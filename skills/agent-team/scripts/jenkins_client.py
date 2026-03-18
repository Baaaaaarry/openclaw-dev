#!/usr/bin/env python3
import json
import time
import urllib.parse
from dataclasses import dataclass
from typing import Dict, Optional

import requests

@dataclass
class JenkinsBuildResult:
    job: str
    queue_url: str
    build_url: Optional[str]
    number: Optional[int]
    result: Optional[str]
    duration_ms: Optional[int]

class JenkinsClient:
    def __init__(self, base_url: str, user: str, token: str, verify_tls: bool = True):
        self.base_url = base_url.rstrip("/")
        self.auth = (user, token)
        self.verify_tls = verify_tls
        self.session = requests.Session()

    def _url(self, path: str) -> str:
        return f"{self.base_url}/{path.lstrip('/')}"

    def trigger_build(self, job: str, params: Optional[Dict[str, str]] = None) -> str:
        parts = [p for p in job.split("/") if p]
        job_path = "/".join([f"job/{urllib.parse.quote(p)}" for p in parts])

        if params:
            url = self._url(f"{job_path}/buildWithParameters")
            r = self.session.post(url, auth=self.auth, params=params, verify=self.verify_tls)
        else:
            url = self._url(f"{job_path}/build")
            r = self.session.post(url, auth=self.auth, verify=self.verify_tls)

        if r.status_code not in (200, 201, 202):
            raise RuntimeError(f"Jenkins trigger failed: {r.status_code} {r.text}")

        queue_url = r.headers.get("Location")
        if not queue_url:
            raise RuntimeError("Jenkins did not return queue Location header")
        return queue_url

    def wait_for_build(self, job: str, queue_url: str, poll_sec: int = 5, timeout_sec: int = 3600) -> JenkinsBuildResult:
        t0 = time.time()
        build_url = None
        number = None

        while time.time() - t0 < timeout_sec:
            qr = self.session.get(f"{queue_url}api/json", auth=self.auth, verify=self.verify_tls)
            if qr.status_code != 200:
                raise RuntimeError(f"Jenkins queue query failed: {qr.status_code} {qr.text}")
            qj = qr.json()
            if "executable" in qj and qj["executable"]:
                build_url = qj["executable"]["url"]
                number = qj["executable"]["number"]
                break
            time.sleep(poll_sec)

        if not build_url:
            raise TimeoutError("Timeout waiting for Jenkins queue to start build")

        while time.time() - t0 < timeout_sec:
            br = self.session.get(f"{build_url}api/json", auth=self.auth, verify=self.verify_tls)
            if br.status_code != 200:
                raise RuntimeError(f"Jenkins build query failed: {br.status_code} {br.text}")
            bj = br.json()
            building = bj.get("building", True)
            result = bj.get("result", None)
            duration = bj.get("duration", None)
            if not building and result:
                return JenkinsBuildResult(job=job, queue_url=queue_url, build_url=build_url, number=number, result=result, duration_ms=duration)
            time.sleep(poll_sec)

        raise TimeoutError("Timeout waiting for Jenkins build to finish")
