from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class BillingItem(Document):
    user:         Optional[ObjectId] = None
    tenant:       Optional[ObjectId] = None
    estate:       Optional[ObjectId] = None
    label:        str = ""
    item_type:    str = "other"
    amount:       float = 0.0
    due_date:     Optional[datetime] = None
    description:  Optional[str] = None
    is_recurring: bool = False
    is_paid:      bool = False
    is_active:    bool = True
    category:     Optional[str] = None
    frequency:    Optional[str] = None
    created_by:   Optional[ObjectId] = None
    created_at:   datetime = Field(default_factory=datetime.utcnow)
    updated_at:   datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "billing-items"
        indexes = [
            [("user", 1), ("is_active", 1), ("is_paid", 1)],
            [("tenant", 1)],
        ]
