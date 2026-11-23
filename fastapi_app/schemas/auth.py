from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional


class RegisterRequest(BaseModel):
    name:     str
    email:    EmailStr
    password: str
    role:     str = "tenant"
    phone:    Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v


class LoginRequest(BaseModel):
    email:    str   # accepts either an email address or a phone number
    password: str


class TokenResponse(BaseModel):
    success: bool = True
    token:   str
    user:    dict


class ForgotPasswordRequest(BaseModel):
    # An email address or a phone number: people with no email reset by SMS.
    email: str


class ResetPasswordRequest(BaseModel):
    otp:      str
    email:    str          # the email address or phone number the code was requested for
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str
