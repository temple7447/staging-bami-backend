from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class BankDeposit(Document):
    amount:       float = 0.0
    bank_name:    Optional[str] = None
    reference:    Optional[str] = None
    paid_for:     Optional[str] = None
    status:       str = "pending"   # pending | approved | rejected
    submitted_by: Optional[ObjectId] = None
    approved_by:  Optional[ObjectId] = None
    notes:        Optional[str] = None
    is_active:    bool = True
    created_at:   datetime = Field(default_factory=datetime.utcnow)
    updated_at:   datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "bank-deposits"
        indexes = [[("status", 1), ("created_at", -1)]]
