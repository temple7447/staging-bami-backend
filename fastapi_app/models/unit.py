from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class Unit(Document):
    estate:       ObjectId
    unit_number:  str
    rent_amount:  float = 0.0
    service_charge: float = 0.0
    caution_fee:  float = 0.0
    legal_fee:    float = 0.0
    is_occupied:  bool = False
    is_active:    bool = True
    created_by:   Optional[ObjectId] = None
    created_at:   datetime = Field(default_factory=datetime.utcnow)
    updated_at:   datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "units"
