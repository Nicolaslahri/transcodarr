/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@transcodarr/shared'],
  output: 'export',
  distDir: 'out',
};

module.exports = nextConfig;
