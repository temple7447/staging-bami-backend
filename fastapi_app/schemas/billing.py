from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class BillingItemCreate(BaseModel):
    item_type:    str
    label:        str
    amount:       float
    due_date:     Optional[datetime] = None
    description:  Optional[str] = None
    is_recurring: bool = False
    frequency:    Optional[str] = "once"


class BillingItemUpdate(BaseModel):
    item_type:    Optional[str] = None
    label:        Optional[str] = None
    amount:       Optional[float] = None
    due_date:     Optional[datetime] = None
    description:  Optional[str] = None
    is_recurring: Optional[bool] = None
    frequency:    Optional[str] = None


class ManualPaymentRequest(BaseModel):
    tenant_id:        str
    amount:           float
    payment_type:     str
    payment_date:     Optional[datetime] = None
    reference:        Optional[str] = None
    notes:            Optional[str] = None
    duration_months:  Optional[int] = None
