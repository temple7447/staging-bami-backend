from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Literal, Optional


class InitializePaystackRequest(BaseModel):
    # Web sends camelCase, mobile sends snake_case — accept both.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    purpose: Literal["topup", "bill"]
    amount: Optional[float] = None            # top-up only; bills are priced server-side
    item_ids: Optional[list[str]] = None      # bill only
    duration_months: int = 12                 # bill only
