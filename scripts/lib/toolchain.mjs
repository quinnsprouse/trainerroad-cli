import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export const repoRoot = resolve(import.meta.dirname, "../..")

export function requireToolchain() {
  try {
    readFileSync(resolve(repoRoot, "node_modules/@biomejs/biome/package.json"))
  } catch {
    throw new Error("Install the trial toolchain: npm --prefix trial ci")
  }
}

export function execTool(name, args, options = {}) {
  if (name !== "biome") throw new Error(`Unsupported guide-generation tool: ${name}`)
  return execFileSync(
    process.execPath,
    [resolve(repoRoot, "node_modules/@biomejs/biome/bin/biome"), ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      ...options,
    },
  )
}
