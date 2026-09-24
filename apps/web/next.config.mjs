/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
    return ["/forgot-password", "/reset-password", "/verify-email", "/check-email"].map((source) => ({ source, headers }));
  },
};

export default nextConfig;
