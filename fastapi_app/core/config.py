from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # App
    APP_NAME: str = "BamiHustle Backend"
    API_VERSION: str = "v1"
    DEBUG: bool = False
    PORT: int = 4000

    # MongoDB
    MONGODB_URI: str

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

    # Email (Mailtrap)
    MAILTRAP_HOST: str = ""
    MAILTRAP_PORT: int = 587
    MAILTRAP_USER: str = ""
    MAILTRAP_PASS: str = ""
    FROM_EMAIL: str = "noreply@bamihost.com"
    FROM_NAME: str = "BamiHost"

    # Cloudinary
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""

    # Paystack
    PAYSTACK_SECRET_KEY: str = ""
    PAYSTACK_PUBLIC_KEY: str = ""

    # Slack
    SLACK_WEBHOOK_URL: str = ""

    # Environment
    NODE_ENV: str = "development"

    class Config:
        env_file = "../.env"
        extra = "ignore"


settings = Settings()
