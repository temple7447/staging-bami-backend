from beanie import Document
from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime
from enum import Enum
from bson import ObjectId


class TenantStatus(str, Enum):
    occupied = "occupied"
    vacant   = "vacant"
    pending  = "pending"
    evicted  = "evicted"


class TenantType(str, Enum):
    new      = "new"
    existing = "existing"
    transfer = "transfer"


class TenantHistory(BaseModel):
    """Embedded history entry — stored inline inside the tenant document."""
    event:      str
    note:       Optional[str] = None
    meta:       Optional[Any] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    created_by: Optional[str] = None


class Tenant(Document):
    estate:     ObjectId
    unit:       ObjectId
    unit_label: str = ""

    tenant_name:  str
    tenant_email: Optional[str] = None
    tenant_phone: Optional[str] = None

    rent_amount:            float = 0.0
    base_rent:              float = 0.0
    service_charge_amount:  float = 0.0
    base_service_charge:    float = 0.0

    tenant_type: str = "new"
    status:      str = "occupied"

    electric_meter_number: str = ""
    entry_date:            Optional[datetime] = None
    next_due_date:         Optional[datetime] = None

    user:                    Optional[ObjectId] = None
    profile_image_url:       Optional[str] = None
    profile_image_public_id: Optional[str] = None

    history: List[TenantHistory] = Field(default_factory=list)

    is_active:  bool = True
    created_by: Optional[ObjectId] = None
    updated_by: Optional[ObjectId] = None

    rent_outstanding:            float = 0.0
    service_charge_outstanding:  float = 0.0

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "tenants"
        indexes = [
            [("estate", 1), ("is_active", 1), ("status", 1)],
            [("estate", 1), ("next_due_date", 1)],
            [("tenant_email", 1)],
            [("is_active", 1), ("next_due_date", 1)],
            [("status", 1), ("next_due_date", 1)],
        ]
