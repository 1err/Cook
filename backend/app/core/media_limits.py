"""One bounded media size contract for API ingestion and provider input."""

# Gemini supports inline inputs below 100 MB. A 30 MiB file encodes to 40 MiB,
# leaving substantial room for the separately bounded prompt and response schema.
# https://ai.google.dev/gemini-api/docs/video-understanding
# https://ai.google.dev/gemini-api/docs/changelog#january-8-2026
MAX_MEDIA_BYTES = 30 * 1024 * 1024
# Multipart boundaries and bounded form fields share an additional 1 MiB.
MAX_MEDIA_REQUEST_BYTES = MAX_MEDIA_BYTES + 1024 * 1024
