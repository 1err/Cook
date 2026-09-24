"""Quantity regressions from real recipe imports, without provider or DB access."""
import unittest
from fractions import Fraction

from app.services.shopping_service import aggregate_ingredients, aggregate_quantities, parse_quantity


class ShoppingQuantityTests(unittest.TestCase):
    def test_recipe_fraction_numerators_are_not_treated_as_whole_amounts(self):
        self.assertEqual(aggregate_quantities(["1/8茶匙"] * 4), "0.5 茶匙")
        self.assertEqual(aggregate_quantities(["1/4袋"] * 4), "1 袋")
        self.assertEqual(aggregate_quantities(["1/4 小勺"] * 2), "0.5 小勺")

    def test_exact_decimal_arithmetic(self):
        self.assertEqual(aggregate_quantities(["1.4 公斤"] * 3), "4.2 公斤")
        self.assertEqual(aggregate_quantities(["0.1 g", "0.2g"]), "0.3 g")
        self.assertEqual(aggregate_quantities(["12g", "3 grams"]), "15 g")

    def test_mixed_unicode_and_ascii_fractions(self):
        self.assertEqual(aggregate_quantities(["½ cup", "1 1/2 cups", "¼cup"]), "2.25 cup")
        self.assertEqual(aggregate_quantities(["1½ cups", "1⁄2 cup"]), "2 cup")
        self.assertEqual(aggregate_quantities(["1/3 cup"] * 2), "2/3 cup")
        self.assertEqual(parse_quantity("1 1/2 cups"), (Fraction(3, 2), "cups"))

    def test_chinese_counts_and_half_units(self):
        self.assertEqual(aggregate_quantities(["半个", "1/4个"]), "0.75 个")
        self.assertEqual(aggregate_quantities(["两根", "一根"]), "3 根")
        self.assertEqual(aggregate_quantities(["一个半", "半个"]), "2 个")
        self.assertEqual(parse_quantity("一半"), (Fraction(1, 2), ""))

    def test_chinese_imprecise_numbers_do_not_become_exact_amounts(self):
        for value in ["十几克", "十多克", "一百多克", "一百来克", "10余克"]:
            with self.subTest(value=value):
                self.assertIsNone(parse_quantity(value))
                self.assertEqual(aggregate_quantities([value] * 2), f"2 × ({value})")
        self.assertEqual(aggregate_quantities(["一半"] * 2), "1")

    def test_compatible_mass_unit_conversion(self):
        self.assertEqual(aggregate_quantities(["0.5 kg", "500克"]), "1000 g")
        self.assertEqual(aggregate_quantities(["100 毫克", "0.9g"]), "1 g")
        self.assertEqual(aggregate_quantities(["12克", "3 grams"]), "15 克")
        self.assertEqual(aggregate_quantities(["1 千克", "500 g"]), "1500 g")
        self.assertEqual(aggregate_quantities(["半千克", "500 g"]), "1000 g")

    def test_compatible_volume_units(self):
        self.assertEqual(aggregate_quantities(["0.5 l", "500毫升"]), "1000 ml")
        self.assertEqual(aggregate_quantities(["1 tbsp", "2 茶匙"]), "25 ml")
        self.assertEqual(aggregate_quantities(["1 teaspoon", "2小勺"]), "3 tsp")

    def test_never_converts_volume_to_weight_or_ambiguous_cups(self):
        self.assertEqual(aggregate_quantities(["100g", "2 tsp"]), "100 g; 2 tsp")
        self.assertEqual(aggregate_quantities(["1 cup", "100 ml"]), "1 cup; 100 ml")

    def test_deduplicates_vague_quantities_without_inventing_amounts(self):
        self.assertEqual(aggregate_quantities(["适量", "适量", "几颗", "适量"]), "适量; 几颗")
        self.assertEqual(aggregate_quantities(["to taste", " To Taste "]), "to taste")
        self.assertEqual(aggregate_quantities(["12g", "适量", "3g", "适量"]), "15 g; 适量")

    def test_preserves_bounds_and_alternate_measurements(self):
        value = "少于1克（1/8小勺）"
        self.assertEqual(aggregate_quantities([value] * 4), "少于4 克 (0.5 小勺)")
        self.assertEqual(aggregate_quantities(["2只（约360克）"] * 2), "4 只 (约720 克)")
        self.assertEqual(aggregate_quantities(["约100g", "约50克"]), "约150 g")

    def test_parenthetical_alternates_are_not_added_to_primary_measure(self):
        self.assertEqual(aggregate_quantities(["1kg (1000g)"] * 2), "2 kg (2000 g)")
        self.assertEqual(aggregate_quantities(["100g (1 cup)"] * 2), "200 g (2 cup)")

    def test_annotations_keep_their_meaning(self):
        self.assertEqual(aggregate_quantities(["1包（100克/包）"] * 2), "2 包 (100克/包)")
        self.assertEqual(aggregate_quantities(["100g (finely chopped)", "200g (finely chopped)"]), "300 g (finely chopped)")

    def test_ambiguous_compound_amounts_keep_multiplicity(self):
        self.assertEqual(aggregate_quantities(["2-3 cloves"] * 2), "2 × (2-3 cloves)")
        self.assertEqual(aggregate_quantities(["4个 每个3克"] * 3), "3 × (4个 每个3克)")
        self.assertEqual(aggregate_quantities(["4 pieces each 3g"] * 3), "3 × (4 pieces each 3g)")
        self.assertEqual(aggregate_quantities(["4 pieces 3-5g"] * 3), "3 × (4 pieces 3-5g)")

    def test_adjacent_imported_alternate_measurements_sum_in_parallel(self):
        self.assertEqual(aggregate_quantities(["4个 3克"] * 3), "12 个 (9 克)")
        self.assertEqual(aggregate_quantities(["4个3克"] * 3), "12 个 (9 克)")
        self.assertEqual(aggregate_quantities(["一根 3克"] * 3), "3 根 (9 克)")
        self.assertEqual(aggregate_quantities(["半杯160克"] * 3), "1.5 杯 (480 克)")
        self.assertEqual(aggregate_quantities(["1/4个 60克"] * 3), "0.75 个 (180 克)")
        self.assertEqual(aggregate_quantities(["一汤勺 5克"] * 3), "3 汤勺 (15 克)")

    def test_shared_explicit_measurement_combines_without_density_guess(self):
        self.assertEqual(aggregate_quantities(["1克（1/8小勺）"] * 4 + ["1/2 茶匙"] * 4), "2.5 小勺")
        self.assertEqual(aggregate_quantities(["4克 (0.5小勺)", "2茶匙"]), "2.5 小勺")
        self.assertEqual(aggregate_quantities(["1/4个 60克"] * 3 + ["半个"] * 2), "1.75 个")

    def test_shared_measurement_does_not_discard_a_bound(self):
        self.assertEqual(aggregate_quantities(["少于1克（1/8小勺）"] * 4 + ["1/8 茶匙"] * 4), "少于4 克 (0.5 小勺); 0.5 茶匙")

    def test_numeric_annotations_and_commas_do_not_create_false_totals(self):
        self.assertEqual(aggregate_quantities(["100g (1 cup, chopped)"] * 2), "2 × (100g (1 cup, chopped))")
        self.assertEqual(aggregate_quantities(["1,5kg"] * 2), "2 × (1,5kg)")
        self.assertEqual(aggregate_quantities(["1包（100克/包）"] * 2), "2 包 (100克/包)")

    def test_invalid_or_compound_amounts_are_not_partially_parsed(self):
        for value in ["1/0 cup", "4个3克", "一根三克", "两三根", "零点五克", "2-3 cloves", "100g or 1 cup", "-2g"]:
            with self.subTest(value=value):
                self.assertIsNone(parse_quantity(value))

    def test_comparison_operators_retain_inclusive_bounds(self):
        self.assertEqual(aggregate_quantities(["<=1g"] * 2), "至多2 g")
        self.assertEqual(aggregate_quantities([">=1g"] * 2), "至少2 g")

    def test_combines_explicit_additions_and_already_aggregated_text(self):
        self.assertEqual(aggregate_quantities(["12g + 3g"]), "15 g")
        self.assertEqual(aggregate_quantities(["适量, 适量, 几颗"]), "适量; 几颗")
        self.assertEqual(aggregate_quantities(["1,000g", "500g"]), "1500 g")

    def test_normalized_results_are_idempotent_for_refine(self):
        inputs = [
            ["1/8茶匙"] * 4,
            ["少于1克（1/8小勺）"] * 4,
            ["2只（约360克）"] * 2,
            ["4个3克"] * 3,
            ["半杯160克"] * 3,
            ["1/4个 60克"] * 3 + ["半个"] * 2,
            ["100g (1 cup, chopped)"] * 2,
            ["1,5kg"] * 2,
            ["1克（1/8小勺）"] * 4 + ["1/2 茶匙"] * 4,
            ["1/3 cup"] * 2,
            ["12g", "适量", "3g", "几颗"],
            ["100g", "2 tbsp"],
        ]
        for quantities in inputs:
            with self.subTest(quantities=quantities):
                output = aggregate_quantities(quantities)
                self.assertEqual(aggregate_quantities([output]), output)

    def test_repeated_uncertain_groups_retain_counts_after_refine(self):
        self.assertEqual(aggregate_quantities(["2 × (4个 每个3克)", "4个 每个3克"]), "3 × (4个 每个3克)")

    def test_repeated_recipes_still_count_numeric_amounts(self):
        result = aggregate_ingredients([("Egg", "2"), ("egg", "2"), ("Salt", "适量"), ("Salt", "适量")])
        self.assertEqual([(item.name, item.total_quantity) for item in result], [("Egg", "4"), ("Salt", "适量")])

    def test_ingredient_identity_matches_refine_casefolding_and_trimming(self):
        result = aggregate_ingredients([(" Süßstoff ", "2g"), ("Süssstoff", "3g"), ("", "50g"), ("   ", "50g")])
        self.assertEqual([(item.name, item.total_quantity) for item in result], [("Süßstoff", "5 g")])

    def test_empty_quantities_remain_empty(self):
        self.assertEqual(aggregate_quantities(["", "   "]), "")


if __name__ == "__main__":
    unittest.main()
