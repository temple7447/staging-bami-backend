"""Paystack client: initialize, verify, and webhook-signature check.

Money safety rules this module exists to enforce:
  * the amount is always read back from Paystack, never taken from a client;
  * everything fails closed — a missing key or a failed call means "not
    verified", and the caller must not credit anything;
  * a webhook body is only believed if its HMAC-SHA512 signature matches.
"""
import hashlib
import hmac

import httpx

from core.config import settings

PAYSTACK_BASE = "https://api.paystack.co"


class PaystackError(Exception):
    """The call could not be completed (config, network, or Paystack refused)."""


def _secret() -> str:
    secret = settings.PAYSTACK_SECRET_KEY
    if not secret:
        raise PaystackError("PAYSTACK_SECRET_KEY not configured")
    return secret


async def _request(method: str, path: str, **kwargs) -> dict:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.request(
                method, f"{PAYSTACK_BASE}{path}",
                headers={"Authorization": f"Bearer {_secret()}"}, **kwargs,
            )
    except httpx.HTTPError as e:
        raise PaystackError(f"request failed: {e}") from e
    try:
        payload = resp.json()
    except ValueError:
        raise PaystackError(f"paystack returned {resp.status_code} with a non-JSON body")
    if resp.status_code != 200 or not payload.get("status"):
        raise PaystackError(payload.get("message") or f"paystack returned {resp.status_code}")
    return payload


async def initialize_transaction(*, email: str, amount_naira: float, reference: str,
                                 callback_url: str, metadata: dict | None = None) -> dict:
    """Start a checkout. Returns {"authorization_url", "access_code", "reference"}."""
    if not email:
        raise PaystackError("an email address is required to start a payment")
    payload = await _request("POST", "/transaction/initialize", json={
        "email": email,
        # Paystack amounts are in kobo.
        "amount": int(round(amount_naira * 100)),
        "currency": "NGN",
        "reference": reference,
        "callback_url": callback_url,
        "metadata": metadata or {},
    })
    data = payload.get("data") or {}
    if not data.get("authorization_url"):
        raise PaystackError("paystack did not return a checkout link")
    return data


async def verify_transaction(reference: str) -> dict:
    """Return {"success", "amount" (naira), "currency", "customer_email", "raw"}."""
    if not reference:
        raise PaystackError("missing reference")
    payload = await _request("GET", f"/transaction/verify/{reference}")
    data = payload.get("data") or {}
    return {
        "success": data.get("status") == "success",
        "amount": (data.get("amount") or 0) / 100.0,
        "currency": data.get("currency", "NGN"),
        "customer_email": (data.get("customer") or {}).get("email", ""),
        "raw": data,
    }


def valid_webhook_signature(raw_body: bytes, signature: str | None) -> bool:
    """Paystack signs the raw body with HMAC-SHA512 using the secret key."""
    secret = settings.PAYSTACK_SECRET_KEY
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, signature)
