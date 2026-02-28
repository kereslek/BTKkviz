/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.police.hu',
        port: '',
        pathname: '/**',
      },
      // Add if you have subdomains or variants
      {
        protocol: 'https',
        hostname: '*.police.hu',
      },
    ],
  },
  // Optional: force webpack if Turbopack keeps breaking (remove later once fixed)
  // experimental: {
  //   turbopack: false,
  // },
  // Do NOT add: turbopack: true/false — that's the invalid boolean!
};

export default nextConfig;