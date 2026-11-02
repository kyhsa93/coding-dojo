// worker_threads stand-in for src/judge/js.worker.ts: same runner, Node's message port instead of `self`.
import { parentPort } from "node:worker_threads";
import type { RunMessage } from "../../src/judge/protocol.ts";
import { runJs } from "../../src/judge/runner.ts";

const port = parentPort!;
port.on("message", (msg: RunMessage) => {
  if (msg?.kind === "run") runJs(msg, (m) => port.postMessage(m));
});
port.postMessage({ kind: "runtime", state: "ready" });
