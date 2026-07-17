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
        "https://staging.bamihost.com,"
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

    # ── AI provider ────────────────────────────────────────────────────────
    # Which LLM backend the app uses for all text/reasoning calls.
    #   "deepseek"  → DeepSeek (OpenAI-compatible API)  [current]
    #   "anthropic" → Claude   (flip back here anytime)
    # Image generation always stays on Gemini (DeepSeek has no image model).
    AI_PROVIDER: str = "deepseek"

    # Anthropic (Claude AI) — kept so AI_PROVIDER can be flipped back to it.
    ANTHROPIC_API_KEY: str = ""

    # DeepSeek (OpenAI-compatible). Get a key at https://platform.deepseek.com
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"

    # Fernet key used to encrypt Integrations Hub auth secrets at rest
    INTEGRATION_ENCRYPTION_KEY: str = ""

    # ── Google Workspace (Drive + Gmail) knowledge ────────────────────────────
    # Server-side OAuth so the AI team can read the owner's Drive files and Gmail
    # and answer against them (RAG). Create an OAuth 2.0 Client (Web application)
    # in Google Cloud Console, enable the Drive + Gmail APIs, and set the redirect
    # URI to  <BACKEND_URL>/api/google/callback.
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    # Where Google sends the user back after consent (must match the console).
    GOOGLE_REDIRECT_URI: str = ""
    # Where to bounce the user's browser after we finish the exchange.
    GOOGLE_POST_CONNECT_REDIRECT: str = ""   # e.g. https://app.bamihost.com/dashboard/head-office
    # Gemini embedding model for the knowledge index (uses GEMINI_API_KEY).
    # text-embedding-004 was retired by Google; gemini-embedding-001 is the
    # successor. EMBED_DIM stays 768 (requested via outputDimensionality) so
    # vectors remain comparable with anything indexed under the old model.
    EMBED_MODEL: str = "models/gemini-embedding-001"
    EMBED_DIM: int = 768

    # Telegram Bot
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_WEBHOOK_SECRET: str = ""

    # Environment
    NODE_ENV: str = "development"

    class Config:
        env_file = "../.env"
        extra = "ignore"


settings = Settings()
