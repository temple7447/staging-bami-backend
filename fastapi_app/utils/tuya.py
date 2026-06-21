"""
Tuya Cloud API client — handles auth, device reading, and remote control.

Auth flow (client credentials):
  GET /v1.0/token?grant_type=1
  Headers: client_id, sign, t, sign_method=HMAC-SHA256
  Sign = HMAC-SHA256(client_id + t + "" + body_hash, client_secret)

Device status:
  GET /v1.0/devices/{device_id}/status

Device control:
  POST /v1.0/devices/{device_id}/commands

Historical logs:
  GET /v2.0/cloud/thing/{device_id}/report-logs
"""

import hmac
import hashlib
import time
import json
import asyncio
from typing import Optional
import httpx

from core.config import settings

# ── token cache ──────────────────────────────────────────────────────────────

_access_token: Optional[str] = None
_token_expires_at: float = 0.0


def _sign(client_id: str, secret: str, t: int, access_token: str, method: str,
          path: str, body: str = "") -> str:
    body_hash = hashlib.sha256(body.encode()).hexdigest()
    # headers string (empty — we don't sign custom headers)
    str_to_sign = "\n".join([method.upper(), body_hash, "", path])
    message = client_id + access_token + str(t) + str_to_sign
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest().upper()


async def _get_token() -> str:
    global _access_token, _token_expires_at
    if _access_token and time.time() < _token_expires_at - 60:
        return _access_token

    client_id = settings.TUYA_CLIENT_ID
    secret = settings.TUYA_CLIENT_SECRET
    base_url = settings.TUYA_BASE_URL
    t = int(time.time() * 1000)
    path = "/v1.0/token?grant_type=1"

    # For the token request, access_token in sign is empty string
    sign = _sign(client_id, secret, t, "", "GET", path)

    headers = {
        "client_id": client_id,
        "sign": sign,
        "t": str(t),
        "sign_method": "HMAC-SHA256",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{base_url}{path}", headers=headers)
        data = resp.json()

    if not data.get("success"):
        raise RuntimeError(f"Tuya auth failed: {data}")

    result = data["result"]
    _access_token = result["access_token"]
    _token_expires_at = time.time() + result.get("expire_time", 7200)
    return _access_token


async def _request(method: str, path: str, body: dict = None) -> dict:
    client_id = settings.TUYA_CLIENT_ID
    secret = settings.TUYA_CLIENT_SECRET
    base_url = settings.TUYA_BASE_URL
    token = await _get_token()
    t = int(time.time() * 1000)
    body_str = json.dumps(body) if body else ""

    sign = _sign(client_id, secret, t, token, method, path, body_str)

    headers = {
        "client_id": client_id,
        "access_token": token,
        "sign": sign,
        "t": str(t),
        "sign_method": "HMAC-SHA256",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        if method.upper() == "GET":
            resp = await client.get(f"{base_url}{path}", headers=headers)
        elif method.upper() == "POST":
            resp = await client.post(f"{base_url}{path}", headers=headers, content=body_str)
        else:
            resp = await client.request(method.upper(), f"{base_url}{path}",
                                        headers=headers, content=body_str)
    return resp.json()


# ── public helpers ────────────────────────────────────────────────────────────

async def get_device_info(device_id: str) -> dict:
    """Return device metadata (name, online status, category)."""
    data = await _request("GET", f"/v1.0/devices/{device_id}")
    if not data.get("success"):
        raise RuntimeError(f"Tuya device info failed: {data}")
    return data["result"]


async def get_device_status(device_id: str) -> dict:
    """
    Return dict of {dp_code: value} for all data points.

    Common codes:
      cur_voltage (0.1V), cur_current (mA), cur_power (0.1W),
      add_ele (0.001 kWh), power_factor (0.01), switch
    """
    data = await _request("GET", f"/v1.0/devices/{device_id}/status")
    if not data.get("success"):
        raise RuntimeError(f"Tuya status failed: {data}")
    return {dp["code"]: dp["value"] for dp in data.get("result", [])}


async def get_device_history(device_id: str, start_ms: int, end_ms: int,
                              codes: str = "add_ele", size: int = 20) -> list:
    """Return time-series log entries for given DP codes."""
    path = (
        f"/v2.0/cloud/thing/{device_id}/report-logs"
        f"?codes={codes}&start_time={start_ms}&end_time={end_ms}&size={size}"
    )
    data = await _request("GET", path)
    if not data.get("success"):
        return []
    return data.get("result", {}).get("logs", [])


async def set_switch(device_id: str, on: bool) -> bool:
    """Remotely open (True) or close (False) the relay — connect/disconnect power."""
    data = await _request("POST", f"/v1.0/devices/{device_id}/commands",
                          {"commands": [{"code": "switch", "value": on}]})
    return data.get("success", False)


async def recharge_meter(device_id: str, kwh_units: float) -> bool:
    """
    Recharge prepaid meter by adding kWh units.
    Tuya prepaid meters accept 'electricity_left' or 'remaining_electricity' DP.
    Value unit is 0.01 kWh → multiply kwh_units * 100.
    """
    data = await _request("POST", f"/v1.0/devices/{device_id}/commands",
                          {"commands": [{"code": "remaining_electricity",
                                         "value": int(kwh_units * 100)}]})
    return data.get("success", False)


def parse_status(raw: dict) -> dict:
    """
    Normalize Tuya DP values to human-readable units.

    Raw Tuya values use integer encoding:
      cur_voltage   / 10  → V
      cur_current   / 1000 → A
      cur_power     / 10  → W
      add_ele       / 100 → kWh  (some devices /1000)
      power_factor  / 100 → ratio
    """
    def _v(code, divisor, default=0.0):
        val = raw.get(code, 0)
        return round(val / divisor, 3) if isinstance(val, (int, float)) else default

    return {
        "voltage":       _v("cur_voltage", 10),
        "current":       _v("cur_current", 1000),
        "power":         _v("cur_power", 10),
        "kwh":           _v("add_ele", 100),
        "power_factor":  _v("power_factor", 100),
        "switch":        raw.get("switch", True),
        "fault":         raw.get("fault", 0),
        "raw":           raw,
    }
