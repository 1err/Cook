"""
Reusable Pydantic types shared by routers.

`LibraryTags` runs the canonical `coerce_library_tags` cleanup before
the field is set, so request models don't each need to repeat the
`@field_validator("library_tags", mode="before")` boilerplate.

`StepList` and `StringList` provide the same convenience for the
tutorial fields (steps, tips, equipment).
"""
from __future__ import annotations

from typing import Annotated

from pydantic import BeforeValidator

from app.models import (
    RecipeStep,
    coerce_library_tags,
    coerce_string_list,
)
from app.tutorial import parse_step_rows

LibraryTags = Annotated[list[str], BeforeValidator(coerce_library_tags)]
StepList = Annotated[list[RecipeStep], BeforeValidator(parse_step_rows)]
StringList = Annotated[list[str], BeforeValidator(coerce_string_list)]
