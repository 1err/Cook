export const ADMIN_EMAIL = "jerryxiang24@gmail.com";

export function isAdminEmail(email?: string | null): boolean {
  return (email ?? "").trim().toLowerCase() === ADMIN_EMAIL;
}

export function isAdminUser(user?: { email?: string | null } | null): boolean {
  return isAdminEmail(user?.email);
}
