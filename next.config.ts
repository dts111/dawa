import type { NextConfig } from "next";

// Who may embed the app in an iframe: itself, localhost for development, and
// the public address in APP_URL (whichever host it is deployed to).
const frameAncestors = ["'self'", "http://localhost:*", "http://127.0.0.1:*"];
try {
  if (process.env.APP_URL) frameAncestors.push(new URL(process.env.APP_URL).origin);
} catch {
  // Ignore a malformed APP_URL rather than failing the build.
}

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (Fly.io). Render runs
  // `next start` and Netlify uses its own Next.js adapter, so neither needs it.
  ...(process.env.STANDALONE === "1" ? { output: "standalone" as const } : {}),
  experimental: {
    // Turbopack's on-disk build cache snapshots env values, which Netlify's
    // secret scanner (rightly) rejects. Builds are small; skip the cache.
    turbopackFileSystemCacheForBuild: false,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors.join(" ")}` }],
      },
    ];
  },
};

export default nextConfig;
