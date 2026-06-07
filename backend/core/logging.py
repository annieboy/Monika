"""Structured logging configuration using structlog.

In development: human-readable, coloured console output.
In production: JSON, one object per line, suitable for log aggregators.

Usage:
    from backend.core.logging import get_logger
    logger = get_logger(__name__)
    logger.info("user_created", user_id=str(user_id))

Binding request context (lasts for the duration of the async task):
    import structlog
    structlog.contextvars.bind_contextvars(request_id="abc", user_id="xyz")
    structlog.contextvars.clear_contextvars()
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog
from structlog.types import EventDict, WrappedLogger


def _add_log_level(logger: WrappedLogger, method_name: str, event_dict: EventDict) -> EventDict:
    event_dict["level"] = method_name.upper()
    return event_dict


def _drop_color_message_key(
    logger: WrappedLogger, method_name: str, event_dict: EventDict
) -> EventDict:
    # uvicorn adds a colour_message key we don't want in structured output
    event_dict.pop("color_message", None)
    return event_dict


def configure_logging(log_level: str = "INFO", production: bool = False) -> None:
    """Call once at application startup."""

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        _add_log_level,
        _drop_color_message_key,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]

    if production:
        renderer: Any = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(log_level.upper())

    # Quieten noisy libraries
    for noisy in ("asyncio", "httpx", "httpcore", "hpack"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a named structured logger."""
    return structlog.get_logger(name)
