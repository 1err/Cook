/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@cooking/shared", "@cooking/api-client", "@cooking/ui"],
};

export default nextConfig;
