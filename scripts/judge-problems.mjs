/**
 * Re-judges the difficulty of existing problems with the local Ollama model and
 * rewrites the label with the judged value. A two-level gap (easy<->hard) is also
 * relabeled but printed as FLAG so you can decide whether the problem is worth keeping.
 * Each problem is also cross-checked (independent solution from the statement); a disagreement is
 * printed as FLAG and nothing is deleted.
 *
 * Usage: node scripts/judge-problems.mjs [id ...]   (no ids = every problem with source ollama/*)
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { callOllama, extractJson } from "./lib/ollama.mjs";
import { applyJudgement, buildJudgePrompt, parseJudgement, reconcileDifficulty } from "./lib/judge.mjs";
import { crossVerify } from "./generate-problem.mjs";

const problemsDir = path.resolve(import.meta.dirname, "../problems");
const wanted = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);

const files = (await readdir(problemsDir)).filter((f) => f.endsWith(".json")).sort();
let changed = 0;
let flagged = 0;
for (const f of files) {
  const file = path.join(problemsDir, f);
  const problem = JSON.parse(await readFile(file, "utf-8"));
  const generated = typeof problem.source === "string" && problem.source.startsWith("ollama/");
  if (wanted.length ? !wanted.includes(problem.id) : !generated) continue;

  let crossChecked = true;
  try {
    await crossVerify(problem);
  } catch (e) {
    crossChecked = false;
    flagged++;
    console.log(`FLAG    ${problem.id}: ${e.message}`);
  }

  const judgement = parseJudgement(extractJson(await callOllama(buildJudgePrompt(problem), { temperature: 0, num_predict: 512 })));
  const outcome = reconcileDifficulty(problem, judgement);
  const next = outcome.problem ?? applyJudgement(problem, judgement);
  next.judge.crossChecked = crossChecked;
  const mark = outcome.action === "reject" ? "FLAG   " : outcome.action === "relabel" ? "RELABEL" : "keep   ";
  if (outcome.action === "reject") flagged++;
  console.log(`${mark} ${problem.id}: ${problem.difficulty} -> ${next.difficulty} (${judgement.algorithm}) ${judgement.reason}`);
  if (next.difficulty !== problem.difficulty || !problem.judge || problem.judge.crossChecked !== crossChecked) {
    await writeFile(file, JSON.stringify(next, null, 2) + "\n");
    changed++;
  }
}
console.log(`\n${changed} file(s) updated, ${flagged} flagged`);
