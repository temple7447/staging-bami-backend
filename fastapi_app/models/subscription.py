from beanie import Document
from pydantic import Field
from typing import Optional, List
from datetime import datetime
from bson import ObjectId


class Subscription(Document):
    name:           str = ""
    price:          float = 0.0
    billing_period: str = "month"   # month | year | week | day | one-time
    description:    Optional[str] = None
    icon:           Optional[str] = None
    status:         str = "Active"  # Active | Inactive
    features:       List[str] = Field(default_factory=list)
    is_active:      bool = True
    created_by:     Optional[ObjectId] = None
    created_at:     datetime = Field(default_factory=datetime.utcnow)
    updated_at:     datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "subscriptions"
        indexes = [[("status", 1)]]
