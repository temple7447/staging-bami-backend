from pydantic import BaseModel, field_validator, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional
from datetime import datetime


class EstateCreate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name:        str
    description: Optional[str] = None
    address:     Optional[str] = None
    total_units: int = 0

    @field_validator("total_units")
    @classmethod
    def non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("total_units cannot be negative")
        return v


class EstateUpdate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name:        Optional[str] = None
    description: Optional[str] = None
    total_units: Optional[int] = None
    # Per-estate rent-increase policy
    rent_increase_percent:     Optional[float] = None
    rent_increase_cycle_years: Optional[int] = None
    rent_increase_start:       Optional[datetime] = None
