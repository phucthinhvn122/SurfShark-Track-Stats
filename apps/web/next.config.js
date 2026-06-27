/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: require('path').join(__dirname, '../..'),
  transpilePackages: ['@surfshark/shared'],
};
module.exports = nextConfig;
