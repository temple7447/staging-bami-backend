from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class RentalApplication(Document):
    first_name:   str = ""
    last_name:    str = ""
    email:        str = ""
    phone:        Optional[str] = None
    unit:         Optional[ObjectId] = None
    estate:       Optional[ObjectId] = None
    message:      Optional[str] = None
    move_in_date: Optional[str] = None
    status:       str = "pending"  # pending | approved | rejected | waitlisted
    submitted_by: Optional[ObjectId] = None
    updated_by:   Optional[ObjectId] = None
    is_active:    bool = True
    created_at:   datetime = Field(default_factory=datetime.utcnow)
    updated_at:   datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "rental-applications"
        indexes = [
            [("email", 1)],
            [("estate", 1), ("status", 1)],
        ]
