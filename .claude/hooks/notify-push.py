#!/usr/bin/env python3
"""PostToolUse/Bash hook — after `git push` in this repo, SMS a summary of
what was pushed via BulkSMS Nigeria (same API utils/sms_service.py uses).

Credentials are read from .env at runtime, never hardcoded here, so nothing
sensitive ends up in this file (which is tracked in this repo)."""
import json
import os
import subprocess
import sys

REPO_DIR = "/Users/temple/Documents/Bami/BamiHustle-backend"
REPO_LABEL = "backend"


def env_var(name: str) -> str:
    try:
        with open(os.path.join(REPO_DIR, ".env")) as f:
            for line in f:
                if line.startswith(f"{name}="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    command = (payload.get("tool_input") or {}).get("command") or ""
    if "git push" not in command:
        return

    token = env_var("BULKSMS_NG_API_TOKEN")
    phone = env_var("PUSH_NOTIFY_PHONE")
    if not token or not phone:
        return

    try:
        subject = subprocess.run(
            ["git", "-C", REPO_DIR, "log", "-1", "--pretty=%s"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
    except Exception:
        subject = ""
    if not subject:
        return

    body = f"BamiHost: pushed to {REPO_LABEL} - {subject}"
    sms_payload = json.dumps({"from": "BamiHost", "to": phone, "body": body})

    try:
        subprocess.run(
            [
                "curl", "-s", "-X", "POST",
                "https://www.bulksmsnigeria.com/api/v2/sms",
                "-H", f"Authorization: Bearer {token}",
                "-H", "Content-Type: application/json",
                "-H", "Accept: application/json",
                "-d", sms_payload,
            ],
            capture_output=True, timeout=20,
        )
    except Exception:
        pass


if __name__ == "__main__":
    main()
