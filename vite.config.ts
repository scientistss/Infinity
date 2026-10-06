import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub project Pages: https://scientistss.github.io/Infinity/
  base: "/Infinity/",
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
