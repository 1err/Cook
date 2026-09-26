"""Compact provider response shapes; source grounding remains a separate check."""
from app.tutorial import ACTION_TYPES


def _object(properties: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required,
            "additionalProperties": False}


_STRINGS = {"type": "array", "items": {"type": "string"}}
_ACTIONS = {"type": "array", "items": _object({
    "id": {"type": "string"},
    "text": {"type": "string"},
    "source_excerpt": {"type": "string"},
    "source_start_seconds": {"type": ["number", "null"], "minimum": 0},
    "source_end_seconds": {"type": ["number", "null"], "minimum": 0},
    "role": {"type": "string", "enum": ["main", "recap", "alternative"]},
})}
_STEPS = {"type": "array", "items": _object({
    "id": {"type": "string"},
    "text": {"type": "string"},
    "source_action_ids": _STRINGS,
    "instruction_source": {"type": "string", "enum": ["source"]},
    "duration_seconds": {"type": ["integer", "null"], "minimum": 15, "maximum": 86400},
    "duration_source": {"type": "string", "enum": ["stated", "estimated", "unknown"]},
    "attention_type": {"type": "string", "enum": ["hands_on", "passive"]},
    "action_type": {"type": "string", "enum": sorted(ACTION_TYPES)},
})}

VIDEO_EXTRACTION_SCHEMA = _object({
    "title": {"type": "string"},
    "description": {"type": ["string", "null"]},
    "total_time_minutes": {"type": ["integer", "null"]},
    "ingredients": {"type": "array", "items": _object({
        "name": {"type": "string"}, "quantity": {"type": "string"},
        "metric_quantity": {"type": ["string", "null"]},
        "notes": {"type": ["string", "null"]},
    }, ["name", "quantity"])},
    "actions": _ACTIONS,
    "steps": _STEPS,
    "tips": _STRINGS,
}, ["title", "ingredients", "actions", "steps"])

VIDEO_AUDIT_SCHEMA = _object({
    "actions": _ACTIONS,
    "steps": _STEPS,
    "audit": _object({
        "complete": {"type": "boolean"},
        "order_valid": {"type": "boolean"},
        "method_available": {"type": "boolean"},
        "missing_action_ids": _STRINGS,
        "unsupported_step_ids": _STRINGS,
        "warnings": _STRINGS,
    }),
})
