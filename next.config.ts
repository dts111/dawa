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
            // localhost/127.0.0.1 for local dev, eaas-pm.fly.dev for the deployed app.
            value:
              "frame-ancestors 'self' http://localhost:* http://127.0.0.1:* https://eaas-pm.fly.dev",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
