"""Base exception hierarchy for Monika."""

from __future__ import annotations

from typing import Any


class MonikaError(Exception):
    """Root exception for all application errors."""

    def __init__(
        self,
        message: str,
        code: str = "internal_error",
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.context: dict[str, Any] = context or {}

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(code={self.code!r}, message={self.message!r})"


class ValidationError(MonikaError):
    """Invalid input from a caller."""

    def __init__(self, message: str, context: dict[str, Any] | None = None) -> None:
        super().__init__(message, code="validation_error", context=context)


class NotFoundError(MonikaError):
    """Requested resource does not exist."""

    def __init__(self, resource: str, identifier: Any) -> None:
        super().__init__(
            f"{resource} not found: {identifier}",
            code="not_found",
            context={"resource": resource, "identifier": str(identifier)},
        )


class AuthenticationError(MonikaError):
    """Authentication or authorisation failure."""

    def __init__(self, message: str = "Authentication failed") -> None:
        super().__init__(message, code="authentication_error")


class ExternalServiceError(MonikaError):
    """A third-party API call failed after retries."""

    def __init__(
        self,
        service: str,
        message: str,
        status_code: int | None = None,
    ) -> None:
        super().__init__(
            f"{service} error: {message}",
            code="external_service_error",
            context={"service": service, "status_code": status_code},
        )
        self.service = service
        self.status_code = status_code


class DataAccessError(MonikaError):
    """Database operation failed."""

    def __init__(self, message: str) -> None:
        super().__init__(message, code="data_access_error")


class ConfigurationError(MonikaError):
    """Missing or invalid application configuration."""

    def __init__(self, variable: str) -> None:
        super().__init__(
            f"Required configuration variable '{variable}' is missing or invalid.",
            code="configuration_error",
            context={"variable": variable},
        )
