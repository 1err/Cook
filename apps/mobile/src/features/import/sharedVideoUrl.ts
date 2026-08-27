const URL_CANDIDATE = /\bhttps:\/\/[^\s<>"']{1,2048}/gi;
const TRAILING_PROSE_PUNCTUATION = /[\])}>,.!?;:]+$/;

const SUPPORTED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
]);

function findSupportedUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  for (const match of value.matchAll(URL_CANDIDATE)) {
    const candidate = match[0].replace(TRAILING_PROSE_PUNCTUATION, "");

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:" && SUPPORTED_HOSTS.has(parsed.hostname)) {
        return parsed.toString();
      }
    } catch {
      // Ignore malformed candidates and continue looking for a supported URL.
    }
  }

  return null;
}

export function extractSharedVideoUrl(
  webUrl: string | null | undefined,
  text: string | null | undefined,
): string | null {
  return findSupportedUrl(webUrl) ?? findSupportedUrl(text);
}
