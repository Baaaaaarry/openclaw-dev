#!/usr/bin/env python3
import os
import shlex
import subprocess
from typing import List, Optional

def run_claude_prompt(prompt: str,
                     allowed_tools: Optional[List[str]] = None,
                     cwd: Optional[str] = None,
                     timeout_sec: int = 3600) -> str:
    """
    Run `claude -p "<prompt>"` under a pseudo-terminal using `script(1)` to avoid headless hangs.
    Returns stdout text.
    """
    allowed = ""
    if allowed_tools:
        allowed = f"--allowedTools {shlex.quote(','.join(allowed_tools))}"

    claude_cmd = f"claude {allowed} -p {shlex.quote(prompt)}"
    script_cmd = ["script", "-q", "-c", claude_cmd, "/dev/null"]

    env = os.environ.copy()
    env.setdefault("CI", "1")

    p = subprocess.run(
        script_cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=timeout_sec,
    )
    out = p.stdout.strip()
    if p.returncode != 0:
        raise RuntimeError(f"claude failed rc={p.returncode}, output:\n{out}")
    return out
