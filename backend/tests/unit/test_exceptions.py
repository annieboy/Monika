"""Tests for the exception hierarchy."""

from __future__ import annotations

import pytest

from backend.core.exceptions import (
    AuthenticationError,
    ConfigurationError,
    DataAccessError,
    ExternalServiceError,
    MonikaError,
    NotFoundError,
    ValidationError,
)


class TestExceptionHierarchy:
    def test_all_exceptions_are_monika_errors(self) -> None:
        assert issubclass(ValidationError, MonikaError)
        assert issubclass(NotFoundError, MonikaError)
        assert issubclass(AuthenticationError, MonikaError)
        assert issubclass(ExternalServiceError, MonikaError)
        assert issubclass(DataAccessError, MonikaError)
        assert issubclass(ConfigurationError, MonikaError)

    def test_all_exceptions_are_exceptions(self) -> None:
        assert issubclass(MonikaError, Exception)

    def test_can_catch_subclass_as_monika_error(self) -> None:
        with pytest.raises(MonikaError):
            raise ValidationError("bad input")


class TestMonikaError:
    def test_message_and_code(self) -> None:
        err = MonikaError("something went wrong", code="test_error")
        assert err.message == "something went wrong"
        assert err.code == "test_error"

    def test_default_code(self) -> None:
        err = MonikaError("oops")
        assert err.code == "internal_error"

    def test_context_defaults_to_empty_dict(self) -> None:
        err = MonikaError("oops")
        assert err.context == {}

    def test_context_stored(self) -> None:
        err = MonikaError("oops", context={"key": "value"})
        assert err.context == {"key": "value"}

    def test_repr(self) -> None:
        err = MonikaError("oops", code="test_code")
        assert "test_code" in repr(err)
        assert "oops" in repr(err)


class TestValidationError:
    def test_code_is_validation_error(self) -> None:
        err = ValidationError("bad value")
        assert err.code == "validation_error"

    def test_with_context(self) -> None:
        err = ValidationError("bad value", context={"field": "email"})
        assert err.context["field"] == "email"


class TestNotFoundError:
    def test_message_includes_resource_and_id(self) -> None:
        err = NotFoundError("User", "abc-123")
        assert "User" in err.message
        assert "abc-123" in err.message

    def test_code_is_not_found(self) -> None:
        err = NotFoundError("Transaction", 42)
        assert err.code == "not_found"

    def test_context_includes_resource_and_identifier(self) -> None:
        err = NotFoundError("User", "abc-123")
        assert err.context["resource"] == "User"
        assert err.context["identifier"] == "abc-123"


class TestAuthenticationError:
    def test_default_message(self) -> None:
        err = AuthenticationError()
        assert "Authentication failed" in err.message

    def test_custom_message(self) -> None:
        err = AuthenticationError("Token expired")
        assert err.message == "Token expired"

    def test_code_is_authentication_error(self) -> None:
        assert AuthenticationError().code == "authentication_error"


class TestExternalServiceError:
    def test_message_includes_service_name(self) -> None:
        err = ExternalServiceError("TrueLayer", "rate limit exceeded", status_code=429)
        assert "TrueLayer" in err.message

    def test_status_code_stored(self) -> None:
        err = ExternalServiceError("Anthropic", "overloaded", status_code=529)
        assert err.status_code == 529
        assert err.context["status_code"] == 529

    def test_service_name_stored(self) -> None:
        err = ExternalServiceError("WhatsApp", "bad request", status_code=400)
        assert err.service == "WhatsApp"
        assert err.context["service"] == "WhatsApp"


class TestConfigurationError:
    def test_message_includes_variable_name(self) -> None:
        err = ConfigurationError("DATABASE_URL")
        assert "DATABASE_URL" in err.message

    def test_context_includes_variable(self) -> None:
        err = ConfigurationError("SECRET_KEY")
        assert err.context["variable"] == "SECRET_KEY"
