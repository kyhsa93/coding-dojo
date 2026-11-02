/// <reference lib="webworker" />
import { lockDown } from "./lockdown.ts";
import type { Post, RunMessage } from "./protocol";
import { runJs } from "./runner.ts";

// One worker per run, so whatever a submission does to the global scope dies with it.
const post: Post = self.postMessage.bind(self);
lockDown();
self.addEventListener("message", (ev: MessageEvent<RunMessage>) => {
  if (ev.data?.kind === "run") runJs(ev.data, post);
});
post({ kind: "runtime", state: "ready" });
