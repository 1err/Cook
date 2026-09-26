import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputFileTracingIncludes: { "/menu-fonts/*": ["../../packages/shared/assets/menu-fonts/*"] },
  devIndicators: false,
  transpilePackages: ["@cooking/shared", "@cooking/api-client"],
  async headers() {
    const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000").origin;
    const development = process.env.NODE_ENV !== "production";
    const headers = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Cache-Control", value: "no-store" },
      { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' ${apiOrigin}${development ? " ws: wss:" : ""}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` },
    ];
    return [
      ...["/forgot-password", "/reset-password", "/verify-email", "/check-email"].map((source) => ({ source, headers })),
      { source: "/chefworld-share-sw.js", headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ] },
    ];
  },
};

export default nextConfig;
