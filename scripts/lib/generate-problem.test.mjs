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
