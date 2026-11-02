// The judge end to end for JavaScript and TypeScript: real worker threads running the real runner, so infinite
// loops, termination and overlapping runs behave as they do in the browser. Python needs Pyodide and is covered
// by the browser check instead.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { Worker } from "node:worker_threads";
import type { WorkerMessage } from "../src/judge/protocol.ts";
import { createJudge, type WorkerLike } from "../src/judge/session.ts";
import type { Problem } from "../src/lib/types.ts";

const live = new Set<Worker>();
function spawn(): WorkerLike {
  const w = new Worker(new URL("./helpers/node-js-worker.ts", import.meta.url));
  live.add(w);
  w.on("exit", () => live.delete(w));
  return {
    post: (m) => w.postMessage(m),
    terminate: () => void w.terminate(),
    listen(onMessage, onError) {
      w.on("message", (m: WorkerMessage) => onMessage(m));
      w.on("error", (e) => onError(e.message));
    },
  };
}
after(() => Promise.all([...live].map((w) => w.terminate())));

const judge = createJudge({ spawn, loadTimeoutMs: () => 15_000 });
const problem: Problem = JSON.parse(readFileSync(new URL("../problems/two-sum.json", import.meta.url), "utf-8"));
const base = { functionName: problem.functionName, tests: problem.tests, timeoutMs: 3000 };

describe("JavaScript / TypeScript judge", () => {
  it("passes the reference solution", async () => {
    const r = await judge.run({ ...base, language: "javascript", code: problem.solution });
    assert.equal(r.failure, undefined);
    assert.ok(r.results.length === problem.tests.length && r.results.every((x) => x.status === "pass"));
  });

  it("passes a TypeScript solution with exports and types", async () => {
    const code = `export function ${problem.functionName}(nums: number[], target: number): number[] {\n  const seen = new Map<number, number>();\n  for (let i = 0; i < nums.length; i++) {\n    const j = seen.get(target - nums[i]);\n    if (j !== undefined) return [j, i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}`;
    const r = await judge.run({ ...base, language: "typescript", code });
    assert.deepEqual([...new Set(r.results.map((x) => x.status))], ["pass"]);
  });

  it("marks a wrong answer as fail", async () => {
    const r = await judge.run({ ...base, language: "javascript", code: `function ${problem.functionName}() { return [0, 0] }` });
    assert.ok(r.results.some((x) => x.status === "fail"));
  });

  it("reports syntax errors as such", async () => {
    const r = await judge.run({ ...base, language: "typescript", code: `function ${problem.functionName}(a: number[] {` });
    assert.equal(r.failure?.kind, "syntax");
  });

  it("stops an infinite loop at the time limit and skips the rest", async () => {
    const code = `function ${problem.functionName}(nums) { if (nums.length > 2) for (;;) {} return [0, 1] }`;
    const started = Date.now();
    const r = await judge.run({ ...base, language: "javascript", code, timeoutMs: 300 });
    assert.ok(Date.now() - started < 3000);
    const statuses = r.results.map((x) => x.status);
    assert.ok(statuses.includes("timeout"));
    assert.equal(statuses.length, problem.tests.length);
    assert.ok(statuses.slice(statuses.indexOf("timeout") + 1).every((s) => s === "skipped"));
  });

  it("keeps concurrent runs apart", async () => {
    const slow = `function ${problem.functionName}() { const end = Date.now() + 50; while (Date.now() < end); return [1, 2] }`;
    const [a, b] = await Promise.all([
      judge.run({ ...base, language: "javascript", code: slow }),
      judge.run({ ...base, language: "javascript", code: problem.solution }),
    ]);
    assert.ok(a.results.every((x) => x.status !== "pass" || JSON.stringify(x.actual) === "[1,2]"));
    assert.ok(b.results.every((x) => x.status === "pass"));
  });

  it("does not let one run's globals leak into the next", async () => {
    await judge.run({ ...base, language: "javascript", code: `Array.prototype.includes = () => true; globalThis.leak = 1; function ${problem.functionName}() { return [] }` });
    const r = await judge.run({ ...base, language: "javascript", code: `function ${problem.functionName}() { return [typeof leak, [1].includes(2)] }` });
    assert.deepEqual(r.results[0].actual, ["undefined", false]);
  });

  it("cancels a running submission", async () => {
    const controller = new AbortController();
    const p = judge.run({ ...base, language: "javascript", code: `function ${problem.functionName}() { for (;;) {} }`, timeoutMs: 60_000 }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    const r = await p;
    assert.equal(r.cancelled, true);
    assert.ok(r.results.every((x) => x.status === "skipped"));
  });
});
