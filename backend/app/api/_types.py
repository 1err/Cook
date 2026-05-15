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
    coerce_steps,
    coerce_string_list,
)

LibraryTags = Annotated[list[str], BeforeValidator(coerce_library_tags)]
StepList = Annotated[list[RecipeStep], BeforeValidator(coerce_steps)]
StringList = Annotated[list[str], BeforeValidator(coerce_string_list)]
