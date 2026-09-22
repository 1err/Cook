export const isPublicAuthPath = (pathname: string) =>
  ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"].includes(pathname.replace(/\/$/, ""));
