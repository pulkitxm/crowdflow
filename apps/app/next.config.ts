import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  transpilePackages: ["@crowdflow/contracts", "@crowdflow/core"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default config;
