import type { NextConfig } from "next";

const api = process.env.CROWDFLOW_API ?? "http://127.0.0.1:8099";

const config: NextConfig = {
  agentRules: false,
  env: {
    NEXT_PUBLIC_CROWDFLOW_WS: `${api.replace(/^http/, "ws")}/ws`,
  },
  transpilePackages: ["@crowdflow/api", "@crowdflow/contracts", "@crowdflow/core"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default config;
