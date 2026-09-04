const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['pg-boss'],
    outputFileTracingIncludes: {
      '/author/challenges/[challengeId]/versions/[version]/preview': [
        '../../challenges/**/*',
        '../../templates/**/*',
      ],
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

module.exports = nextConfig;
