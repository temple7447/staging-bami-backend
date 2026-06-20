from pydantic import BaseModel, EmailStr
from typing import Optional


class CreateWalletRequest(BaseModel):
    user_id: str


class AddFundsRequest(BaseModel):
    amount: float


class DeductFundsRequest(BaseModel):
    amount: float


class BankDetails(BaseModel):
    account_name:   Optional[str] = None
    account_number: Optional[str] = None
    bank_name:      Optional[str] = None


class WalletTransactionRequest(BaseModel):
    type:            str              # deposit | withdraw | transfer
    amount:          float
    description:     Optional[str] = None
    recipient_email: Optional[str] = None
    recipient_id:    Optional[str] = None
    recipient_type:  Optional[str] = None  # "estate" | None (user)
    bank_details:    Optional[BankDetails] = None


class AdminCreditRequest(BaseModel):
    user_id: Optional[str] = None
    email:   Optional[str] = None
    amount:  float
    reason:  Optional[str] = None
