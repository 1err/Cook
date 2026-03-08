const envApiBase = process.env.NEXT_PUBLIC_API_BASE ?? "";

export function getApiBase(): string {
  // Browser
  if (typeof window !== "undefined") {
    // In production use env variable
    if (envApiBase) return envApiBase;

    // Local dev fallback
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8000`;
  }

  // Server-side rendering
  return envApiBase;
}