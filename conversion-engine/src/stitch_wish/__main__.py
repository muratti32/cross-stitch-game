from __future__ import annotations

import os
import logging

import uvicorn

from .log_config import uvicorn_log_config


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    log_level = os.environ.get("LOG_LEVEL", "info").lower()
    logging.captureWarnings(True)
    uvicorn.run(
        "stitch_wish.main:app",
        host=host,
        port=port,
        log_level=log_level,
        log_config=uvicorn_log_config(log_level),
        access_log=False,
    )


if __name__ == "__main__":
    main()
