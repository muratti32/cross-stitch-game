from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class PaletteEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    dmc_code: str
    name: str
    rgb_hex: str


class PerColorCount(BaseModel):
    model_config = ConfigDict(frozen=True)

    palette_index: int = Field(ge=1, le=255)
    dmc_code: str
    count: int = Field(ge=1)


class ConversionStatistics(BaseModel):
    model_config = ConfigDict(frozen=True)

    width: int = Field(ge=20, le=300)
    height: int = Field(ge=20, le=300)
    total_stitchable_cells: int = Field(ge=0)
    per_color: list[PerColorCount]
    distinct_colors: int = Field(ge=0, le=60)


class ConvertResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    grid: str
    palette: list[PaletteEntry]
    preview_png: str
    statistics: ConversionStatistics
    engine_version: str
    dmc_palette_version: str
    recipe_version: str


class HealthResponse(BaseModel):
    status: str
    engine_version: str


class ErrorResponse(BaseModel):
    error_code: str
    message: str
