/**
 * Performance gate for hard problems: "hard" is measured, not asked.
 *
 * Besides the reference solution the model supplies
 *  - bruteForce: an obviously-correct slow function with the same parameters
 *  - largeInput: a deterministic builder returning one argument list at the upper constraint
 *
 * The gate passes when
 *  1. the builder is deterministic (two calls give the same input) and returns one value per parameter
 *  2. the brute force agrees with the reference solution on every small test it can finish
 *  3. the reference solution finishes the large input within SOLUTION_MAX_MS
 *  4. the brute force does NOT finish the large input within BRUTE_TIMEOUT_MS
 *
 * Rule 2 makes the brute force a second oracle for the statement; rules 3 and 4 show the constraints
 * are big enough that the required technique is actually needed.
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
 * Runs the gate. `problem` is a built problem (examples/tests with expected values, solution loaded by name).
 * Returns {ok, failures, evidence}; evidence is recorded on the problem when the gate passes.
 */
export function runPerfGate(problem, { bruteForce, largeInput }) {
  const failures = [];
  const evidence = { solutionMs: null, bruteForce: null, largeInputArgs: null, includedAsTest: false };

  let brute;
  try {
    brute = loadSolution(bruteForce, "bruteForce");
  } catch (e) {
    return { ok: false, failures: [`bruteForce does not load: ${e.message}`], evidence };
  }

  let input;
  try {
    input = buildLargeInput(largeInput, problem.params.length);
  } catch (e) {
    return { ok: false, failures: [`largeInput: ${e.message}`], evidence };
  }
  evidence.largeInputArgs = Array.from(input, summarizeArg); // host-realm array (runCase returns vm-realm values)

  // 2. brute force agrees with the reference on the small tests it can finish
  let agreements = 0;
  for (const t of [...problem.examples, ...problem.tests]) {
    let got;
    try {
      got = runCase(brute, t.input, BRUTE_TIMEOUT_MS);
    } catch (e) {
      if (isTimeout(e)) continue;
      failures.push(`bruteForce threw on input ${JSON.stringify(t.input).slice(0, 120)}: ${e.message}`);
      break;
    }
    if (!deepEqual(got, t.expected)) {
      failures.push(`bruteForce disagrees with the solution on input ${JSON.stringify(t.input).slice(0, 120)}: solution ${JSON.stringify(t.expected)}, bruteForce ${JSON.stringify(got)}`);
      break;
    }
    agreements++;
  }
  if (failures.length) return { ok: false, failures, evidence };
  if (agreements < MIN_AGREEMENTS) {
    return { ok: false, failures: [`bruteForce finished only ${agreements} of the small tests within ${BRUTE_TIMEOUT_MS}ms; the small tests must be small enough for it (need ${MIN_AGREEMENTS})`], evidence };
  }

  // 3. the solution is fast on the large input
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

  // 4. the brute force is slow on the large input
  const t1 = performance.now();
  try {
    runCase(brute, input, BRUTE_TIMEOUT_MS);
    const ms = Math.round(performance.now() - t1);
    evidence.bruteForce = `${ms}ms`;
    return { ok: false, failures: [`bruteForce finished the large input in ${ms}ms (limit ${BRUTE_TIMEOUT_MS}ms): the constraints are too small to need the technique, or the brute force is not naive. Make the large input bigger or the brute force simpler`], evidence };
  } catch (e) {
    if (!isTimeout(e)) {
      return { ok: false, failures: [`bruteForce threw on the large input instead of being slow: ${e.message}. Write it so it runs (slowly) without recursion depth errors`], evidence };
    }
    evidence.bruteForce = `timeout>${BRUTE_TIMEOUT_MS}ms`;
  }

  const largeTest = { input, expected };
  evidence.includedAsTest = JSON.stringify(largeTest).length <= MAX_LARGE_TEST_CHARS;
  return { ok: true, failures: [], evidence, largeTest };
}
