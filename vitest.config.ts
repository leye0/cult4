import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["archive/**", "node_modules/**", "dist/**"],
    testTimeout: 10_000,
  },
});
