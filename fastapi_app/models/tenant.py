from beanie import Document
from pydantic import Field
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


class HistoryEvent(str, Enum):
    created    = "created"
    moved_in   = "moved_in"
    moved_out  = "moved_out"
    rent_update = "rent_update"
    payment    = "payment"
    note       = "note"


class TenantHistory(Document):
    event:      HistoryEvent
    note:       Optional[str] = None
    meta:       Optional[Any] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: Optional[ObjectId] = None

    class Settings:
        name = "tenant_history"


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

    tenant_type: TenantType   = TenantType.new
    status:      TenantStatus = TenantStatus.occupied

    electric_meter_number: str = ""
    entry_date:            Optional[datetime] = None
    next_due_date:         Optional[datetime] = None

    user:                    Optional[ObjectId] = None
    profile_image_url:       Optional[str] = None
    profile_image_public_id: Optional[str] = None

    history: List[TenantHistory] = Field(default_factory=list)

    is_active:  bool = True
    created_by: ObjectId = ...
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
