from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # App
    APP_NAME: str = "BamiHost Backend"
    API_VERSION: str = "v1"
    DEBUG: bool = False
    PORT: int = 4000

    # Database (PostgreSQL via Neon in production, SQLite locally)
    DATABASE_URL: str = "sqlite+aiosqlite:///bamihost.db"

    # JWT
    JWT_SECRET: str
    JWT_EXPIRE: str = "30d"
    JWT_ALGORITHM: str = "HS256"

    # Bcrypt
    BCRYPT_SALT_ROUNDS: int = 10

    # CORS
    ALLOWED_ORIGINS: str = (
        "http://localhost:3000,"
        "http://localhost:5173,"
        "http://localhost:8080,"
        "http://localhost:4200,"
        "https://www.bamihost.com,"
        "https://staging-baminhost.vercel.app"
    )

    @property
    def allowed_origins_list(self) -> List[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    # Rate limiting
    RATE_LIMIT_WINDOW_MS: int = 900000   # 15 min
    RATE_LIMIT_MAX_REQUESTS: int = 200

    # Email — Mailtrap sending API
    MAILTRAP_TOKEN:        str = ""
    MAILTRAP_SENDER_EMAIL: str = ""
    MAILTRAP_SENDER_NAME:  str = "BamiHost"
    FROM_EMAIL: str = ""
    FROM_NAME:  str = "BamiHost"

    # Cloudinary
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""

    # Google Gemini — "Nano Banana" (gemini-2.5-flash-image) for logo/image generation
    GEMINI_API_KEY: str = ""

    # Paystack
    PAYSTACK_SECRET_KEY: str = ""
    PAYSTACK_PUBLIC_KEY: str = ""

    # Slack
    SLACK_WEBHOOK_URL: str = ""

    # Termii (WhatsApp + SMS reminders)
    TERMII_API_KEY: str = ""
    TERMII_BASE_URL: str = "https://api.ng.termii.com"
    TERMII_SENDER_ID: str = "Termii"            # approved SMS sender ID
    TERMII_WHATSAPP_TEMPLATE_ID: str = ""       # pre-approved WhatsApp template
    TERMII_WHATSAPP_DEVICE_ID: str = ""         # WhatsApp device/phone id
    DEFAULT_COUNTRY_CODE: str = "234"           # Nigeria — for phone normalization
    REMINDER_CHANNEL: str = "whatsapp"          # whatsapp | sms | both

    # Tuya IoT (smart meters)
    TUYA_CLIENT_ID: str = ""
    TUYA_CLIENT_SECRET: str = ""
    TUYA_BASE_URL: str = "https://openapi.tuyaeu.com"
    TUYA_ELECTRICITY_RATE: float = 70.0   # ₦ per kWh default tariff

    # Anthropic (Claude AI)
    ANTHROPIC_API_KEY: str = ""

    # Telegram Bot
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_WEBHOOK_SECRET: str = ""

    # Environment
    NODE_ENV: str = "development"

    class Config:
        env_file = "../.env"
        extra = "ignore"


settings = Settings()
