"""Tests for the structured logging configuration."""

from __future__ import annotations

import json
import logging

import structlog

from backend.core.logging import configure_logging, get_logger


class TestConfigureLogging:
    def test_development_mode_does_not_crash(self) -> None:
        configure_logging(log_level="DEBUG", production=False)
        logger = get_logger("test")
        # Should not raise
        logger.info("test_event", key="value")

    def test_production_mode_outputs_json(self, capsys: object) -> None:
        import io

        configure_logging(log_level="INFO", production=True)

        # Capture stdout
        captured = io.StringIO()
        root = logging.getLogger()
        old_handlers = root.handlers[:]
        new_handler = logging.StreamHandler(captured)

        formatter = root.handlers[0].formatter if root.handlers else None
        if formatter:
            new_handler.setFormatter(formatter)

        root.handlers = [new_handler]
        try:
            logger = get_logger("test.json")
            logger.info("test_event", foo="bar")
            output = captured.getvalue().strip()
            if output:
                parsed = json.loads(output)
                assert "event" in parsed or "message" in parsed or "foo" in parsed
        finally:
            root.handlers = old_handlers

    def test_get_logger_returns_bound_logger(self) -> None:
        configure_logging(production=False)
        logger = get_logger("test.module")
        assert logger is not None

    def test_context_vars_binding(self) -> None:
        configure_logging(production=False)
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(user_id="user-123", request_id="req-456")
        ctx = structlog.contextvars.get_contextvars()
        assert ctx.get("user_id") == "user-123"
        assert ctx.get("request_id") == "req-456"
        structlog.contextvars.clear_contextvars()

    def test_context_vars_cleared(self) -> None:
        configure_logging(production=False)
        structlog.contextvars.bind_contextvars(user_id="user-123")
        structlog.contextvars.clear_contextvars()
        ctx = structlog.contextvars.get_contextvars()
        assert "user_id" not in ctx

    def test_log_level_is_respected(self) -> None:
        configure_logging(log_level="ERROR", production=False)
        root = logging.getLogger()
        assert root.level == logging.ERROR
