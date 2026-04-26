export function getApiBase(): string {
  const envValue = process.env.EXPO_PUBLIC_API_BASE?.trim();
  if (envValue) return envValue.replace(/\/+$/, "");
  return "http://localhost:8000";
}
