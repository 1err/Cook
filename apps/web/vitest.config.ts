import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: true,
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
