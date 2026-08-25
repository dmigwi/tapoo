import { defineConfig } from "vitest/config"

const frontendCoverageDirectory =
  process.env.VITEST_COVERAGE_DIR ?? ".tmp/frontend-coverage"
const tapooBuildYear = new Date().getFullYear()
const tapooBuildDate = new Date().toISOString()

export default defineConfig({
  define: {
    __TAPOO_BUILD_YEAR__: String(tapooBuildYear),
    __TAPOO_BUILD_DATE__: JSON.stringify(tapooBuildDate),
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    include: ["frontend/**/*.test.ts", "frontend/**/*.test.mjs"],
    coverage: {
      include: ["frontend/app/**/*.ts", "frontend/tapoo.ts"],
      provider: "v8",
      reporter: ["text", "cobertura"],
      reportsDirectory: frontendCoverageDirectory,
    },
  },
})
