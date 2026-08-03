import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devApiOrigin = env.DEV_API_ORIGIN || 'http://127.0.0.1:8787'
  const sentryBuildConfigured = Boolean(
    env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT,
  )

  return {
    plugins: [
      react(),
      ...(sentryBuildConfigured ? [
        sentryVitePlugin({
          authToken: env.SENTRY_AUTH_TOKEN,
          org: env.SENTRY_ORG,
          project: env.SENTRY_PROJECT,
          telemetry: false,
          sourcemaps: {
            filesToDeleteAfterUpload: ['./dist/**/*.map'],
          },
        }),
      ] : []),
    ],
    build: {
      sourcemap: sentryBuildConfigured ? 'hidden' : false,
    },
    server: {
      host: '127.0.0.1',
      port: 4173,
      proxy: {
        '/api': devApiOrigin,
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-server/**', 'coverage/**'],
    },
  }
})
