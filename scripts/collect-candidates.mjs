/**
 * Collects the candidate artifacts of a run (one directory per slot, each with problems/<id>.json and an
 * optional report.md), keeps the distinct ones, copies them into problems/ and writes the pull request
 * body. Exit 1 when nothing was accepted.
 *
 * Usage: node scripts/collect-candidates.mjs <candidates dir>    (PR_BODY_OUT=path, RUN_URL=url)
 */
import { mkdir, readdir, readFile, writeFile, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { renderPrBody, selectCandidates } from "./lib/collect.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/collect-candidates.mjs <candidates dir>");
  process.exit(1);
}
const problemsDir = path.resolve(import.meta.dirname, "../problems");
const existingFiles = (await readdir(problemsDir)).filter((f) => f.endsWith(".json"));
const existing = [];
for (const f of existingFiles) existing.push(JSON.parse(await readFile(path.join(problemsDir, f), "utf-8")));
const existingIds = new Set(existing.map((p) => p.id));

const candidates = [];
let slotDirs = [];
try {
  slotDirs = (await readdir(dir)).filter((d) => d.startsWith("candidate-")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
} catch {
  slotDirs = [];
}
for (const d of slotDirs) {
  const slot = d.replace(/^candidate-/, "");
  const base = path.join(dir, d);
  let report = "";
  try {
    report = (await readFile(path.join(base, "report.md"), "utf-8")).trim();
  } catch {}
  let files = [];
  try {
    files = (await readdir(path.join(base, "problems"))).filter((f) => f.endsWith(".json")).sort();
  } catch {}
  for (const f of files) {
    const src = path.join(base, "problems", f);
    const problem = JSON.parse(await readFile(src, "utf-8"));
    candidates.push({ slot, problem, report, src, modified: existingIds.has(problem.id) });
  }
}

const { accepted, dropped } = selectCandidates(candidates, existing);
for (const c of accepted) {
  await mkdir(problemsDir, { recursive: true });
  await copyFile(c.src, path.join(problemsDir, `${c.problem.id}.json`));
  console.log(`accepted slot ${c.slot}: ${c.problem.id}${c.modified ? " (modified)" : ""}`);
}
for (const d of dropped) console.log(`dropped  slot ${d.slot}: ${d.id} — ${d.reason}`);
if (process.env.PR_BODY_OUT) await writeFile(process.env.PR_BODY_OUT, renderPrBody({ accepted, dropped, runUrl: process.env.RUN_URL }) + "\n");
console.log(`\n${accepted.length} accepted, ${dropped.length} dropped, ${slotDirs.length} slot artifact(s)`);
if (accepted.length === 0) process.exit(1);
await stat(problemsDir);
