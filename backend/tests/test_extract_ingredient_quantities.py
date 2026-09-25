"""Ingredient parsing preserves source amounts and optional metric provenance."""
import json

import pytest

from app.extract import parse_llm_recipe_response
from app.services.video_response_schemas import VIDEO_EXTRACTION_SCHEMA


def ingredient(**values):
    parsed = parse_llm_recipe_response(json.dumps({"title": "Dinner", "ingredients": [values]}, ensure_ascii=False))
    return parsed["ingredients"][0]


def test_explicit_metric_is_optional_and_never_replaces_source_count():
    assert ingredient(name="螺丝椒", quantity="7根", metric_quantity="约400克", notes="薄皮；斜切") == {
        "name": "螺丝椒", "quantity": "7根", "metric_quantity": "约400克", "notes": "薄皮；斜切",
    }
    assert ingredient(name="螺丝椒", quantity="7根", notes="薄皮；斜切")["metric_quantity"] is None


@pytest.mark.parametrize("quantity,primary,metric", [
    ("2 cloves approx. 10 g", "2 cloves", "approx. 10 g"),
    ("2瓣约10克", "2瓣", "约10克"),
    ("1 cup (240 mL)", "1 cup", "240 mL"),
    ("两碗（约600毫升）", "两碗", "约600毫升"),
    ("2 cups (about 400–500 ml)", "2 cups", "about 400–500 ml"),
    ("2 cups approx. 1/2 l", "2 cups", "approx. 1/2 l"),
])
def test_legacy_dual_measurements_keep_approximation(quantity, primary, metric):
    result = ingredient(name="Ingredient", quantity=quantity)
    assert result["quantity"] == primary
    assert result["metric_quantity"] == metric


@pytest.mark.parametrize("quantity", ["适量", "少许", "to taste", "as needed", "约200克", "1/2 cup"])
def test_parser_does_not_invent_metric_equivalents_or_precision(quantity):
    result = ingredient(name="Ingredient", quantity=quantity, notes="Keep the source wording.")
    assert result["quantity"] == quantity
    assert result["metric_quantity"] is None
    assert result["notes"] == "Keep the source wording."


def test_explicit_metric_does_not_erase_a_different_original_alternative():
    result = ingredient(name="Milk", quantity="1 cup / 240 mL", metric_quantity="约250毫升", notes="Source gives both.")
    assert result["quantity"] == "1 cup / 240 mL"
    assert result["metric_quantity"] == "约250毫升"


def test_preparation_stays_separate_from_the_source_amount():
    result = ingredient(name="排骨", quantity="一斤", metric_quantity="500g", notes="块要切得小一点")
    assert result["quantity"] == "一斤"
    assert result["notes"] == "块要切得小一点"
    assert result["metric_quantity"] == "500g"


def test_provider_accepts_optional_metric_field_without_requiring_it():
    item = VIDEO_EXTRACTION_SCHEMA["properties"]["ingredients"]["items"]
    assert item["properties"]["metric_quantity"]["type"] == ["string", "null"]
    assert "metric_quantity" not in item["required"]
    assert item["additionalProperties"] is False
