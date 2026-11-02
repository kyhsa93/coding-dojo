/// <reference lib="webworker" />

/**
 * Browser APIs a solution never needs but could misuse: the network, storage shared with every other site under
 * kyhsa93.github.io (IndexedDB, Cache Storage, OPFS), and nested workers that would start with fresh globals.
 *
 * This is defence in depth, not the boundary. Deleting globals cannot stop `import("https://…")`, and code can
 * still patch the worker's own globals. The page's Content-Security-Policy, which the blob-started worker
 * inherits, is what limits network access; README "실행 환경과 보안" lists what neither covers.
 */
const BLOCKED_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebSocketStream",
  "WebTransport",
  "EventSource",
  "importScripts",
  "indexedDB",
  "caches",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "RTCPeerConnection",
  // Chromium's legacy sandboxed file system persists per origin and would carry data from one run to the next.
  "webkitRequestFileSystem",
  "webkitRequestFileSystemSync",
  "webkitResolveLocalFileSystemURL",
  "webkitResolveLocalFileSystemSyncURL",
];

function remove(target: object, name: string) {
  // Web APIs live on the prototype chain (WorkerGlobalScope.prototype and friends), not on the global itself.
  for (let o: object | null = target; o; o = Object.getPrototypeOf(o)) {
    if (Object.getOwnPropertyDescriptor(o, name)?.configurable) Reflect.deleteProperty(o, name);
  }
}

export function lockDown() {
  for (const name of BLOCKED_GLOBALS) remove(globalThis, name);
  if (typeof navigator !== "undefined") {
    remove(navigator, "storage");
    remove(navigator, "locks");
    remove(navigator, "storageBuckets");
  }
  // Replies go through a reference taken before this runs; submitted code cannot post look-alike messages.
  remove(globalThis, "postMessage");
}
