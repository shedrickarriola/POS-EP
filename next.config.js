/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true, // This is the crucial line
  },
  // If you are seeing SWC errors in StackBlitz/WebContainers,
  // sometimes disabling the swcMinify helps stability
  swcMinify: true,
};

module.exports = nextConfig;
