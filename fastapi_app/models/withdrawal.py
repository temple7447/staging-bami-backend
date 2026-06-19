from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class Withdrawal(Document):
    user:         Optional[ObjectId] = None
    amount:       float = 0.0
    bank_details: Optional[dict] = None
    status:       str = "pending"  # pending | approved | rejected | completed
    reference:    Optional[str] = None
    notes:        Optional[str] = None
    reviewed_by:  Optional[ObjectId] = None
    reviewed_at:  Optional[datetime] = None
    is_active:    bool = True
    created_at:   datetime = Field(default_factory=datetime.utcnow)
    updated_at:   datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "withdrawals"
        indexes = [
            [("user", 1), ("status", 1)],
            [("reference", 1)],
        ]
