import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { bin: "src/bin.ts" },
  format: "cjs",
  platform: "node",
  target: "node22",
  deps: {
    alwaysBundle: /^(?!node:|@resvg\/)/,
    neverBundle: ["@resvg/resvg-js"],
    onlyBundle: ["effect", "@effect/platform-node", "@effect/platform-node-shared"],
  },
  define: { "import.meta": "{}" },
  dts: false,
  sourcemap: false,
  outDir: "dist",
})
