from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray


UInt8Array = NDArray[np.uint8]
Int64Array = NDArray[np.int64]


@dataclass(frozen=True, slots=True)
class QuantizedColors:
    centers: UInt8Array
    pixel_cluster_ids: Int64Array


def _round_fraction_half_up(numerator: int, denominator: int) -> int:
    quotient, remainder = divmod(numerator, denominator)
    return quotient + int(remainder * 2 >= denominator)


def _box_score(
    unique_colors: UInt8Array,
    counts: Int64Array,
    indices: Int64Array,
) -> tuple[int, int, int]:
    colors_in_box = unique_colors[indices]
    ranges = colors_in_box.max(axis=0).astype(np.int16) - colors_in_box.min(axis=0)
    return (int(ranges.max()), int(counts[indices].sum()), len(indices))


def _split_box(
    unique_colors: UInt8Array,
    counts: Int64Array,
    indices: Int64Array,
) -> tuple[Int64Array, Int64Array]:
    colors_in_box = unique_colors[indices]
    ranges = colors_in_box.max(axis=0).astype(np.int16) - colors_in_box.min(axis=0)
    channel = int(np.argmax(ranges))

    order = np.lexsort(
        (
            colors_in_box[:, 2],
            colors_in_box[:, 1],
            colors_in_box[:, 0],
            colors_in_box[:, channel],
        )
    )
    sorted_indices = indices[order]
    cumulative = np.cumsum(counts[sorted_indices], dtype=np.int64)
    weighted_midpoint = (int(cumulative[-1]) + 1) // 2
    split_at = int(np.searchsorted(cumulative, weighted_midpoint, side="left")) + 1
    split_at = min(max(split_at, 1), len(sorted_indices) - 1)
    return sorted_indices[:split_at], sorted_indices[split_at:]


def _weighted_center(
    unique_colors: UInt8Array,
    counts: Int64Array,
    indices: Int64Array,
) -> UInt8Array:
    weights = counts[indices]
    total = int(weights.sum())
    weighted_sums = (
        unique_colors[indices].astype(np.uint64) * weights.astype(np.uint64)[:, None]
    ).sum(axis=0, dtype=np.uint64)
    return np.asarray(
        [_round_fraction_half_up(int(value), total) for value in weighted_sums],
        dtype=np.uint8,
    )


def median_cut(pixels: UInt8Array, max_colors: int) -> QuantizedColors:
    """Deterministic weighted median-cut over an N x 3 uint8 RGB array."""
    unique_colors, inverse, counts = np.unique(
        pixels,
        axis=0,
        return_inverse=True,
        return_counts=True,
    )
    unique_colors = unique_colors.astype(np.uint8, copy=False)
    inverse = inverse.astype(np.int64, copy=False)
    counts = counts.astype(np.int64, copy=False)

    boxes: list[Int64Array] = [np.arange(len(unique_colors), dtype=np.int64)]
    while len(boxes) < max_colors:
        candidates = [index for index, box in enumerate(boxes) if len(box) > 1]
        if not candidates:
            break
        selected = max(
            candidates,
            key=lambda index: (*_box_score(unique_colors, counts, boxes[index]), -index),
        )
        left, right = _split_box(unique_colors, counts, boxes[selected])
        boxes[selected] = left
        boxes.append(right)

    centers = np.vstack(
        [_weighted_center(unique_colors, counts, box) for box in boxes]
    ).astype(np.uint8, copy=False)
    unique_to_cluster = np.empty(len(unique_colors), dtype=np.int64)
    for cluster_id, box in enumerate(boxes):
        unique_to_cluster[box] = cluster_id

    return QuantizedColors(
        centers=centers,
        pixel_cluster_ids=unique_to_cluster[inverse],
    )

