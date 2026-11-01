/**
 * Statement audit: the review step after a problem passed every automatic gate.
 *
 * The gates prove that the solution, the brute force and an independent solution agree on the tests.
 * They do not prove that a READER of the statement would arrive at the same rules: the first hard
 * problem excluded descending adjacent digits (21, 10) while its statement only listed 12, 23, 34.
 * This asks the model to compare the statement against what the solution and the tests actually do
 * and to list every rule a careful reader could not determine from the statement alone. Deterministic
 * checks cover the cheap things (constraints mentioned, explanations present, edge tests present).
 * The result is a report for a human, not a gate: it goes into the pull request the generator opens.
 */

const SEVERITIES = ["high", "low"];
const MAX_TESTS_SHOWN = 12;

const signatureOf = (problem) => `${problem.functionName}(${problem.params.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${problem.returnType}`;

/** Smallest tests first: edge cases are what the audit is about, and the prompt must stay short. */
function sampleTests(problem) {
  const seen = new Set(problem.examples.map((e) => JSON.stringify(e.input)));
  return [...problem.tests]
    .filter((t) => !seen.has(JSON.stringify(t.input)))
    .map((t) => ({ t, size: JSON.stringify(t.input).length }))
    .sort((a, b) => a.size - b.size)
    .slice(0, MAX_TESTS_SHOWN)
    .map(({ t }) => t);
}

export function buildAuditPrompt(problem) {
  const examples = problem.examples.map((e) => `- input ${JSON.stringify(e.input)} -> ${JSON.stringify(e.expected)}${e.explanation ? ` (${e.explanation})` : ""}`).join("\n");
  const tests = sampleTests(problem).map((t) => `- input ${JSON.stringify(t.input).slice(0, 200)} -> ${JSON.stringify(t.expected).slice(0, 120)}`).join("\n");
  return `You review coding problems before publication. The reference solution and the tests are correct by construction; the question is whether the STATEMENT alone lets a careful reader derive the same answers. Output ONLY a JSON object, no prose.

Compare the statement with what the reference solution and the tests actually do. Report every rule that the solution applies but the statement does not state clearly, or states in a way a reader could reasonably interpret differently. Typical gaps:
- direction or order (ascending only vs both directions, left-to-right vs any order)
- boundaries: inclusive/exclusive ranges, empty input, single element, zero, negative numbers, leading zeros
- ties and tie-breaking, duplicates, what to return when no answer exists
- units and formats of the return value (index vs value, 0-based vs 1-based, count vs list)
- constraints missing or inconsistent with the tests
Use the tests as evidence: a test whose expected value follows a rule the statement never mentions is a gap. Do not report style, wording or difficulty. If the statement is complete, return an empty "issues" list.

Signature: ${signatureOf(problem)}

Statement:
${problem.statement}

Examples:
${examples}

Further tests (input -> expected):
${tests}

Reference solution:
${problem.solution}

JSON shape (write rule, evidence and fix in Korean):
{"verdict": "clear|unclear", "summary": "한 문장", "issues": [{"severity": "high|low", "rule": "풀이가 적용하지만 지문에 없는 규칙", "evidence": "그 규칙을 보여 주는 테스트나 풀이 부분", "fix": "지문에 추가할 문장"}]}
"high" = a reader following the statement literally would fail a test; "low" = unclear but most readers would guess right.`;
}

export function parseAudit(candidate) {
  if (!candidate || typeof candidate !== "object") throw new Error("audit: not an object");
  const issues = Array.isArray(candidate.issues) ? candidate.issues : [];
  const cleaned = issues
    .filter((i) => i && typeof i === "object" && typeof i.rule === "string" && i.rule.trim())
    .map((i) => ({
      severity: SEVERITIES.includes(i.severity) ? i.severity : "low",
      rule: i.rule.trim(),
      evidence: typeof i.evidence === "string" ? i.evidence.trim() : "",
      fix: typeof i.fix === "string" ? i.fix.trim() : "",
    }));
  const verdict = candidate.verdict === "unclear" || cleaned.some((i) => i.severity === "high") ? "unclear" : "clear";
  return { verdict, summary: typeof candidate.summary === "string" ? candidate.summary.trim() : "", issues: cleaned };
}

/** Cheap checks that need no model. Each returns a warning string or nothing. */
export function deterministicChecks(problem) {
  const warnings = [];
  if (problem.statement.length < 80) warnings.push(`지문이 ${problem.statement.length}자로 짧다`);
  if (!/(최대|이하|이상|범위|길이|개수|≤|<=|10\^)/.test(problem.statement)) warnings.push("지문에 입력 크기 제약이 없다");
  const missing = problem.examples.filter((e) => !e.explanation || e.explanation.trim().length < 10).length;
  if (missing) warnings.push(`예제 ${missing}개에 설명이 없거나 10자 미만이다`);
  const all = [...problem.examples, ...problem.tests];
  problem.params.forEach((p, idx) => {
    const values = all.map((t) => t.input[idx]);
    if (/\[\]$/.test(p.type) && !values.some((v) => Array.isArray(v) && v.length === 0)) warnings.push(`매개변수 ${p.name}: 빈 배열 테스트가 없다`);
    if (p.type === "string" && !values.some((v) => v === "")) warnings.push(`매개변수 ${p.name}: 빈 문자열 테스트가 없다`);
    if (p.type === "number" && !values.some((v) => v === 0 || v === 1)) warnings.push(`매개변수 ${p.name}: 0 또는 1 테스트가 없다`);
  });
  const distinct = new Set(all.map((t) => JSON.stringify(t.expected))).size;
  if (distinct < 3) warnings.push(`기대값 종류가 ${distinct}개뿐이다`);
  return warnings;
}

/** Markdown for the pull request body and the job summary. */
export function renderAuditReport(problem, audit, warnings) {
  const lines = [`### ${problem.id} — ${audit ? (audit.verdict === "clear" ? "지문 명확" : "지문 검토 필요") : "모델 검수 실패"}`];
  if (audit?.summary) lines.push("", audit.summary);
  if (audit?.issues.length) {
    lines.push("", "| 심각도 | 지문에 없는 규칙 | 근거 | 제안 |", "|---|---|---|---|");
    for (const i of audit.issues) lines.push(`| ${i.severity} | ${cell(i.rule)} | ${cell(i.evidence)} | ${cell(i.fix)} |`);
  }
  if (warnings.length) {
    lines.push("", "기계 검사:");
    for (const w of warnings) lines.push(`- ${w}`);
  }
  if (audit && !audit.issues.length && !warnings.length) lines.push("", "지적 사항 없음.");
  return lines.join("\n");
}

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
