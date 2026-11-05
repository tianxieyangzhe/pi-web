import path from "node:path";
import manifestPlugin from "./src/infrastructure/build/atomic-manifest-plugin.cjs";
const { AtomicManifestPlugin } = manifestPlugin;

const runtimeRecoveryStub = path.resolve(process.cwd(), "src/infrastructure/bots/runtime-recovery.stub.ts");

/** @type {import("next").NextConfig} */
const nextConfig = {
  ...(process.env.AI_WORKSPACE_BUILD_DIR ? {distDir:process.env.AI_WORKSPACE_BUILD_DIR} : {}),
  allowedDevOrigins: ["106.12.15.161"],
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
