import { hostname, networkInterfaces } from "node:os";
import manifestPlugin from "./src/infrastructure/build/atomic-manifest-plugin.cjs";
const { AtomicManifestPlugin } = manifestPlugin;

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": [
      "src/infrastructure/database/*.sql",
      "node_modules/@earendil-works/pi-*/dist/**/*",
      "node_modules/@earendil-works/pi-*/package.json",
      "node_modules/better-sqlite3/build/Release/*.node",
    ],
  },
  ...(process.env.AI_WORKSPACE_BUILD_DIR ? {distDir:process.env.AI_WORKSPACE_BUILD_DIR} : {}),
  allowedDevOrigins: [
    // Next rejects bare wildcards; **.* matches IPv4 addresses and dotted hosts.
    "**.*",
    hostname(),
    ...Object.values(networkInterfaces()).flatMap(addresses =>
      (addresses ?? []).filter(address => address.family === "IPv6")
        .flatMap(address => [address.address, `[${address.address}]`]),
    ),
    ...(process.env.AI_WORKSPACE_ALLOWED_DEV_ORIGINS ?? "")
      .split(",")
      .map(origin => origin.trim())
      .filter(Boolean),
  ],
  devIndicators: false,
  reactStrictMode: true,
  // Pi loads project-local extensions, credentials and provider modules with
  // Node APIs at runtime. It must remain external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "@earendil-works/pi-coding-agent"],
  webpack(config, { dev }) {
    if (dev) config.plugins.push(new AtomicManifestPlugin());
    return config;
  },
};

export default nextConfig;
