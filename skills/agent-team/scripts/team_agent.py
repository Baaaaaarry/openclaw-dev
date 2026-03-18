#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import re
import time
import uuid
from typing import Any

from claude_pty import run_claude_prompt
from git_ops import ensure_clean_repo, checkout_base, create_branch, commit_all, push_branch, get_diff_summary
from jenkins_client import JenkinsClient
from notify import notify

def load_template(path: str) -> str:
    return pathlib.Path(path).read_text(encoding="utf-8")

def render(tpl: str, **kwargs) -> str:
    out = tpl
    for k, v in kwargs.items():
        out = out.replace("{{" + k + "}}", v)
    return out

def must_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"Cannot find JSON in output:\n{text}")
    return json.loads(m.group(0))

def write_run_file(run_dir: pathlib.Path, name: str, data: Any) -> None:
    p = run_dir / name
    if isinstance(data, (dict, list)):
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        p.write_text(str(data), encoding="utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="path to git repo")
    ap.add_argument("--prompt", required=True, help="user requirement prompt")
    ap.add_argument("--base", default="main", help="base branch, default main")
    ap.add_argument("--remote", default="origin", help="remote name, default origin")
    ap.add_argument("--max_review_loops", type=int, default=2, help="max loops when review requests changes")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    run_id = time.strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    run_dir = pathlib.Path(repo) / ".team_agent_runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    notify("run_start", {"run_id": run_id, "repo": repo})
    ensure_clean_repo(repo)
    checkout_base(repo, args.base)

    arch_tpl = load_template(os.path.join(os.path.dirname(__file__), "..", "templates", "arch_prompt.txt"))
    arch_prompt = render(arch_tpl, USER_REQUIREMENT=args.prompt)
    arch_out = run_claude_prompt(arch_prompt, allowed_tools=["bash"])
    arch_json = must_json(arch_out)
    write_run_file(run_dir, "arch.json", arch_json)
    notify("arch_done", {"requirements": len(arch_json.get("requirements", [])), "test_points": len(arch_json.get("test_points", []))})

    feature_branch = f"feature/team_{run_id}"
    create_branch(repo, feature_branch)

    dev_tpl = load_template(os.path.join(os.path.dirname(__file__), "..", "templates", "dev_prompt.txt"))
    test_tpl = load_template(os.path.join(os.path.dirname(__file__), "..", "templates", "test_prompt.txt"))
    review_tpl = load_template(os.path.join(os.path.dirname(__file__), "..", "templates", "review_prompt.txt"))

    j_url = os.getenv("JENKINS_URL")
    j_user = os.getenv("JENKINS_USER")
    j_token = os.getenv("JENKINS_API_TOKEN")
    j_job = os.getenv("JENKINS_JOB")
    j_params_raw = os.getenv("JENKINS_PARAMS", "").strip()
    j_params = json.loads(j_params_raw) if j_params_raw else {}

    if not (j_url and j_user and j_token and j_job):
        raise RuntimeError("Missing Jenkins env vars: JENKINS_URL/JENKINS_USER/JENKINS_API_TOKEN/JENKINS_JOB")

    jc = JenkinsClient(j_url, j_user, j_token, verify_tls=True)

    review_loops = 0
    while True:
        dev_prompt = render(dev_tpl, REQUIREMENTS_JSON=json.dumps(arch_json, ensure_ascii=False, indent=2))
        dev_out = run_claude_prompt(dev_prompt, allowed_tools=["bash"])
        write_run_file(run_dir, f"dev_loop{review_loops}.log", dev_out)
        dev_json = must_json(dev_out)
        write_run_file(run_dir, f"dev_loop{review_loops}.json", dev_json)

        commit_msg = dev_json.get("commit_message") or f"Implement: {run_id}"
        commit_all(repo, commit_msg)
        push_branch(repo, args.remote, feature_branch)
        notify("dev_committed", {"branch": feature_branch, "commit_message": commit_msg})

        if "BRANCH" not in j_params:
            j_params["BRANCH"] = feature_branch

        queue_url = jc.trigger_build(j_job, params=j_params)
        notify("jenkins_triggered", {"job": j_job, "queue_url": queue_url})
        build_res = jc.wait_for_build(j_job, queue_url, poll_sec=5, timeout_sec=7200)
        write_run_file(run_dir, f"jenkins_loop{review_loops}.json", build_res.__dict__)
        notify("jenkins_done", {"result": build_res.result, "build_url": build_res.build_url})

        if build_res.result != "SUCCESS":
            raise RuntimeError(f"Jenkins gate failed: {build_res.build_url} result={build_res.result}")

        ci_info = {
            "branch": feature_branch,
            "job": j_job,
            "build_url": build_res.build_url,
            "build_number": build_res.number,
        }
        test_prompt = render(
            test_tpl,
            TEST_POINTS_JSON=json.dumps(arch_json.get("test_points", []), ensure_ascii=False, indent=2),
            CI_BUILD_INFO=json.dumps(ci_info, ensure_ascii=False, indent=2),
        )
        test_out = run_claude_prompt(test_prompt, allowed_tools=["bash"])
        test_json = must_json(test_out)
        write_run_file(run_dir, f"test_loop{review_loops}.json", test_json)
        notify("test_done", {"overall": test_json.get("overall")})

        if str(test_json.get("overall", "")).upper() != "PASS":
            raise RuntimeError(f"Black-box tests failed. See {run_dir}/test_loop{review_loops}.json")

        notify("push_for_review", {"branch": feature_branch, "note": "Assuming remote hook triggers review email."})

        diff_summary = get_diff_summary(repo, args.base)
        review_prompt = render(
            review_tpl,
            DIFF_SUMMARY=diff_summary,
            CONTEXT=f"RunID={run_id}, branch={feature_branch}, base={args.base}",
        )
        review_out = run_claude_prompt(review_prompt, allowed_tools=["bash"])
        review_json = must_json(review_out)
        write_run_file(run_dir, f"review_loop{review_loops}.json", review_json)
        notify("review_done", {"decision": review_json.get("decision"), "comments": len(review_json.get("comments", []))})

        decision = str(review_json.get("decision", "")).upper()
        if decision == "APPROVE":
            final = f"# Final Summary\n\n- Run: {run_id}\n- Branch: {feature_branch}\n- Jenkins: {build_res.build_url}\n- Test: PASS\n- Review: APPROVE\n"
            write_run_file(run_dir, "final_summary.md", final)
            notify("run_success", {"run_id": run_id, "branch": feature_branch})
            return

        review_loops += 1
        if review_loops > args.max_review_loops:
            raise RuntimeError(f"Exceeded max review loops ({args.max_review_loops}). Please resolve manually.")

        arch_json["requirements"].append({
            "id": f"review_loop_{review_loops}",
            "description": "Apply review comments and re-run CI+tests.",
            "acceptance_criteria": "All review blockers resolved; CI+tests pass again.",
            "constraints": "Keep diffs minimal; do not regress tests.",
            "dependencies": [],
            "review_comments": review_json.get("comments", []),
        })
        notify("looping", {"review_loop": review_loops, "reason": "REQUEST_CHANGES"})

if __name__ == "__main__":
    main()
