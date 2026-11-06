"""Select the exact exported bytes for shared or private edition acceptance."""
import os
from pathlib import Path


def reader_edition_output(default, environ=None):
    environ = os.environ if environ is None else environ
    key = 'READER_EDITION_TEST_OUTPUT'
    value = environ.get(key)
    output = Path(value) if key in environ else Path(default)
    if not output.is_absolute() or (key in environ and not value):
        raise ValueError(f'{key} must name an absolute, non-linked output directory.')
    resolved = output.resolve(strict=True)
    if output != resolved or not resolved.is_dir():
        raise ValueError(f'{key} must name an absolute, non-linked output directory.')
    return resolved
