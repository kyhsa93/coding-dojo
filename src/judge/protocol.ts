import type { JsonValue, JudgeValue, Language, RunFailure } from "../lib/types";

/**
 * Main thread → worker. A worker gets a run only after it has reported its runtime ready, and only one at a time,
 * so a run is either waiting on the main thread (cheap to drop) or executing in the worker (stopped by terminate).
 * Every run carries a fresh random `id` that each reply echoes; replies with any other id are ignored.
 *
 * The worker never sees expected values: it returns what the submission produced and the main thread compares,
 * so code that patches `Math` or `Array.prototype` inside the worker cannot turn a wrong answer into a pass.
 */
export interface RunMessage {
  kind: "run";
  id: string;
  language: Language;
  code: string;
  functionName: string;
  inputs: JsonValue[][];
}

export type TestOutcome = { index: number; durationMs: number } & ({ ok: true; actual: JudgeValue } | { ok: false; error: string });

/** Worker → main thread. */
export type WorkerMessage =
  /** Startup progress of the language runtime (Pyodide for Python; immediate for JavaScript). */
  | { kind: "runtime"; state: "loading" }
  | { kind: "runtime"; state: "ready" }
  | { kind: "runtime"; state: "failed"; error: string }
  | { id: string; kind: "test"; outcome: TestOutcome }
  | { id: string; kind: "done"; stdout: string }
  /** Syntax error, top-level exception or missing function: no test ran. */
  | { id: string; kind: "failed"; failure: RunFailure; stdout: string };

export type Post = (msg: WorkerMessage) => void;
