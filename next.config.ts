import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "pg"],
  poweredByHeader: false,
};

export default nextConfig;
