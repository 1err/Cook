"""
Shopping list refinement via LLM. Wraps app.refine; stateless, no DB.
"""
from app.refine import refine_shopping_list

__all__ = ["refine_shopping_list"]
