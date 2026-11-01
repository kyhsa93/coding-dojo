/**
 * Generates coding problems with a local Ollama model and writes validated JSON files into problems/.
 *
 * The model proposes the statement, a JavaScript reference solution and test INPUTS only.
 * Expected outputs are always computed by running the reference solution, so a test can never
 * disagree with the solution. A problem is written only when every check in buildProblem passes
 * AND two further model passes agree with it:
 *  1. cross-check: the model solves the problem again from the statement alone; that independent
 *     solution must match the reference solution on every test input (catches statements that do
 *     not describe what the solution computes). Two independent tries, either may agree.
 *  2. judge: the real difficulty must be within one level of the label. One level off: the label
 *     is corrected. Two levels off (easy<->hard): rejected.
 * A rejected candidate's reason is fed into the next attempt's prompt.
 *
 * Env: OLLAMA_URL, OLLAMA_MODEL, OLLAMA_THINK=false, COUNT, TOPIC, DIFFICULTY, MAX_ATTEMPTS,
 *      GENERATION_BUDGET_MINUTES (no new attempt or stage call starts after this; 0 = unlimited),
 *      ARCHETYPE (pin one hard archetype), ARCHETYPE_FIRST / ARCHETYPE_EXCLUDE (parallel slots, see lib/slots.mjs),
 *      HARD_GENERATION=split|single (hard: statement first and solution + tests second, or one call),
 *      DOMAIN (setting the problem is told in: backend, containers, aws, ...; none; empty = random, see lib/domains.mjs)
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DIFFICULTIES, LANGUAGES, loadSolution, runCase, starterFor, toPlainJs, validateShape, verifySolution } from "./lib/problem-utils.mjs";
import { MODEL, callOllama, extractJson } from "./lib/ollama.mjs";
import { buildCrossSolvePrompt, buildJudgePrompt, crossCheck, parseCrossSolution, parseJudgement, reconcileDifficulty } from "./lib/judge.mjs";
import { findArchetype, pickArchetype, servesTopic } from "./lib/archetypes.mjs";
import { checkBruteForce, checkLargeInput } from "./lib/perf-gate.mjs";
import { buildBruteForcePrompt, buildLargeInputPrompt, parseFunctionSource } from "./lib/hard-stages.mjs";
import { domainBlock, pickDomain } from "./lib/domains.mjs";

const COUNT = Math.max(1, Number(process.env.COUNT ?? 1));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.MAX_ATTEMPTS ?? 4));
const BUDGET_MS = Math.max(0, Number(process.env.GENERATION_BUDGET_MINUTES ?? 0)) * 60_000;
const DEADLINE = BUDGET_MS ? Date.now() + BUDGET_MS : Infinity;
const budgetExhausted = () => Date.now() > DEADLINE;
/** Thrown before a model call once the budget is gone, so the attempt ends and the loop stops instead of overrunning the job. */
function ensureBudget(stage) {
  if (budgetExhausted()) throw new Error(`time budget exhausted before ${stage} (${process.env.GENERATION_BUDGET_MINUTES} min)`);
}
const problemsDir = path.resolve(import.meta.dirname, "../problems");

const TOPICS = [
  "array", "string", "hash-map", "stack", "queue", "two-pointers", "sliding-window", "binary-search", "sorting",
  "recursion", "dynamic-programming", "graph-bfs", "graph-dfs", "greedy", "heap", "intervals", "matrix", "bit-manipulation",
  "math", "prefix-sum", "linked-structure-simulation", "backend-simulation (rate limiter, LRU cache, idempotency keys, job scheduling, log parsing)",
  "parsing (tokens, expressions, dates)", "string-compression", "topological-sort", "union-find",
];

const MIN_TESTS = 8;
const MAX_TESTS = 16;

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function existingProblems() {
  const files = (await readdir(problemsDir)).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    const p = JSON.parse(await readFile(path.join(problemsDir, f), "utf-8"));
    out.push({ id: p.id, title: p.title });
  }
  return out;
}

/**
 * Hard problems are built from an archetype: the model is told which technique the solution must use.
 * The brute force and the large input for the performance gate are asked for in later, separate calls
 * (obtainBruteForce / obtainLargeInput) so a failure there retries only that stage.
 */
function hardBlock(archetype) {
  if (!archetype) return "";
  return `
Hard problem requirements (a reviewer and an automated performance gate check these; a mismatch is rejected):
- Required technique: ${archetype.technique}. The "solution" MUST implement this technique. Design the problem so that a naive approach (${archetype.brute}) is far too slow at the stated constraints.
- State input sizes in the statement big enough that the technique is needed. Guidance for the upper constraint: ${archetype.large}.
- Keep the regular "tests" small (a few hundred elements at most); a separate large input is generated later.
`;
}

export function buildPrompt({ topic, difficulty, existing, feedback, archetype, domain = null }) {
  const avoid = existing.map((p) => `${p.id} (${p.title}${p.algorithm ? `: ${p.algorithm}` : ""})`).join(", ") || "(none)";
  const feedbackBlock = feedback ? `\nYour previous attempt was rejected: ${feedback}\nFix that in this attempt.\n` : "";
  return `You are writing one coding interview problem for a practice site. Output ONLY a compact JSON object on a single line: no prose, no markdown fences, no newlines or indentation between fields.
${feedbackBlock}${hardBlock(archetype)}
Constraints:
- Topic: ${topic}
${domainBlock(domain)}- Difficulty: ${difficulty}. easy = one pass or direct simulation; medium = a known technique (two pointers, sliding window, binary search, BFS/DFS, prefix sums, 1-D DP, heap) applied carefully; hard = several techniques combined, a non-obvious 2-D DP or graph algorithm, or an insight most candidates miss. A reviewer will grade the real difficulty from your solution and reject a mismatch.
- The problem must be solvable as a single pure function. No classes, no I/O, no randomness, no dates based on "now".
- All inputs and outputs must be JSON values: numbers, strings, booleans, null, arrays, plain objects. No undefined, NaN, Infinity, functions, Map, Set, BigInt.
- Parameter and return types use TypeScript notation limited to: number, string, boolean, number[], string[], boolean[], number[][], string[][], Record<string, number>, Record<string, string>.
- Do NOT reuse these existing problems or trivial variants of them: ${avoid}
- Write "title", "statement", "hints" and "explanation" in Korean. Keep identifiers in English.
- "statement" is Markdown. State constraints (input sizes, value ranges) and tie-breaking rules precisely so the answer is unique.
- "solution" is a complete, correct JavaScript (ES2022, no TypeScript, no imports, no console.log) implementation of the function named "functionName". It must handle every edge case the statement allows and run each test in well under one second.
- "tests" are INPUTS ONLY: an array of ${MIN_TESTS}..${MAX_TESTS} items, each item is the argument list (an array with exactly one element per parameter). Include edge cases: empty input, single element, duplicates, negative numbers where allowed, and at least one large case near the upper constraint. Do NOT include expected outputs anywhere; they are computed by running your solution.
- "examples" are 2..3 of those argument lists, each with a short Korean "explanation".

JSON shape (fill every field):
{
  "id": "kebab-case-slug",
  "title": "한국어 제목",
  "difficulty": "${difficulty}",
  "tags": ["${topic.split(" ")[0]}", "..."],
  "statement": "마크다운 문제 설명",
  "functionName": "camelCaseName",
  "params": [{"name": "nums", "type": "number[]"}],
  "returnType": "number",
  "examples": [{"input": [[1,2,3]], "explanation": "..."}],
  "tests": [[[1,2,3]], [[]], [[5]]],
  "hints": ["힌트 1", "힌트 2"],
  "solution": "function camelCaseName(nums) { ... }"
}`;
}

const COMMON_RULES = `- The problem must be solvable as a single pure function. No classes, no I/O, no randomness, no dates based on "now".
- All inputs and outputs must be JSON values: numbers, strings, booleans, null, arrays, plain objects. No undefined, NaN, Infinity, functions, Map, Set, BigInt.
- Parameter and return types use TypeScript notation limited to: number, string, boolean, number[], string[], boolean[], number[][], string[][], Record<string, number>, Record<string, string>.`;

const signatureOf = (spec) => `${spec.functionName}(${spec.params.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${spec.returnType}`;

/**
 * Split generation, step 1 of 2: the statement, signature, examples and hints only. A hard problem's
 * single-call answer (statement + solution + 8..16 tests) runs to 3000+ tokens, where a 14b model on a
 * CPU runner degenerates (repeated fragments, truncated JSON, type annotations). Two shorter answers
 * keep each call inside the range the model handles, and a failed implementation retries alone.
 */
export function buildSpecPrompt({ topic, difficulty, existing, feedback, archetype, domain = null }) {
  const avoid = existing.map((p) => `${p.id} (${p.title}${p.algorithm ? `: ${p.algorithm}` : ""})`).join(", ") || "(none)";
  const feedbackBlock = feedback ? `\nYour previous attempt was rejected: ${feedback}\nFix that in this attempt.\n` : "";
  const hard = archetype
    ? `
Hard problem requirements (a reviewer and an automated performance gate check these; a mismatch is rejected):
- The intended solution MUST use this technique: ${archetype.technique}. Design the problem so that a naive approach (${archetype.brute}) is far too slow at the stated constraints.
- State input sizes in the statement big enough that the technique is needed. Guidance for the upper constraint: ${archetype.large}.
`
    : "";
  return `You are writing one coding interview problem for a practice site. In THIS step write only the problem itself: the statement, the function signature, the examples and the hints. The reference solution and the tests are written in a later step from your statement, so the statement must say everything a solver needs. Output ONLY a compact JSON object on a single line: no prose, no markdown fences, no newlines or indentation between fields.
${feedbackBlock}${hard}
Constraints:
- Topic: ${topic}
${domainBlock(domain)}- Difficulty: ${difficulty}. easy = one pass or direct simulation; medium = a known technique (two pointers, sliding window, binary search, BFS/DFS, prefix sums, 1-D DP, heap) applied carefully; hard = several techniques combined, a non-obvious 2-D DP or graph algorithm, or an insight most candidates miss.
${COMMON_RULES}
- Do NOT reuse these existing problems or trivial variants of them: ${avoid}
- Write "title", "statement", "hints" and the example "explanation" in Korean. Keep identifiers in English.
- "statement" is Markdown. State constraints (input sizes, value ranges), the result for the empty or smallest input, and tie-breaking rules precisely so the answer is unique.
- "examples" are 2..3 argument lists, each with a short Korean "explanation" of the expected result. An example "input" is a positional array with exactly one element per parameter, in the order of "params" (for nums and k: [[1,2,3], 2]); never an object keyed by parameter names. Do NOT include expected outputs as fields; they are computed later.

JSON shape (fill every field):
{
  "id": "kebab-case-slug",
  "title": "한국어 제목",
  "difficulty": "${difficulty}",
  "tags": ["${topic.split(" ")[0]}", "..."],
  "statement": "마크다운 문제 설명",
  "functionName": "camelCaseName",
  "params": [{"name": "nums", "type": "number[]"}, {"name": "k", "type": "number"}],
  "returnType": "number",
  "examples": [{"input": [[1,2,3], 2], "explanation": "..."}],
  "hints": ["힌트 1", "힌트 2"]
}`;
}

/** Split generation, step 2 of 2: the reference solution and the test inputs for a finished spec. */
export function buildImplPrompt(spec, archetype, feedback) {
  const feedbackBlock = feedback ? `\nYour previous answer was rejected: ${feedback}\nFix that.\n` : "";
  const technique = archetype
    ? `- The solution MUST implement this technique: ${archetype.technique}. A naive approach (${archetype.brute}) is rejected by a reviewer and by a performance gate at the stated constraints.\n`
    : "";
  const examples = spec.examples.map((e) => `  ${JSON.stringify(e.input)}`).join("\n");
  return `Write the reference solution and the test inputs for this coding problem. Output ONLY a compact JSON object on a single line: no prose, no markdown fences, no newlines or indentation between fields.
${feedbackBlock}
Signature: ${signatureOf(spec)}

Rules:
- "solution" is a complete, correct JavaScript (ES2022, no TypeScript type annotations, no imports, no console.log) implementation of the function named "${spec.functionName}" with exactly the parameters of the signature. It must follow the statement literally, handle every edge case the statement allows (including the empty or smallest input), and run each test in well under one second.
${technique}- "tests" are INPUTS ONLY: an array of ${MIN_TESTS}..${MAX_TESTS} items, each item is the argument list (an array with exactly ${spec.params.length} element(s), one per parameter). Include edge cases: empty input, single element, duplicates, negative numbers where allowed, ties, and at least one case near the upper constraint but still small enough to list (a few hundred elements at most). Do NOT include expected outputs anywhere; they are computed by running your solution.
- Every value must be a JSON value within the statement's constraints.

Statement:
${spec.statement}

Example argument lists (write tests in the same shape):
${examples}

JSON shape:
{"solution": "function ${spec.functionName}(${spec.params.map((p) => p.name).join(", ")}) { ... }", "tests": [${spec.examples[0] ? JSON.stringify(spec.examples[0].input) : "[...]"}, ...]}`;
}

/** Validates the step-1 answer and normalizes its examples to argument lists, or throws with a reason. */
export function buildSpec(candidate, { existingIds }) {
  const c = candidate;
  if (!c || typeof c !== "object") throw new Error("spec is not an object");
  if (typeof c.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(c.id)) throw new Error(`id missing or not kebab-case: ${c.id}`);
  if (existingIds.has(c.id)) throw new Error(`id duplicate: ${c.id}`);
  if (!DIFFICULTIES.includes(c.difficulty)) throw new Error(`bad difficulty ${c.difficulty}`);
  if (typeof c.functionName !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.functionName)) throw new Error(`functionName must be an identifier: ${c.functionName}`);
  const params = Array.isArray(c.params) ? c.params : [];
  if (params.length === 0 || !params.every((x) => x && typeof x.name === "string" && typeof x.type === "string")) throw new Error("params must be a non-empty {name,type}[]");
  if (typeof c.returnType !== "string" || !c.returnType.trim()) throw new Error("returnType missing");
  const statement = String(c.statement ?? "").trim();
  if (statement.length < 80) throw new Error("statement too short");
  const normalizeInput = inputNormalizer(params);
  if (!Array.isArray(c.examples) || c.examples.length === 0) throw new Error("examples missing");
  const examples = c.examples.slice(0, 3).map((raw) => {
    const input = normalizeInput(raw);
    if (!input || input.length !== params.length) throw new Error(`example input malformed: ${JSON.stringify(raw).slice(0, 80)} (need an array with ${params.length} argument(s))`);
    const explanation = typeof raw?.explanation === "string" ? raw.explanation.trim() : "";
    return explanation ? { input, explanation } : { input };
  });
  return {
    id: c.id,
    title: String(c.title ?? "").trim(),
    difficulty: c.difficulty,
    tags: Array.isArray(c.tags) ? c.tags : [],
    statement,
    functionName: c.functionName,
    params,
    returnType: c.returnType.trim(),
    examples,
    hints: Array.isArray(c.hints) ? c.hints : [],
  };
}

/** Model calls per stage before the whole attempt is given up. */
const STAGE_RETRIES = 3;
const STAGE_TEMPERATURES = [0.3, 0.7, 0.5];

/**
 * Split generation, step 2: ask for solution + tests until buildProblem accepts them. A rejection
 * (syntax error, wrong arity, undefined result, trivial outputs) retries this step only, with the reason.
 */
export async function obtainImplementation(spec, archetype, { existingIds, source }, log = () => {}, initialFeedback = null) {
  let feedback = initialFeedback;
  let last = null;
  for (let i = 0; i < STAGE_RETRIES; i++) {
    try {
      ensureBudget("implementation");
      const raw = await callOllama(buildImplPrompt(spec, archetype, feedback), { temperature: STAGE_TEMPERATURES[i], top_p: 0.9, num_predict: 4096 });
      const impl = extractJson(raw);
      if (!impl || typeof impl !== "object") throw new Error("implementation is not an object");
      const problem = buildProblem({ ...spec, solution: impl.solution, tests: impl.tests }, { existingIds, source });
      log(`  implementation: accepted (call ${i + 1}/${STAGE_RETRIES}, ${problem.tests.length} tests)`);
      return problem;
    } catch (e) {
      last = e;
      feedback = e.message;
      log(`  implementation rejected (call ${i + 1}/${STAGE_RETRIES}): ${e.message}`);
    }
  }
  throw new Error(`implementation: ${last.message}`);
}

/**
 * Stage: ask for a brute force until one agrees with the solution on the small tests.
 * Returns {source, brute} or throws with the last reason.
 */
export async function obtainBruteForce(problem, archetype, log = () => {}) {
  let feedback = null;
  for (let i = 0; i < STAGE_RETRIES; i++) {
    try {
      ensureBudget("brute force");
      const raw = await callOllama(buildBruteForcePrompt(problem, archetype, feedback), { temperature: STAGE_TEMPERATURES[i], top_p: 0.9, num_predict: 2048 });
      const source = parseFunctionSource(extractJson(raw), "bruteForce");
      const check = checkBruteForce(problem, source);
      if (check.ok) {
        log(`  brute force: agrees with the solution (call ${i + 1}/${STAGE_RETRIES})`);
        return { source, brute: check.brute };
      }
      feedback = check.failures[0];
    } catch (e) {
      feedback = e.message;
    }
    log(`  brute force rejected (call ${i + 1}/${STAGE_RETRIES}): ${feedback}`);
  }
  throw new Error(`brute force: ${feedback}`);
}

/**
 * Stage: ask for a large-input builder until the solution is fast and the brute force is slow on it.
 * Returns {source, evidence, largeTest} or throws with the last reason.
 */
export async function obtainLargeInput(problem, archetype, brute, log = () => {}) {
  let feedback = null;
  for (let i = 0; i < STAGE_RETRIES; i++) {
    try {
      ensureBudget("large input");
      const raw = await callOllama(buildLargeInputPrompt(problem, archetype, feedback), { temperature: STAGE_TEMPERATURES[i], top_p: 0.9, num_predict: 2048 });
      const source = parseFunctionSource(extractJson(raw), "largeInput");
      const check = checkLargeInput(problem, brute, source);
      if (check.ok) {
        const perf = check.evidence;
        log(`  perf gate: solution ${perf.solutionMs}ms, bruteForce ${perf.bruteForce} on (${perf.largeInputArgs.join(", ")})${perf.includedAsTest ? ", large input added as a test" : ""} (call ${i + 1}/${STAGE_RETRIES})`);
        return { source, evidence: perf, largeTest: check.largeTest };
      }
      feedback = check.failures[0];
    } catch (e) {
      feedback = e.message;
    }
    log(`  large input rejected (call ${i + 1}/${STAGE_RETRIES}): ${feedback}`);
  }
  throw new Error(`large input: ${feedback}`);
}

/** Runs both hard stages and returns the problem with the evidence recorded. */
export async function applyHardStages(problem, archetype, log = () => {}) {
  const { brute } = await obtainBruteForce(problem, archetype, log);
  const { source, evidence, largeTest } = await obtainLargeInput(problem, archetype, brute, log);
  return {
    ...problem,
    tests: evidence.includedAsTest ? [...problem.tests, largeTest] : problem.tests,
    judge: { ...(problem.judge ?? {}), archetype: archetype.key, performance: { ...evidence, largeInput: source } },
  };
}

/**
 * A test is an argument list. For a one-parameter function the model often writes the bare argument
 * instead ("tests": [5, 7] or [[1, 2, 3], [4]] for nums: number[]); that is unambiguous, so accept it.
 * Returns a function mapping a raw test/example item to an argument list, or null when it is malformed.
 */
function inputNormalizer(params) {
  const single = params.length === 1;
  const singleIsArray = single && /\[\]$/.test(String(params[0].type ?? ""));
  return (item) => {
    const raw = item && typeof item === "object" && !Array.isArray(item) && "input" in item ? item.input : item;
    if (Array.isArray(raw)) {
      if (raw.length === params.length && !(singleIsArray && raw.length === 1 && !Array.isArray(raw[0]))) return raw;
      if (singleIsArray) return [raw];
      return raw;
    }
    if (single && raw !== undefined && raw !== null && !singleIsArray) return [raw];
    return null;
  };
}

/**
 * Split generation: when every brute force disagrees with the solution on the same input, the
 * statement is probably clear and the solution wrong (run 41312490045: a "strictly increasing digits"
 * count of 200 below 123 against three brute forces saying 47). Rewrite the solution once with that
 * evidence, keeping the statement, before the attempt is given up.
 */
async function applyHardStagesSplit(spec, problem, archetype, ctx, log = () => {}) {
  try {
    return await applyHardStages(problem, archetype, log);
  } catch (e) {
    const m = /^brute force: (bruteForce disagrees with the solution on input .*?)(?:\. One of them|$)/s.exec(e.message);
    if (!m) throw e;
    log(`  solution suspect: ${m[1]}; rewriting the solution once with that evidence`);
    const feedback = `an independent brute-force implementation of the statement disagrees with your solution: ${m[1]}. Re-derive the answer for that input from the statement by hand; if the brute force is right, your solution has a bug, fix it`;
    const rewritten = await obtainImplementation(spec, archetype, ctx, log, feedback);
    return applyHardStages(rewritten, archetype, log);
  }
}

/** Turns a model candidate into a full problem or throws with a reason. */
export function buildProblem(candidate, { existingIds, source }) {
  const c = candidate;
  if (!c || typeof c !== "object") throw new Error("candidate is not an object");
  if (!Array.isArray(c.tests)) throw new Error("tests missing");
  if (!Array.isArray(c.examples)) throw new Error("examples missing");
  if (typeof c.solution !== "string") throw new Error("solution missing");
  if (!DIFFICULTIES.includes(c.difficulty)) throw new Error(`bad difficulty ${c.difficulty}`);
  if (typeof c.id !== "string" || existingIds.has(c.id)) throw new Error(`id missing or duplicate: ${c.id}`);

  const solution = toPlainJs(c.solution);
  const fn = loadSolution(solution, c.functionName);
  const params = Array.isArray(c.params) ? c.params : [];
  const normalizeInput = inputNormalizer(params);
  // A solution that returns undefined (stored as null) for some input has not decided that case; such a
  // problem fails the brute-force oracle and confuses solvers. Only a declared nullable return may be null.
  const nullable = /\b(null|undefined|void)\b/.test(String(c.returnType ?? ""));
  const expectedFor = (input) => {
    const expected = runCase(fn, input);
    if (expected === null && !nullable) throw new Error(`solution returns undefined/null for input ${JSON.stringify(input).slice(0, 80)} (returnType ${c.returnType}): state that case in the statement and handle it in the solution`);
    return expected;
  };

  const seen = new Set();
  const tests = [];
  for (const raw of c.tests) {
    const input = normalizeInput(raw);
    if (!input) throw new Error("test input is not an array");
    if (input.length !== params.length) throw new Error(`test has ${input.length} args, expected ${params.length}`);
    const key = JSON.stringify(input);
    if (seen.has(key)) continue;
    seen.add(key);
    tests.push({ input, expected: expectedFor(input) });
  }
  if (tests.length < MIN_TESTS) throw new Error(`only ${tests.length} distinct tests (need ${MIN_TESTS})`);

  const distinctOutputs = new Set(tests.map((t) => JSON.stringify(t.expected)));
  if (distinctOutputs.size < 2) throw new Error("solution returns the same value for every test (trivial)");

  const examples = c.examples.slice(0, 3).map((raw) => {
    const input = normalizeInput(raw);
    if (!input || input.length !== params.length) throw new Error("example input malformed");
    const ex = { input, expected: expectedFor(input) };
    if (typeof raw?.explanation === "string" && raw.explanation.trim()) ex.explanation = raw.explanation.trim();
    return ex;
  });
  if (examples.length === 0) throw new Error("no examples");

  const problem = {
    id: c.id,
    title: String(c.title ?? "").trim(),
    difficulty: c.difficulty,
    tags: Array.from(new Set((Array.isArray(c.tags) ? c.tags : []).map((t) => String(t).toLowerCase().trim()).filter(Boolean))),
    statement: String(c.statement ?? "").trim(),
    functionName: c.functionName,
    params,
    returnType: String(c.returnType ?? "").trim(),
    starterCode: Object.fromEntries(LANGUAGES.map((l) => [l, starterFor(l, c.functionName, params, String(c.returnType ?? ""))])),
    examples,
    tests,
    hints: Array.isArray(c.hints) ? c.hints.map(String).filter(Boolean).slice(0, 4) : [],
    solution: solution.trim(),
    createdAt: new Date().toISOString().slice(0, 10),
    source,
  };
  if (problem.tags.length === 0) problem.tags = ["misc"];
  if (problem.statement.length < 80) throw new Error("statement too short");

  const shape = validateShape(problem);
  if (shape.length) throw new Error(`shape: ${shape.join("; ")}`);
  const verified = verifySolution(problem);
  if (!verified.ok) throw new Error(`verify: ${verified.failures.slice(0, 3).join("; ")}`);
  return problem;
}

/** Model pass: solve from the statement alone and compare. Throws with the first disagreement. */
export async function crossVerify(problem, log = () => {}) {
  const total = problem.examples.length + problem.tests.length;
  let last = null;
  for (const temperature of [0.3, 0.8]) {
    ensureBudget("cross-check");
    const raw = await callOllama(buildCrossSolvePrompt(problem), { temperature, top_p: 0.9, num_predict: 4096 });
    const result = crossCheck(problem, parseCrossSolution(extractJson(raw)));
    const timeouts = result.timeouts ? `, ${result.timeouts} timed out and were ignored` : "";
    if (result.ok) {
      log(`  cross-check: independent solution agrees on ${result.agreements}/${total} inputs${timeouts}`);
      return;
    }
    last = result;
    log(`  cross-check: ${result.failures.length}/${total} inputs disagree${timeouts} (temperature ${temperature})`);
  }
  throw new Error(`cross-check: an independent solution written from the statement disagrees with the reference solution. ${last.failures[0]}. Either the statement is ambiguous or the solution does not implement it`);
}

/** Second model pass: grade the real difficulty. Returns the judgement. */
export async function judgeProblem(problem, archetype = null) {
  ensureBudget("judge");
  const raw = await callOllama(buildJudgePrompt(problem, archetype ? { technique: archetype.technique } : {}), { temperature: 0, num_predict: 512 });
  return parseJudgement(extractJson(raw));
}

/** Archetype for this slot: the ARCHETYPE env pins one, otherwise hard problems get one picked for the topic. */
function chooseArchetype(topic, difficulty, used) {
  const pinned = process.env.ARCHETYPE?.trim();
  if (pinned) {
    const a = findArchetype(pinned);
    if (!a) throw new Error(`unknown ARCHETYPE ${pinned}`);
    return a;
  }
  if (difficulty !== "hard") return null;
  // A parallel slot starts with its assigned archetype and may move on after failures, unlike ARCHETYPE.
  const first = process.env.ARCHETYPE_FIRST?.trim();
  if (first && !used.includes(first)) {
    const a = findArchetype(first);
    if (!a) throw new Error(`unknown ARCHETYPE_FIRST ${first}`);
    return a;
  }
  return pickArchetype(topic, used);
}

/** Archetype keys sibling slots of the same run are working on; never chosen here. */
const ARCHETYPE_EXCLUDE = (process.env.ARCHETYPE_EXCLUDE ?? "").split(",").map((s) => s.trim()).filter(Boolean);
/** hard problems: "split" asks for the statement first and the solution + tests second; "single" asks for everything in one call. */
const HARD_GENERATION = process.env.HARD_GENERATION === "single" ? "single" : "split";

/** An archetype is given up after this many rejected attempts in a row; the next attempt gets another one. */
const ATTEMPTS_PER_ARCHETYPE = 2;

async function generateOne({ topic, difficulty, existing }) {
  const existingIds = new Set(existing.map((p) => p.id));
  const temperatures = [0.7, 0.9, 0.5, 1.0];
  let feedback = null;
  // Rejected candidates join the avoid list: the model otherwise retells the same problem attempt after attempt.
  const rejected = [];
  const usedArchetypes = [...ARCHETYPE_EXCLUDE];
  let archetype = null;
  let archetypeFailures = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const temperature = temperatures[attempt % temperatures.length];
    if (budgetExhausted()) {
      console.log(`  time budget exhausted (${process.env.GENERATION_BUDGET_MINUTES} min), no more attempts`);
      break;
    }
    if (!archetype || archetypeFailures >= ATTEMPTS_PER_ARCHETYPE) {
      archetype = chooseArchetype(topic, difficulty, usedArchetypes);
      archetypeFailures = 0;
      if (archetype) usedArchetypes.push(archetype.key);
    }
    // The archetype decides the real topic when the requested one has no hard archetype.
    const slotTopic = archetype && !servesTopic(archetype, topic) ? archetype.topics[0] : topic;
    // The setting is drawn per attempt: a story the model cannot make a problem of should not block the slot.
    const domain = pickDomain(process.env);
    console.log(`  attempt ${attempt + 1}/${MAX_ATTEMPTS} (temperature ${temperature}${archetype ? `, archetype ${archetype.key}` : ""}${slotTopic !== topic ? `, topic ${slotTopic}` : ""}${domain ? `, setting ${domain.key}` : ""})`);
    try {
      const avoid = [...existing, ...rejected];
      const source = `ollama/${MODEL}`;
      let entry = null;
      let built;
      let spec = null;
      if (archetype && HARD_GENERATION === "split") {
        const raw = await callOllama(buildSpecPrompt({ topic: slotTopic, difficulty, existing: avoid, feedback, archetype, domain }), { temperature, top_p: 0.9, num_predict: 3072 });
        const candidate = extractJson(raw);
        entry = candidate && typeof candidate.id === "string" ? { id: candidate.id, title: String(candidate.title ?? "") } : null;
        if (entry) rejected.push(entry);
        spec = buildSpec(candidate, { existingIds });
        console.log(`  spec: ${spec.id} ${signatureOf(spec)} (${spec.statement.length} chars, ${spec.examples.length} examples)`);
        built = await obtainImplementation(spec, archetype, { existingIds, source }, console.log);
      } else {
        const prompt = buildPrompt({ topic: slotTopic, difficulty, existing: avoid, feedback, archetype, domain });
        const raw = await callOllama(prompt, { temperature, top_p: 0.9, num_predict: archetype ? 6144 : 4096 });
        const candidate = extractJson(raw);
        entry = candidate && typeof candidate.id === "string" ? { id: candidate.id, title: String(candidate.title ?? "") } : null;
        if (entry) rejected.push(entry);
        built = buildProblem(candidate, { existingIds, source });
      }

      if (archetype) built = spec ? await applyHardStagesSplit(spec, built, archetype, { existingIds, source }, console.log) : await applyHardStages(built, archetype, console.log);

      await crossVerify(built, console.log);

      const judgement = await judgeProblem(built, archetype);
      if (entry) entry.algorithm = judgement.algorithm;
      console.log(`  judge: ${judgement.difficulty} (${judgement.algorithm})${judgement.usesTechnique !== undefined ? `, usesTechnique=${judgement.usesTechnique}` : ""}`);
      const outcome = reconcileDifficulty(built, judgement, { objective: Boolean(archetype) });
      if (outcome.action === "reject") throw new Error(`difficulty: ${outcome.reason}`);
      if (outcome.action === "relabel") console.log(`  relabeled ${built.difficulty} -> ${outcome.problem.difficulty}`);
      outcome.problem.judge.crossChecked = true;
      rejected.pop();
      return outcome.problem;
    } catch (e) {
      console.log(`  rejected: ${e.message}`);
      // Every rejection reaches the next attempt. Shape errors ("test has 2 args, expected 1", "tests
      // missing") used to be silent, so the model repeated the same mistake attempt after attempt.
      feedback = e.message;
      archetypeFailures++;
    }
  }
  return null;
}

async function main() {
  const existing = await existingProblems();
  let written = 0;
  for (let i = 0; i < COUNT; i++) {
    if (budgetExhausted()) {
      console.log(`time budget exhausted, skipping the remaining ${COUNT - i} slot(s)`);
      break;
    }
    const topic = process.env.TOPIC?.trim() || pick(TOPICS);
    const pinned = process.env.ARCHETYPE?.trim();
    const difficulty = pinned ? "hard" : DIFFICULTIES.includes(process.env.DIFFICULTY) ? process.env.DIFFICULTY : pick(["easy", "medium", "medium", "hard"]);
    console.log(`[${i + 1}/${COUNT}] topic=${topic} difficulty=${difficulty} model=${MODEL}`);
    const problem = await generateOne({ topic, difficulty, existing });
    if (!problem) {
      console.log("  giving up on this slot");
      continue;
    }
    await writeFile(path.join(problemsDir, `${problem.id}.json`), JSON.stringify(problem, null, 2) + "\n");
    existing.push({ id: problem.id, title: problem.title });
    written++;
    console.log(`  wrote problems/${problem.id}.json (${problem.tests.length} tests)`);
  }
  console.log(`\n${written}/${COUNT} problems written`);
  if (written === 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
