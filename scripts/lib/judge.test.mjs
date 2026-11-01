import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJudgePrompt, crossCheck, parseJudgement, reconcileDifficulty } from "./judge.mjs";
import { HARD_ARCHETYPES, archetypesForTopic, findArchetype, pickArchetype, servesTopic } from "./archetypes.mjs";

const problem = {
  title: "t",
  difficulty: "hard",
  functionName: "f",
  params: [{ name: "nums", type: "number[]" }],
  returnType: "number",
  statement: "s",
  solution: "function f(nums) { return 0; }",
  judge: { archetype: "dp-lis-nlogn", performance: { solutionMs: 10 } },
};

test("judge prompt asks for the technique check only when one is required", () => {
  assert.doesNotMatch(buildJudgePrompt(problem), /usesTechnique/);
  const withTechnique = buildJudgePrompt(problem, { technique: "interval DP" });
  assert.match(withTechnique, /Required technique: interval DP/);
  assert.match(withTechnique, /"usesTechnique": true\|false/);
});

test("parseJudgement reads usesTechnique as a boolean when present", () => {
  assert.equal(parseJudgement({ difficulty: "hard", usesTechnique: "false" }).usesTechnique, false);
  assert.equal(parseJudgement({ difficulty: "Hard", usesTechnique: true }).usesTechnique, true);
  assert.equal(parseJudgement({ difficulty: "easy" }).usesTechnique, undefined);
});

test("objective evidence keeps the hard label over the judge's opinion", () => {
  const out = reconcileDifficulty(problem, { difficulty: "medium", algorithm: "a", reason: "r", usesTechnique: true }, { objective: true });
  assert.equal(out.action, "keep");
  assert.equal(out.problem.difficulty, "hard");
  assert.equal(out.problem.judge.opinion, "medium");
  assert.equal(out.problem.judge.usesTechnique, true);
  assert.equal(out.problem.judge.archetype, "dp-lis-nlogn", "existing judge fields survive");
});

test("objective evidence still rejects when the technique is not implemented", () => {
  const out = reconcileDifficulty(problem, { difficulty: "hard", algorithm: "a", reason: "single loop", usesTechnique: false }, { objective: true });
  assert.equal(out.action, "reject");
  assert.match(out.reason, /required technique/);
});

test("without objective evidence the old two-level rule applies", () => {
  assert.equal(reconcileDifficulty(problem, { difficulty: "easy", algorithm: "", reason: "" }).action, "reject");
  assert.equal(reconcileDifficulty(problem, { difficulty: "medium", algorithm: "", reason: "" }).action, "relabel");
  assert.equal(reconcileDifficulty({ ...problem, difficulty: "easy" }, { difficulty: "easy", algorithm: "", reason: "" }).action, "keep");
});

test("archetypes are well-formed and cover every scripted topic word or fall back", () => {
  const keys = new Set();
  for (const a of HARD_ARCHETYPES) {
    assert.ok(!keys.has(a.key), `duplicate key ${a.key}`);
    keys.add(a.key);
    for (const f of ["technique", "large", "brute"]) assert.ok(a[f]?.length > 20, `${a.key}.${f}`);
    assert.ok(a.topics.length >= 1);
  }
  assert.ok(archetypesForTopic("dynamic-programming").length >= 5);
  assert.ok(archetypesForTopic("backend-simulation (rate limiter, LRU cache)").length >= 1);
  assert.equal(archetypesForTopic("no-such-topic").length, 0);
});

test("pickArchetype prefers the topic and skips used keys, then falls back", () => {
  const dp = archetypesForTopic("dynamic-programming").map((a) => a.key);
  const first = pickArchetype("dynamic-programming", [], () => 0);
  assert.ok(dp.includes(first.key));
  assert.ok(servesTopic(first, "dynamic-programming"));
  const second = pickArchetype("dynamic-programming", [first.key], () => 0);
  assert.notEqual(second.key, first.key);
  const exhausted = pickArchetype("dynamic-programming", dp, () => 0);
  assert.ok(dp.includes(exhausted.key), "topic pool reused once exhausted");
  const fallback = pickArchetype("no-such-topic", [], () => 0.5);
  assert.ok(findArchetype(fallback.key));
  assert.equal(servesTopic(fallback, "no-such-topic"), false);
});

test("crossCheck ignores inputs where the independent solution times out but needs 6 agreements", () => {
  const problem = {
    functionName: "twice", examples: [{ input: [1], expected: 2 }],
    tests: [2, 3, 4, 5, 6, 7].map((n) => ({ input: [n], expected: n * 2 })).concat([{ input: [10 ** 9], expected: 2 * 10 ** 9 }]),
  };
  const naive = "function twice(n) { if (n > 1000) { while (true) {} } return n * 2; }";
  const r = crossCheck(problem, naive);
  assert.equal(r.ok, true, r.failures.join("; "));
  assert.equal(r.timeouts, 1);
  assert.equal(r.agreements, 7);
  const tooFew = crossCheck({ ...problem, tests: problem.tests.slice(0, 2) }, naive);
  assert.equal(tooFew.ok, false);
  assert.match(tooFew.failures[0], /finished only 3 input/);
  const wrong = crossCheck(problem, "function twice(n) { return n + n + (n === 3 ? 1 : 0); }");
  assert.equal(wrong.ok, false);
  assert.match(wrong.failures[0], /input \[3\]/);
});
