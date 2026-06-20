from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional
from datetime import datetime


class TenantCreate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    unit_id:                    str
    tenant_name:                Optional[str] = None
    first_name:                 Optional[str] = None
    surname:                    Optional[str] = None
    other_names:                Optional[str] = None
    tenant_email:               Optional[str] = None
    email:                      Optional[str] = None
    tenant_phone:               Optional[str] = None
    whatsapp:                   Optional[str] = None
    tenant_type:                Optional[str] = "new"
    entry_date:                 Optional[str] = None
    next_due_date:              Optional[str] = None
    duration_months:            Optional[int] = None
    rent_outstanding:           Optional[float] = 0
    service_charge_outstanding: Optional[float] = 0


class TenantUpdate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    unit_label:                 Optional[str]   = None
    tenant_name:                Optional[str]   = None
    first_name:                 Optional[str]   = None
    surname:                    Optional[str]   = None
    other_names:                Optional[str]   = None
    tenant_email:               Optional[str]   = None
    email:                      Optional[str]   = None
    tenant_phone:               Optional[str]   = None
    whatsapp:                   Optional[str]   = None
    rent_amount:                Optional[float] = None
    service_charge_amount:      Optional[float] = None
    tenant_type:                Optional[str]   = None
    status:                     Optional[str]   = None
    electric_meter_number:      Optional[str]   = None
    entry_date:                 Optional[str]   = None
    next_due_date:              Optional[str]   = None
    rent_outstanding:           Optional[float] = None
    service_charge_outstanding: Optional[float] = None


class HistoryCreate(BaseModel):
    event: str
    note:  Optional[str] = None
    meta:  Optional[dict] = None


class TransactionCreate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    amount:          float
    type:            str
    method:          Optional[str] = None
    status:          str = "paid"
    reference:       Optional[str] = None
    period_month:    Optional[int] = None
    period_year:     Optional[int] = None
    notes:           Optional[str] = None
    duration_months: Optional[int] = None


class PayBillingItemsRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    item_ids:        list[str]
    payment_method:  str = "wallet"
    duration_months: int = 12
