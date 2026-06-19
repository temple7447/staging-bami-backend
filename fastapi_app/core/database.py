from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI
from core.config import settings
import logging

logger = logging.getLogger(__name__)

client: AsyncIOMotorClient = None


async def connect_db(app: FastAPI):
    global client
    client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = client.get_default_database()

    # Import all Beanie document models here so they are registered
    from models.user import User
    from models.tenant import Tenant
    from models.estate import Estate
    from models.unit import Unit
    from models.payment import Payment
    from models.wallet import Wallet
    from models.wallet_account import WalletAccount
    from models.transaction import Transaction
    from models.notification import Notification
    from models.issue import Issue
    from models.billing_item import BillingItem
    from models.subscription import Subscription
    from models.service_request import ServiceRequest
    from models.rental_application import RentalApplication
    from models.enquiry import Enquiry
    from models.bank_deposit import BankDeposit
    from models.withdrawal import Withdrawal
    from models.business_type import BusinessType
    from models.visit import Visit
    from models.reminder_log import ReminderLog
    from models.setting import Setting

    await init_beanie(
        database=db,
        document_models=[
            User, Tenant, Estate, Unit, Payment, Wallet, WalletAccount,
            Transaction, Notification, Issue, BillingItem, Subscription,
            ServiceRequest, RentalApplication, Enquiry, BankDeposit,
            Withdrawal, BusinessType, Visit, ReminderLog, Setting,
        ]
    )
    logger.info("Database connected and Beanie initialised")


async def disconnect_db():
    global client
    if client:
        client.close()
        logger.info("Database connection closed")
