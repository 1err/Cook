const URL_CANDIDATE = /\bhttps?:\/\/[^\s<>"'，。！？；、）】》]{1,2048}/gi;
const TRAILING_PROSE_PUNCTUATION = /[\])}>,.!?;:，。！？；、）】》]+$/;

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
const REDNOTE_HOSTS = new Set(["xiaohongshu.com", "www.xiaohongshu.com", "m.xiaohongshu.com"]);
const REDNOTE_SHORT_HOSTS = new Set(["xhslink.com", "www.xhslink.com", "xhslink.cn", "www.xhslink.cn"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function isSupportedVideoUrl(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  // RedNote's own share messages commonly include HTTP short links. Upgrade
  // only these exact provider hosts; every outgoing shared URL remains HTTPS.
  if (parsed.protocol === "http:" && (REDNOTE_HOSTS.has(host) || REDNOTE_SHORT_HOSTS.has(host))) {
    parsed.protocol = "https:";
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    return false;
  }

  if (REDNOTE_HOSTS.has(host)) {
    return /^\/(?:explore|discovery\/item)\/[a-f0-9]{24}\/?$/i.test(parsed.pathname);
  }
  if (REDNOTE_SHORT_HOSTS.has(host)) {
    return /^\/(?:[A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+\/?$/.test(parsed.pathname);
  }
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
  return false;
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
