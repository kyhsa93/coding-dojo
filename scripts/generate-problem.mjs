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
 * Env: OLLAMA_URL, OLLAMA_MODEL, OLLAMA_THINK=false, COUNT, TOPIC, DIFFICULTY, MAX_ATTEMPTS
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DIFFICULTIES, LANGUAGES, loadSolution, runCase, starterFor, validateShape, verifySolution } from "./lib/problem-utils.mjs";
import { MODEL, callOllama, extractJson } from "./lib/ollama.mjs";
import { buildCrossSolvePrompt, buildJudgePrompt, crossCheck, parseCrossSolution, parseJudgement, reconcileDifficulty } from "./lib/judge.mjs";

const COUNT = Math.max(1, Number(process.env.COUNT ?? 1));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.MAX_ATTEMPTS ?? 4));
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

function buildPrompt({ topic, difficulty, existing, feedback }) {
  const avoid = existing.map((p) => `${p.id} (${p.title})`).join(", ") || "(none)";
  const feedbackBlock = feedback ? `\nYour previous attempt was rejected: ${feedback}\nFix that in this attempt.\n` : "";
  return `You are writing one coding interview problem for a practice site. Output ONLY a compact JSON object on a single line: no prose, no markdown fences, no newlines or indentation between fields.
${feedbackBlock}
Constraints:
- Topic: ${topic}
- Difficulty: ${difficulty}. easy = one pass or direct simulation; medium = a known technique (two pointers, sliding window, binary search, BFS/DFS, prefix sums, 1-D DP, heap) applied carefully; hard = several techniques combined, a non-obvious 2-D DP or graph algorithm, or an insight most candidates miss. A reviewer will grade the real difficulty from your solution and reject a mismatch.
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

/** Turns a model candidate into a full problem or throws with a reason. */
export function buildProblem(candidate, { existingIds, source }) {
  const c = candidate;
  if (!c || typeof c !== "object") throw new Error("candidate is not an object");
  if (!Array.isArray(c.tests)) throw new Error("tests missing");
  if (!Array.isArray(c.examples)) throw new Error("examples missing");
  if (typeof c.solution !== "string") throw new Error("solution missing");
  if (!DIFFICULTIES.includes(c.difficulty)) throw new Error(`bad difficulty ${c.difficulty}`);
  if (typeof c.id !== "string" || existingIds.has(c.id)) throw new Error(`id missing or duplicate: ${c.id}`);

  const fn = loadSolution(c.solution, c.functionName);
  const params = Array.isArray(c.params) ? c.params : [];

  const normalizeInput = (item) => (Array.isArray(item?.input) ? item.input : Array.isArray(item) ? item : null);

  const seen = new Set();
  const tests = [];
  for (const raw of c.tests) {
    const input = normalizeInput(raw);
    if (!input) throw new Error("test input is not an array");
    if (input.length !== params.length) throw new Error(`test has ${input.length} args, expected ${params.length}`);
    const key = JSON.stringify(input);
    if (seen.has(key)) continue;
    seen.add(key);
    tests.push({ input, expected: runCase(fn, input) });
  }
  if (tests.length < MIN_TESTS) throw new Error(`only ${tests.length} distinct tests (need ${MIN_TESTS})`);

  const distinctOutputs = new Set(tests.map((t) => JSON.stringify(t.expected)));
  if (distinctOutputs.size < 2) throw new Error("solution returns the same value for every test (trivial)");

  const examples = c.examples.slice(0, 3).map((raw) => {
    const input = normalizeInput(raw);
    if (!input || input.length !== params.length) throw new Error("example input malformed");
    const ex = { input, expected: runCase(fn, input) };
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
    solution: c.solution.trim(),
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
    const raw = await callOllama(buildCrossSolvePrompt(problem), { temperature, top_p: 0.9, num_predict: 4096 });
    const result = crossCheck(problem, parseCrossSolution(extractJson(raw)));
    if (result.ok) {
      log(`  cross-check: independent solution agrees on ${total} inputs`);
      return;
    }
    last = result;
    log(`  cross-check: ${result.failures.length}/${total} inputs disagree (temperature ${temperature})`);
  }
  throw new Error(`cross-check: an independent solution written from the statement disagrees with the reference solution. ${last.failures[0]}. Either the statement is ambiguous or the solution does not implement it`);
}

/** Second model pass: grade the real difficulty. Returns the judgement. */
export async function judgeProblem(problem) {
  const raw = await callOllama(buildJudgePrompt(problem), { temperature: 0, num_predict: 512 });
  return parseJudgement(extractJson(raw));
}

async function generateOne({ topic, difficulty, existing }) {
  const existingIds = new Set(existing.map((p) => p.id));
  const temperatures = [0.7, 0.9, 0.5, 1.0];
  let feedback = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const temperature = temperatures[attempt % temperatures.length];
    console.log(`  attempt ${attempt + 1}/${MAX_ATTEMPTS} (temperature ${temperature})`);
    try {
      const prompt = buildPrompt({ topic, difficulty, existing, feedback });
      const raw = await callOllama(prompt, { temperature, top_p: 0.9, num_predict: 4096 });
      const candidate = extractJson(raw);
      const built = buildProblem(candidate, { existingIds, source: `ollama/${MODEL}` });

      try {
        await crossVerify(built, console.log);
      } catch (e) {
        feedback = e.message;
        throw e;
      }

      const judgement = await judgeProblem(built);
      console.log(`  judge: ${judgement.difficulty} (${judgement.algorithm})`);
      const outcome = reconcileDifficulty(built, judgement);
      if (outcome.action === "reject") {
        feedback = outcome.reason;
        throw new Error(`difficulty: ${outcome.reason}`);
      }
      if (outcome.action === "relabel") console.log(`  relabeled ${built.difficulty} -> ${outcome.problem.difficulty}`);
      outcome.problem.judge.crossChecked = true;
      return outcome.problem;
    } catch (e) {
      console.log(`  rejected: ${e.message}`);
    }
  }
  return null;
}

async function main() {
  const existing = await existingProblems();
  let written = 0;
  for (let i = 0; i < COUNT; i++) {
    const topic = process.env.TOPIC?.trim() || pick(TOPICS);
    const difficulty = DIFFICULTIES.includes(process.env.DIFFICULTY) ? process.env.DIFFICULTY : pick(["easy", "medium", "medium", "hard"]);
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
