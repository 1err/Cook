export function isAdminUser(user?: { email?: string | null; is_admin?: boolean } | null): boolean {
  return user?.is_admin === true;
}
