# Cache-warmer ingredient catalog review

Reviewed: 2026-08-29

## Outcome

The daily Weee source catalog now contains 390 unique grocery-searchable terms: 198 English and 192 Simplified Chinese. Fifteen intentional English plural variants produce 405 exact runtime queries. The previous catalog contained 165 source entries, 164 unique entries, and 177 runtime queries.

The catalog is Asian-first—especially Chinese, Japanese, Korean, Southeast Asian, and South Asian pantry coverage—while retaining common global cooking staples. It is grouped in `backend/app/jobs/cache_warmer_queries.py::CURATED_INGREDIENTS_BY_CATEGORY` so future reviews can reason about coverage instead of editing one undifferentiated list.

| Category | Source terms |
| --- | ---: |
| Meat, poultry, and eggs | 51 |
| Seafood | 35 |
| Tofu and plant proteins | 20 |
| Produce and aromatics | 79 |
| Fruit | 19 |
| Mushrooms and sea vegetables | 18 |
| Grains, noodles, and flours | 34 |
| Beans, nuts, and seeds | 17 |
| Dairy and alternatives | 12 |
| Oils and vinegars | 13 |
| Sauces and ferments | 45 |
| Spices and herbs | 32 |
| Baking and sweeteners | 15 |

## Research inputs

- [Weee grocery categories](https://www.sayweee.com/en/category) and current category/trending pages were used to keep queries aligned with the store the warmer actually searches, including tofu forms, Asian produce, noodles, seafood, sauces, and seasonings.
- [Recipe1M+](https://arxiv.org/abs/1810.06553), a corpus of more than one million recipes, informed broad staple coverage and the decision to prioritize frequent ingredient families rather than attempt an unbounded long tail.
- [USDA FoodData Central](https://fdc.nal.usda.gov/data-documentation/) supplied a general food-category and ingredient-name baseline.
- [FoodOn](https://foodon.org/) supplied the category-oriented review model: generic grocery products, separated from brands and recipe preparation text.
- [FAO/INFOODS Asian food-composition resources](https://www.fao.org/infoods/infoods/tables-and-databases/asia/en/) were used as a regional-coverage check across Chinese, Japanese, Korean, Southeast Asian, and South Asian foods.

These sources generated and checked candidates; they were not copied wholesale. A nutrition ontology or recipe corpus contains far more entries than a daily store-search job can safely refresh.

## Selection rules

Include a term when it is a common ingredient or a materially distinct purchasable form, such as `silken tofu`, `tofu skin`, `dark soy sauce`, `rice vermicelli`, `fish balls`, or `绍兴酒`.

Keep high-value English and Chinese aliases as separate queries when the app can emit either spelling. Runtime lookup deliberately performs only whitespace cleanup and case folding; it does not map `姜` to `生姜`, `蒜` to `大蒜`, or `牛腱肉` to `牛腱`.

The final review rebalanced secondary global terms toward representative Asian coverage without increasing the source catalog: `paneer`, `ghee`, `curry leaves`, `gochugaru`, `matcha powder`, `spring roll wrappers`, `galangal`, and both common English names for makrut/kaffir lime leaves were promoted. High-value pre-existing exact terms such as `牛腱子`, `牛肩肉`, `牛里脊肉`, `紫皮茄子`, and `丁香` were retained. Representative singular/plural pairs are warmed in both forms, including `chicken wing(s)`, `fish ball(s)`, `scallop(s)`, `clam(s)`, `oyster(s)`, and `rice cake(s)`.

Exclude brands, quantities, preparation instructions, freshness adjectives, and arbitrary recipe descriptors. The catalog is a reviewed refresh list, not a discovery crawler.

## Operational boundary

The warmer remains serial and background-priority. Its current reviewed ceiling is 405 runtime queries, enforced by `backend/tests/test_cache_warmer_queries.py`; the implemented catalog uses all 405. At the 125-second per-operation ceiling, a pathological all-timeout pass can exceed fourteen hours, while normal successful searches should be far shorter. Do not raise the ceiling until production full-run duration, hit rate, confirmed-empty rate, failure rate, and product-match quality have been measured.

Tests do not scrape Weee. They validate exact reviewed counts, category coverage, representative high-value and retained legacy terms, intentional demotions, duplicate freedom, deterministic output, common plural expansion, and the query ceiling. Negative fixtures also reject quantities, unit-prefixed queries, brands, preparation language, and freshness descriptors. Live catalog validation should be a controlled operational check, not part of CI.

## Next review

Use production cache-request and warmer outcome logs to promote frequently missed terms and demote consistently unused, empty, or noisy terms. Prefer substitutions within the 405-query ceiling over another blanket expansion.
