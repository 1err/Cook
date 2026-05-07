/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@cooking/shared", "@cooking/api-client"],
};

export default nextConfig;
