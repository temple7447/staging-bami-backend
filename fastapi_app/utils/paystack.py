"""Paystack transaction verification.

Wallet top-ups must correspond to real money received. We never trust a
client-supplied amount — we verify the reference against Paystack and read
the amount back from them. Fails closed: if the key is missing or the call
fails, verification fails and no credit happens.
"""
import os
import httpx

PAYSTACK_VERIFY_URL = "https://api.paystack.co/transaction/verify/{ref}"


class PaystackError(Exception):
    """Verification could not be completed (config/network/Paystack down)."""


async def verify_transaction(reference: str) -> dict:
    """Return normalized verification result for a reference.

    {"success": bool, "amount": float (naira), "currency": str,
     "customer_email": str, "raw": {...}}

    Raises PaystackError if verification cannot be performed at all — callers
    must treat that as "not verified" and refuse to credit.
    """
    secret = os.getenv("PAYSTACK_SECRET_KEY", "")
    if not secret:
        raise PaystackError("PAYSTACK_SECRET_KEY not configured")
    if not reference:
        raise PaystackError("missing reference")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                PAYSTACK_VERIFY_URL.format(ref=reference),
                headers={"Authorization": f"Bearer {secret}"},
            )
    except httpx.HTTPError as e:
        raise PaystackError(f"verification request failed: {e}") from e

    if resp.status_code != 200:
        raise PaystackError(f"paystack returned {resp.status_code}")

    payload = resp.json()
    if not payload.get("status"):
        raise PaystackError(payload.get("message", "verification failed"))

    data = payload.get("data", {})
    return {
        "success": data.get("status") == "success",
        # Paystack amounts are in kobo.
        "amount": (data.get("amount") or 0) / 100.0,
        "currency": data.get("currency", "NGN"),
        "customer_email": (data.get("customer") or {}).get("email", ""),
        "raw": data,
    }
