/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disables Turbopack → uses classic Webpack (recommended until Turbopack is more stable)
  turbopack: false,

  // Optional: other common settings you might want
  // reactStrictMode: true,
  // swcMinify: true,
  // images: { ... },
};

export default nextConfig;