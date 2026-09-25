"""Imported timers are useful estimates, independent of instruction evidence."""
from __future__ import annotations

import json
import math

import pytest

from app.extract import _extract_with_audit
from app.services.tutorial_timing import estimate_import_step_durations


async def imported_steps(texts, *, metadata=None, audit_failure=False, warnings=None):
    actions = [
        {"id": f"a{index}", "text": text, "source_excerpt": text,
         "source_start_seconds": index * 10, "source_end_seconds": index * 10 + 2}
        for index, text in enumerate(texts, start=1)
    ]
    steps = [
        {"id": f"step{index}", "text": text, "source_action_ids": [f"a{index}"],
         "duration_seconds": None, "duration_source": "unknown", **(metadata or {})}
        for index, text in enumerate(texts, start=1)
    ]
    replies = [
        {"title": "Tofu", "ingredients": [{"name": "tofu", "quantity": "400 g"}],
         "actions": actions, "steps": steps},
        {"actions": actions, "steps": steps, "audit": {
            "complete": True, "order_valid": True, "method_available": bool(steps),
            "missing_action_ids": [], "unsupported_step_ids": [], "warnings": warnings or [],
        }},
    ]
    calls = []

    async def request(prompt):
        calls.append(prompt)
        if audit_failure and len(calls) == 2:
            raise TimeoutError("Audit unavailable")
        return json.dumps(replies[len(calls) - 1], ensure_ascii=False)

    source = "\n".join(f"[s{index} {index * 10}-{index * 10 + 2}s] {text}"
                       for index, text in enumerate(texts, start=1))
    recipe = await _extract_with_audit(source, kind="captions", request=request, audiovisual=False)
    return recipe, calls


@pytest.mark.asyncio
@pytest.mark.parametrize("text, maximum", [
    ("Transfer the fried tofu to a claypot.", 60),
    ("将煎好的豆腐移入砂锅。", 60),
    ("将煎至金黄的豆腐盛入砂锅。", 60),
    ("将焖好的豆腐盛出。", 60),
    ("Garnish with scallions.", 60),
    ("撒上葱花。", 60),
    ("Turn off the heat.", 30),
    ("Add soy sauce.", 60),
    ("Add brown rice.", 60),
    ("倒入调好的酱汁。", 60),
    ("Mix the sauce ingredients.", 120),
    ("搅拌酱汁。", 120),
    ("Drain the tofu.", 120),
    ("沥干豆腐。", 120),
    ("Slice the tofu.", 180),
    ("将豆腐切片。", 180),
    ("Wash the eggplant.", 180),
    ("清洗茄子。", 180),
])
async def test_brief_imported_actions_get_short_estimates_and_keep_source_moments(text, maximum):
    recipe, calls = await imported_steps([text])

    step = recipe.steps[0]
    assert isinstance(step.duration_seconds, int)
    assert 15 <= step.duration_seconds <= maximum
    assert step.duration_source == "estimated"
    assert step.text == text
    assert step.instruction_source == "source"
    assert step.source_excerpt == text
    assert (step.source_start_seconds, step.source_end_seconds) == (10, 12)
    assert recipe.import_review.status == "ready"
    assert len(calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["Transfer the fried tofu to a claypot.", "撒上葱花。"])
async def test_model_cannot_give_a_simple_transfer_or_garnish_a_five_minute_estimate(text):
    recipe, _ = await imported_steps([text], metadata={"duration_seconds": 300, "duration_source": "estimated"})
    assert 15 <= recipe.steps[0].duration_seconds <= 60
    assert recipe.steps[0].duration_source == "estimated"


@pytest.mark.asyncio
async def test_cooking_estimates_are_not_shortened_by_transfer_or_mixing_words():
    recipe, _ = await imported_steps([
        "Stir-fry the tofu until golden.", "翻炒豆腐至金黄。",
        "Transfer tofu to the pot and simmer until tender.", "将豆腐移入锅中炖至入味。",
    ])
    assert all(step.duration_seconds is not None and step.duration_seconds >= 180 for step in recipe.steps)


@pytest.mark.asyncio
async def test_timed_import_keeps_order_and_derives_total_without_changing_audit_warnings():
    texts = ["Slice the tofu.", "Fry the tofu.", "Transfer the tofu to a claypot."]
    recipe, calls = await imported_steps(texts, warnings=["Check the source for the garlic addition."])
    assert [step.text for step in recipe.steps] == texts
    assert all(step.duration_seconds is not None for step in recipe.steps)
    assert recipe.total_time_minutes == math.ceil(sum(step.duration_seconds for step in recipe.steps) / 60)
    assert recipe.import_review.status == "needs_review"
    assert "Check the source for the garlic addition." in recipe.import_review.warnings
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_audit_failure_still_returns_timed_initial_draft_for_review():
    recipe, calls = await imported_steps(["Slice the tofu.", "Fry the tofu."], audit_failure=True)
    assert all(step.duration_seconds is not None and step.duration_source == "estimated" for step in recipe.steps)
    assert recipe.import_review.status == "needs_review"
    assert any("could not finish" in warning for warning in recipe.import_review.warnings)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_timing_an_unverified_step_does_not_claim_source_support():
    # Existing grounding conservatively does not recognize this exact wording.
    recipe, _ = await imported_steps(["关火。"])
    assert 15 <= recipe.steps[0].duration_seconds <= 30
    assert recipe.steps[0].duration_source == "estimated"
    assert recipe.steps[0].instruction_source is None
    assert recipe.import_review.status == "needs_review"


@pytest.mark.parametrize("provenance, duration", [("user", 1), ("stated", 300), ("estimated", 45)])
def test_timing_preserves_existing_valid_values_and_all_non_timing_fields(provenance, duration):
    original = {"id": "stable-id", "text": "Transfer the tofu.", "duration_seconds": duration,
                "duration_source": provenance, "instruction_source": "source", "source_excerpt": "Transfer the tofu.",
                "source_start_seconds": 10, "source_end_seconds": 12, "action_type": "assemble",
                "attention_type": "hands_on", "image_url": "https://images.example/tofu.jpg"}
    result = estimate_import_step_durations([original])
    assert result == [original]
    assert result[0] is not original


@pytest.mark.parametrize("text", ["Turn off the heat under the braising pot.", "Switch off the heat."])
def test_heat_control_does_not_acquire_a_pan_preheating_timer(text):
    step = estimate_import_step_durations([{"text": text, "duration_seconds": None, "duration_source": "unknown"}])[0]
    assert 15 <= step["duration_seconds"] <= 30
    assert step["duration_source"] == "estimated"


@pytest.mark.asyncio
async def test_verified_source_time_is_not_replaced_by_short_action_estimate():
    recipe, _ = await imported_steps(["Drain the tofu for 5 minutes."],
                                     metadata={"duration_seconds": 300, "duration_source": "stated"})
    assert (recipe.steps[0].duration_seconds, recipe.steps[0].duration_source) == (300, "stated")


@pytest.mark.asyncio
async def test_ingredient_only_import_does_not_acquire_steps_or_a_total():
    recipe, _ = await imported_steps([])
    assert recipe.steps == []
    assert recipe.total_time_minutes is None
    assert recipe.import_review.status == "needs_review"
