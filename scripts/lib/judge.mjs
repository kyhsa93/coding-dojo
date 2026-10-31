/**
 * Asks the local Ollama model to judge the real difficulty of a finished problem.
 * The model sees the statement and the reference solution, and answers with
 * {difficulty, algorithm, reason}. The caller decides what to do with a mismatch.
 */
import { DIFFICULTIES } from "./problem-utils.mjs";

const RANK = Object.fromEntries(DIFFICULTIES.map((d, i) => [d, i]));

export function buildJudgePrompt(problem) {
  return `You are a strict reviewer grading the REAL difficulty of a coding interview problem. Output ONLY a JSON object, no prose.

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
{"difficulty": "easy|medium|hard", "algorithm": "핵심 알고리즘 한 줄 (한국어)", "reason": "판정 근거 한두 문장 (한국어)"}`;
}

export function parseJudgement(candidate) {
  if (!candidate || typeof candidate !== "object") throw new Error("judge: not an object");
  const difficulty = String(candidate.difficulty ?? "").toLowerCase().trim();
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`judge: bad difficulty ${candidate.difficulty}`);
  return {
    difficulty,
    algorithm: String(candidate.algorithm ?? "").trim(),
    reason: String(candidate.reason ?? "").trim(),
  };
}

/**
 * Applies a judgement to a problem.
 * - same level: keep
 * - one level apart: relabel to the judged level
 * - two levels apart (easy<->hard): reject, the problem is not what was asked for
 */
export function reconcileDifficulty(problem, judgement) {
  const gap = Math.abs(RANK[problem.difficulty] - RANK[judgement.difficulty]);
  if (gap >= 2) {
    return { action: "reject", reason: `judged ${judgement.difficulty} but labeled ${problem.difficulty}: ${judgement.reason}` };
  }
  return { action: gap === 0 ? "keep" : "relabel", problem: applyJudgement(problem, judgement) };
}

/** Returns a copy of the problem labeled with the judged difficulty and the judgement recorded. */
export function applyJudgement(problem, judgement) {
  return {
    ...problem,
    difficulty: judgement.difficulty,
    judge: { difficulty: judgement.difficulty, algorithm: judgement.algorithm, reason: judgement.reason },
  };
}
