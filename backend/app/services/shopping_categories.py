"""Exact grocery categories for the reviewed bilingual ingredient catalog."""
from app.jobs.cache_warmer_queries import CURATED_INGREDIENTS_BY_CATEGORY


_CATALOG_CATEGORIES = {
    "meat_poultry_eggs": "Meat & Seafood",
    "seafood": "Meat & Seafood",
    "produce_aromatics": "Produce",
    "fruits": "Produce",
    "grains_noodles_flours": "Pantry & Dry Goods",
    "beans_nuts_seeds": "Pantry & Dry Goods",
    "oils_vinegars": "Pantry & Dry Goods",
    "sauces_ferments": "Pantry & Dry Goods",
    "spices_herbs": "Pantry & Dry Goods",
    "baking_sweeteners": "Pantry & Dry Goods",
    "dairy_and_alternatives": "Dairy",
}
_CATEGORIES = {
    name.casefold(): category
    for section, category in _CATALOG_CATEGORIES.items()
    for name in CURATED_INGREDIENTS_BY_CATEGORY[section]
}
# These catalog sections span grocery aisles. Keep their distinctions explicit,
# and never classify an unknown compound ingredient by a substring.
for _category, _names in {
    "Produce": (
        "mushroom", "mushrooms", "shiitake", "enoki mushrooms", "oyster mushrooms",
        "king oyster mushrooms", "香菇", "金针菇", "平菇", "杏鲍菇",
        "edamame", "毛豆", "大葱", "红洋葱", "紫洋葱", "red onion",
        "onions", "carrots", "potatoes", "tomatoes", "green onions",
    ),
    "Pantry & Dry Goods": (
        "dried shrimp", "虾米", "干贝", "kombu", "wakame", "nori", "海带",
        "裙带菜", "紫菜", "wood ear mushrooms", "木耳", "银耳",
        "coconut milk", "椰奶", "tofu skin", "bean curd sticks", "fermented tofu",
        "腐竹", "腐乳", "蒜粉", "姜粉", "garlic powder", "ginger powder",
        "ground pepper", "黑胡椒", "黑胡椒粉", "白胡椒", "味精", "msg",
        "中筋面粉", "普通面粉", "all-purpose flour", "all purpose flour", "ap flour",
        "table salt", "white sugar", "granulated sugar", "白砂糖",
        "oil", "vegetable oil", "cooking oil", "食盐", "精盐",
    ),
    "Dairy": ("egg", "eggs", "鸡蛋", "咸鸭蛋", "皮蛋", "cheese"),
}.items():
    _CATEGORIES.update(dict.fromkeys((_name.casefold() for _name in _names), _category))


def grocery_category(name: str) -> str:
    return _CATEGORIES.get(name.strip().casefold(), "Other")
