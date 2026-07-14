from __future__ import annotations

import csv
import math
import re
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources


_HEX_PATTERN = re.compile(r"^[0-9A-F]{6}$")


@dataclass(frozen=True, slots=True)
class DmcColor:
    code: str
    name: str
    rgb_hex: str
    rgb: tuple[int, int, int]
    lab: tuple[float, float, float]


def rgb_to_lab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    linear: list[float] = []
    for component in rgb:
        value = component / 255.0
        if value <= 0.04045:
            linear.append(value / 12.92)
        else:
            linear.append(((value + 0.055) / 1.055) ** 2.4)

    red, green, blue = linear
    x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047
    y = 0.2126729 * red + 0.7151522 * green + 0.0721750 * blue
    z = (0.0193339 * red + 0.1191920 * green + 0.9503041 * blue) / 1.08883

    delta = 6.0 / 29.0
    threshold = delta**3

    def pivot(value: float) -> float:
        if value > threshold:
            return value ** (1.0 / 3.0)
        return value / (3.0 * delta**2) + 4.0 / 29.0

    fx = pivot(x)
    fy = pivot(y)
    fz = pivot(z)
    return (116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))


@lru_cache(maxsize=1)
def load_dmc_colors() -> tuple[DmcColor, ...]:
    data_path = resources.files("stitch_wish.data").joinpath("dmc_colors.csv")
    colors: list[DmcColor] = []
    seen_codes: set[str] = set()

    with data_path.open("r", encoding="utf-8", newline="") as data_file:
        reader = csv.DictReader(data_file)
        if reader.fieldnames != ["dmc_code", "name", "rgb_hex"]:
            raise RuntimeError("DMC data has an invalid header")

        for row in reader:
            code = row["dmc_code"].strip()
            name = row["name"].strip()
            rgb_hex = row["rgb_hex"].strip().upper().removeprefix("#")
            if not code or not name or not _HEX_PATTERN.fullmatch(rgb_hex):
                raise RuntimeError(f"DMC data has an invalid row for code {code!r}")
            if code in seen_codes:
                raise RuntimeError(f"DMC data has duplicate code {code!r}")
            seen_codes.add(code)
            rgb = tuple(int(rgb_hex[offset : offset + 2], 16) for offset in (0, 2, 4))
            colors.append(
                DmcColor(
                    code=code,
                    name=name,
                    rgb_hex=rgb_hex,
                    rgb=rgb,
                    lab=rgb_to_lab(rgb),
                )
            )

    if len(colors) < 450:
        raise RuntimeError("DMC data must contain at least 450 unique colors")

    return tuple(sorted(colors, key=lambda color: color.code))


def nearest_dmc(rgb: tuple[int, int, int]) -> DmcColor:
    target_l, target_a, target_b = rgb_to_lab(rgb)

    def distance_key(color: DmcColor) -> tuple[float, str]:
        color_l, color_a, color_b = color.lab
        distance_squared = math.fsum(
            (
                (target_l - color_l) ** 2,
                (target_a - color_a) ** 2,
                (target_b - color_b) ** 2,
            )
        )
        return (distance_squared, color.code)

    return min(load_dmc_colors(), key=distance_key)

