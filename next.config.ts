import type { NextConfig } from "next"

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? ""
const isGitHubActions = process.env.GITHUB_ACTIONS === "true"
const basePath = isGitHubActions && repoName ? `/${repoName}` : ""

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true
  },
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined
}

export default nextConfig
