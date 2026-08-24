import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained server bundle — needed for the Docker deploy on Fly.io.
  output: "standalone",
  // better-sqlite3 is a native addon — it must stay outside the bundler.
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            // Local dev: any port on localhost/127.0.0.1. Replace with the
            // real dafegen.com origin(s) once this is deployed.
            value: "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
