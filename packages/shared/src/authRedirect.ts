/** Keep post-auth navigation on an application path, including after URL normalization. */
export function safeAuthRedirect(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) {
    return "/library";
  }
  return value;
}
