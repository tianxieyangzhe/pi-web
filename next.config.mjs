import path from "node:path";
import manifestPlugin from "./src/infrastructure/build/atomic-manifest-plugin.cjs";
const { AtomicManifestPlugin } = manifestPlugin;

const runtimeRecoveryStub = path.resolve(process.cwd(), "src/infrastructure/bots/runtime-recovery.stub.ts");

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
  allowedDevOrigins: (process.env.AI_WORKSPACE_ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean),
  devIndicators: false,
  reactStrictMode: true,
  // Pi loads project-local extensions, credentials and provider modules with
  // Node APIs at runtime. It must remain external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "@earendil-works/pi-coding-agent"],
  webpack(config, { dev, nextRuntime, webpack }) {
    if (nextRuntime !== "nodejs") {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/runtime-recovery\.server$/, runtimeRecoveryStub));
    }
    if (dev) config.plugins.push(new AtomicManifestPlugin());
    return config;
  },
};

export default nextConfig;
