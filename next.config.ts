/**
 * @fileoverview Next.js build/runtime config: permissive remote image patterns and larger server action bodies.
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

/** Default export consumed by `next build`; relaxes `next/image` HTTPS hosts and raises server action payload cap. */
export default nextConfig;
