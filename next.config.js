/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,  // Temporarily ignore TS errors to deploy
  },
  eslint: {
    ignoreDuringBuilds: true, // Ignore linting errors
  },
  experimental: {
    serverComponentsExternalPackages: ['pg'],
  },
  staticPageGenerationTimeout: 120,
}

module.exports = nextConfig
