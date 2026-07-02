import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/lib/sow-pricing.test.ts"],
  },
});
