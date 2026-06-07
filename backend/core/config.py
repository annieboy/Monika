"""Application configuration via pydantic-settings.

All settings are read from environment variables. If a required variable
is missing the application fails immediately at startup with a clear message.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://monika:monika@localhost:5432/monika",
        description="Async SQLAlchemy database URL (asyncpg driver).",
    )
    DATABASE_URL_SYNC: str = Field(
        default="postgresql://monika:monika@localhost:5432/monika",
        description="Synchronous database URL (for Alembic migrations).",
    )
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20


class RedisSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    REDIS_URL: str = Field(
        default="redis://localhost:6379",
        description="Redis connection URL.",
    )


class EncryptionSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    ENCRYPTION_KEY: str = Field(
        description=(
            "64-character hex string (32 bytes). "
            "Generate with: openssl rand -hex 32. "
            "In production, use AWS KMS instead."
        ),
    )
    ENCRYPTION_KEY_VERSION: int = Field(default=1)

    @field_validator("ENCRYPTION_KEY")
    @classmethod
    def validate_encryption_key(cls, v: str) -> str:
        v = v.strip()
        if len(v) != 64:
            raise ValueError(
                f"ENCRYPTION_KEY must be a 64-character hex string (got {len(v)} chars). "
                "Generate with: openssl rand -hex 32"
            )
        try:
            bytes.fromhex(v)
        except ValueError as exc:
            raise ValueError("ENCRYPTION_KEY must be a valid hex string.") from exc
        return v


class TrueLayerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    TRUELAYER_CLIENT_ID: str = Field(default="")
    TRUELAYER_CLIENT_SECRET: str = Field(default="")
    TRUELAYER_REDIRECT_URI: str = Field(default="http://localhost:3000/connect/callback")
    TRUELAYER_ENVIRONMENT: Literal["sandbox", "production"] = "sandbox"


class AnthropicSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    ANTHROPIC_API_KEY: str = Field(default="")


class WhatsAppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    WHATSAPP_PHONE_NUMBER_ID: str = Field(default="")
    WHATSAPP_ACCESS_TOKEN: str = Field(default="")
    WHATSAPP_VERIFY_TOKEN: str = Field(default="")
    WHATSAPP_APP_SECRET: str = Field(default="")


class Settings(BaseSettings):
    """Root settings object. Reads from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # Application
    APP_ENV: Literal["development", "test", "staging", "production"] = "development"
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    SECRET_KEY: str = Field(
        description=(
            "64-character hex string used to sign onboarding tokens. "
            "Generate with: openssl rand -hex 32"
        ),
    )

    # Sub-settings (delegated)
    DATABASE_URL: str = "postgresql+asyncpg://monika:monika@localhost:5432/monika"
    DATABASE_URL_SYNC: str = "postgresql://monika:monika@localhost:5432/monika"
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20

    REDIS_URL: str = "redis://localhost:6379"

    ENCRYPTION_KEY: str = Field(default="")
    ENCRYPTION_KEY_VERSION: int = 1

    @field_validator("ENCRYPTION_KEY")
    @classmethod
    def validate_encryption_key(cls, v: str) -> str:
        if not v:
            return v  # allow empty in development — caught at point-of-use
        v = v.strip()
        if len(v) != 64:
            raise ValueError(
                f"ENCRYPTION_KEY must be a 64-character hex string (got {len(v)} chars). "
                "Generate with: openssl rand -hex 32"
            )
        try:
            bytes.fromhex(v)
        except ValueError as exc:
            raise ValueError("ENCRYPTION_KEY must be a valid hex string.") from exc
        return v

    TRUELAYER_CLIENT_ID: str = ""
    TRUELAYER_CLIENT_SECRET: str = ""
    TRUELAYER_REDIRECT_URI: str = "http://localhost:3000/connect/callback"
    TRUELAYER_ENVIRONMENT: Literal["sandbox", "production"] = "sandbox"

    ANTHROPIC_API_KEY: str = ""

    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_ACCESS_TOKEN: str = ""
    WHATSAPP_VERIFY_TOKEN: str = ""
    WHATSAPP_APP_SECRET: str = ""

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("SECRET_KEY is required. Generate with: openssl rand -hex 32")
        if len(v) < 32:
            raise ValueError(
                f"SECRET_KEY must be at least 32 characters (got {len(v)}). "
                "Generate with: openssl rand -hex 32"
            )
        return v

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def is_development(self) -> bool:
        return self.APP_ENV == "development"

    @property
    def is_test(self) -> bool:
        return self.APP_ENV == "test"


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance. Fails fast if configuration is invalid."""
    return Settings()
