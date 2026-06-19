from beanie import Document
from pydantic import Field
from typing import Optional, List
from datetime import datetime
from bson import ObjectId


class WalletAccount(Document):
    """Estate-level wallet for rent distribution."""
    estate:          Optional[ObjectId] = None
    balance:         float = 0.0
    total_received:  float = 0.0
    total_disbursed: float = 0.0
    currency:        str = "NGN"
    is_active:       bool = True
    created_at:      datetime = Field(default_factory=datetime.utcnow)
    updated_at:      datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "wallet-accounts"
        indexes = [[("estate", 1)]]
