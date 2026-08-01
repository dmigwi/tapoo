import { defineConfig } from "vitest/config"

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
    include: ["frontend/bench/maze-test.benchmark.ts"],
  },
})
