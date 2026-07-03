import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/lib/sow-pricing.test.ts", "src/lib/kanban-workflow-e2e.test.ts"],
  },
});
