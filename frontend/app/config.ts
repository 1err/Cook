const envApiBase = (process.env.NEXT_PUBLIC_API_BASE ?? "").trim();

const LOCAL_DEV_API = "http://localhost:8000";

export function getApiBase(): string {
  if (envApiBase) return envApiBase;
  return LOCAL_DEV_API;
}

