"""Versioned USD prices and conservative bounds for supported byte-BPE models.

Text chat uses byte-BPE, which cannot produce more content tokens
than UTF-8 bytes; 64 tokens per message plus 1024 per request covers framing. New
model families/modalities require an explicit reviewed bound before enabling.
"""
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING

NANO_USD = 1_000_000_000
APP_AI_HARD_CAP_NANO = 30 * NANO_USD
# Official model pages: https://developers.openai.com/api/docs/models/gpt-6-luna
# (2026-09-29) and /gpt-4o-mini (2026-09-22). Luna uses Standard processing,
# no tools, and at most 272K input tokens. Reserve/reconcile all input at the
# $0.125/M cache-write rate rather than assuming $0.10/M uncached input or a
# cache-hit discount. This ledger is a conservative estimate, not an invoice.
# Output usage includes any reasoning tokens. Higher configured rates are safe;
# lower/unreviewed rates could silently defeat the cap.
MIN_TEXT_RATES = {
    'gpt-6-luna': (Decimal('0.125'), Decimal('0.50')),
    'gpt-4o-mini': (Decimal('0.15'), Decimal('0.60')),
    'gpt-4o-mini-2024-07-18': (Decimal('0.15'), Decimal('0.60')),
}
LUNA_STANDARD_INPUT_TOKEN_BOUND = 272_000

# Reviewed 2026-09-24: https://ai.google.dev/gemini-api/docs/pricing and
# https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
# Standard tier: all input modalities $0.30/M; output INCLUDING thinking $2.50/M.
# Reserve full model limits: countTokens is an estimate and a YouTube source may
# change between token counting and generation. No tools/agentic video are used.
GEMINI_REVIEWED_MODEL = 'gemini-3.5-flash-lite'
GEMINI_INPUT_TOKEN_BOUND = 1_048_576
GEMINI_OUTPUT_TOKEN_BOUND = 65_536

# Reviewed 2026-09-25 against the standard (not Batch) Image API prices:
# https://developers.openai.com/api/docs/guides/image-generation
# Text-only prompt: $5/M input; $30/M image output. Low 1024 square estimates
# 196 output tokens; reserve 512 to leave conservative format/framing margin.
# No image inputs, automatic quality/size, partial images, or other models.
IMAGE_SUPPORTED_MODELS = {'gpt-image-2', 'gpt-image-2-2026-04-21'}
IMAGE_OUTPUT_TOKEN_BOUND = 512
# Reviewed 2026-09-26 at the same official URL: low 1024x1536 is $0.005
# output at $30/M (about 167 tokens). Reserve 1024 as a conservative bound;
# menu generation fixes this size/quality, with no image inputs or partials.
MENU_ARTWORK_OUTPUT_TOKEN_BOUND = 1024


def configured_image_price(settings) -> 'Price':
    if settings.OPENAI_IMAGE_MODEL not in IMAGE_SUPPORTED_MODELS:
        raise ValueError('Image AI pricing is not reviewed for this model')
    return Price(settings.OPENAI_IMAGE_MODEL, 'openai-images-standard-2026-09-25',
                 Decimal('5'), Decimal('30'))


@dataclass(frozen=True)
class Price:
    model: str
    version: str
    input_usd_per_million: Decimal
    output_usd_per_million: Decimal


def text_output_token_limit(settings, operation: str) -> int:
    """Use the same bounded completion allowance for requests and reservations."""
    limit = (settings.OPENAI_SHOPPING_MAX_OUTPUT_TOKENS if operation == "shopping_refine"
             else settings.OPENAI_MAX_OUTPUT_TOKENS)
    # Reviewed model limit: https://developers.openai.com/api/docs/models/gpt-4o-mini
    if settings.OPENAI_MODEL in {"gpt-4o-mini", "gpt-4o-mini-2024-07-18"}:
        return min(limit, 16384)
    return limit


def configured_price(settings) -> Price:
    model = settings.OPENAI_MODEL
    if (model not in MIN_TEXT_RATES or settings.AI_PRICE_MODEL != model
            or not settings.AI_PRICE_VERSION.strip()
            or settings.AI_INPUT_USD_PER_MILLION_TOKENS is None
            or settings.AI_OUTPUT_USD_PER_MILLION_TOKENS is None):
        raise ValueError('AI pricing is not configured for this model')
    rates = [Decimal(str(settings.AI_INPUT_USD_PER_MILLION_TOKENS)),
             Decimal(str(settings.AI_OUTPUT_USD_PER_MILLION_TOKENS))]
    if any(not rate.is_finite() or rate <= 0 for rate in rates):
        raise ValueError('AI prices must be positive finite USD amounts')
    minimum_input, minimum_output = MIN_TEXT_RATES[model]
    if rates[0] < minimum_input or rates[1] < minimum_output:
        raise ValueError('AI rates are below the verified model price')
    return Price(model, settings.AI_PRICE_VERSION, *rates)


def configured_video_price(settings) -> Price:
    if (settings.GEMINI_MODEL != GEMINI_REVIEWED_MODEL
            or settings.GEMINI_PRICE_MODEL != settings.GEMINI_MODEL
            or not settings.GEMINI_PRICE_VERSION.strip()
            or settings.GEMINI_INPUT_USD_PER_MILLION_TOKENS is None
            or settings.GEMINI_OUTPUT_USD_PER_MILLION_TOKENS is None):
        raise ValueError('Video AI pricing is not configured for this model')
    rates = [Decimal(str(settings.GEMINI_INPUT_USD_PER_MILLION_TOKENS)),
             Decimal(str(settings.GEMINI_OUTPUT_USD_PER_MILLION_TOKENS))]
    if any(not rate.is_finite() for rate in rates) or rates[0] < Decimal('.30') or rates[1] < Decimal('2.50'):
        raise ValueError('Video AI rates are below the verified model price')
    return Price(settings.GEMINI_MODEL, settings.GEMINI_PRICE_VERSION, *rates)


def usd_to_nano(amount) -> int:
    value = Decimal(str(amount))
    if not value.is_finite() or value < 0:
        raise ValueError('Invalid USD budget')
    # Budget ceilings round down; costs round up.
    return int(value * NANO_USD)


def estimate_cost_nano(price: Price, input_tokens: int, output_tokens: int) -> int:
    if input_tokens < 0 or output_tokens < 0:
        raise ValueError('Invalid token usage')
    amount = (price.input_usd_per_million * input_tokens
              + price.output_usd_per_million * output_tokens) * 1000
    return int(amount.to_integral_value(rounding=ROUND_CEILING))


def prompt_token_ceiling(messages: list[dict[str, str]], *, model: str | None = None) -> int:
    if not messages or any(set(message) != {'role', 'content'}
                           or message['role'] not in {'system', 'user', 'assistant'}
                           or not isinstance(message['content'], str) for message in messages):
        raise ValueError('Only bounded text messages are supported')
    bound = 1024 + sum(len(message['content'].encode('utf-8')) + 64 for message in messages)
    if model == 'gpt-6-luna' and bound > LUNA_STANDARD_INPUT_TOKEN_BOUND:
        raise ValueError('Prompt exceeds the reviewed Luna input price tier')
    return bound
