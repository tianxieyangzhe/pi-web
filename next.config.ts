import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  // Pi loads project-local extensions, credentials and provider modules with
  // Node APIs at runtime. It must remain external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "@earendil-works/pi-coding-agent"],
};

export default nextConfig;
