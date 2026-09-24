export const isPublicAuthPath = (pathname: string) =>
  ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/check-email"].includes(pathname.replace(/\/$/, ""));
