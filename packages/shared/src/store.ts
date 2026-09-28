export const WEEE_STORE = "weee" as const;
export const WEEE_STORE_LABEL = "Weee";

// Presentation only: retain the source name for product identity and pack parsing.
// Unknown Weee prefixes and ordinary brand names are intentionally left intact.
export function getWeeeProductDisplayName(name: string): string {
  const prefix = /^weee_(?:seasoning|dried|meat|health|green|frozen|freshgourmet|snack|instant|canned|care|fruits|tofuplantbased|grocery)_/i;
  if (!prefix.test(name)) return name;
  const displayName = name.replace(prefix, "").replace(/_+/g, " ").trim();
  return displayName || name;
}

export function isSafeWeeeProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase();
    const isWeeeHost = ["sayweee.com", "weee.com"].some(
      (officialHost) => hostname === officialHost || hostname.endsWith(`.${officialHost}`),
    );
    return (
      url.protocol === "https:" &&
      isWeeeHost &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname.toLocaleLowerCase().includes("/product/")
    );
  } catch {
    return false;
  }
}
