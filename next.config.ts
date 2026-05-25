import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Required for instrumentation.ts
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
