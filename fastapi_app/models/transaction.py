from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class Transaction(Document):
    tenant:       Optional[ObjectId] = None
    estate:       Optional[ObjectId] = None
    amount:       float = 0.0
    type:         str = "rent"
    method:       Optional[str] = None
    status:       str = "paid"
    reference:    Optional[str] = None
    period_month: Optional[int] = None
    period_year:  Optional[int] = None
    notes:        Optional[str] = None
    is_active:    bool = True
    created_by:   Optional[ObjectId] = None
    created_at:   datetime = Field(default_factory=datetime.utcnow)
    updated_at:   datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "transactions"
        indexes = [
            [("tenant", 1), ("status", 1)],
            [("estate", 1)],
        ]
