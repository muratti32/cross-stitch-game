from __future__ import annotations

import asyncio
import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from stitch_wish.constants import DMC_PALETTE_VERSION, ENGINE_VERSION, MAX_INPUT_BYTES
from stitch_wish import main as main_module

from .conftest import convert_request, image_bytes


def _decoded_grid(payload: dict[str, object]) -> bytes:
    return base64.b64decode(str(payload["grid"]), validate=True)


def test_health(client: TestClient) -> None:
    response = client.get("/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "engine_version": ENGINE_VERSION}


def test_alpha_cells_palette_and_statistics_are_consistent(client: TestClient) -> None:
    image = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
    for y in range(20):
        for x in range(10, 20):
            image.putpixel((x, y), (30, 190, 80, 255))

    response = convert_request(client, image_bytes(image), max_colors=4)

    assert response.status_code == 200
    payload = response.json()
    statistics = payload["statistics"]
    grid = _decoded_grid(payload)
    assert statistics["width"] == 20
    assert statistics["height"] == 20
    assert len(grid) == 400
    assert all(grid[y * 20 + x] == 0 for y in range(20) for x in range(10))
    assert all(grid[y * 20 + x] > 0 for y in range(20) for x in range(10, 20))
    assert statistics["total_stitchable_cells"] == 200
    assert statistics["distinct_colors"] == len(payload["palette"])
    assert sum(item["count"] for item in statistics["per_color"]) == 200
    assert max(grid) <= len(payload["palette"])
    assert payload["engine_version"] == ENGINE_VERSION
    assert payload["dmc_palette_version"] == DMC_PALETTE_VERSION
    assert payload["recipe_version"] == "v1"
    preview = Image.open(io.BytesIO(base64.b64decode(payload["preview_png"])))
    try:
        assert preview.mode == "RGBA"
        assert preview.size == (160, 160)
        # Unstitched cells are fully transparent (0, 0, 0, 0); backend renderer must produce the same value
        assert preview.getpixel((4 * 8, 10 * 8)) == (0, 0, 0, 0)
        expected_rgb = tuple(
            bytes.fromhex(payload["palette"][0]["rgb_hex"].removeprefix("#"))
        )
        assert preview.getpixel((15 * 8, 10 * 8)) == (*expected_rgb, 255)
    finally:
        preview.close()


def test_all_transparent_artwork_has_empty_palette_and_transparent_preview(
    client: TestClient,
) -> None:
    image = Image.new("RGBA", (20, 20), (120, 30, 220, 0))

    response = convert_request(client, image_bytes(image))

    assert response.status_code == 200
    payload = response.json()
    assert set(_decoded_grid(payload)) == {0}
    assert payload["palette"] == []
    assert payload["statistics"]["per_color"] == []
    assert payload["statistics"]["total_stitchable_cells"] == 0
    assert payload["statistics"]["distinct_colors"] == 0
    preview = Image.open(io.BytesIO(base64.b64decode(payload["preview_png"])))
    try:
        assert preview.mode == "RGBA"
        assert preview.getextrema()[3] == (0, 0)
        # Unstitched cells are fully transparent (0, 0, 0, 0); backend renderer must produce the same value
        assert preview.getextrema() == ((0, 0), (0, 0), (0, 0), (0, 0))
    finally:
        preview.close()


def test_alpha_threshold_is_127_empty_and_128_stitchable(client: TestClient) -> None:
    image = Image.new("RGBA", (20, 20), (40, 90, 170, 127))
    for y in range(20):
        for x in range(10, 20):
            image.putpixel((x, y), (40, 90, 170, 128))

    response = convert_request(client, image_bytes(image))

    assert response.status_code == 200
    grid = _decoded_grid(response.json())
    assert all(grid[y * 20 + x] == 0 for y in range(20) for x in range(10))
    assert all(grid[y * 20 + x] > 0 for y in range(20) for x in range(10, 20))


def test_png_color_key_transparency_survives_downsampling(client: TestClient) -> None:
    image = Image.new("RGB", (80, 40), (255, 0, 0))
    for y in range(40):
        for x in range(40, 80):
            image.putpixel((x, y), (0, 180, 80))

    response = convert_request(
        client,
        image_bytes(image, transparency=(255, 0, 0)),
        short_edge_cells=20,
    )

    assert response.status_code == 200
    payload = response.json()
    assert (payload["statistics"]["width"], payload["statistics"]["height"]) == (
        40,
        20,
    )
    grid = _decoded_grid(payload)
    assert all(grid[y * 40 + x] == 0 for y in range(20) for x in range(15))
    assert all(grid[y * 40 + x] > 0 for y in range(20) for x in range(25, 40))


def test_max_colors_is_respected_after_dmc_merge(client: TestClient) -> None:
    image = Image.new("RGB", (120, 60))
    for y in range(image.height):
        for x in range(image.width):
            image.putpixel(
                (x, y),
                (
                    (x * 17 + y * 3) % 256,
                    (x * 5 + y * 19) % 256,
                    (x * 11 + y * 7) % 256,
                ),
            )

    response = convert_request(
        client,
        image_bytes(image),
        short_edge_cells=20,
        max_colors=2,
    )

    assert response.status_code == 200
    payload = response.json()
    assert 1 <= len(payload["palette"]) <= 2
    assert payload["statistics"]["distinct_colors"] == len(payload["palette"])
    assert max(_decoded_grid(payload)) <= 2


@pytest.mark.parametrize(
    ("source_size", "short_edge_cells", "expected_size"),
    [
        ((40, 40), 20, (20, 20)),
        ((40, 40), 300, (300, 300)),
        ((1_000, 100), 100, (300, 30)),
        ((100, 1_000), 100, (30, 300)),
    ],
)
def test_grid_dimension_limits_and_proportional_clamping(
    client: TestClient,
    source_size: tuple[int, int],
    short_edge_cells: int,
    expected_size: tuple[int, int],
) -> None:
    image = Image.new("RGB", source_size, (80, 120, 180))

    response = convert_request(
        client,
        image_bytes(image),
        short_edge_cells=short_edge_cells,
    )

    assert response.status_code == 200
    statistics = response.json()["statistics"]
    assert (statistics["width"], statistics["height"]) == expected_size
    assert 20 <= statistics["width"] <= 300
    assert 20 <= statistics["height"] <= 300


def test_impossible_aspect_ratio_is_structured_422(client: TestClient) -> None:
    image = Image.new("RGB", (1_600, 100), (80, 120, 180))

    response = convert_request(
        client,
        image_bytes(image),
        short_edge_cells=100,
    )

    assert response.status_code == 422
    assert response.json()["error_code"] == "dimensions_unsatisfiable"
    assert set(response.json()) == {"error_code", "message"}


def test_rounding_cannot_make_an_impossible_aspect_ratio_valid(
    client: TestClient,
) -> None:
    image = Image.new("RGB", (1_538, 100), (80, 120, 180))

    response = convert_request(
        client,
        image_bytes(image),
        short_edge_cells=100,
    )

    assert response.status_code == 422
    assert response.json()["error_code"] == "dimensions_unsatisfiable"


def test_exif_orientation_is_applied_before_dimension_selection(client: TestClient) -> None:
    image = Image.new("RGB", (40, 20), (140, 70, 20))
    exif = Image.Exif()
    exif[274] = 6

    response = convert_request(
        client,
        image_bytes(image, "JPEG", exif=exif),
        short_edge_cells=20,
    )

    assert response.status_code == 200
    statistics = response.json()["statistics"]
    assert (statistics["width"], statistics["height"]) == (20, 40)


@pytest.mark.parametrize(
    "artwork",
    [
        b"not an image",
        image_bytes(Image.new("RGB", (20, 20), "red"))[:30],
    ],
)
def test_malformed_and_truncated_images_are_structured_422(
    client: TestClient,
    artwork: bytes,
) -> None:
    response = convert_request(client, artwork)

    assert response.status_code == 422
    assert response.json()["error_code"] == "corrupt_image"
    assert set(response.json()) == {"error_code", "message"}


def test_decodable_unsupported_format_is_structured_422(client: TestClient) -> None:
    gif = image_bytes(Image.new("RGB", (20, 20), "red"), "GIF")

    response = convert_request(client, gif)

    assert response.status_code == 422
    assert response.json()["error_code"] == "unsupported_image"


@pytest.mark.parametrize("image_format", ["PNG", "JPEG", "WEBP"])
def test_supported_image_formats_are_accepted(
    client: TestClient,
    image_format: str,
) -> None:
    artwork = image_bytes(Image.new("RGB", (20, 20), (40, 90, 170)), image_format)

    response = convert_request(client, artwork)

    assert response.status_code == 200


def test_oversized_upload_is_structured_413(client: TestClient) -> None:
    response = convert_request(client, b"x" * (MAX_INPUT_BYTES + 1))

    assert response.status_code == 413
    assert response.json()["error_code"] == "input_too_large"
    assert set(response.json()) == {"error_code", "message"}


def test_oversized_source_edge_is_structured_413(client: TestClient) -> None:
    image = Image.new("1", (12_001, 20), 1)

    response = convert_request(client, image_bytes(image))

    assert response.status_code == 413
    assert response.json()["error_code"] == "input_too_large"


def test_oversized_edge_takes_precedence_over_unsupported_format(
    client: TestClient,
) -> None:
    image = Image.new("P", (12_001, 20), 1)

    response = convert_request(client, image_bytes(image, "GIF"))

    assert response.status_code == 413
    assert response.json()["error_code"] == "input_too_large"


@pytest.mark.parametrize(
    "overrides",
    [
        {"short_edge_cells": 19},
        {"short_edge_cells": 301},
        {"max_colors": 1},
        {"max_colors": 61},
        {"recipe_version": "unknown"},
    ],
)
def test_invalid_parameters_are_structured_422(
    client: TestClient,
    overrides: dict[str, object],
) -> None:
    parameters = {
        "short_edge_cells": 20,
        "max_colors": 8,
        "recipe_version": "v1",
        **overrides,
    }
    image = image_bytes(Image.new("RGB", (20, 20), "red"))

    response = convert_request(client, image, **parameters)

    assert response.status_code == 422
    assert response.json()["error_code"] == "invalid_parameters"
    assert set(response.json()) == {"error_code", "message"}


def test_malformed_multipart_envelope_is_structured_422(client: TestClient) -> None:
    response = client.post(
        "/v1/convert",
        content=b"not-a-multipart-envelope",
        headers={"Content-Type": "multipart/form-data"},
    )

    assert response.status_code == 422
    assert response.json()["error_code"] == "invalid_parameters"
    assert set(response.json()) == {"error_code", "message"}


def test_corrupt_multipart_headers_are_structured_422(client: TestClient) -> None:
    boundary = "stitch-wish-boundary"
    response = client.post(
        "/v1/convert",
        content=(
            f"--{boundary}\r\n"
            "not-a-valid-part-header\r\n\r\n"
            "payload\r\n"
            f"--{boundary}--\r\n"
        ).encode("ascii"),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )

    assert response.status_code == 422
    assert response.json()["error_code"] == "invalid_parameters"
    assert set(response.json()) == {"error_code", "message"}


def test_duplicate_form_fields_are_structured_422(client: TestClient) -> None:
    image = image_bytes(Image.new("RGB", (20, 20), "red"))
    response = client.post(
        "/v1/convert",
        files=[
            ("artwork", ("artwork.png", image, "image/png")),
            ("short_edge_cells", (None, "20")),
            ("short_edge_cells", (None, "21")),
            ("max_colors", (None, "8")),
            ("recipe_version", (None, "v1")),
        ],
    )

    assert response.status_code == 422
    assert response.json()["error_code"] == "invalid_parameters"


def test_busy_instance_rejects_without_queueing(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main_module, "CONVERSION_SLOTS", asyncio.Semaphore(0))
    image = image_bytes(Image.new("RGB", (20, 20), "red"))

    response = convert_request(client, image)

    assert response.status_code == 503
    assert response.json()["error_code"] == "conversion_capacity_exceeded"


def test_palette_is_frequency_then_code_ordered_and_counts_match_grid(
    client: TestClient,
) -> None:
    image = Image.new("RGB", (20, 20), (0, 0, 0))
    for y in range(5):
        for x in range(20):
            image.putpixel((x, y), (255, 255, 255))

    response = convert_request(client, image_bytes(image), max_colors=4)

    assert response.status_code == 200
    payload = response.json()
    counts = [item["count"] for item in payload["statistics"]["per_color"]]
    assert counts == sorted(counts, reverse=True)
    for left, right in zip(
        payload["statistics"]["per_color"],
        payload["statistics"]["per_color"][1:],
    ):
        if left["count"] == right["count"]:
            assert left["dmc_code"] < right["dmc_code"]
    assert sum(counts) == payload["statistics"]["total_stitchable_cells"]
    assert sum(value > 0 for value in _decoded_grid(payload)) == sum(counts)
