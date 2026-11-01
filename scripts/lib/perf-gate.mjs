/**
 * Performance gate for hard problems: "hard" is measured, not asked.
 *
 * Besides the reference solution the model supplies, in separate calls,
 *  - bruteForce: an obviously-correct slow function with the same parameters
 *  - largeInput: a deterministic builder returning one argument list at the upper constraint
 *
 * The gate passes when
 *  1. the brute force agrees with the reference solution on every small test it can finish (checkBruteForce)
 *  2. the builder is deterministic and returns one value per parameter (checkLargeInput)
 *  3. the reference solution finishes the large input within SOLUTION_MAX_MS (checkLargeInput)
 *  4. the brute force does NOT finish the large input within BRUTE_TIMEOUT_MS (checkLargeInput)
 *
 * Rule 1 makes the brute force a second oracle for the statement; rules 3 and 4 show the constraints
 * are big enough that the required technique is actually needed. The two checks are separate so the
 * generator can retry just the stage that failed.
 */
import { deepEqual, loadSolution, runCase } from "./problem-utils.mjs";

export const SOLUTION_MAX_MS = Number(process.env.PERF_SOLUTION_MAX_MS ?? 1000);
export const BRUTE_TIMEOUT_MS = Number(process.env.PERF_BRUTE_TIMEOUT_MS ?? 2000);
/** Large inputs above this many JSON characters are kept out of the problem's test list. */
export const MAX_LARGE_TEST_CHARS = Number(process.env.PERF_MAX_LARGE_TEST_CHARS ?? 400_000);
const MIN_AGREEMENTS = 6;

const isTimeout = (e) => /timed out|ERR_SCRIPT_EXECUTION_TIMEOUT/i.test(String(e?.message ?? e));

function summarizeArg(v) {
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (typeof v === "string") return `string[${v.length}]`;
  if (v && typeof v === "object") return `object{${Object.keys(v).length}}`;
  return JSON.stringify(v);
}

export function buildLargeInput(source, paramCount) {
  const builder = loadSolution(source, "largeInput");
  const first = runCase(builder, [], 5000);
  const second = runCase(builder, [], 5000);
  if (!Array.isArray(first)) throw new Error("largeInput must return an array of arguments");
  if (first.length !== paramCount) throw new Error(`largeInput returns ${first.length} args, expected ${paramCount}`);
  if (!deepEqual(first, second)) throw new Error("largeInput is not deterministic (do not use Math.random or Date)");
  return first;
}

/**
 * Stage 1: the brute force loads and agrees with the reference solution on the small tests.
 * Returns {ok, failures, brute} where brute is the loaded function.
 */
export function checkBruteForce(problem, bruteForce) {
  let brute;
  try {
    brute = loadSolution(bruteForce, "bruteForce");
  } catch (e) {
    return { ok: false, failures: [`bruteForce does not load: ${e.message}`] };
  }
  let agreements = 0;
  for (const t of [...problem.examples, ...problem.tests]) {
    let got;
    try {
      got = runCase(brute, t.input, BRUTE_TIMEOUT_MS);
    } catch (e) {
      if (isTimeout(e)) continue;
      return { ok: false, failures: [`bruteForce threw on input ${JSON.stringify(t.input).slice(0, 120)}: ${e.message}`] };
    }
    if (!deepEqual(got, t.expected)) {
      return { ok: false, failures: [`bruteForce disagrees with the solution on input ${JSON.stringify(t.input).slice(0, 120)}: solution ${JSON.stringify(t.expected)}, bruteForce ${JSON.stringify(got)}. One of them does not follow the statement`] };
    }
    agreements++;
  }
  if (agreements < MIN_AGREEMENTS) {
    return { ok: false, failures: [`bruteForce finished only ${agreements} of the small tests within ${BRUTE_TIMEOUT_MS}ms; the small tests must be small enough for it (need ${MIN_AGREEMENTS})`] };
  }
  return { ok: true, failures: [], brute };
}

/**
 * Stage 2: the large input is deterministic, the solution is fast on it and the brute force is slow.
 * `brute` is the function returned by checkBruteForce. Returns {ok, failures, evidence, largeTest}.
 */
export function checkLargeInput(problem, brute, largeInput) {
  const evidence = { solutionMs: null, bruteForce: null, largeInputArgs: null, includedAsTest: false };
  let input;
  try {
    input = buildLargeInput(largeInput, problem.params.length);
  } catch (e) {
    return { ok: false, failures: [`largeInput: ${e.message}`], evidence };
  }
  evidence.largeInputArgs = Array.from(input, summarizeArg); // host-realm array (runCase returns vm-realm values)

  const fn = loadSolution(problem.solution, problem.functionName);
  let expected;
  const t0 = performance.now();
  try {
    expected = runCase(fn, input, SOLUTION_MAX_MS);
  } catch (e) {
    const why = isTimeout(e) ? `did not finish within ${SOLUTION_MAX_MS}ms` : `threw ${e.message}`;
    return { ok: false, failures: [`solution ${why} on the large input (${evidence.largeInputArgs.join(", ")})`], evidence };
  }
  evidence.solutionMs = Math.round(performance.now() - t0);

  const t1 = performance.now();
  try {
    runCase(brute, input, BRUTE_TIMEOUT_MS);
    const ms = Math.round(performance.now() - t1);
    evidence.bruteForce = `${ms}ms`;
    return { ok: false, failures: [`bruteForce finished the large input (${evidence.largeInputArgs.join(", ")}) in ${ms}ms (limit ${BRUTE_TIMEOUT_MS}ms): the input is too small to need the technique. Build a much bigger input, as close to the stated upper constraint as possible`], evidence };
  } catch (e) {
    if (!isTimeout(e)) {
      return { ok: false, failures: [`bruteForce threw on the large input instead of being slow: ${e.message}`], evidence };
    }
    evidence.bruteForce = `timeout>${BRUTE_TIMEOUT_MS}ms`;
  }

  const largeTest = { input, expected };
  evidence.includedAsTest = JSON.stringify(largeTest).length <= MAX_LARGE_TEST_CHARS;
  return { ok: true, failures: [], evidence, largeTest };
}

/** Both stages in one call (used by tests and by anyone holding both sources already). */
export function runPerfGate(problem, { bruteForce, largeInput }) {
  const stage1 = checkBruteForce(problem, bruteForce);
  if (!stage1.ok) return { ok: false, failures: stage1.failures, evidence: null };
  return checkLargeInput(problem, stage1.brute, largeInput);
}
