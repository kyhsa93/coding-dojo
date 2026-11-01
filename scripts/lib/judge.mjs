/**
 * Asks the local Ollama model to judge the real difficulty of a finished problem.
 * The model sees the statement and the reference solution, and answers with
 * {difficulty, algorithm, reason}. The caller decides what to do with a mismatch.
 *
 * It also holds the cross-check: the model solves the problem again from the statement alone and
 * that independent solution must agree with the reference solution on every test input. This
 * catches statements that do not describe what the reference solution computes.
 */
import { DIFFICULTIES, deepEqual, loadSolution, runCase } from "./problem-utils.mjs";

const RANK = Object.fromEntries(DIFFICULTIES.map((d, i) => [d, i]));

/**
 * `technique` (hard problems built from an archetype): the judge must also say whether the reference
 * solution really implements it. The difficulty opinion is still collected for the record.
 */
export function buildJudgePrompt(problem, { technique } = {}) {
  const techniqueBlock = technique
    ? `
Required technique: ${technique}
Also answer "usesTechnique": true only if the reference solution genuinely implements this technique, false if it uses a simpler approach that merely passes the tests.
`
    : "";
  const techniqueField = technique ? `, "usesTechnique": true|false` : "";
  return `You are a strict reviewer grading the REAL difficulty of a coding interview problem. Output ONLY a JSON object, no prose.
${techniqueBlock}

Grading scale (judge by the simplest correct approach, not by how the statement sounds):
- easy: one pass or direct simulation, basic counting with a hash map, simple sorting, a single loop with an obvious accumulator. Any junior developer solves it in under 10 minutes.
- medium: needs a known technique applied correctly: two pointers, sliding window, binary search on answer, BFS/DFS, prefix sums, a 1-D DP, a heap, interval sweep, or careful tie-breaking and edge handling that is easy to get wrong.
- hard: combines several techniques, a non-obvious 2-D DP or graph algorithm, tricky invariants, or needs an insight most candidates miss in 30 minutes.

Ignore the claimed difficulty and the amount of text. If the reference solution is a single simple loop, it is easy regardless of the story.

Problem title: ${problem.title}
Claimed difficulty: ${problem.difficulty}
Signature: ${problem.functionName}(${problem.params.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${problem.returnType}

Statement:
${problem.statement}

Reference solution:
${problem.solution}

JSON shape:
{"difficulty": "easy|medium|hard", "algorithm": "핵심 알고리즘 한 줄 (한국어)", "reason": "판정 근거 한두 문장 (한국어)"${techniqueField}}`;
}

export function parseJudgement(candidate) {
  if (!candidate || typeof candidate !== "object") throw new Error("judge: not an object");
  const difficulty = String(candidate.difficulty ?? "").toLowerCase().trim();
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`judge: bad difficulty ${candidate.difficulty}`);
  const out = {
    difficulty,
    algorithm: String(candidate.algorithm ?? "").trim(),
    reason: String(candidate.reason ?? "").trim(),
  };
  if ("usesTechnique" in candidate) {
    const v = candidate.usesTechnique;
    out.usesTechnique = v === true || String(v).toLowerCase() === "true";
  }
  return out;
}

/**
 * Applies a judgement to a problem.
 * - same level: keep
 * - one level apart: relabel to the judged level
 * - two levels apart (easy<->hard): reject, the problem is not what was asked for
 *
 * `objective` (hard problems that passed the performance gate): the measured evidence outranks the
 * model's difficulty opinion, so the label stays hard. The problem is rejected only when the judge
 * says the required technique is not implemented.
 */
export function reconcileDifficulty(problem, judgement, { objective = false } = {}) {
  if (objective && problem.difficulty === "hard") {
    if (judgement.usesTechnique === false) {
      return { action: "reject", reason: `the solution does not implement the required technique: ${judgement.reason}` };
    }
    return { action: "keep", problem: applyJudgement(problem, { ...judgement, difficulty: "hard" }, { opinion: judgement.difficulty }) };
  }
  const gap = Math.abs(RANK[problem.difficulty] - RANK[judgement.difficulty]);
  if (gap >= 2) {
    return { action: "reject", reason: `judged ${judgement.difficulty} but labeled ${problem.difficulty}: ${judgement.reason}` };
  }
  return { action: gap === 0 ? "keep" : "relabel", problem: applyJudgement(problem, judgement) };
}

/** Returns a copy of the problem labeled with the judged difficulty and the judgement recorded. */
export function applyJudgement(problem, judgement, extra = {}) {
  const judge = { ...(problem.judge ?? {}), difficulty: judgement.difficulty, algorithm: judgement.algorithm, reason: judgement.reason };
  if (judgement.usesTechnique !== undefined) judge.usesTechnique = judgement.usesTechnique;
  if (extra.opinion && extra.opinion !== judgement.difficulty) judge.opinion = extra.opinion;
  else delete judge.opinion;
  return { ...problem, difficulty: judgement.difficulty, judge };
}

/* ---------- cross-check: an independent solution written from the statement alone ---------- */

export function buildCrossSolvePrompt(problem) {
  return `Solve this coding problem from the statement alone. Output ONLY a compact JSON object on a single line, no prose, no markdown fences.

Write a complete, correct JavaScript (ES2022, no TypeScript, no imports, no console.log) function named "${problem.functionName}" with this signature:
${problem.functionName}(${problem.params.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${problem.returnType}

Follow the statement literally, including tie-breaking rules and edge cases. If the statement is ambiguous, pick the most natural reading. Each call must finish well under one second for the stated constraints.

Title: ${problem.title}

Statement:
${problem.statement}

JSON shape:
{"solution": "function ${problem.functionName}(...) { ... }"}`;
}

export function parseCrossSolution(candidate) {
  if (!candidate || typeof candidate !== "object") throw new Error("cross-solve: not an object");
  if (typeof candidate.solution !== "string" || !candidate.solution.trim()) throw new Error("cross-solve: solution missing");
  return candidate.solution.trim();
}

/**
 * Runs an independent solution on every example and test input and compares it with the stored expected values.
 * The independent solution checks the statement's semantics, not performance: inputs on which it times out
 * (a naive solution on a hard problem's large test) are ignored, but it must agree on at least
 * MIN_CROSS_AGREEMENTS inputs. Returns {ok, failures, agreements, timeouts}; a failure names the input and
 * both outputs so the next attempt can be told.
 */
export const MIN_CROSS_AGREEMENTS = 6;

export function crossCheck(problem, altSolution) {
  const failures = [];
  let agreements = 0;
  let timeouts = 0;
  let fn;
  try {
    fn = loadSolution(altSolution, problem.functionName);
  } catch (e) {
    return { ok: false, failures: [`independent solution does not load: ${e.message}`], agreements, timeouts };
  }
  for (const t of [...problem.examples, ...problem.tests]) {
    let got;
    try {
      got = runCase(fn, t.input);
    } catch (e) {
      if (/timed out|ERR_SCRIPT_EXECUTION_TIMEOUT/i.test(String(e.message))) {
        timeouts++;
        continue;
      }
      failures.push(`input ${JSON.stringify(t.input).slice(0, 120)}: independent solution threw ${e.message}`);
      continue;
    }
    if (deepEqual(got, t.expected)) agreements++;
    else failures.push(`input ${JSON.stringify(t.input).slice(0, 120)}: reference solution returns ${JSON.stringify(t.expected)}, independent solution returns ${JSON.stringify(got)}`);
  }
  if (failures.length === 0 && agreements < MIN_CROSS_AGREEMENTS) {
    failures.push(`independent solution finished only ${agreements} input(s) within the time limit (need ${MIN_CROSS_AGREEMENTS}); the small tests must be small enough for a naive solution`);
  }
  return { ok: failures.length === 0, failures, agreements, timeouts };
}
