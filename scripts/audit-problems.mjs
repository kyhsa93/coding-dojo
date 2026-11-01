/**
 * Statement audit of existing problems (scripts/lib/audit.mjs): the model lists rules the solution
 * applies that the statement does not state, plus cheap deterministic checks. Prints a markdown report
 * and writes it to AUDIT_OUT when set. Report only: the exit code is 1 only for an unknown id.
 *
 * Usage: node scripts/audit-problems.mjs <id ...>
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { callOllama, extractJson } from "./lib/ollama.mjs";
import { buildAuditPrompt, deterministicChecks, parseAudit, renderAuditReport } from "./lib/audit.mjs";

const problemsDir = path.resolve(import.meta.dirname, "../problems");
const ids = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
if (!ids.length) {
  console.error("usage: node scripts/audit-problems.mjs <id ...>");
  process.exit(1);
}

const sections = [];
let unclear = 0;
for (const id of ids) {
  const problem = JSON.parse(await readFile(path.join(problemsDir, `${id}.json`), "utf-8"));
  const warnings = deterministicChecks(problem);
  let audit = null;
  try {
    audit = parseAudit(extractJson(await callOllama(buildAuditPrompt(problem), { temperature: 0, num_predict: 1024 })));
  } catch (e) {
    console.log(`  audit of ${id} failed: ${e.message}`);
    warnings.push(`모델 검수 실패: ${e.message.split("\n")[0]}`);
  }
  if (!audit || audit.verdict === "unclear") unclear++;
  console.log(`  ${id}: ${audit ? `${audit.verdict}, ${audit.issues.length} issue(s)` : "audit failed"}, ${warnings.length} warning(s)`);
  sections.push(renderAuditReport(problem, audit, warnings));
}

const report = sections.join("\n\n");
console.log(`\n${report}`);
if (process.env.AUDIT_OUT) await writeFile(process.env.AUDIT_OUT, report + "\n");
console.log(`\n${ids.length - unclear}/${ids.length} clear`);
