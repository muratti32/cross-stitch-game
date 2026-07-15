# Stitch Wish Conversion Engine

This directory is an independent, stateless Python 3.12 service. It converts one
approved artwork image into the dense Pattern Artifact v1 cell encoding used by
the client. It does not authenticate players, persist files, use a database, or
run queues. Deploy it only on a private network reachable by the backend worker;
do not expose it directly to players or the public internet.

## API contract

`POST /v1/convert` accepts `multipart/form-data`:

| Field | Type | Contract |
| --- | --- | --- |
| `artwork` | file | Complete PNG, JPEG, or WebP; at most 20 MiB; each source edge at most 12,000 px |
| `short_edge_cells` | integer | Target short grid edge, 20..300 |
| `max_colors` | integer | Maximum quantization colors, 2..60 |
| `recipe_version` | string | Must be `v1` |

Each field must appear exactly once and no extra parts are accepted. The whole
multipart envelope has a 21 MiB safety cap so a malformed request cannot spool
unbounded temporary data; this leaves 1 MiB for normal multipart overhead above
the exact 20 MiB artwork limit.

Example:

```sh
curl -X POST http://127.0.0.1:8000/v1/convert \
  -F artwork=@artwork.png \
  -F short_edge_cells=80 \
  -F max_colors=24 \
  -F recipe_version=v1
```

The JSON response contains:

- `grid`: standard base64 of exactly `width * height` row-major bytes. `0` is
  empty and `1..N` indexes the ordered palette. Packaging as gzip/protobuf is a
  backend responsibility.
- `palette`: `[{dmc_code, name, rgb_hex}]`; `rgb_hex` is `#RRGGBB`. Entries are
  sorted by mapped-cell frequency descending, then DMC code ascending as a
  string.
- `preview_png`: standard base64 of a deterministic RGBA PNG rendered from the
  final grid and DMC palette. Empty cells are transparent.
- `statistics`: `width`, `height`, `total_stitchable_cells`, `distinct_colors`,
  and `per_color`. Each `per_color` item has the 1-based `palette_index`,
  `dmc_code`, and `count`, in palette order.
- `engine_version`, immutable `dmc_palette_version`, and the accepted
  `recipe_version`.

`GET /v1/health` returns `{"status":"ok","engine_version":"1.0.0"}`.

Expected request failures return only:

```json
{"error_code":"corrupt_image","message":"..."}
```

Parameter, recipe, format, corrupt-image, and unsatisfiable-dimension failures
use HTTP 422. Inputs over 20 MiB or with either source edge over 12,000 px use
HTTP 413. An instance at its configured conversion capacity rejects immediately
with HTTP 503 rather than retaining an in-process job queue. Animated/multi-frame
images are not supported.

## Recipe `v1`

The recipe is deliberately finite and versioned so a caller can reproduce an
artifact later:

1. Decode the image header and read EXIF orientation for geometry.
2. Choose proportional integer dimensions. The requested short edge is used
   unless the long edge would exceed 300; then both axes are scaled to a 300-cell
   long edge. Half values round upward. If proportional rounding cannot keep both
   axes in 20..300, conversion returns 422.
3. Use JPEG decoder draft scaling when available, then downsample once with
   Pillow LANCZOS and `reducing_gap=3.0`. Apply EXIF orientation at grid scale
   and convert to RGBA, avoiding multiple full-resolution source copies.
4. Treat resized pixels with alpha below 128 as empty.
5. Quantize stitchable RGB cells with deterministic weighted median cut. Box,
   channel, median, and centroid ties have fixed rules; no randomness is used.
6. Match cluster centroids to the checked-in 455-color DMC table with CIE76 in
   D65 Lab. Equal-distance matches use DMC code ascending. Merge clusters that
   select the same DMC color.
7. Render with up to 8 pixels per cell and a 2,048 px preview-edge cap. Encode
   RGBA PNG with `compress_level=9`, `optimize=false`, and no metadata.

Dependency versions are pinned in `pyproject.toml`. Identical image bytes,
engine version, recipe, and runtime produce byte-identical grid, palette, and
preview outputs.

## Run and test

```sh
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[test]'
python -m stitch_wish
```

Configuration is environment-only: `HOST` defaults to `0.0.0.0`, `PORT` to
`8000`, `LOG_LEVEL` to `info`, and `MAX_CONCURRENT_CONVERSIONS` to `1`. The
default concurrency bound prevents multiple maximum-size decodes from
multiplying worker memory; allocate at least 1 GiB per configured conversion.
Application and server events are structured JSON and do not include filenames,
request bodies, image bytes, or player data. Uvicorn access logging is disabled
by the packaged entrypoint.

```sh
pytest
python -m compileall src
docker build -t stitch-wish-conversion-engine .
```

The container uses Python 3.12 slim, runs as the non-root `stitchwish` user, and
expands `PORT` inside the Python entrypoint.
