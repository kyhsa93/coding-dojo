import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { createJudge, type JudgeRequest } from "../src/judge/session.ts";
import type { Language, RunResponse } from "../src/lib/types.ts";
import { FakeWorker } from "./helpers/fake-worker.ts";

let clock = 0;
let spawned: FakeWorker[] = [];
let ids = 0;

function judge() {
  return createJudge({
    spawn: (language: Language) => {
      const w = new FakeWorker(language);
      spawned.push(w);
      return w;
    },
    loadTimeoutMs: (language) => (language === "python" ? 120_000 : 15_000),
    newId: () => `run-${++ids}`,
    now: () => clock,
  });
}

function request(language: Language, n = 2, extra: Partial<JudgeRequest> = {}): JudgeRequest {
  return { language, code: "", functionName: "f", tests: Array.from({ length: n }, (_, i) => ({ input: [i], expected: i })), timeoutMs: 3000, ...extra };
}

function tick(ms: number) {
  clock += ms;
  mock.timers.tick(ms);
}

/** Resolves to the response, or "pending" if the promise has not settled yet. */
async function state(p: Promise<RunResponse>): Promise<RunResponse | "pending"> {
  return Promise.race([p, new Promise<"pending">((r) => setImmediate(() => r("pending")))]);
}

beforeEach(() => {
  clock = 0;
  spawned = [];
  ids = 0;
  mock.timers.enable({ apis: ["setTimeout"] });
});
afterEach(() => mock.timers.reset());

describe("request/response mapping", () => {
  it("grades on the main thread and resolves once", async () => {
    const j = judge();
    let events = 0;
    const p = j.run(request("javascript"), { onEvent: () => events++ });
    const w = spawned[0];
    w.ready();
    assert.deepEqual(w.last().inputs, [[0], [1]]);
    assert.equal("tests" in w.last(), false, "expected values never reach the worker");
    w.answer([0, 5], "out");
    const r = await p;
    assert.deepEqual(
      r.results.map((x) => x.status),
      ["pass", "fail"],
    );
    assert.equal(r.results[1].actual, 5);
    assert.equal(r.stdout, "out");
    assert.equal(w.terminated, true, "JavaScript workers are single-use");
    w.answer([0, 1]); // late duplicate is ignored
    assert.equal(events, 3); // running + 2 tests
  });

  it("ignores messages that carry another run's id", async () => {
    const j = judge();
    const p = j.run(request("javascript", 1));
    const w = spawned[0];
    w.ready();
    w.reply({ id: "forged", kind: "test", outcome: { index: 0, ok: true, actual: 0, durationMs: 0 } });
    w.reply({ id: "forged", kind: "done", stdout: "" });
    assert.equal(await state(p), "pending");
    w.answer([7]);
    assert.equal((await p).results[0].status, "fail");
  });

  it("ignores results out of order", async () => {
    const j = judge();
    const p = j.run(request("javascript", 2));
    const w = spawned[0];
    w.ready();
    const { id } = w.last();
    w.reply({ id, kind: "test", outcome: { index: 1, ok: true, actual: 1, durationMs: 0 } });
    w.reply({ id, kind: "done", stdout: "" });
    assert.equal((await p).results.length, 0);
  });

  it("runs JavaScript submissions side by side in separate workers", async () => {
    const j = judge();
    const a = j.run(request("javascript", 1));
    const b = j.run(request("typescript", 1));
    assert.equal(spawned.length, 2);
    spawned[1].ready();
    spawned[0].ready();
    spawned[1].answer([0]);
    spawned[0].answer([9]);
    assert.equal((await a).results[0].status, "fail");
    assert.equal((await b).results[0].status, "pass");
  });

  it("runs consecutive Python submissions on one worker", async () => {
    const j = judge();
    const a = j.run(request("python", 1));
    const w = spawned[0];
    w.ready();
    w.answer([0]);
    await a;
    const b = j.run(request("python", 1));
    assert.equal(spawned.length, 1);
    assert.equal(w.sent.length, 2);
    w.answer([0]);
    assert.equal((await b).results[0].status, "pass");
    assert.equal(w.terminated, false);
  });

  it("lets a newer Python run replace an executing one", async () => {
    const j = judge();
    const a = j.run(request("python", 2));
    spawned[0].ready();
    const b = j.run(request("python", 1));
    const first = await a;
    assert.equal(first.cancelled, true);
    assert.equal(spawned[0].terminated, true, "the only way to stop running code");
    assert.equal(spawned.length, 2);
    spawned[1].ready();
    spawned[1].answer([0]);
    assert.equal((await b).results[0].status, "pass");
  });
});

describe("cancellation", () => {
  it("keeps the Python download when a waiting run is cancelled", async () => {
    const j = judge();
    j.warmUp("python");
    const controller = new AbortController();
    const events: string[] = [];
    const p = j.run(request("python", 2), { signal: controller.signal, onEvent: (e) => events.push(e.kind) });
    spawned[0].reply({ kind: "runtime", state: "loading" });
    controller.abort();
    const r = await p;
    assert.equal(r.cancelled, true);
    assert.deepEqual(
      r.results.map((x) => x.status),
      ["skipped", "skipped"],
    );
    assert.equal(spawned[0].terminated, false);
    assert.equal(spawned[0].sent.length, 0, "a cancelled run never reaches the worker");
    assert.deepEqual(events, ["loading"]);
    // The next run reuses the same download.
    const q = j.run(request("python", 1));
    spawned[0].ready();
    spawned[0].answer([0]);
    assert.equal((await q).results[0].status, "pass");
    assert.equal(spawned.length, 1);
  });

  it("terminates the worker when an executing run is cancelled and keeps finished results", async () => {
    const j = judge();
    const controller = new AbortController();
    const p = j.run(request("python", 3), { signal: controller.signal });
    const w = spawned[0];
    w.ready();
    w.reply({ id: w.last().id, kind: "test", outcome: { index: 0, ok: true, actual: 0, durationMs: 1 } });
    controller.abort();
    const r = await p;
    assert.deepEqual(
      r.results.map((x) => x.status),
      ["pass", "skipped", "skipped"],
    );
    assert.equal(w.terminated, true);
    j.run(request("python", 1));
    assert.equal(spawned.length, 2, "a fresh worker replaces the terminated one");
  });

  it("resolves at once when the signal is already aborted", async () => {
    const j = judge();
    const controller = new AbortController();
    controller.abort();
    const r = await j.run(request("javascript", 1), { signal: controller.signal });
    assert.equal(r.cancelled, true);
    assert.equal(spawned.length, 0);
  });
});

describe("time limits", () => {
  it("times out the running test, skips the rest and discards the worker", async () => {
    const j = judge();
    const p = j.run(request("javascript", 3, { timeoutMs: 1000 }));
    const w = spawned[0];
    w.ready();
    tick(400);
    w.reply({ id: w.last().id, kind: "test", outcome: { index: 0, ok: true, actual: 0, durationMs: 400 } });
    tick(999);
    assert.equal(await state(p), "pending", "each test gets its own full limit");
    tick(1);
    const r = await p;
    assert.deepEqual(
      r.results.map((x) => x.status),
      ["pass", "timeout", "skipped"],
    );
    assert.match(r.results[1].error!, /제한 시간 1초/);
    assert.equal(r.results[1].durationMs, 1000);
    assert.equal(w.terminated, true);
  });

  it("stops at the total limit even when every test is within its own", async () => {
    const j = judge();
    const p = j.run(request("javascript", 5, { timeoutMs: 1000, totalTimeoutMs: 2500 }));
    const w = spawned[0];
    w.ready();
    const { id } = w.last();
    for (let i = 0; i < 3; i++) {
      tick(900);
      w.reply({ id, kind: "test", outcome: { index: i, ok: true, actual: i, durationMs: 900 } });
    }
    const r = await p;
    assert.deepEqual(
      r.results.map((x) => x.status),
      ["pass", "pass", "timeout", "skipped", "skipped"],
    );
    assert.match(r.results[2].error!, /전체 제한 시간 2.5초/);
  });

  it("does not count the Python download against the test limit", async () => {
    const j = judge();
    const p = j.run(request("python", 1, { timeoutMs: 1000 }));
    const w = spawned[0];
    w.reply({ kind: "runtime", state: "loading" });
    tick(30_000);
    assert.equal(await state(p), "pending");
    w.ready();
    tick(200);
    w.answer([0]);
    const r = await p;
    assert.equal(r.results[0].status, "pass");
    assert.equal(r.loadMs, 30_000);
    assert.equal(r.runMs, 200);
  });

  it("fails as load and drops the worker when the runtime never becomes ready", async () => {
    const j = judge();
    const p = j.run(request("python", 1));
    tick(120_000);
    const r = await p;
    assert.equal(r.failure?.kind, "load");
    assert.match(r.failure!.message, /120초/);
    assert.equal(spawned[0].terminated, true);
  });
});

describe("runtime failures", () => {
  it("retries the Python runtime from a fresh worker after a failed download", async () => {
    const j = judge();
    const p = j.run(request("python", 1));
    spawned[0].reply({ kind: "runtime", state: "failed", error: "CDN unreachable" });
    const r = await p;
    assert.deepEqual(r.failure, { kind: "load", message: "CDN unreachable" });
    assert.equal(spawned[0].terminated, true);
    const q = j.run(request("python", 1));
    assert.equal(spawned.length, 2);
    spawned[1].ready();
    spawned[1].answer([0]);
    assert.equal((await q).results[0].status, "pass");
  });

  it("replaces a Python worker that reports a broken runtime after a run", async () => {
    const j = judge();
    const p = j.run(request("python", 1));
    spawned[0].ready();
    spawned[0].answer([0]);
    spawned[0].reply({ kind: "runtime", state: "failed", error: "fatal" });
    await p;
    assert.equal(spawned[0].terminated, true);
    j.run(request("python", 1));
    assert.equal(spawned.length, 2);
  });

  it("treats a worker error before startup as a load failure", async () => {
    const j = judge();
    const p = j.run(request("javascript", 1));
    spawned[0].fail("404");
    const r = await p;
    assert.equal(r.failure?.kind, "load");
    assert.match(r.failure!.message, /404/);
  });

  it("ignores worker errors after startup (stray timers in user code)", async () => {
    const j = judge();
    const p = j.run(request("javascript", 1));
    spawned[0].ready();
    spawned[0].fail("Uncaught Error from setTimeout");
    spawned[0].answer([0]);
    assert.equal((await p).results[0].status, "pass");
  });

  it("passes syntax and top-level failures through", async () => {
    const j = judge();
    const p = j.run(request("javascript", 2));
    spawned[0].ready();
    spawned[0].reply({ id: spawned[0].last().id, kind: "failed", failure: { kind: "syntax", message: "Unexpected token" }, stdout: "" });
    const r = await p;
    assert.deepEqual(r.failure, { kind: "syntax", message: "Unexpected token" });
    assert.equal(r.results.length, 0);
  });
});

describe("comparison options", () => {
  it("applies the problem's tolerance", async () => {
    const j = judge();
    const req = { ...request("javascript", 1), tests: [{ input: [0], expected: 0.5 }], tolerance: 0.01 };
    const p = j.run(req);
    spawned[0].ready();
    spawned[0].answer([0.505]);
    assert.equal((await p).results[0].status, "pass");
  });
});
