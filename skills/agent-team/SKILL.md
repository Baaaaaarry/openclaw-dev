---
name: agent-team
description: "Operate a multi-agent dev team workflow (arch/dev/test/review) with Jenkins gate, including requirements breakdown, implementation, whitebox tests, CI build, blackbox tests, code review, and rework loop. Use for coordinating dev team agent pipelines on a repo."
---

# TEAM Agent Skill (Arch/Dev/Test/Review + Jenkins Gate)

## Purpose

This skill provides a "dev team agent" workflow on the local machine:

1. arch agent: understand the user prompt, produce (a) implementation requirements and (b) test points, and dispatch them to dev and test agents.
2. dev agent: implement the requirements, run white-box tests, then submit to Jenkins CI gate build. On CI success, notify test agent to validate via black-box tests using the latest CI artifacts/build.
3. after all tests pass: push code to remote repo to trigger code review email; also notify review agent to perform code inspection.
4. dev agent and review agent discuss whether changes are needed; if changes are made, repeat step (2) and re-push for review.

## Entry

Run locally:

- `python3 scripts/team_agent.py --repo <path> --prompt "<your requirement>"`

## Required Environment

### Claude Code

- `claude` CLI available in PATH.
- This skill uses a PTY wrapper to avoid headless hangs.

### Git

- Repo is a git working tree.
- Remote `origin` configured.
- Default base branch: `main` (configurable).

### Jenkins Gate

Set:

- `JENKINS_URL` e.g. https://jenkins.example.com
- `JENKINS_USER`
- `JENKINS_API_TOKEN`
- `JENKINS_JOB` e.g. my-folder/my-job
  Optional:
- `JENKINS_PARAMS` JSON string for buildWithParameters, e.g. `{"BRANCH":"feature/xxx"}`

### Notifications (optional)

- `TEAM_NOTIFY_WEBHOOK` (HTTP webhook to post status updates)
- `TEAM_NOTIFY_CONSOLE=1` (default)

## Agents & Responsibilities

### arch agent

Input: user prompt
Output (JSON):

- requirements: detailed implementation tasks, constraints, acceptance criteria
- test_points: functional test checklist, edge cases, non-functional checks

### dev agent

Input: requirements + repo context
Do:

- create feature branch
- implement changes
- run white-box tests (unit/lint)
- commit
- trigger Jenkins gate build and wait for result
  On success: notify test agent with branch + build URL + artifact info

### test agent

Input: test_points + build info
Do:

- fetch CI artifact/build instructions
- run black-box tests (functional / E2E / API)
  Output: pass/fail + evidence + potential defect tickets

### review agent

Input: PR/diff summary + context
Do:

- inspect code: correctness, style, security, performance, test adequacy
  Output: review comments, suggested changes

## Failure Handling

- Any step failure stops the pipeline and prints actionable next steps:
  - arch parse failure -> rerun with simplified prompt
  - dev tests fail -> dev fixes locally then retries
  - Jenkins gate fail -> print console log + dev fixes then retriggers
  - black-box fail -> dev fixes, rerun step (2)
  - review requires change -> dev/review discussion then loop

## Outputs

The runner persists:

- `.team_agent_runs/<run_id>/arch.json`
- `.team_agent_runs/<run_id>/dev.log`
- `.team_agent_runs/<run_id>/jenkins.json`
- `.team_agent_runs/<run_id>/test.json`
- `.team_agent_runs/<run_id>/review.json`
- `.team_agent_runs/<run_id>/final_summary.md`

## Security

- Jenkins credentials are read from environment variables only.
- No secrets printed to console; logs redact tokens.
