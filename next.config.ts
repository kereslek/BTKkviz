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
};

module.exports = nextConfig;