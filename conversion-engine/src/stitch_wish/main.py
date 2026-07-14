from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import Counter
from datetime import UTC, datetime
from typing import Annotated

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from python_multipart.exceptions import MultipartParseError
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .constants import (
    ENGINE_VERSION,
    MAX_COLORS,
    MAX_INPUT_BYTES,
    MAX_MULTIPART_BODY_BYTES,
    MIN_COLORS,
)
from .converter import convert_image
from .errors import (
    ConversionError,
    conversion_capacity_exceeded,
    input_too_large,
    invalid_parameters,
)
from .models import ConvertResponse, ErrorResponse, HealthResponse


logger = logging.getLogger("stitch_wish")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())
logger.propagate = False

BODY_TOO_LARGE_DETAIL = "stitch_wish_multipart_body_too_large"
EXPECTED_FORM_FIELDS = frozenset(
    {"artwork", "short_edge_cells", "max_colors", "recipe_version"}
)
MAX_CONCURRENT_CONVERSIONS = int(os.environ.get("MAX_CONCURRENT_CONVERSIONS", "1"))
if MAX_CONCURRENT_CONVERSIONS < 1:
    raise RuntimeError("MAX_CONCURRENT_CONVERSIONS must be at least 1")
CONVERSION_SLOTS = asyncio.Semaphore(MAX_CONCURRENT_CONVERSIONS)


def _log_event(event: str, **fields: object) -> None:
    logger.info(
        json.dumps(
            {
                "event": event,
                "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds"),
                **fields,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


class RequestSizeLimitMiddleware:
    """Bound multipart bytes before Starlette can spool an unbounded upload."""

    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope.get("method") != "POST"
            or scope.get("path") != "/v1/convert"
        ):
            await self.app(scope, receive, send)
            return

        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared_size = int(content_length)
            except ValueError:
                declared_size = 0
            if declared_size > self.max_body_bytes:
                _log_event(
                    "conversion_rejected",
                    error_code="input_too_large",
                    status_code=413,
                )
                response = JSONResponse(
                    status_code=413,
                    content={
                        "error_code": "input_too_large",
                        "message": "Multipart request body exceeds the upload safety limit.",
                    },
                )
                await response(scope, receive, send)
                return

        received_size = 0

        async def limited_receive() -> Message:
            nonlocal received_size
            message = await receive()
            if message["type"] == "http.request":
                received_size += len(message.get("body", b""))
                if received_size > self.max_body_bytes:
                    raise MultiPartException(BODY_TOO_LARGE_DETAIL)
            return message

        try:
            await self.app(scope, limited_receive, send)
        except MultiPartException as error:
            if error.message != BODY_TOO_LARGE_DETAIL:
                raise
            _log_event(
                "conversion_rejected",
                error_code="input_too_large",
                status_code=413,
            )
            response = JSONResponse(
                status_code=413,
                content={
                    "error_code": "input_too_large",
                    "message": "Multipart request body exceeds the upload safety limit.",
                },
            )
            await response(scope, receive, send)


app = FastAPI(
    title="Stitch Wish Conversion Engine",
    version=ENGINE_VERSION,
    docs_url="/docs",
    redoc_url=None,
)
app.add_middleware(
    RequestSizeLimitMiddleware,
    max_body_bytes=MAX_MULTIPART_BODY_BYTES,
)


@app.exception_handler(ConversionError)
async def conversion_error_handler(
    _request: Request,
    error: ConversionError,
) -> JSONResponse:
    _log_event(
        "conversion_rejected",
        error_code=error.error_code,
        status_code=error.status_code,
    )
    return JSONResponse(
        status_code=error.status_code,
        content={"error_code": error.error_code, "message": error.message},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _request: Request,
    _error: RequestValidationError,
) -> JSONResponse:
    _log_event(
        "conversion_rejected",
        error_code="invalid_parameters",
        status_code=422,
    )
    return JSONResponse(
        status_code=422,
        content={
            "error_code": "invalid_parameters",
            "message": "Request fields are missing or outside their allowed ranges.",
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(
    _request: Request,
    error: StarletteHTTPException,
) -> JSONResponse:
    if (
        error.status_code == 413
        or error.status_code == 400
        and error.detail == BODY_TOO_LARGE_DETAIL
    ):
        status_code = 413
        error_code = "input_too_large"
        message = "Multipart request body exceeds the upload safety limit."
    elif error.status_code == 400:
        status_code = 422
        error_code = "invalid_parameters"
        message = "The multipart request envelope is malformed."
    else:
        status_code = error.status_code
        error_code = "request_error"
        message = "The requested route or method is not available."

    _log_event(
        "request_rejected",
        error_code=error_code,
        status_code=status_code,
    )
    return JSONResponse(
        status_code=status_code,
        content={"error_code": error_code, "message": message},
        headers=error.headers,
    )


@app.exception_handler(MultipartParseError)
async def multipart_parse_error_handler(
    _request: Request,
    _error: MultipartParseError,
) -> JSONResponse:
    _log_event(
        "request_rejected",
        error_code="invalid_parameters",
        status_code=422,
    )
    return JSONResponse(
        status_code=422,
        content={
            "error_code": "invalid_parameters",
            "message": "The multipart request envelope is malformed.",
        },
    )


async def _read_limited(upload: UploadFile) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_INPUT_BYTES:
            raise input_too_large(
                f"Artwork must not exceed {MAX_INPUT_BYTES // (1024 * 1024)} MiB."
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def _validate_form_shape(request: Request) -> None:
    form = await request.form()
    counts = Counter(key for key, _value in form.multi_items())
    if set(counts) != EXPECTED_FORM_FIELDS or any(
        count != 1 for count in counts.values()
    ):
        raise invalid_parameters(
            "Exactly one artwork and one value for each profile parameter are required."
        )


@app.get("/v1/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", engine_version=ENGINE_VERSION)


@app.post(
    "/v1/convert",
    response_model=ConvertResponse,
    responses={
        413: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def convert(
    request: Request,
    artwork: Annotated[UploadFile, File(description="PNG, JPEG, or WebP artwork")],
    short_edge_cells: Annotated[int, Form(ge=20, le=300)],
    max_colors: Annotated[int, Form(ge=MIN_COLORS, le=MAX_COLORS)],
    recipe_version: Annotated[str, Form(min_length=1, max_length=64)],
) -> ConvertResponse:
    started = time.perf_counter()
    if CONVERSION_SLOTS.locked():
        await artwork.close()
        raise conversion_capacity_exceeded()

    await CONVERSION_SLOTS.acquire()
    try:
        try:
            await _validate_form_shape(request)
            image_bytes = await _read_limited(artwork)
        finally:
            await artwork.close()

        result = await run_in_threadpool(
            convert_image,
            image_bytes,
            short_edge_cells,
            max_colors,
            recipe_version,
        )
        _log_event(
            "conversion_complete",
            duration_ms=round((time.perf_counter() - started) * 1000),
            status_code=200,
        )
        return result
    finally:
        CONVERSION_SLOTS.release()
