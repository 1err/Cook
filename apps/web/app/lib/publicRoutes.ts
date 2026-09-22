export const PUBLIC_PAGE_PATHS = ["/", "/about", "/privacy", "/terms", "/contact"] as const;

export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGE_PATHS.some((path) => path === pathname);
}
