"""A small allowlist combines shopping synonyms without broad name matching."""
import pytest

from app import refine
from app.services.shopping_service import aggregate_ingredients, normalize_purchase_quantity


def test_named_shopping_aliases_share_one_total_regardless_of_input_order():
    ingredients = [
        ("生抽", "20 g"), ("生抽酱油", "10 g"), ("鲜味生抽", "1 汤匙"),
        ("老抽酱油", "5 g"), ("老抽", "10 g"),
        ("油", "10 g"), ("食用油", "20 g"), ("植物油", "1 汤匙"),
    ]
    expected = {"生抽": "约 45 g", "老抽": "15 g", "食用油": "约 44 g"}
    for rows in (ingredients, list(reversed(ingredients))):
        output = aggregate_ingredients(rows, for_purchase=True)
        assert {item.name: normalize_purchase_quantity(item.name, item.total_quantity)
                for item in output} == expected


def test_other_sauces_oils_and_default_aggregation_remain_distinct():
    names = ["生抽", "老抽", "酱油", "低钠生抽", "蒸鱼豉油", "橄榄油", "芝麻油", "辣椒油"]
    assert {item.name for item in aggregate_ingredients([(name, "1 g") for name in names], for_purchase=True)} == set(names)
    assert len(aggregate_ingredients([("生抽", "1 g"), ("生抽酱油", "2 g")])) == 2


@pytest.mark.asyncio
async def test_refine_fallback_merges_aliases_without_losing_measured_amounts(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", lambda: None)
    result = await refine.refine_shopping_list([
        {"name": "鲜味生抽", "quantity": "1 汤匙"},
        {"name": "生抽酱油", "quantity": "20 g"},
        {"name": "生抽", "quantity": "适量"},
    ])
    assert result["purchase_items"] == [{
        "name": "生抽", "suggested_purchase": "约 35 g", "grocery_category": "Other",
    }]
    assert normalize_purchase_quantity("鲜味生抽", "20 g; 1 汤匙") == "约 35 g"


@pytest.mark.parametrize(("name", "quantity", "expected"), [
    ("大蒜", "55 g + 2 瓣", "约 61 g"),
    ("garlic", "55 g; 2 cloves", "about 61 g"),
    ("大蒜", "2 瓣", "2 瓣"),
    ("大蒜", "55 g; 2-3 瓣", "55 g；2-3 瓣"),
    ("橙子", "55 g; 2 瓣", "55 g + 2 瓣"),
])
def test_only_known_garlic_cloves_join_a_mixed_weight(name, quantity, expected):
    assert normalize_purchase_quantity(name, quantity) == expected
    assert normalize_purchase_quantity(name, expected) == expected


def test_recorded_garlic_weight_wins_over_standard_clove_estimate():
    rows = aggregate_ingredients([("大蒜", "2 瓣 (10 g)"), ("大蒜", "1 瓣")], for_purchase=True)
    assert normalize_purchase_quantity(rows[0].name, rows[0].total_quantity) == "约 13 g"
