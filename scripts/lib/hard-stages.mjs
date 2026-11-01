/**
 * Prompts for the two extra stages of a hard problem. Each asks the model for ONE small thing, with the
 * finished statement and signature in front of it, so a failure costs a short retry instead of a whole
 * new problem.
 */
import { BRUTE_TIMEOUT_MS, SOLUTION_MAX_MS } from "./perf-gate.mjs";

const signatureOf = (problem) => `${problem.functionName}(${problem.params.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${problem.returnType}`;

const feedbackBlock = (feedback) => (feedback ? `\nYour previous answer was rejected: ${feedback}\nFix that.\n` : "");

const MAX_ANCHORS = 4;

/** The smallest tests with their expected values: concrete anchors for the edge cases the statement glosses over. */
export function anchorTests(problem) {
  const seen = new Set();
  return [...problem.examples, ...problem.tests]
    .filter((t) => {
      const k = JSON.stringify(t.input);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => JSON.stringify(a.input).length - JSON.stringify(b.input).length)
    .slice(0, MAX_ANCHORS);
}

const anchorBlock = (problem) => anchorTests(problem).map((t) => `  ${JSON.stringify(t.input)} -> ${JSON.stringify(t.expected)}`).join("\n");

export function buildBruteForcePrompt(problem, archetype, feedback) {
  return `Write the most obvious SLOW solution (a brute force) for this coding problem. Output ONLY a compact JSON object on a single line, no prose, no markdown fences.
${feedbackBlock(feedback)}
Rules:
- A JavaScript (ES2022, no TypeScript, no imports, no console.log) function named "bruteForce" with exactly these parameters: ${signatureOf(problem).replace(problem.functionName, "bruteForce")}
- Approach: ${archetype.brute}. No memoization, no pruning, no clever data structures. Being slow is the point: it is only run on small inputs, and it must NOT finish a large input within ${BRUTE_TIMEOUT_MS}ms.
- It must return exactly the same values as a correct solution for every valid input, including the edge cases (empty input, single element, ties and tie-breaking rules). Follow the statement literally.
- Handle the empty input explicitly and return what the reference solution returns for it. Math.max()/Math.min() with no arguments give -Infinity/Infinity, which is wrong.
- It must return exactly these values (arguments -> result, from the reference solution); they settle the edge cases:
${anchorBlock(problem)}
- Recursion depth must stay below ~5000 frames; use loops where the input can be large.

Statement:
${problem.statement}

Reference solution (use it only to confirm the semantics; do not copy its algorithm):
${problem.solution}

JSON shape:
{"bruteForce": "function bruteForce(...) { ... }"}`;
}

export function buildLargeInputPrompt(problem, archetype, feedback) {
  return `Write a JavaScript function that builds ONE large test input for this coding problem. Output ONLY a compact JSON object on a single line, no prose, no markdown fences.
${feedbackBlock(feedback)}
Rules:
- A function named "largeInput" with no parameters that returns an array with one element per parameter of ${signatureOf(problem)} (exactly ${problem.params.length} element(s)).
- Build it at the upper constraint stated in the problem. Guidance: ${archetype.large}.
- Deterministic: use a seeded generator such as \`let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;\`. Never use Math.random or Date.
- Every value must satisfy the statement's constraints (ranges, uniqueness, validity of graphs/orders), so the input is legal.
- A correct O(n log n)-class solution must finish it within ${SOLUTION_MAX_MS}ms; a naive brute force (${archetype.brute}) must not finish within ${BRUTE_TIMEOUT_MS}ms. Prefer the largest legal size.
- Size alone is not the goal: shape the input as the WORST case for that brute force (a pattern with many '*' against a text that almost matches, all-equal characters, deep chains, many overlapping intervals). A random input that the brute force handles quickly is rejected even when it is big.
- ES2022, no imports, no console.log. Avoid recursion.

Statement:
${problem.statement}

JSON shape:
{"largeInput": "function largeInput() { let s = 12345; ...; return [ ... ]; }"}`;
}

/** Pulls a function source string out of a model answer, or throws. */
export function parseFunctionSource(candidate, field) {
  if (!candidate || typeof candidate !== "object") throw new Error(`${field}: not an object`);
  const src = candidate[field];
  if (typeof src !== "string" || !src.trim()) throw new Error(`${field}: missing`);
  if (!new RegExp(`function\\s+${field}\\s*\\(`).test(src)) throw new Error(`${field}: must define function ${field}(...)`);
  return src.trim();
}
