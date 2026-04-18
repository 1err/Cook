"""
Shared query catalog for cache warming.
"""
from __future__ import annotations

PRECOMPUTE_CONCURRENCY = 5
DEFAULT_STORE = "weee"
CANONICAL_MAP: dict[str, str] = {
    "onions": "onion",
    "green onions": "green onion",
    "jalapenos": "jalapeno",
}

COMMON_INGREDIENTS = [
    "beef",
    "beef shank",
    "beef chuck",
    "beef brisket",
    "ground beef",
    "chicken",
    "chicken thigh",
    "chicken breast",
    "chicken wings",
    "pork",
    "pork belly",
    "pork ribs",
    "pork loin",
    "ground pork",
    "shrimp",
    "salmon",
    "tofu",
    "egg",
    "milk",
    "butter",
    "cheese",
    "yogurt",
    "rice",
    "noodles",
    "pasta",
    "flour",
    "cornstarch",
    "soy sauce",
    "oyster sauce",
    "sesame oil",
    "rice vinegar",
    "cooking wine",
    "doubanjiang",
    "black vinegar",
    "garlic",
    "ginger",
    "onion",
    "green onion",
    "cilantro",
    "potato",
    "sweet potato",
    "tomato",
    "cucumber",
    "carrot",
    "broccoli",
    "spinach",
    "bok choy",
    "napa cabbage",
    "bell pepper",
    "jalapeno",
    "mushroom",
    "shiitake",
    "avocado",
    "lemon",
    "lime",
    "apple",
    "banana",
    "strawberry",
    "blueberry",
    "black beans",
    "chickpeas",
    "lentils",
    "olive oil",
    "coconut milk",
    "牛肉",
    "牛腱",
    "牛腱子",
    "牛腩",
    "牛肋条",
    "牛里脊",
    "鸡肉",
    "鸡腿",
    "鸡翅",
    "鸡胸肉",
    "鸡爪",
    "猪肉",
    "五花肉",
    "排骨",
    "猪里脊",
    "猪蹄",
    "虾",
    "三文鱼",
    "豆腐",
    "鸡蛋",
    "牛奶",
    "米饭",
    "面条",
    "蒜",
    "大蒜",
    "生姜",
    "洋葱",
    "葱",
    "香菜",
    "土豆",
    "红薯",
    "西红柿",
    "黄瓜",
    "胡萝卜",
    "西兰花",
    "菠菜",
    "上海青",
    "青江菜",
    "大白菜",
    "青椒",
    "香菇",
    "金针菇",
    "茄子",
    "豆角",
    "四季豆",
    "酱油",
    "蚝油",
    "麻油",
    "米醋",
    "料酒",
    "陈醋",
    "辣椒",
    "花椒",
    "豆瓣酱",
]

_PLURAL_VARIATIONS: dict[str, str] = {
    "egg": "eggs",
    "onion": "onions",
    "green onion": "green onions",
    "carrot": "carrots",
    "potato": "potatoes",
    "sweet potato": "sweet potatoes",
    "tomato": "tomatoes",
    "cucumber": "cucumbers",
    "bell pepper": "bell peppers",
    "jalapeno": "jalapenos",
    "mushroom": "mushrooms",
    "shiitake": "shiitakes",
    "chicken wing": "chicken wings",
    "chicken thigh": "chicken thighs",
}

def _is_valid_query(q: str) -> bool:
    banned = ["新鲜", "切块"]
    return not any(word in q for word in banned)


def expand_query(q: str) -> list[str]:
    query = q.strip()
    if not query:
        return []
    variations = {query}
    plural = _PLURAL_VARIATIONS.get(query.lower())
    if plural:
        variations.add(plural)
    return sorted(variations)

ALL_QUERIES = sorted(
    {
        variation.strip().lower()
        for query in COMMON_INGREDIENTS
        for variation in expand_query(query)
        if variation.strip() and _is_valid_query(variation)
    }
)
