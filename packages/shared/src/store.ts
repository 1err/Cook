export const WEEE_STORE = "weee" as const;
export const WEEE_STORE_LABEL = "Weee";

export function isSafeWeeeProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase();
    const isWeeeHost =
      hostname === "sayweee.com" || hostname.endsWith(".sayweee.com");
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
