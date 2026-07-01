import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  transpilePackages: ['@yuanai/ui', '@yuanai/core'],
  webpack(config) {
    // packages/core and packages/ui use TS ESM-style `.js` extensions in imports.
    // TypeScript resolves .js → .ts, but webpack does not — teach it the same rule.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    }
    return config
  },
}

export default withNextIntl(nextConfig)
