/** Stored recipe metadata must not turn an external link into executable or credential-bearing content. */
export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}
