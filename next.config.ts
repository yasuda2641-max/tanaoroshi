import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Firebase SDK はサーバーサイドでは使わないのでクライアントのみ
  experimental: {},
};

export default nextConfig;
