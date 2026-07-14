from __future__ import annotations

import io
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from stitch_wish.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def image_bytes(
    image: Image.Image,
    image_format: str = "PNG",
    **save_options: object,
) -> bytes:
    output = io.BytesIO()
    image.save(output, format=image_format, **save_options)
    return output.getvalue()


def convert_request(
    client: TestClient,
    artwork: bytes,
    *,
    short_edge_cells: int = 20,
    max_colors: int = 8,
    recipe_version: str = "v1",
):
    return client.post(
        "/v1/convert",
        files={"artwork": ("artwork.bin", artwork, "application/octet-stream")},
        data={
            "short_edge_cells": str(short_edge_cells),
            "max_colors": str(max_colors),
            "recipe_version": recipe_version,
        },
    )

