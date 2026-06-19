from beanie import Document, Link, before_event, Insert
from pydantic import EmailStr, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum
from bson import ObjectId


class UserRole(str, Enum):
    super_admin    = "super_admin"
    admin          = "admin"
    business_owner = "business_owner"
    manager        = "manager"
    super_manager  = "super_manager"
    vendor         = "vendor"
    super_vendor   = "super_vendor"
    tenant         = "tenant"
    user           = "user"


class Service(Document):
    name: str
    description: Optional[str] = None
    price: float
    rate_type: str = "fixed"   # "fixed" | "hourly"

    class Settings:
        name = "services"


class BankDetails(Document):
    account_name:   Optional[str] = None
    account_number: Optional[str] = None
    bank_name:      Optional[str] = None
    bank_code:      Optional[str] = None

    class Settings:
        name = "bank_details"


class User(Document):
    name:     str
    email:    EmailStr
    password: str
    role:     UserRole = UserRole.tenant

    position:           Optional[str] = None
    assigned_estates:   List[ObjectId] = Field(default_factory=list)
    phone:              Optional[str]  = None
    is_active:          bool = True
    last_login:         Optional[datetime] = None
    created_by:         Optional[ObjectId] = None
    email_verified:     bool = False

    email_verification_token:  Optional[str] = None
    password_reset_token:      Optional[str] = None
    password_reset_expire:     Optional[datetime] = None
    password_reset_otp_hash:   Optional[str] = None
    password_reset_otp_expire: Optional[datetime] = None

    profile_image_url:       Optional[str] = None
    profile_image_public_id: Optional[str] = None

    # Vendor fields
    business_name:    Optional[str] = None
    business_type_id: Optional[ObjectId] = None
    specialization:   Optional[str] = None
    cac_number:       Optional[str] = None
    gov_id:           Optional[str] = None
    certification:    Optional[str] = None
    business_address: Optional[str] = None
    portfolio:        List[str] = Field(default_factory=list)
    bio:              Optional[str] = None
    rating:           float = 0.0
    review_count:     int = 0
    location_city:    Optional[str] = None
    location_state:   Optional[str] = None
    op_hours_start:   str = "9:00 AM"
    op_hours_end:     str = "6:00 PM"
    is_verified_pro:  bool = False
    manager:          Optional[ObjectId] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "users"
        indexes = [
            [("email", 1), ("is_active", 1)],
            [("role", 1), ("is_active", 1)],
            [("assigned_estates", 1)],
            [("created_at", -1)],
        ]
