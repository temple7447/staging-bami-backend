from beanie import Document
from pydantic import Field
from typing import Optional, List
from datetime import datetime
from enum import Enum
from bson import ObjectId


class UnitStatus(str, Enum):
    vacant      = "vacant"
    occupied    = "occupied"
    maintenance = "maintenance"
    reserved    = "reserved"


class UnitCategory(str, Enum):
    apartment = "Apartment"
    house     = "House"
    villa     = "Villa"
    office    = "Office"
    studio    = "Studio"
    penthouse = "Penthouse"
    other     = "Other"


class ListingType(str, Enum):
    rent = "Rent"
    sale = "Sale"


class Amenities(Document):
    wifi:        bool = False
    pool:        bool = False
    gym:         bool = False
    parking:     bool = False
    ac:          bool = False
    security:    bool = False
    pet_friendly: bool = False
    balcony:     bool = False
    laundry:     bool = False

    class Settings:
        name = "amenities"


class Unit(Document):
    estate:               ObjectId
    label:                str
    monthly_price:        float = 0.0
    service_charge_monthly: float = 0.0
    caution_fee:          float = 0.0
    legal_fee:            float = 0.0
    meter_number:         Optional[str] = None
    description:          Optional[str] = None
    category:             UnitCategory = UnitCategory.apartment
    listing_type:         ListingType  = ListingType.rent
    available_date:       Optional[datetime] = None
    bedrooms:             int = 0
    bathrooms:            int = 0
    area:                 float = 0.0
    amenities:            dict = Field(default_factory=dict)
    street_address:       Optional[str] = None
    images:               List[dict] = Field(default_factory=list)   # [{url, public_id, caption}]
    videos:               List[dict] = Field(default_factory=list)   # [{url, public_id, thumbnail, caption}]
    status:               UnitStatus = UnitStatus.vacant
    occupied_by:          Optional[ObjectId] = None
    occupied_since:       Optional[datetime] = None
    features:             List[dict] = Field(default_factory=list)   # [{name, value}]
    condition_reports:    List[dict] = Field(default_factory=list)
    is_active:            bool = True
    created_by:           Optional[ObjectId] = None
    updated_by:           Optional[ObjectId] = None
    created_at:           datetime = Field(default_factory=datetime.utcnow)
    updated_at:           datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "units"
        indexes = [
            [("estate", 1), ("status", 1)],
            [("estate", 1), ("label", 1), ("is_active", 1)],
        ]
