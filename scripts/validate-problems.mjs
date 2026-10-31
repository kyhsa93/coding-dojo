import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { validateShape, verifySolution } from "./lib/problem-utils.mjs";

const dir = path.resolve(import.meta.dirname, "../problems");
const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
let failed = 0;
const ids = new Set();

for (const file of files) {
  const p = JSON.parse(await readFile(path.join(dir, file), "utf-8"));
  const problems = [];
  if (path.basename(file, ".json") !== p.id) problems.push(`file name must equal id (${p.id})`);
  if (ids.has(p.id)) problems.push("duplicate id");
  ids.add(p.id);
  problems.push(...validateShape(p));
  if (problems.length === 0) {
    const { failures } = verifySolution(p);
    problems.push(...failures);
  }
  if (problems.length) {
    failed++;
    console.log(`✗ ${file}`);
    for (const m of problems) console.log(`    ${m}`);
  } else {
    console.log(`✓ ${file} (${p.tests.length} tests)`);
  }
}

console.log(`\n${files.length - failed}/${files.length} problems valid`);
if (failed) process.exit(1);
