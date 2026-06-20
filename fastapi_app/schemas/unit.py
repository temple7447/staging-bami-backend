from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class UnitCreate(BaseModel):
    label:                 str
    monthly_price:         float
    service_charge_monthly: float = 0.0
    caution_fee:           float = 0.0
    legal_fee:             float = 0.0
    meter_number:          Optional[str] = None
    description:           Optional[str] = None
    category:              str = "apartment"
    listing_type:          str = "rent"
    available_date:        Optional[datetime] = None
    bedrooms:              int = 0
    bathrooms:             int = 0
    area:                  float = 0.0
    amenities:             dict = {}
    street_address:        Optional[str] = None
    features:              List[dict] = []


class UnitUpdate(BaseModel):
    label:                 Optional[str]   = None
    monthly_price:         Optional[float] = None
    service_charge_monthly: Optional[float] = None
    caution_fee:           Optional[float] = None
    legal_fee:             Optional[float] = None
    meter_number:          Optional[str]   = None
    description:           Optional[str]   = None
    category:              Optional[str] = None
    listing_type:          Optional[str] = None
    available_date:        Optional[datetime] = None
    bedrooms:              Optional[int]   = None
    bathrooms:             Optional[int]   = None
    area:                  Optional[float] = None
    amenities:             Optional[dict]  = None
    street_address:        Optional[str]   = None
    features:              Optional[List[dict]] = None


class MediaUpdateBody(BaseModel):
    images:  Optional[List[dict]] = None
    videos:  Optional[List[dict]] = None
    replace: bool = False


class MediaRemoveBody(BaseModel):
    image_ids: List[str] = []
    video_ids: List[str] = []


class ConditionReportJson(BaseModel):
    type:              str
    overall_condition: str = "good"
    notes:             Optional[str] = None
    images:            List[dict] = []
    videos:            List[dict] = []
