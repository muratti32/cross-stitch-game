import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) so the
  // production Dockerfile can run the console with a minimal node_modules set.
  output: "standalone",
};

export default nextConfig;
