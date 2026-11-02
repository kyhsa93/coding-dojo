// npm run e2e: serves the build (`npm run build` first) and runs every browser check against it.
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const here = new URL(".", import.meta.url).pathname;
const checks = readdirSync(here).filter((f) => f.endsWith(".check.mjs")).sort();
let server;
if (!process.env.E2E_BASE) {
  server = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 100; i++) {
    const up = await fetch("http://localhost:4173/coding-dojo/").then((r) => r.ok, () => false);
    if (up) break;
    await sleep(100);
  }
}
let failed = 0;
for (const file of checks) {
  console.log(`\n=== ${file}`);
  const r = spawnSync(process.execPath, [here + file], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
if (server) process.kill(-server.pid);
process.exit(failed ? 1 : 0);
