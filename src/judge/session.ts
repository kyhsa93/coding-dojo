import { deepEqual } from "../lib/deepEqual.ts";
import type { Language, RunFailure, RunResponse, TestCase, TestResult } from "../lib/types";
import type { RunMessage, TestOutcome, WorkerMessage } from "./protocol";

/** The slice of `Worker` the judge uses, so tests can drive it without a browser. */
export interface WorkerLike {
  post(msg: RunMessage): void;
  terminate(): void;
  listen(onMessage: (msg: WorkerMessage) => void, onError: (message: string) => void): void;
}

export interface JudgeRequest {
  language: Language;
  code: string;
  functionName: string;
  tests: TestCase[];
  /** Limit for each test, counted from the previous result (the first one also covers top-level code). */
  timeoutMs: number;
  /** Limit for the whole run once the runtime is ready. */
  totalTimeoutMs?: number;
  tolerance?: number;
}

export type RunEvent =
  /** Waiting for the language runtime to download and start (Python's first run). */
  | { kind: "loading" }
  /** The submission is executing; the judged clock starts now. */
  | { kind: "running" }
  | { kind: "test"; result: TestResult };

export interface RunOptions {
  /** Aborting stops the run: a waiting run is dropped, an executing one has its worker terminated. */
  signal?: AbortSignal;
  onEvent?: (e: RunEvent) => void;
}

export interface JudgeConfig {
  spawn(language: Language): WorkerLike;
  /** How long a run may wait for the runtime before it fails as `load`. */
  loadTimeoutMs(language: Language): number;
  newId?(): string;
  now?(): number;
}

type HostState = "loading" | "ready" | "dead";

/**
 * One worker. It accepts a run only after reporting its runtime ready and runs one at a time. Python keeps its
 * host between runs (Pyodide takes seconds to start); JavaScript gets a fresh host per run, so nothing a
 * submission does to the global scope can leak into the next one.
 */
class Host {
  state: HostState = "loading";
  /** The worker said it is downloading a runtime, as opposed to merely starting up. */
  downloading = false;
  waiting?: Run;
  running?: Run;

  readonly language: Language;
  private readonly worker: WorkerLike;
  private readonly onDead: (host: Host) => void;

  constructor(language: Language, worker: WorkerLike, onDead: (host: Host) => void) {
    this.language = language;
    this.worker = worker;
    this.onDead = onDead;
    worker.listen(
      (msg) => this.receive(msg),
      (message) => this.crash(message),
    );
  }

  private receive(msg: WorkerMessage) {
    if (this.state === "dead") return;
    if (msg.kind === "runtime") {
      if (msg.state === "loading") {
        this.downloading = true;
        this.waiting?.emit({ kind: "loading" });
      } else if (msg.state === "ready") {
        this.state = "ready";
        const next = this.waiting;
        this.waiting = undefined;
        if (next) this.dispatch(next);
      } else {
        // Also reaches a run dispatched just before a broken runtime reported itself.
        const runs = [this.waiting, this.running];
        this.kill();
        for (const run of runs) run?.fail({ kind: "load", message: msg.error });
      }
      return;
    }
    // Anything not addressed to the executing run is stale or forged.
    if (this.running && msg.id === this.running.id) this.running.receive(msg);
  }

  /** Errors after startup come from stray timers in user code and are not fatal; before it, the worker is broken. */
  private crash(message: string) {
    if (this.state !== "loading") return;
    const run = this.waiting;
    this.kill();
    run?.fail({ kind: "load", message: `채점 환경을 시작하지 못했습니다: ${message}` });
  }

  enqueue(run: Run) {
    if (this.state === "ready" && !this.running) this.dispatch(run);
    else {
      this.waiting = run;
      if (this.downloading) run.emit({ kind: "loading" });
    }
  }

  private dispatch(run: Run) {
    this.running = run;
    run.start();
    this.worker.post(run.message);
  }

  /** Forgets a run that settled; the worker stays usable only if the run ended on its own. */
  release(run: Run, reusable: boolean) {
    if (this.waiting === run) this.waiting = undefined;
    if (this.running === run) this.running = undefined;
    if (!reusable || this.language !== "python") this.kill();
  }

  kill() {
    if (this.state === "dead") return;
    this.state = "dead";
    this.worker.terminate();
    this.onDead(this);
  }
}

class Run {
  readonly id: string;
  readonly message: RunMessage;
  private readonly results: TestResult[] = [];
  private settled = false;
  private readonly startedAt: number;
  private readyAt?: number;
  private testTimer?: ReturnType<typeof setTimeout>;
  private totalTimer?: ReturnType<typeof setTimeout>;
  private loadTimer?: ReturnType<typeof setTimeout>;
  private lastMark = 0;
  host?: Host;
  private readonly req: JudgeRequest;
  private readonly opts: RunOptions;
  private readonly cfg: Required<JudgeConfig>;
  private readonly resolve: (r: RunResponse) => void;

  constructor(req: JudgeRequest, opts: RunOptions, cfg: Required<JudgeConfig>, resolve: (r: RunResponse) => void) {
    this.req = req;
    this.opts = opts;
    this.cfg = cfg;
    this.resolve = resolve;
    this.id = cfg.newId();
    this.startedAt = cfg.now();
    this.message = { kind: "run", id: this.id, language: req.language, code: req.code, functionName: req.functionName, inputs: req.tests.map((t) => t.input) };
  }

  emit(e: RunEvent) {
    if (!this.settled) this.opts.onEvent?.(e);
  }

  /** Called when the run waits for a runtime. */
  wait(host: Host) {
    this.host = host;
    const ms = this.cfg.loadTimeoutMs(this.req.language);
    this.loadTimer = setTimeout(() => {
      // A stuck download is only retried from a fresh worker.
      this.host?.kill();
      this.fail({ kind: "load", message: `실행 환경을 ${Math.round(ms / 1000)}초 안에 준비하지 못했습니다. 네트워크를 확인한 뒤 다시 실행해 주세요.` });
    }, ms);
    host.enqueue(this);
  }

  start() {
    clearTimeout(this.loadTimer);
    this.readyAt = this.cfg.now();
    this.emit({ kind: "running" });
    this.armTest();
    if (this.req.totalTimeoutMs) {
      const ms = this.req.totalTimeoutMs;
      this.totalTimer = setTimeout(() => this.stopOnTime(`전체 제한 시간 ${seconds(ms)}초를 넘겨 중단했습니다`), ms);
    }
  }

  private armTest() {
    clearTimeout(this.testTimer);
    this.lastMark = this.cfg.now();
    const ms = this.req.timeoutMs;
    this.testTimer = setTimeout(() => this.stopOnTime(`제한 시간 ${seconds(ms)}초를 넘겼습니다`), ms);
  }

  receive(msg: Exclude<WorkerMessage, { kind: "runtime" }>) {
    if (msg.kind === "test") {
      const result = this.grade(msg.outcome);
      if (!result) return;
      this.results.push(result);
      this.emit({ kind: "test", result });
      this.armTest();
    } else if (msg.kind === "done") {
      this.finish({ results: this.results, stdout: msg.stdout }, true);
    } else {
      this.finish({ results: [], stdout: msg.stdout, failure: msg.failure }, true);
    }
  }

  private grade(o: TestOutcome): TestResult | undefined {
    const test = this.req.tests[o.index];
    if (!test || o.index !== this.results.length) return undefined;
    if (!o.ok) return { index: o.index, status: "error", expected: test.expected, error: o.error, durationMs: o.durationMs };
    const pass = deepEqual(o.actual, test.expected, { tolerance: this.req.tolerance });
    return { index: o.index, status: pass ? "pass" : "fail", expected: test.expected, actual: o.actual, durationMs: o.durationMs };
  }

  /** The submission ran too long: only terminating the worker stops it. */
  private stopOnTime(error: string) {
    const index = this.results.length;
    const test = this.req.tests[index];
    if (test) this.results.push({ index, status: "timeout", expected: test.expected, error, durationMs: this.cfg.now() - this.lastMark });
    this.skipRest("앞 테스트가 시간 초과로 중단되어 실행하지 않았습니다");
    this.finish({ results: this.results, stdout: "" }, false);
  }

  cancel() {
    this.skipRest("실행을 중단해 실행하지 않았습니다");
    // A run still waiting for the runtime has not reached the worker, so the worker (and its download) survives.
    const reusable = this.readyAt === undefined;
    this.finish({ results: this.results, stdout: "", cancelled: true }, reusable);
  }

  fail(failure: RunFailure) {
    this.finish({ results: [], stdout: "", failure }, false);
  }

  private skipRest(reason: string) {
    for (let i = this.results.length; i < this.req.tests.length; i++) {
      this.results.push({ index: i, status: "skipped", expected: this.req.tests[i].expected, error: reason, durationMs: 0 });
    }
  }

  private finish(resp: Omit<RunResponse, "kind">, reusable: boolean) {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.testTimer);
    clearTimeout(this.totalTimer);
    clearTimeout(this.loadTimer);
    this.host?.release(this, reusable);
    const end = this.cfg.now();
    const loadMs = (this.readyAt ?? end) - this.startedAt;
    const runMs = this.readyAt === undefined ? undefined : end - this.readyAt;
    this.resolve({ kind: "result", ...resp, loadMs, runMs });
  }
}

function seconds(ms: number) {
  return Number((ms / 1000).toFixed(1));
}

function randomId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createJudge(config: JudgeConfig) {
  const cfg: Required<JudgeConfig> = { newId: randomId, now: () => performance.now(), ...config };
  let python: Host | undefined;

  function hostFor(language: Language): Host {
    if (language !== "python") return new Host(language, cfg.spawn(language), () => {});
    if (!python) {
      python = new Host("python", cfg.spawn("python"), (dead) => {
        if (python === dead) python = undefined;
      });
    }
    return python;
  }

  return {
    /** Starts the Python runtime download ahead of the first run. JavaScript workers start fast enough per run. */
    warmUp(language: Language) {
      if (language !== "python") return;
      try {
        hostFor("python");
      } catch {
        /* the run itself reports this */
      }
    },

    /**
     * Runs the tests and always resolves exactly once. A newer Python run replaces an unfinished one, which
     * resolves as cancelled.
     */
    run(req: JudgeRequest, opts: RunOptions = {}): Promise<RunResponse> {
      return new Promise((resolve) => {
        const { signal } = opts;
        const onAbort = () => run.cancel();
        const run = new Run(req, opts, cfg, (resp) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(resp);
        });
        if (signal?.aborted) {
          run.cancel();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const host = hostFor(req.language);
          host.waiting?.cancel();
          host.running?.cancel();
          run.wait(host.state === "dead" ? hostFor(req.language) : host);
        } catch (e) {
          // new Worker can throw synchronously (blocked by policy); the promise still has to resolve.
          run.fail({ kind: "load", message: `채점 환경을 시작하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` });
        }
      });
    },
  };
}
