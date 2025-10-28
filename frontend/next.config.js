/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Avoid RN-only package in web bundles
    config.resolve.alias['@react-native-async-storage/async-storage'] = false;
    return config;
  },
};
module.exports = nextConfig;
