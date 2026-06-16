import type { NextConfig } from "next";
import { readFileSync } from "fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

const nextConfig: NextConfig = {
  // Firebase SDK はサーバーサイドでは使わないのでクライアントのみ
  experimental: {},
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
