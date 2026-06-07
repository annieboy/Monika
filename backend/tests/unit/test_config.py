"""Tests for application configuration."""

from __future__ import annotations

import pytest
from pydantic import ValidationError as PydanticValidationError

from backend.core.config import Settings, get_settings


def _make_settings(**overrides: str) -> Settings:
    """Build a Settings object with test defaults, applying any overrides."""
    defaults = {
        "APP_ENV": "test",
        "SECRET_KEY": "a" * 64,
        "ENCRYPTION_KEY": "b" * 64,
    }
    defaults.update(overrides)
    return Settings(**defaults)  # type: ignore[arg-type]


class TestSettingsValidation:
    def test_valid_settings_load(self) -> None:
        settings = _make_settings()
        assert settings.APP_ENV == "test"

    def test_missing_secret_key_raises(self) -> None:
        with pytest.raises(PydanticValidationError) as exc_info:
            Settings(SECRET_KEY="", ENCRYPTION_KEY="b" * 64)  # type: ignore[call-arg]
        assert "SECRET_KEY" in str(exc_info.value)

    def test_short_secret_key_raises(self) -> None:
        with pytest.raises(PydanticValidationError):
            _make_settings(SECRET_KEY="tooshort")

    def test_secret_key_minimum_32_chars(self) -> None:
        settings = _make_settings(SECRET_KEY="a" * 32)
        assert settings.SECRET_KEY == "a" * 32

    def test_encryption_key_must_be_64_hex_chars_if_set(self) -> None:
        # Non-empty ENCRYPTION_KEY must be exactly 64 hex chars
        with pytest.raises(PydanticValidationError):
            _make_settings(ENCRYPTION_KEY="abc")  # too short

    def test_encryption_key_must_be_valid_hex_if_set(self) -> None:
        with pytest.raises(PydanticValidationError):
            _make_settings(ENCRYPTION_KEY="z" * 64)  # 'z' is not valid hex

    def test_encryption_key_can_be_empty_for_development(self) -> None:
        # Empty key is allowed — caught at point-of-use (EncryptionService)
        settings = _make_settings(ENCRYPTION_KEY="")
        assert settings.ENCRYPTION_KEY == ""

    def test_valid_encryption_key(self) -> None:
        settings = _make_settings(ENCRYPTION_KEY="deadbeef" * 8)  # 64 hex chars
        assert len(settings.ENCRYPTION_KEY) == 64

    def test_invalid_app_env_raises(self) -> None:
        with pytest.raises(PydanticValidationError):
            _make_settings(APP_ENV="invalid")  # type: ignore[arg-type]

    def test_valid_app_env_values(self) -> None:
        for env in ("development", "test", "staging", "production"):
            s = _make_settings(APP_ENV=env)  # type: ignore[arg-type]
            assert env == s.APP_ENV

    def test_invalid_log_level_raises(self) -> None:
        with pytest.raises(PydanticValidationError):
            _make_settings(LOG_LEVEL="VERBOSE")  # type: ignore[arg-type]


class TestSettingsProperties:
    def test_is_production(self) -> None:
        s = _make_settings(APP_ENV="production")
        assert s.is_production is True
        assert s.is_development is False
        assert s.is_test is False

    def test_is_development(self) -> None:
        s = _make_settings(APP_ENV="development")
        assert s.is_development is True
        assert s.is_production is False

    def test_is_test(self) -> None:
        s = _make_settings(APP_ENV="test")
        assert s.is_test is True


class TestGetSettings:
    def test_returns_settings_instance(self) -> None:
        settings = get_settings()
        assert isinstance(settings, Settings)

    def test_is_cached(self) -> None:
        s1 = get_settings()
        s2 = get_settings()
        assert s1 is s2

    def test_cache_cleared_between_tests(self, reset_settings_cache: None) -> None:
        # The conftest fixture clears the cache — each call to get_settings()
        # should return the same object within a single test.
        s1 = get_settings()
        s2 = get_settings()
        assert s1 is s2
