from __future__ import annotations


class ConversionError(Exception):
    def __init__(self, status_code: int, error_code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message


def invalid_parameters(message: str) -> ConversionError:
    return ConversionError(422, "invalid_parameters", message)


def corrupt_image() -> ConversionError:
    return ConversionError(
        422,
        "corrupt_image",
        "Artwork must be a complete, decodable PNG, JPEG, or WebP image.",
    )


def unsupported_image(message: str) -> ConversionError:
    return ConversionError(422, "unsupported_image", message)


def dimensions_unsatisfiable() -> ConversionError:
    return ConversionError(
        422,
        "dimensions_unsatisfiable",
        "The artwork aspect ratio cannot produce a proportional grid with both axes between 20 and 300 cells.",
    )


def input_too_large(message: str) -> ConversionError:
    return ConversionError(413, "input_too_large", message)


def conversion_capacity_exceeded() -> ConversionError:
    return ConversionError(
        503,
        "conversion_capacity_exceeded",
        "This engine instance is already processing its configured conversion capacity.",
    )
