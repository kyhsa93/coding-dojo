import type { RunMessage, WorkerMessage } from "../../src/judge/protocol.ts";
import type { WorkerLike } from "../../src/judge/session.ts";
import type { Language } from "../../src/lib/types.ts";

/** A worker the test drives by hand: it records what it was sent and replies only when told to. */
export class FakeWorker implements WorkerLike {
  readonly language: Language;
  readonly sent: RunMessage[] = [];
  terminated = false;
  private onMessage?: (msg: WorkerMessage) => void;
  private onError?: (message: string) => void;

  constructor(language: Language) {
    this.language = language;
  }

  post(msg: RunMessage) {
    if (this.terminated) throw new Error("post after terminate");
    this.sent.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  listen(onMessage: (msg: WorkerMessage) => void, onError: (message: string) => void) {
    this.onMessage = onMessage;
    this.onError = onError;
  }

  reply(msg: WorkerMessage) {
    if (!this.terminated) this.onMessage?.(msg);
  }
  fail(message: string) {
    this.onError?.(message);
  }
  ready() {
    this.reply({ kind: "runtime", state: "ready" });
  }
  last(): RunMessage {
    const m = this.sent.at(-1);
    if (!m) throw new Error("nothing sent");
    return m;
  }
  /** Answers the last run with the given return values, then done. */
  answer(values: unknown[], stdout = "") {
    const { id } = this.last();
    values.forEach((actual, index) => this.reply({ id, kind: "test", outcome: { index, ok: true, actual: actual as never, durationMs: 1 } }));
    this.reply({ id, kind: "done", stdout });
  }
}
