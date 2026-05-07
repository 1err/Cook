"""
Reusable Pydantic types shared by routers.

`LibraryTags` runs the canonical `coerce_library_tags` cleanup before
the field is set, so request models don't each need to repeat the
`@field_validator("library_tags", mode="before")` boilerplate.
"""
from __future__ import annotations

from typing import Annotated

from pydantic import BeforeValidator

from app.models import coerce_library_tags

LibraryTags = Annotated[list[str], BeforeValidator(coerce_library_tags)]
