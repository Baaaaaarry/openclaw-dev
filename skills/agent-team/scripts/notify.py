#!/usr/bin/env python3
import json
import os
from typing import Any, Dict

import requests

def notify(event: str, payload: Dict[str, Any]) -> None:
    print(f"[TEAM_NOTIFY] {event}: {json.dumps(payload, ensure_ascii=False)}")

    webhook = os.getenv("TEAM_NOTIFY_WEBHOOK")
    if webhook:
        try:
            requests.post(webhook, json={"event": event, "payload": payload}, timeout=10)
        except Exception as e:
            print(f"[TEAM_NOTIFY] webhook failed: {e}")
