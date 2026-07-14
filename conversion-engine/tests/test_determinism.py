from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

from .conftest import image_bytes


CHILD_SCRIPT = r"""
import base64
import hashlib
import json
import os
from pathlib import Path

from stitch_wish.converter import convert_image

result = convert_image(
    Path(os.environ["ARTWORK_PATH"]).read_bytes(),
    short_edge_cells=37,
    max_colors=12,
    recipe_version="v1",
)
palette_bytes = json.dumps(
    [entry.model_dump(mode="json") for entry in result.palette],
    ensure_ascii=False,
    separators=(",", ":"),
).encode("utf-8")
print(json.dumps({
    "grid": hashlib.sha256(base64.b64decode(result.grid)).hexdigest(),
    "palette": hashlib.sha256(palette_bytes).hexdigest(),
    "preview": hashlib.sha256(base64.b64decode(result.preview_png)).hexdigest(),
}, sort_keys=True))
"""


def _fresh_process_hashes(artwork_path: Path, hash_seed: str) -> dict[str, str]:
    project_root = Path(__file__).resolve().parents[1]
    environment = os.environ.copy()
    environment["ARTWORK_PATH"] = str(artwork_path)
    environment["PYTHONHASHSEED"] = hash_seed
    environment["PYTHONPATH"] = os.pathsep.join(
        filter(
            None,
            [str(project_root / "src"), environment.get("PYTHONPATH", "")],
        )
    )
    completed = subprocess.run(
        [sys.executable, "-c", CHILD_SCRIPT],
        cwd=project_root,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_outputs_are_identical_across_fresh_processes(tmp_path: Path) -> None:
    image = Image.new("RGBA", (73, 41))
    for y in range(image.height):
        for x in range(image.width):
            alpha = 0 if (x + y * 3) % 17 == 0 else 255
            image.putpixel(
                (x, y),
                (
                    (x * 31 + y * 7) % 256,
                    (x * 3 + y * 29) % 256,
                    (x * 13 + y * 11) % 256,
                    alpha,
                ),
            )
    artwork_path = tmp_path / "determinism.png"
    artwork_path.write_bytes(image_bytes(image))

    first = _fresh_process_hashes(artwork_path, "1")
    second = _fresh_process_hashes(artwork_path, "8675309")

    assert first == second
    assert set(first) == {"grid", "palette", "preview"}
    assert all(len(digest) == 64 for digest in first.values())

