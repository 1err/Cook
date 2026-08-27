const URL_CANDIDATE = /\bhttps:\/\/[^\s<>"']{1,2048}/gi;
const TRAILING_PROSE_PUNCTUATION = /[\])}>,.!?;:]+$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);
const YOUTUBE_NOCOOKIE_HOSTS = new Set([
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const TIKTOK_CANONICAL_HOSTS = new Set(["www.tiktok.com", "m.tiktok.com"]);
const TIKTOK_SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function isSupportedVideoUrl(parsed: URL): boolean {
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    return false;
  }

  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (YOUTUBE_HOSTS.has(host)) {
    if (parsed.pathname === "/watch") {
      return YOUTUBE_ID.test(parsed.searchParams.get("v") ?? "");
    }
    return /^\/(?:shorts|live|embed)\/[A-Za-z0-9_-]{11}\/?$/.test(parsed.pathname);
  }
  if (host === "youtu.be") {
    return /^\/[A-Za-z0-9_-]{11}\/?$/.test(parsed.pathname);
  }
  if (YOUTUBE_NOCOOKIE_HOSTS.has(host)) {
    return /^\/embed\/[A-Za-z0-9_-]{11}\/?$/.test(parsed.pathname);
  }
  if (
    TIKTOK_CANONICAL_HOSTS.has(host) &&
    /^\/@[^/]+\/video\/\d+\/?$/.test(parsed.pathname)
  ) {
    return true;
  }
  if (TIKTOK_SHORT_HOSTS.has(host)) {
    return /^\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname);
  }
  return host === "www.tiktok.com" && /^\/t\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname);
}

function findSupportedUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  for (const match of value.matchAll(URL_CANDIDATE)) {
    const candidate = match[0].replace(TRAILING_PROSE_PUNCTUATION, "");

    try {
      const parsed = new URL(candidate);
      if (isSupportedVideoUrl(parsed)) return parsed.toString();
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
