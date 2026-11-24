"""QuickPin Nigeria client (airtime + electricity resale).

https://www.quickpinnigeria.com/developers — Bearer key, server-side only.
Every purchase carries a `client_reference` (our Transaction id), so a retry
after a timeout returns the original order instead of buying twice.

`QuickPinError.definite` is True when QuickPin clearly refused the order (nothing
was bought, safe to refund). It is False when we cannot know (timeout, 5xx, bad
body): the caller must NOT refund then — it must ask QuickPin what happened.
"""
import logging

import httpx

from core.config import settings

log = logging.getLogger("quickpin")

# QuickPin error codes that mean "the order was not placed".
_DEFINITE = {
    "invalid_request", "invalid_json", "insufficient_balance", "invalid_meter", "invalid_smartcard",
    "service_unavailable", "maintenance", "rate_limited", "missing_api_key", "invalid_api_key",
    "account_suspended", "not_found",
}


class QuickPinError(Exception):
    def __init__(self, code: str, message: str, status: int = 0, definite: bool = False, data: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.definite = definite
        self.data = data or {}


def configured() -> bool:
    return bool(settings.QUICKPIN_API_KEY)


async def _call(method: str, path: str, *, json: dict | None = None, timeout: float = 45.0) -> tuple[int, dict]:
    if not configured():
        raise QuickPinError("not_configured", "QuickPin is not configured", definite=True)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.request(
                method, f"{settings.QUICKPIN_BASE_URL}{path}", json=json,
                headers={"Authorization": f"Bearer {settings.QUICKPIN_API_KEY}"},
            )
    except httpx.HTTPError as e:
        raise QuickPinError("network", f"QuickPin unreachable: {type(e).__name__}", definite=False)
    try:
        data = res.json()
    except ValueError:
        raise QuickPinError("bad_response", "QuickPin sent an unreadable reply", res.status_code, definite=False)
    if res.status_code in (200, 202):
        return res.status_code, data
    code = str(data.get("error") or "provider_error")
    log.warning("quickpin %s %s -> %s %s", method, path, res.status_code, code)
    raise QuickPinError(code, str(data.get("message") or code), res.status_code,
                        definite=(code in _DEFINITE and res.status_code < 500) or res.status_code == 422, data=data)


async def catalog() -> dict:
    return (await _call("GET", "/catalog", timeout=20))[1]


async def verify_meter(disco: str, meter_type: str, meter_number: str) -> dict:
    return (await _call("POST", "/verify/meter", json={
        "disco": disco, "meter_type": meter_type, "meter_number": meter_number}, timeout=30))[1]


async def buy_airtime(network: str, amount: int, phone: str, ref: str) -> tuple[int, dict]:
    return await _call("POST", "/airtime", json={
        "network": network, "amount": amount, "phone": phone, "client_reference": ref})


async def buy_electricity(disco: str, meter_type: str, meter_number: str, amount: int, phone: str, ref: str) -> tuple[int, dict]:
    return await _call("POST", "/electricity", json={
        "disco": disco, "meter_type": meter_type, "meter_number": meter_number,
        "amount": amount, "phone": phone, "client_reference": ref})


async def order_status(ref: str) -> tuple[int, dict]:
    """200 = delivered, 202 = still processing. A failed order raises QuickPinError(status=422)."""
    return await _call("GET", f"/transactions/{ref}", timeout=20)
