/**
 * Generates coding problems with a local Ollama model and writes validated JSON files into problems/.
 *
 * The model proposes the statement, a JavaScript reference solution and test INPUTS only.
 * Expected outputs are always computed by running the reference solution, so a test can never
 * disagree with the solution. A problem is written only when every check in verifyCandidate passes.
 *
 * Env: OLLAMA_URL, OLLAMA_MODEL, OLLAMA_THINK=false, COUNT, TOPIC, DIFFICULTY, MAX_ATTEMPTS
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DIFFICULTIES, LANGUAGES, loadSolution, runCase, starterFor, validateShape, verifySolution } from "./lib/problem-utils.mjs";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:14b";
const DISABLE_THINKING = process.env.OLLAMA_THINK === "false";
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

function buildPrompt({ topic, difficulty, existing }) {
  const avoid = existing.map((p) => `${p.id} (${p.title})`).join(", ") || "(none)";
  return `You are writing one coding interview problem for a practice site. Output ONLY a JSON object, no prose, no markdown fences.

Constraints:
- Topic: ${topic}
- Difficulty: ${difficulty}
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

async function callOllama(prompt, options) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: true,
      format: "json",
      options,
      ...(DISABLE_THINKING ? { think: false } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const chunk = JSON.parse(trimmed);
    if (chunk.error) throw new Error(`ollama error: ${chunk.error}`);
    if (typeof chunk.response === "string") text += chunk.response;
  };
  for await (const bytes of res.body) {
    pending += decoder.decode(bytes, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  consume(pending);
  if (!text) throw new Error("ollama 응답이 비어 있음");
  return text;
}

export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("JSON 객체를 찾을 수 없음");
  return JSON.parse(body.slice(start, end + 1));
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

async function generateOne({ topic, difficulty, existing }) {
  const existingIds = new Set(existing.map((p) => p.id));
  const prompt = buildPrompt({ topic, difficulty, existing });
  const temperatures = [0.7, 0.9, 0.5, 1.0];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const temperature = temperatures[attempt % temperatures.length];
    console.log(`  attempt ${attempt + 1}/${MAX_ATTEMPTS} (temperature ${temperature})`);
    try {
      const raw = await callOllama(prompt, { temperature, top_p: 0.9, num_predict: 4096 });
      const candidate = extractJson(raw);
      const problem = buildProblem(candidate, { existingIds, source: `ollama/${MODEL}` });
      return problem;
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
