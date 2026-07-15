from __future__ import annotations

import base64
import io
import struct
import warnings
from collections import defaultdict
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageFile, UnidentifiedImageError

from .colors import DmcColor, load_dmc_colors, nearest_dmc
from .constants import (
    ALPHA_THRESHOLD,
    DMC_PALETTE_VERSION,
    ENGINE_VERSION,
    MAX_GRID_EDGE,
    MAX_COLORS,
    MAX_IMAGE_EDGE,
    MAX_IMAGE_PIXELS,
    MIN_COLORS,
    MIN_GRID_EDGE,
    PREVIEW_MAX_CELL_PX,
    PREVIEW_MAX_EDGE_PX,
    SUPPORTED_RECIPE_VERSION,
)
from .errors import (
    ConversionError,
    corrupt_image,
    dimensions_unsatisfiable,
    input_too_large,
    invalid_parameters,
    unsupported_image,
)
from .models import (
    ConversionStatistics,
    ConvertResponse,
    PaletteEntry,
    PerColorCount,
)
from .quantization import median_cut


Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
ImageFile.LOAD_TRUNCATED_IMAGES = False

SUPPORTED_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})
EXIF_ORIENTATION_TAG = 274
AXIS_SWAPPING_ORIENTATIONS = frozenset({5, 6, 7, 8})
ORIENTATION_TRANSPOSE = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}
LANCZOS_SOURCE_MODES = frozenset({"L", "LA", "RGB", "RGBA", "CMYK"})


@dataclass(frozen=True, slots=True)
class PreparedGrid:
    rgba: NDArray[np.uint8]
    width: int
    height: int


def _round_ratio_half_up(value: int, numerator: int, denominator: int) -> int:
    scaled = value * numerator
    quotient, remainder = divmod(scaled, denominator)
    return quotient + int(remainder * 2 >= denominator)


def calculate_grid_size(
    source_width: int,
    source_height: int,
    short_edge_cells: int,
) -> tuple[int, int]:
    short_source_edge = min(source_width, source_height)
    long_source_edge = max(source_width, source_height)

    if long_source_edge * MIN_GRID_EDGE > short_source_edge * MAX_GRID_EDGE:
        raise dimensions_unsatisfiable()

    if short_edge_cells * long_source_edge <= MAX_GRID_EDGE * short_source_edge:
        scale_numerator = short_edge_cells
        scale_denominator = short_source_edge
    else:
        scale_numerator = MAX_GRID_EDGE
        scale_denominator = long_source_edge

    width = _round_ratio_half_up(source_width, scale_numerator, scale_denominator)
    height = _round_ratio_half_up(source_height, scale_numerator, scale_denominator)

    if (
        min(width, height) < MIN_GRID_EDGE
        or max(width, height) > MAX_GRID_EDGE
    ):
        raise dimensions_unsatisfiable()
    return width, height


def _check_source_dimensions(width: int, height: int) -> None:
    if width <= 0 or height <= 0:
        raise corrupt_image()
    if width > MAX_IMAGE_EDGE or height > MAX_IMAGE_EDGE:
        raise input_too_large(
            f"Artwork dimensions must not exceed {MAX_IMAGE_EDGE} pixels on either edge."
        )


def _read_exif_orientation(source: Image.Image) -> int:
    orientation = int(source.getexif().get(EXIF_ORIENTATION_TAG, 1))
    return orientation if 1 <= orientation <= 8 else 1


def _resize_before_orientation(
    source: Image.Image,
    target_size: tuple[int, int],
) -> Image.Image:
    if source.format == "JPEG":
        source.draft("RGB", target_size)

    working = source
    owns_working = False
    has_color_key_transparency = source.info.get("transparency") is not None
    if source.mode not in LANCZOS_SOURCE_MODES or has_color_key_transparency:
        target_mode = (
            "RGBA"
            if has_color_key_transparency
            else "RGB"
        )
        working = source.convert(target_mode)
        owns_working = True

    try:
        return working.resize(
            target_size,
            resample=Image.Resampling.LANCZOS,
            reducing_gap=3.0,
        )
    finally:
        if owns_working:
            working.close()


def _apply_exif_orientation(
    resized: Image.Image,
    orientation: int,
) -> Image.Image:
    transpose = ORIENTATION_TRANSPOSE.get(orientation)
    if transpose is None:
        return resized
    return resized.transpose(transpose)


def _decode_and_resize(image_bytes: bytes, short_edge_cells: int) -> PreparedGrid:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_bytes)) as source:
                _check_source_dimensions(*source.size)
                source_format = (source.format or "").upper()
                if source_format not in SUPPORTED_FORMATS:
                    raise unsupported_image(
                        "Artwork format must be PNG, JPEG, or WebP."
                    )
                if int(getattr(source, "n_frames", 1)) != 1:
                    raise unsupported_image("Animated or multi-frame artwork is not supported.")

                orientation = _read_exif_orientation(source)
                if orientation in AXIS_SWAPPING_ORIENTATIONS:
                    oriented_source_width = source.height
                    oriented_source_height = source.width
                else:
                    oriented_source_width = source.width
                    oriented_source_height = source.height

                width, height = calculate_grid_size(
                    oriented_source_width,
                    oriented_source_height,
                    short_edge_cells,
                )
                resize_target = (
                    (height, width)
                    if orientation in AXIS_SWAPPING_ORIENTATIONS
                    else (width, height)
                )
                resized = _resize_before_orientation(source, resize_target)
                try:
                    oriented = _apply_exif_orientation(resized, orientation)
                    try:
                        if oriented.mode == "RGBA":
                            array = np.asarray(oriented, dtype=np.uint8).copy()
                        else:
                            rgba = oriented.convert("RGBA")
                            try:
                                array = np.asarray(rgba, dtype=np.uint8).copy()
                            finally:
                                rgba.close()
                    finally:
                        if oriented is not resized:
                            oriented.close()
                finally:
                    resized.close()

                if array.shape != (height, width, 4):
                    raise corrupt_image()

        return PreparedGrid(rgba=array, width=width, height=height)
    except ConversionError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, MemoryError):
        raise input_too_large("Artwork dimensions exceed the decoder safety limit.") from None
    except (
        UnidentifiedImageError,
        OSError,
        EOFError,
        IndexError,
        KeyError,
        OverflowError,
        RuntimeError,
        SyntaxError,
        TypeError,
        ValueError,
        struct.error,
    ):
        raise corrupt_image() from None


def _render_preview(
    grid: NDArray[np.uint8],
    palette: list[DmcColor],
) -> bytes:
    height, width = grid.shape
    preview = np.zeros((height, width, 4), dtype=np.uint8)
    for palette_index, color in enumerate(palette, start=1):
        cells = grid == palette_index
        preview[cells, 0] = color.rgb[0]
        preview[cells, 1] = color.rgb[1]
        preview[cells, 2] = color.rgb[2]
        preview[cells, 3] = 255

    cell_size = min(
        PREVIEW_MAX_CELL_PX,
        max(1, PREVIEW_MAX_EDGE_PX // max(width, height)),
    )
    image = Image.fromarray(preview)
    try:
        if cell_size > 1:
            scaled = image.resize(
                (width * cell_size, height * cell_size),
                resample=Image.Resampling.NEAREST,
            )
        else:
            scaled = image
        try:
            output = io.BytesIO()
            scaled.save(
                output,
                format="PNG",
                optimize=False,
                compress_level=9,
            )
            return output.getvalue()
        finally:
            if scaled is not image:
                scaled.close()
    finally:
        image.close()


def convert_image(
    image_bytes: bytes,
    short_edge_cells: int,
    max_colors: int,
    recipe_version: str,
) -> ConvertResponse:
    if not MIN_GRID_EDGE <= short_edge_cells <= MAX_GRID_EDGE:
        raise invalid_parameters("short_edge_cells must be between 20 and 300.")
    if not MIN_COLORS <= max_colors <= MAX_COLORS:
        raise invalid_parameters("max_colors must be between 2 and 60.")
    if recipe_version != SUPPORTED_RECIPE_VERSION:
        raise invalid_parameters(
            f"Unsupported recipe_version {recipe_version!r}; expected {SUPPORTED_RECIPE_VERSION!r}."
        )

    prepared = _decode_and_resize(image_bytes, short_edge_cells)
    rgba = prepared.rgba
    stitchable = rgba[:, :, 3] >= ALPHA_THRESHOLD
    flat_mask = stitchable.reshape(-1)
    flat_grid = np.zeros(prepared.width * prepared.height, dtype=np.uint8)

    ordered_colors: list[DmcColor] = []
    if bool(flat_mask.any()):
        rgb_pixels = rgba[:, :, :3].reshape(-1, 3)[flat_mask]
        quantized = median_cut(rgb_pixels, max_colors)
        cluster_colors = [
            nearest_dmc(tuple(int(component) for component in center))
            for center in quantized.centers
        ]

        counts_by_code: dict[str, int] = defaultdict(int)
        cluster_counts = np.bincount(
            quantized.pixel_cluster_ids,
            minlength=len(cluster_colors),
        )
        for cluster_id, color in enumerate(cluster_colors):
            counts_by_code[color.code] += int(cluster_counts[cluster_id])

        colors_by_code = {color.code: color for color in load_dmc_colors()}
        ordered_codes = sorted(
            counts_by_code,
            key=lambda code: (-counts_by_code[code], code),
        )
        ordered_colors = [colors_by_code[code] for code in ordered_codes]
        index_by_code = {
            color.code: palette_index
            for palette_index, color in enumerate(ordered_colors, start=1)
        }
        cluster_to_palette = np.asarray(
            [index_by_code[color.code] for color in cluster_colors],
            dtype=np.uint8,
        )
        flat_grid[flat_mask] = cluster_to_palette[quantized.pixel_cluster_ids]

    grid = flat_grid.reshape(prepared.height, prepared.width)
    preview_png = _render_preview(grid, ordered_colors)
    final_counts = np.bincount(flat_grid, minlength=len(ordered_colors) + 1)

    palette_models = [
        PaletteEntry(
            dmc_code=color.code,
            name=color.name,
            rgb_hex=f"#{color.rgb_hex}",
        )
        for color in ordered_colors
    ]
    per_color = [
        PerColorCount(
            palette_index=palette_index,
            dmc_code=color.code,
            count=int(final_counts[palette_index]),
        )
        for palette_index, color in enumerate(ordered_colors, start=1)
    ]

    return ConvertResponse(
        grid=base64.b64encode(flat_grid.tobytes(order="C")).decode("ascii"),
        palette=palette_models,
        preview_png=base64.b64encode(preview_png).decode("ascii"),
        statistics=ConversionStatistics(
            width=prepared.width,
            height=prepared.height,
            total_stitchable_cells=int(flat_mask.sum()),
            per_color=per_color,
            distinct_colors=len(ordered_colors),
        ),
        engine_version=ENGINE_VERSION,
        dmc_palette_version=DMC_PALETTE_VERSION,
        recipe_version=recipe_version,
    )
