import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/lib/sow-pricing.test.ts",
      "src/lib/kanban-workflow-e2e.test.ts",
      "src/lib/social-media-nodes.test.ts",
      "src/lib/ps-script-gen.test.ts",
      "src/lib/workflow-executor-generate-script.test.ts",
      "src/lib/workflow-executor-core.test.ts",
      "src/lib/workflow-executor-comms.test.ts",
      "src/lib/workflow-executor-content.test.ts",
      "src/lib/workflow-executor-integrations.test.ts",
      "src/lib/tenant-signals.test.ts",
      "src/lib/drift-engine.test.ts",
      "src/lib/priority-engine.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/workflow-executor.ts"],
      thresholds: {
        branches: 90,
      },
    },
  },
});
