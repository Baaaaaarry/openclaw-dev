#!/usr/bin/env python3
import subprocess

def _run(cmd, cwd: str, check: bool = True) -> str:
    p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"cmd failed: {' '.join(cmd)}\n{p.stdout}")
    return p.stdout.strip()

def ensure_clean_repo(repo: str) -> None:
    s = _run(["git", "status", "--porcelain"], cwd=repo)
    if s.strip():
        raise RuntimeError("Repo is not clean. Please commit/stash changes before running team_agent.")

def checkout_base(repo: str, base_branch: str) -> None:
    _run(["git", "fetch", "origin"], cwd=repo)
    _run(["git", "checkout", base_branch], cwd=repo)
    _run(["git", "pull", "--ff-only", "origin", base_branch], cwd=repo)

def create_branch(repo: str, branch: str) -> None:
    _run(["git", "checkout", "-b", branch], cwd=repo)

def commit_all(repo: str, message: str) -> None:
    _run(["git", "add", "-A"], cwd=repo)
    _run(["git", "commit", "-m", message], cwd=repo)

def push_branch(repo: str, remote: str, branch: str) -> None:
    _run(["git", "push", "-u", remote, branch], cwd=repo)

def get_diff_summary(repo: str, base_branch: str) -> str:
    return _run(["git", "diff", f"origin/{base_branch}...HEAD", "--stat"], cwd=repo, check=False)
