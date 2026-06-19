from beanie import Document
from pydantic import Field
from typing import Optional, Any
from datetime import datetime
from enum import Enum
from bson import ObjectId


class PaymentStatus(str, Enum):
    pending   = "pending"
    completed = "completed"
    failed    = "failed"
    refunded  = "refunded"


class Payment(Document):
    tenant:         ObjectId
    estate:         Optional[ObjectId] = None
    amount:         float
    payment_type:   str
    payment_status: PaymentStatus = PaymentStatus.pending
    reference:      Optional[str] = None
    paystack_response: Optional[Any] = None
    created_by:     Optional[ObjectId] = None
    created_at:     datetime = Field(default_factory=datetime.utcnow)
    updated_at:     datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "payments"
        indexes = [
            [("tenant", 1), ("payment_status", 1)],
            [("reference", 1)],
        ]
