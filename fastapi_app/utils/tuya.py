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


async def _command(device_id: str, code: str, value) -> bool:
    data = await _request("POST", f"/v1.0/devices/{device_id}/commands",
                          {"commands": [{"code": code, "value": value}]})
    return bool(data.get("success", False))


async def set_prepayment(device_id: str, on: bool) -> bool:
    """Turn the meter's own prepaid mode on/off. With it ON the meter itself cuts
    power when its balance reaches zero, whether or not our server is reachable."""
    return await _command(device_id, "switch_prepayment", on)


async def recharge_meter(device_id: str, kwh_units: float) -> bool:
    """Send purchased kWh to the meter. Returns whether Tuya accepted the command
    (NOT whether the balance moved — callers verify with read_balance_kwh).

    Breaker-type prepaid meters (category dlq) take `charge_energy`, scale 2
    (0.01 kWh steps); older prepaid meters take `remaining_electricity`."""
    status = await get_device_status(device_id)
    units = int(round(kwh_units * 100))
    if units <= 0:
        return False
    code = "charge_energy" if "charge_energy" in status else "remaining_electricity"
    return await _command(device_id, code, units)


async def read_balance_kwh(device_id: str):
    """The meter's own remaining-credit reading in kWh, or None if it has none."""
    status = await get_device_status(device_id)
    return parse_status(status)["balance_kwh"]


def _decode_phase(b64: str) -> tuple[float, float, float]:
    """Breaker meters pack one phase into 8 bytes: voltage (0.1 V, 2 bytes),
    current (mA, 3 bytes), power (W, 3 bytes)."""
    import base64
    try:
        b = base64.b64decode(b64)
    except Exception:
        return 0.0, 0.0, 0.0
    if len(b) < 8:
        return 0.0, 0.0, 0.0
    return (int.from_bytes(b[0:2], "big") / 10,
            int.from_bytes(b[2:5], "big") / 1000,
            float(int.from_bytes(b[5:8], "big")))


def parse_status(raw: dict) -> dict:
    """
    Normalize Tuya DP values to human-readable units.

    Two families are understood:
      * breaker meters (category dlq): phase_a (packed), total_forward_energy and
        balance_energy (both 0.01 kWh), switch_prepayment
      * plain energy meters: cur_voltage/10, cur_current/1000, cur_power/10,
        add_ele/100, power_factor/100
    `balance_kwh` is the meter's own remaining credit, or None when the device
    has no prepaid balance of its own.
    """
    if "phase_a" in raw:
        v, a, w = _decode_phase(raw.get("phase_a") or "")
        return {
            "voltage": v, "current": a, "power": w,
            "kwh": round((raw.get("total_forward_energy") or 0) / 100, 3),
            "power_factor": 0.0,
            "balance_kwh": round((raw.get("balance_energy") or 0) / 100, 3)
                           if "balance_energy" in raw else None,
            "prepayment": bool(raw.get("switch_prepayment", False)),
            "switch": raw.get("switch", True),
            "fault": raw.get("fault", 0),
            "raw": raw,
        }

    def _v(code, divisor, default=0.0):
        val = raw.get(code, 0)
        return round(val / divisor, 3) if isinstance(val, (int, float)) else default

    return {
        "voltage":       _v("cur_voltage", 10),
        "current":       _v("cur_current", 1000),
        "power":         _v("cur_power", 10),
        "kwh":           _v("add_ele", 100),
        "power_factor":  _v("power_factor", 100),
        "balance_kwh":   None,
        "prepayment":    False,
        "switch":        raw.get("switch", True),
        "fault":         raw.get("fault", 0),
        "raw":           raw,
    }
