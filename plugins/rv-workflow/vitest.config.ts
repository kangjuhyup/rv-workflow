import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["mcp/test/**/*.test.ts", "web/test/**/*.test.ts?(x)"],
    setupFiles: ["./web/test/setup.ts"],
  },
});
