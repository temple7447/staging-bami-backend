from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class Wallet(Document):
    user_id:        ObjectId
    balance:        float = 0.0
    total_earnings: float = 0.0
    total_spent:    float = 0.0
    currency:       str = "NGN"
    is_active:      bool = True
    created_at:     datetime = Field(default_factory=datetime.utcnow)
    updated_at:     datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "wallets"
        indexes = [[("user_id", 1)]]
