import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAuditPrompt, deterministicChecks, parseAudit, renderAuditReport } from "./audit.mjs";

const digitDp = JSON.parse(await readFile(new URL("../../problems/digit-dp-count-without-adjacent-digits.json", import.meta.url), "utf-8"));
const twoSum = JSON.parse(await readFile(new URL("../../problems/two-sum.json", import.meta.url), "utf-8"));

test("audit prompt shows the signature, statement, examples, small tests and the solution", () => {
  const p = buildAuditPrompt(digitDp);
  assert.match(p, /countNumbersWithoutAdjacentDigits\(n: number\): number/);
  assert.match(p, /input \[123\] -> 91/);
  assert.match(p, /input \[0\] -> 1/);
  assert.match(p, /function countNumbersWithoutAdjacentDigits/);
  assert.match(p, /"verdict": "clear\|unclear"/);
  // Examples are not repeated among the further tests, and the huge inputs are left out.
  assert.equal(p.match(/input \[123\]/g).length, 1);
  assert.doesNotMatch(p, /655154048466/);
});

test("parseAudit normalises severities and derives the verdict from high issues", () => {
  const a = parseAudit({ verdict: "clear", issues: [{ severity: "high", rule: "내림차순도 제외", evidence: "[10] -> 10", fix: "양방향 명시" }, { rule: "no severity" }, { severity: "low" }] });
  assert.equal(a.verdict, "unclear");
  assert.equal(a.issues.length, 2);
  assert.equal(a.issues[1].severity, "low");
  assert.deepEqual(parseAudit({ verdict: "clear" }), { verdict: "clear", summary: "", issues: [] });
  assert.throws(() => parseAudit(null), /not an object/);
});

test("deterministic checks flag missing explanations, constraints and edge tests", () => {
  assert.deepEqual(deterministicChecks(digitDp), []);
  const stripped = { ...twoSum, statement: "짧은 지문", examples: twoSum.examples.map((e) => ({ ...e, explanation: "" })), tests: twoSum.tests.filter((t) => t.input[0].length > 0) };
  const warnings = deterministicChecks(stripped);
  assert.ok(warnings.some((w) => /짧다/.test(w)), warnings.join("; "));
  assert.ok(warnings.some((w) => /제약이 없다/.test(w)));
  assert.ok(warnings.some((w) => /설명이 없거나/.test(w)));
  assert.ok(warnings.some((w) => /nums: 빈 배열/.test(w)));
});

test("renderAuditReport produces a markdown table and escapes pipes", () => {
  const md = renderAuditReport(digitDp, { verdict: "unclear", summary: "요약", issues: [{ severity: "high", rule: "a|b", evidence: "e", fix: "f" }] }, ["경고 1"]);
  assert.match(md, /^### digit-dp-count-without-adjacent-digits — 지문 검토 필요/);
  assert.match(md, /\| high \| a\\\|b \| e \| f \|/);
  assert.match(md, /- 경고 1/);
  assert.match(renderAuditReport(digitDp, { verdict: "clear", summary: "", issues: [] }, []), /지적 사항 없음/);
  assert.match(renderAuditReport(digitDp, null, ["모델 검수 실패: x"]), /모델 검수 실패/);
});
