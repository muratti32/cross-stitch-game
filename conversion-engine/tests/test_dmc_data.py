from __future__ import annotations

import re

from stitch_wish.colors import load_dmc_colors


def test_checked_in_dmc_table_is_complete_and_valid() -> None:
    colors = load_dmc_colors()

    assert len(colors) >= 450
    assert len({color.code for color in colors}) == len(colors)
    assert all(re.fullmatch(r"[0-9A-F]{6}", color.rgb_hex) for color in colors)
    assert all(color.name for color in colors)

