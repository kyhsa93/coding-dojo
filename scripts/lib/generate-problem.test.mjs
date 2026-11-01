import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProblem } from "../generate-problem.mjs";

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
