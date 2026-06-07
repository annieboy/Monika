"""Shared pytest fixtures."""

from __future__ import annotations

import os

import pytest

# Set test environment variables before any application code imports settings.
# This runs before conftest fixtures and before the test module is imported.
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("ENCRYPTION_KEY", "b" * 64)
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://monika:monika@localhost:5432/monika_test",
)
os.environ.setdefault(
    "DATABASE_URL_SYNC",
    "postgresql://monika:monika@localhost:5432/monika_test",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")


@pytest.fixture(autouse=True)
def reset_settings_cache() -> None:
    """Clear the lru_cache on get_settings() between tests."""
    from backend.core.config import get_settings

    get_settings.cache_clear()
