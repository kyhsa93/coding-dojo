import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImplPrompt, buildProblem, buildPrompt, buildSpec, buildSpecPrompt } from "../generate-problem.mjs";
import { findArchetype } from "./archetypes.mjs";
import { findDomain } from "./domains.mjs";

const base = {
  id: "sum-or-nothing", title: "합", difficulty: "easy", tags: ["array"],
  statement: "정수 배열이 주어지면 모든 원소의 합을 반환하세요. 배열 길이는 최대 100000이고 각 원소는 -10^9 이상 10^9 이하입니다. 빈 배열이면 0을 반환합니다.",
  functionName: "sum", params: [{ name: "nums", type: "number[]" }], returnType: "number",
  examples: [{ input: [[1, 2]], explanation: "1+2" }],
  tests: [[[1]], [[1, 2]], [[3]], [[4, 5]], [[-1, 1]], [[7, 7, 7]], [[10]], [[0, 2]]],
};

test("buildProblem rejects a solution that returns undefined for some test", () => {
  const sloppy = { ...base, tests: [...base.tests, [[]]], solution: "function sum(nums) { if (!nums.length) return; return nums.reduce((a, b) => a + b, 0); }" };
  assert.throws(() => buildProblem(sloppy, { existingIds: new Set(), source: "test" }), /returns undefined\/null for input \[\[\]\]/);
  const fine = { ...sloppy, solution: "function sum(nums) { return nums.reduce((a, b) => a + b, 0); }" };
  assert.equal(buildProblem(fine, { existingIds: new Set(), source: "test" }).tests.length, 9);
});

test("a declared nullable return type may be null", () => {
  const nullable = { ...base, returnType: "number | null", solution: "function sum(nums) { if (!nums.length) return null; return nums.reduce((a, b) => a + b, 0); }", tests: [...base.tests, [[]]] };
  const p = buildProblem(nullable, { existingIds: new Set(), source: "test" });
  assert.equal(p.tests.at(-1).expected, null);
});

test("bare arguments of a one-parameter function are accepted as tests", () => {
  const bare = { ...base, tests: [[1], [1, 2], [3], [4, 5], [-1, 1], [7, 7, 7], [10], [0, 2]], examples: [{ input: [1, 2] }], solution: "function sum(nums) { return nums.reduce((a, b) => a + b, 0); }" };
  const p = buildProblem(bare, { existingIds: new Set(), source: "test" });
  assert.deepEqual(p.tests[1], { input: [[1, 2]], expected: 3 });
  assert.deepEqual(p.examples[0].input, [[1, 2]]);
  const scalar = { ...base, params: [{ name: "n", type: "number" }], functionName: "twice", solution: "function twice(n) { return n * 2; }", tests: [1, 2, 3, 4, 5, 6, 7, 8], examples: [{ input: 3 }] };
  const q = buildProblem(scalar, { existingIds: new Set(), source: "test" });
  assert.deepEqual(q.tests[0], { input: [1], expected: 2 });
  assert.deepEqual(q.examples[0], { input: [3], expected: 6 });
  const two = { ...base, params: [{ name: "a", type: "number" }, { name: "b", type: "number" }], functionName: "add", solution: "function add(a, b) { return a + b; }", tests: [[1, 2, 3]], examples: [{ input: [1, 2] }] };
  assert.throws(() => buildProblem(two, { existingIds: new Set(), source: "test" }), /test has 3 args, expected 2/);
});

test("a type-annotated solution is stripped to plain JavaScript", () => {
  const typed = { ...base, solution: "function sum(nums: number[]): number { let s: number = 0; for (const x of nums) s += x; return s; }" };
  const p = buildProblem(typed, { existingIds: new Set(), source: "test" });
  assert.doesNotMatch(p.solution, /: number/);
  assert.equal(p.tests[1].expected, 3);
  const broken = { ...base, solution: "function sum(nums) { return ( ; }" };
  assert.throws(() => buildProblem(broken, { existingIds: new Set(), source: "test" }), SyntaxError);
});

const specCandidate = {
  id: "longest-increasing-run", title: "가장 긴 증가 구간", difficulty: "hard", tags: ["dynamic-programming"],
  statement: "정수 배열 nums 가 주어지면 가장 긴 증가 부분 수열의 길이를 반환하세요. 배열 길이는 최대 100000, 각 원소는 -10^9 이상 10^9 이하입니다. 빈 배열이면 0을 반환합니다.",
  functionName: "lis", params: [{ name: "nums", type: "number[]" }], returnType: "number",
  examples: [{ input: [1, 3, 2, 4], explanation: "1,3,4 또는 1,2,4" }, { input: [[]], explanation: "빈 배열" }],
  hints: ["이분 탐색"],
};

test("spec prompt asks for the statement only and carries the archetype and the feedback", () => {
  const p = buildSpecPrompt({ topic: "dynamic-programming", difficulty: "hard", existing: [{ id: "a", title: "A" }], feedback: "statement too short", archetype: findArchetype("dp-lis-nlogn") });
  assert.match(p, /write only the problem itself/);
  assert.match(p, /Your previous attempt was rejected: statement too short/);
  assert.match(p, /MUST use this technique/);
  assert.match(p, /a \(A\)/);
  assert.doesNotMatch(p, /"solution"/);
  assert.doesNotMatch(p, /"tests"/);
});

test("buildSpec validates the first answer and normalizes bare example arguments", () => {
  const spec = buildSpec(specCandidate, { existingIds: new Set() });
  assert.deepEqual(spec.examples, [{ input: [[1, 3, 2, 4]], explanation: "1,3,4 또는 1,2,4" }, { input: [[]], explanation: "빈 배열" }]);
  assert.throws(() => buildSpec({ ...specCandidate, statement: "짧다" }, { existingIds: new Set() }), /statement too short/);
  assert.throws(() => buildSpec(specCandidate, { existingIds: new Set(["longest-increasing-run"]) }), /id duplicate/);
  assert.throws(() => buildSpec({ ...specCandidate, params: [] }, { existingIds: new Set() }), /params/);
  assert.throws(() => buildSpec({ ...specCandidate, examples: [] }, { existingIds: new Set() }), /examples missing/);
});

test("implementation prompt carries the signature, the statement, the examples and the technique", () => {
  const spec = buildSpec(specCandidate, { existingIds: new Set() });
  const p = buildImplPrompt(spec, findArchetype("dp-lis-nlogn"), "test has 2 args, expected 1");
  assert.match(p, /Signature: lis\(nums: number\[\]\): number/);
  assert.match(p, /Your previous answer was rejected: test has 2 args, expected 1/);
  assert.match(p, /MUST implement this technique/);
  assert.match(p, /\[\[1,3,2,4\]\]/);
  assert.match(p, /"solution": "function lis\(nums\)/);
  assert.match(p, /exactly 1 element\(s\)/);
});

test("a spec plus a second-step answer builds the same problem as a single answer", () => {
  const spec = buildSpec(specCandidate, { existingIds: new Set() });
  const impl = { solution: "function lis(nums) { const t = []; for (const x of nums) { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; } t[lo] = x; } return t.length; }", tests: [[[1, 3, 2, 4]], [[]], [[5]], [[9, 8, 7]], [[1, 2, 3]], [[2, 2, 2]], [[1, 5, 2, 6, 3, 7]], [[-1, -2, -3, 0]]] };
  const p = buildProblem({ ...spec, ...impl }, { existingIds: new Set(), source: "test" });
  assert.equal(p.id, "longest-increasing-run");
  assert.deepEqual(p.examples[0], { input: [[1, 3, 2, 4]], expected: 3, explanation: "1,3,4 또는 1,2,4" });
  assert.equal(p.tests.length, 8);
  assert.equal(p.hints[0], "이분 탐색");
});

test("spec prompt shows positional example inputs for a two-parameter signature", () => {
  const p = buildSpecPrompt({ topic: "array", difficulty: "hard", existing: [], feedback: null, archetype: findArchetype("binary-search-answer") });
  assert.match(p, /never an object keyed by parameter names/);
  assert.match(p, /"input": \[\[1,2,3\], 2\]/);
});

test("the generation prompt carries the setting when one is given", () => {
  const args = { topic: "heap", difficulty: "medium", existing: [], feedback: null, archetype: null };
  assert.doesNotMatch(buildPrompt(args), /Setting:/);
  const p = buildPrompt({ ...args, domain: findDomain("aws") });
  assert.match(p, /Setting: AWS cloud infrastructure/);
  assert.match(p, /Include "aws" in "tags"/);
  assert.match(p, /Topic: heap/);
});

test("the spec prompt carries the setting too", () => {
  const p = buildSpecPrompt({ topic: "graph-bfs", difficulty: "hard", existing: [], feedback: null, archetype: findArchetype("graph-dijkstra-state"), domain: findDomain("containers") });
  assert.match(p, /Setting: containers and orchestration/);
  assert.match(p, /Include "containers" in "tags"/);
});
