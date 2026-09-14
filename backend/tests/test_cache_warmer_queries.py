"""Quality gates for the curated daily store-product query catalog."""
from __future__ import annotations

import unicodedata
from collections import Counter

from app.jobs import cache_warmer_queries as catalog


REQUIRED_CATEGORY_SAMPLES = {
    "meat_poultry_eggs": {
        "beef chuck",
        "beef short ribs",
        "chicken wing",
        "chicken feet",
        "pork belly",
        "牛肩肉",
        "牛腱子",
        "牛腱肉",
        "牛里脊肉",
        "咸鸭蛋",
        "皮蛋",
    },
    "seafood": {
        "clam",
        "clams",
        "dried shrimp",
        "fish ball",
        "fish balls",
        "oyster",
        "oysters",
        "scallop",
        "scallops",
        "干贝",
        "虾滑",
    },
    "tofu_plant_proteins": {"silken tofu", "tofu skin", "豆腐泡", "腐竹"},
    "produce_aromatics": {
        "bitter melon",
        "gai lan",
        "green beans",
        "galangal",
        "lotus root",
        "kaffir lime leaves",
        "makrut lime leaves",
        "姜",
        "蒜",
        "红甜椒",
        "青江菜",
        "青蒜",
        "四季豆",
        "竹笋",
        "蒜苗",
        "紫皮茄子",
        "韭菜",
    },
    "fruits": {
        "avocado",
        "lemon",
        "lime",
        "mango",
        "苹果",
        "香蕉",
        "菠萝",
        "橙子",
        "草莓",
        "蓝莓",
        "柠檬",
        "牛油果",
    },
    "mushrooms_sea_vegetables": {"king oyster mushrooms", "wood ear mushrooms", "木耳", "紫菜"},
    "grains_noodles_flours": {
        "glass noodles",
        "rice cake",
        "rice cakes",
        "rice paper",
        "spring roll wrappers",
        "wonton wrappers",
        "粉丝",
        "糯米粉",
    },
    "beans_nuts_seeds": {"adzuki beans", "black sesame", "绿豆", "腰果"},
    "dairy_and_alternatives": {"condensed milk", "coconut milk", "ghee", "paneer", "炼乳", "椰奶"},
    "oils_vinegars": {"peanut oil", "rice vinegar", "镇江香醋", "芝麻油"},
    "sauces_ferments": {
        "gochujang",
        "miso",
        "shaoxing wine",
        "sweet bean sauce",
        "干豆豉",
        "红腐乳",
        "辣豆瓣酱",
        "郫县豆瓣酱",
        "蒸鱼豉油",
    },
    "spices_herbs": {
        "Sichuan peppercorn",
        "curry leaves",
        "gochugaru",
        "star anise",
        "garam masala",
        "五香粉",
        "十三香",
        "大料",
        "干辣椒",
        "草果",
        "辣椒面",
        "陈皮",
        "丁香",
        "香叶",
    },
    "baking_sweeteners": {
        "agar agar",
        "baking powder",
        "matcha powder",
        "palm sugar",
        "泡打粉",
        "糖",
        "红糖",
    },
}

EXPECTED_CATEGORY_COUNTS = {
    "meat_poultry_eggs": 51,
    "seafood": 35,
    "tofu_plant_proteins": 20,
    "produce_aromatics": 79,
    "fruits": 19,
    "mushrooms_sea_vegetables": 18,
    "grains_noodles_flours": 34,
    "beans_nuts_seeds": 17,
    "dairy_and_alternatives": 12,
    "oils_vinegars": 13,
    "sauces_ferments": 45,
    "spices_herbs": 32,
    "baking_sweeteners": 15,
}

INTENTIONALLY_DEMOTED_SECONDARY_TERMS = {
    "almonds",
    "apple cider vinegar",
    "asparagus",
    "balsamic vinegar",
    "blueberry",
    "canola oil",
    "cauliflower",
    "cheese",
    "cocoa powder",
    "cream cheese",
    "fish",
    "flour",
    "gelatin",
    "noodles",
    "pasta",
    "pumpkin seeds",
    "vegetable oil",
    "walnuts",
    "zucchini",
}


def _review_key(query: str) -> str:
    """Stricter-than-runtime key used only to catch catalog curation mistakes."""
    return " ".join(unicodedata.normalize("NFKC", query).split()).casefold()


def test_catalog_is_grouped_for_review_and_covers_researched_chef_staples():
    groups = getattr(catalog, "CURATED_INGREDIENTS_BY_CATEGORY", {})

    assert set(groups) == set(REQUIRED_CATEGORY_SAMPLES)
    for category, required_queries in REQUIRED_CATEGORY_SAMPLES.items():
        assert required_queries <= set(groups[category]), category
        assert len(groups[category]) == EXPECTED_CATEGORY_COUNTS[category], category


def test_source_catalog_has_no_review_key_duplicates():
    counts = Counter(_review_key(query) for query in catalog.COMMON_INGREDIENTS)

    assert [query for query, count in counts.items() if count > 1] == []


def test_generated_variations_do_not_silently_collide_between_sources():
    origins: dict[str, set[str]] = {}
    for source_query in catalog.COMMON_INGREDIENTS:
        for variation in catalog.expand_query(source_query):
            origins.setdefault(_review_key(variation), set()).add(source_query)

    assert {
        runtime_query: source_queries
        for runtime_query, source_queries in origins.items()
        if len(source_queries) > 1
    } == {}


def test_daily_catalog_is_broad_but_bounded_for_serial_warming():
    assert catalog.REVIEWED_SOURCE_QUERY_COUNT == 390
    assert catalog.REVIEWED_RUNTIME_QUERY_COUNT == 405
    assert catalog.MAX_RUNTIME_QUERY_COUNT == 405
    assert len(catalog.COMMON_INGREDIENTS) == catalog.REVIEWED_SOURCE_QUERY_COUNT
    assert len(catalog.ALL_QUERIES) == catalog.REVIEWED_RUNTIME_QUERY_COUNT
    assert len(catalog.ALL_QUERIES) <= catalog.MAX_RUNTIME_QUERY_COUNT


def test_secondary_global_terms_are_intentionally_demoted_for_asian_coverage():
    assert INTENTIONALLY_DEMOTED_SECONDARY_TERMS.isdisjoint(catalog.COMMON_INGREDIENTS)


def test_source_queries_are_clean_grocery_search_terms():
    for query in catalog.COMMON_INGREDIENTS:
        assert query
        assert query == query.strip()
        assert "  " not in query
        assert len(query) <= 60
        assert catalog._is_valid_query(query)

    assert "sweet bean paste" not in catalog.COMMON_INGREDIENTS


def test_query_validator_rejects_quantities_brands_and_recipe_descriptors():
    malformed_queries = {
        "2 lb beef",
        "lb beef",
        "Kikkoman soy sauce",
        "garlic, finely chopped",
        "fresh ginger",
        "新鲜香菇",
    }
    valid_product_forms = {
        "dried shrimp",
        "ground beef",
        "matcha powder",
        "牛腱子",
    }

    assert not any(catalog._is_valid_query(query) for query in malformed_queries)
    assert all(catalog._is_valid_query(query) for query in valid_product_forms)


def test_generated_catalog_is_sorted_unique_and_keeps_common_plural_queries():
    assert catalog.ALL_QUERIES == sorted(set(catalog.ALL_QUERIES))
    assert all(query == query.casefold() for query in catalog.ALL_QUERIES)
    assert {
        "chicken wing",
        "chicken wings",
        "egg",
        "eggs",
        "green onion",
        "green onions",
        "tofu",
        "豆腐",
    } <= set(catalog.ALL_QUERIES)
