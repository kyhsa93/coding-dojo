import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBruteForce, checkLargeInput, runPerfGate } from "./perf-gate.mjs";
import { loadSolution, runCase } from "./problem-utils.mjs";

// Longest increasing subsequence: O(n log n) reference, O(n^2) brute force.
const solution = `function lis(nums) {
  const tails = [];
  for (const x of nums) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
    tails[lo] = x;
  }
  return tails.length;
}`;
const bruteForce = `function bruteForce(nums) {
  const dp = new Array(nums.length).fill(1);
  let best = nums.length ? 1 : 0;
  for (let i = 0; i < nums.length; i++) for (let j = 0; j < i; j++) if (nums[j] < nums[i] && dp[j] + 1 > dp[i]) { dp[i] = dp[j] + 1; if (dp[i] > best) best = dp[i]; }
  return best;
}`;
const largeInput = (n) => `function largeInput() {
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const nums = []; for (let i = 0; i < ${n}; i++) nums.push(Math.floor(rnd() * 1e9));
  return [nums];
}`;

function problemWith(inputs) {
  const fn = loadSolution(solution, "lis");
  const tests = inputs.map((input) => ({ input, expected: runCase(fn, input) }));
  return { functionName: "lis", params: [{ name: "nums", type: "number[]" }], solution, examples: tests.slice(0, 1), tests };
}

const smallInputs = [[[1, 3, 2, 4]], [[]], [[5]], [[5, 4, 3]], [[1, 2, 3, 4, 5]], [[2, 2, 2]], [[10, 9, 2, 5, 3, 7, 101, 18]], [[0, 1, 0, 3, 2, 3]]];

test("passes when the solution is fast and the brute force is slow on the large input", () => {
  const result = runPerfGate(problemWith(smallInputs), { bruteForce, largeInput: largeInput(200_000) });
  assert.equal(result.ok, true, result.failures.join("; "));
  assert.ok(result.evidence.solutionMs < 1000);
  assert.match(result.evidence.bruteForce, /^timeout>/);
  assert.deepStrictEqual(result.evidence.largeInputArgs, ["array[200000]"]);
  assert.equal(result.largeTest.input[0].length, 200_000);
  assert.equal(typeof result.largeTest.expected, "number");
});

test("rejects when the brute force finishes the large input in time", () => {
  const result = runPerfGate(problemWith(smallInputs), { bruteForce, largeInput: largeInput(300) });
  assert.equal(result.ok, false);
  assert.match(result.failures[0], /bruteForce finished the large input/);
});

test("rejects when the brute force disagrees with the solution", () => {
  const wrong = bruteForce.replace("return best;", "return best + 1;");
  const result = runPerfGate(problemWith(smallInputs), { bruteForce: wrong, largeInput: largeInput(200_000) });
  assert.equal(result.ok, false);
  assert.match(result.failures[0], /disagrees/);
});

test("rejects a non-deterministic large input builder", () => {
  const random = "function largeInput() { return [[Math.random()]]; }";
  const result = runPerfGate(problemWith(smallInputs), { bruteForce, largeInput: random });
  assert.equal(result.ok, false);
  assert.match(result.failures[0], /not deterministic/);
});

test("rejects a builder with the wrong number of arguments", () => {
  const result = runPerfGate(problemWith(smallInputs), { bruteForce, largeInput: "function largeInput() { return [[1], 2]; }" });
  assert.equal(result.ok, false);
  assert.match(result.failures[0], /returns 2 args, expected 1/);
});

test("rejects when the brute force cannot finish enough small tests", () => {
  const big = Array.from({ length: 100_000 }, (_, i) => (i * 7919) % 10007);
  const result = runPerfGate(problemWith([[big], [[1]], [[2, 1]]]), { bruteForce, largeInput: largeInput(200_000) });
  assert.equal(result.ok, false);
  assert.match(result.failures[0], /finished only/);
});

test("checkBruteForce returns the loaded function and checkLargeInput reuses it", () => {
  const problem = problemWith(smallInputs);
  const stage1 = checkBruteForce(problem, bruteForce);
  assert.equal(stage1.ok, true, stage1.failures.join("; "));
  assert.equal(typeof stage1.brute, "function");
  const tooSmall = checkLargeInput(problem, stage1.brute, largeInput(300));
  assert.equal(tooSmall.ok, false);
  assert.match(tooSmall.failures[0], /too small/);
  const ok = checkLargeInput(problem, stage1.brute, largeInput(200_000));
  assert.equal(ok.ok, true, ok.failures.join("; "));
  assert.equal(ok.evidence.includedAsTest, false, "200k ints exceed the test-size budget");
});

test("checkBruteForce rejects a source that does not load", () => {
  const r = checkBruteForce(problemWith(smallInputs), "function bruteForce(nums) { return ( ; }");
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /does not load/);
});
