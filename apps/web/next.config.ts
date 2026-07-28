import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@roft/engine"],
  // 本地开两桌人时会同时用 localhost 与 127.0.0.1（两套独立 cookie），
  // dev server 默认拦另一个主机名的资源请求。
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
