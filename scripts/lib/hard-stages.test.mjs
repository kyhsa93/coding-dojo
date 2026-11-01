import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorTests, buildBruteForcePrompt, buildLargeInputPrompt, parseFunctionSource } from "./hard-stages.mjs";
import { findArchetype } from "./archetypes.mjs";

const problem = {
  functionName: "lis",
  params: [{ name: "nums", type: "number[]" }],
  returnType: "number",
  statement: "최장 증가 부분 수열",
  solution: "function lis(nums) { return 0; }",
  examples: [{ input: [[1, 3, 2, 4]], expected: 3 }],
  tests: [{ input: [[1, 3, 2, 4]], expected: 3 }, { input: [[]], expected: 0 }, { input: [[5]], expected: 1 }, { input: [[9, 8, 7, 6, 5, 4]], expected: 1 }, { input: [[1, 2]], expected: 2 }, { input: [[2, 2]], expected: 1 }],
};
const archetype = findArchetype("dp-lis-nlogn");

test("brute force prompt names the function, the approach and the feedback", () => {
  const p = buildBruteForcePrompt(problem, archetype, "disagrees on [[1]]");
  assert.match(p, /function named "bruteForce"/);
  assert.match(p, /bruteForce\(nums: number\[\]\): number/);
  assert.match(p, /classic O\(n\^2\) LIS DP/);
  assert.match(p, /Your previous answer was rejected: disagrees on \[\[1\]\]/);
  assert.match(p, /최장 증가 부분 수열/);
  assert.doesNotMatch(buildBruteForcePrompt(problem, archetype, null), /previous answer/);
});

test("brute force prompt anchors the four smallest distinct tests with their expected values", () => {
  assert.deepEqual(anchorTests(problem).map((t) => t.input), [[[]], [[5]], [[1, 2]], [[2, 2]]]);
  const p = buildBruteForcePrompt(problem, archetype, null);
  assert.match(p, /\[\[\]\] -> 0\n {2}\[\[5\]\] -> 1/);
  assert.doesNotMatch(p, /9,8,7,6,5,4/);
});

test("large input prompt states the arity, the guidance and the time limits", () => {
  const p = buildLargeInputPrompt(problem, archetype, null);
  assert.match(p, /exactly 1 element\(s\)/);
  assert.match(p, /100000 integers/);
  assert.match(p, /within 1000ms/);
  assert.match(p, /not finish within 2000ms/);
  assert.match(p, /Never use Math.random/);
  assert.match(p, /WORST case for that brute force/);
});

test("parseFunctionSource requires the named function", () => {
  assert.equal(parseFunctionSource({ bruteForce: " function bruteForce(a) { return a; } " }, "bruteForce"), "function bruteForce(a) { return a; }");
  assert.throws(() => parseFunctionSource({ bruteForce: "function other(a) {}" }, "bruteForce"), /must define function bruteForce/);
  assert.throws(() => parseFunctionSource({}, "largeInput"), /missing/);
  assert.throws(() => parseFunctionSource(null, "largeInput"), /not an object/);
});
