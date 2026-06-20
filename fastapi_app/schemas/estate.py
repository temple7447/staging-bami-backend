from pydantic import BaseModel, field_validator
from typing import Optional


class EstateCreate(BaseModel):
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
    name:        Optional[str] = None
    description: Optional[str] = None
    total_units: Optional[int] = None
