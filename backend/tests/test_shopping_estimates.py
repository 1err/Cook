"""Purchase estimates preserve source amounts and the exact parser's uncertainty."""
import pytest

from app.services import shopping_service


@pytest.mark.parametrize(("name", "quantity", "expected"), [
    ("盐", "1 茶勺; 7 g; 少许; 适量", "约 13 g，另按口味添加"),
    ("生抽", "100 g; 3 勺", "约 145 g（按每勺1汤匙估算）"),
    ("白糖", "9 g; 0.5 勺", "约 15.2 g（按每勺1汤匙估算）"),
    ("老抽", "20 g; 0.5 勺; 少许; 适量", "约 27.5 g（按每勺1汤匙估算），另按口味添加"),
    ("蚝油", "60 g; 2 勺; 适量", "约 98 g（按每勺1汤匙估算），另按口味添加"),
    ("八角", "1 个; 6", "7 个"),
    ("MSG", "5 g; to taste; as needed", "5 g, plus more to taste"),
    ("味精", "适量; 少许", "适量"),
    ("Almond flour", "100 g; 1 cup", "100 g + 1 cup"),
    ("Kosher salt", "1 tsp; 7 g", "1 tsp + 7 g"),
    ("Rice", "1,000 g; 0.5 kg", "1500 g"),
    ("Salt", "1-2 tsp; 7 g", "7 g; 1-2 tsp"),
    ("中筋面粉", "2; 0.25 杯", "约 30 g；2（单位待确认）"),
    ("中筋面粉", "2", "2（单位待确认）"),
    ("Salt", "1 tsp; 7 g; to taste", "about 13 g, plus more to taste"),
    ("Milk", "100 ml; 0.5 l", "600 ml"),
    ("Onion", "2 pieces", "2 pieces"),
])
def test_purchase_totals_preserve_every_measured_and_unmeasured_contribution(name, quantity, expected):
    normalize = getattr(shopping_service, "normalize_purchase_quantity", None)
    assert normalize is not None, "Purchase quantity normalization is not implemented"
    assert normalize(name, quantity) == expected


@pytest.mark.parametrize(("name", "quantity", "expected"), [
    ("Salt", "4g (0.5 tsp); 2 tsp", "about 16 g"),
    ("Salt", "1 tsp (4g); 7g", "11 g"),
    ("中筋面粉", "半杯 160克; 40g", "200 g"),
    ("Almond flour", "1 cup (120g); 30g", "150 g"),
    ("盐", "一茶匙; 七克", "约 13 g"),
    ("Salt", "less than 1g (1/8 tsp); 7g", "7 g; less than 1 g (0.125 tsp)"),
    ("Salt", "<=1g; 7g", "7 g; 至多1 g"),
    ("Salt", "2-3 tsp; 2-3 tsp", "2 × (2-3 tsp)"),
    ("Salt", "100g (1 cup, chopped)", "100g (1 cup, chopped)"),
    ("Salt", "1包 (100克/包)", "1 包 (100克/包)"),
    ("Salt", "2; 7g", "7 g; 2 (unit missing)"),
])
def test_estimates_keep_bounds_alternates_ranges_and_missing_units(name, quantity, expected):
    normalize = getattr(shopping_service, "normalize_purchase_quantity", None)
    assert normalize is not None, "Purchase quantity normalization is not implemented"
    assert normalize(name, quantity) == expected


def test_reprocessing_estimates_does_not_apply_density_or_spoon_assumptions_twice():
    normalize = getattr(shopping_service, "normalize_purchase_quantity", None)
    assert normalize is not None, "Purchase quantity normalization is not implemented"
    total = "约 65 g（按每勺1汤匙估算），另按口味添加"
    assert normalize("生抽", total) == total
    assert normalize("生抽", total + "; 10g") == "约 75 g（按每勺1汤匙估算），另按口味添加"
    incomplete = "约 30 g；2（单位待确认）"
    assert normalize("中筋面粉", incomplete) == incomplete


@pytest.mark.parametrize("quantity", ["50 g", "50 ml", "2", "", "to taste", "1 cup plus more as needed", "1-2 cups", "1 cup (plus 2 tbsp)", "less than 1 cup", "0 cups"])
def test_saved_metric_equivalent_does_not_replace_an_edited_or_incomplete_original(quantity):
    preferred = getattr(shopping_service, "preferred_shopping_quantity", None)
    assert preferred is not None, "Metric equivalent selection is not implemented"
    assert preferred(quantity, "125 g") == quantity


@pytest.mark.parametrize(("quantity", "metric", "expected"), [
    ("1 cup", "125 g", "125 g"),
    ("1/2 tsp", "3 g", "3 g"),
    ("2 pieces", "100g", "100g"),
    ("1 cup", "100", "1 cup"),
    ("1 cup", "100g; 2 tsp", "1 cup"),
    ("1 cup", "0g", "1 cup"),
    ("1 unknown", "125g", "1 unknown"),
])
def test_saved_metric_equivalent_replaces_only_complete_known_measurements(quantity, metric, expected):
    preferred = getattr(shopping_service, "preferred_shopping_quantity", None)
    assert preferred is not None, "Metric equivalent selection is not implemented"
    assert preferred(quantity, metric) == expected


@pytest.mark.parametrize(("name", "quantities", "expected"), [
    ("中筋面粉", ["半杯160克", "1杯"], "约 280 g"),
    ("Salt", ["4g (0.5 tsp)", "2 tsp"], "about 16 g"),
])
def test_purchase_aggregation_preserves_recorded_mass_before_combining_recipes(name, quantities, expected):
    items = shopping_service.aggregate_ingredients(
        [(name, quantity) for quantity in quantities], for_purchase=True,
    )
    assert len(items) == 1
    assert shopping_service.normalize_purchase_quantity(items[0].name, items[0].total_quantity) == expected
