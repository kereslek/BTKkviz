/** @type {import('next').NextConfig} */
const nextConfig = {
  // Your existing images config here...
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

  // FORCE webpack (stable parser, no Turbopack bugs)
  experimental: {
    turbopack: false,
  },

  // REMOVE any lines like:
  // turbopack: true,
  // experimental: { turbo: ... } or turbopack: true/false
};

export default nextConfig;