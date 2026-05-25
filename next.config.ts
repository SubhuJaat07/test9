import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // instrumentation.ts is supported by default in Next.js 16+, no experimental flag needed
};

export default nextConfig;
