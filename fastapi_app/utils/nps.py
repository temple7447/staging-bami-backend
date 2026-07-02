"""
Auto-NPS — after a tenant's first confirmed payment, automatically send the
1-question NPS survey on Telegram (the bot captures their 0-10 reply).

Gated on `nps_asked_at` so each tenant is only ever asked once.
"""
import logging
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)

NPS_MESSAGE = (
    "🎉 Thanks for your payment! Quick favour — on a scale of *0 to 10*, how likely "
    "are you to recommend us to a friend or colleague?\n\nJust reply with a number (0–10). 🙏"
)


async def maybe_request_first_payment_nps(db: AsyncSession, tenant_id: str) -> None:
    """If the tenant is on Telegram and hasn't been surveyed yet, send the NPS ask.
    Never raises — failures are logged so they can't break the payment flow."""
    try:
        from models.tenant import Tenant
        from utils.telegram_service import send_to_tenant, is_configured
        from sqlalchemy import select

        if not is_configured():
            return
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalars().first()
        if not tenant or not tenant.telegram_id or tenant.nps_asked_at is not None:
            return
        res = await send_to_tenant(db, tenant.id, NPS_MESSAGE)
        if res.get("success"):
            tenant.nps_asked_at = utcnow()
            await db.commit()
            logger.info("[AUTO_NPS] survey sent to tenant %s", tenant_id)
    except Exception as e:
        logger.warning("[AUTO_NPS] failed for tenant %s: %s", tenant_id, e)
