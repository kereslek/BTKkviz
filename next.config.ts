/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.police.hu',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.police.hu',
      },
    ],
  },
  // Remove any experimental.turbopack line — it's no longer needed or valid here
  // If you want to force-disable Turbopack, use NEXT_TURBOPACK=0 env var when running build/dev
};

export default nextConfig;