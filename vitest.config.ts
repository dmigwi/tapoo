import { defineConfig } from "vitest/config"

const frontendCoverageDirectory =
  process.env.VITEST_COVERAGE_DIR ?? ".tmp/frontend-coverage"
const tapooBuildYear = new Date().getFullYear()

export default defineConfig({
  define: {
    __TAPOO_BUILD_YEAR__: String(tapooBuildYear),
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    include: ["frontend/**/*.test.ts"],
    coverage: {
      include: ["frontend/app/**/*.ts", "frontend/tapoo.ts"],
      provider: "v8",
      reporter: ["text", "cobertura"],
      reportsDirectory: frontendCoverageDirectory,
    },
  },
})
