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
  // This forces webpack (fixes Turbopack parser bug + invalid config)
  experimental: {
    turbopack: false,
  },
};

export default nextConfig;