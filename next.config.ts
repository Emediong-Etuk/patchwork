import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The orchestrator, Switch client and repository executor run in the Node
  // runtime only; keep Prisma out of the bundle.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  poweredByHeader: false,
  eslint: { dirs: ["app", "components", "src", "tests"] },
};

export default nextConfig;
