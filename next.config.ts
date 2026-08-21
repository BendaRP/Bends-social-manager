import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The worker process shares code with the app; keep server externals honest so
  // BullMQ/ioredis are not bundled into serverless traces.
  serverExternalPackages: ["bullmq", "ioredis", "@prisma/client"],
  experimental: {
    // Media uploads are presigned client-side, so request bodies stay small.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
