/** Minimal streaming client for Ollama's /api/generate with JSON output. */
export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
export const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:14b";
const DISABLE_THINKING = process.env.OLLAMA_THINK === "false";

/**
 * qwen3 in JSON mode sometimes degenerates into an endless run of whitespace after an array; the
 * grammar allows it, so generation only stops at num_predict, which costs 30+ minutes on a CPU runner
 * and yields a truncated object. Abort as soon as the trailing whitespace run gets this long.
 */
const MAX_TRAILING_WHITESPACE = 200;
/** Same idea for any short unit (`0,0,0,...`, `"a","a",...`): abort once this much of the tail is one unit repeated. */
const REPETITION_WINDOW = 1000;
const MAX_REPEAT_UNIT = 80;
/** Hard wall-clock cap per call: a degenerate run that no detector catches still ends well inside the job limit. */
export const CALL_TIMEOUT_MS = Number(process.env.OLLAMA_CALL_TIMEOUT_MS ?? 20 * 60_000);

/** True when the last REPETITION_WINDOW characters are one unit of at most MAX_REPEAT_UNIT characters repeated. */
export function looksRepetitive(text) {
  if (text.length < REPETITION_WINDOW) return false;
  const tail = text.slice(-REPETITION_WINDOW);
  for (let n = 1; n <= MAX_REPEAT_UNIT; n++) {
    const unit = tail.slice(-n);
    if (unit.repeat(Math.ceil(REPETITION_WINDOW / n)).slice(-REPETITION_WINDOW) === tail) return true;
  }
  return false;
}

const fmtSeconds = (ns) => `${(ns / 1e9).toFixed(0)}s`;

export async function callOllama(prompt, options) {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CALL_TIMEOUT_MS);
  const request = (think) =>
    fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: MODEL, prompt, stream: true, format: "json", options, ...(think ? { think: false } : {}) }),
    });
  let res = await request(DISABLE_THINKING);
  if (!res.ok) {
    // The body names the cause ("model not found", "does not support thinking"), which the status alone hides.
    const body = await res.text().catch(() => "");
    // A model without a thinking mode (qwen2.5-coder) may refuse the flag altogether; it is a no-op there anyway.
    if (DISABLE_THINKING && /think/i.test(body)) res = await request(false);
    if (!res.ok) {
      clearTimeout(timer);
      throw new Error(`ollama http ${res.status}: ${body.slice(0, 300)}`);
    }
  }
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let doneReason = null;
  let degenerated = false;
  let nextRepetitionCheck = REPETITION_WINDOW;
  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const chunk = JSON.parse(trimmed);
    if (chunk.error) throw new Error(`ollama error: ${chunk.error}`);
    if (typeof chunk.response === "string") text += chunk.response;
    if (chunk.done) {
      doneReason = chunk.done_reason ?? "stop";
      if (chunk.eval_count) {
        const tps = (chunk.eval_count / (chunk.eval_duration / 1e9)).toFixed(1);
        console.log(`    ollama: ${chunk.eval_count} tokens in ${fmtSeconds(chunk.eval_duration)} (${tps} tok/s), prompt ${chunk.prompt_eval_count ?? "?"} tokens in ${fmtSeconds(chunk.prompt_eval_duration ?? 0)}`);
      }
    }
    let repetitive = false;
    if (text.length >= nextRepetitionCheck) {
      nextRepetitionCheck = text.length + 50;
      repetitive = looksRepetitive(text);
    }
    if (repetitive || /\s{200,}$/.test(text.slice(-MAX_TRAILING_WHITESPACE - 1))) {
      degenerated = true;
      controller.abort();
    }
  };
  try {
    for await (const bytes of res.body) {
      pending += decoder.decode(bytes, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    consume(pending);
  } catch (e) {
    if (!degenerated && !timedOut) throw e;
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) throw new Error(`ollama 호출이 ${Math.round(CALL_TIMEOUT_MS / 60_000)}분을 넘겨 중단 (${text.length}자 생성, ${Math.round((Date.now() - startedAt) / 1000)}s)`);
  if (degenerated) throw new Error(`ollama 출력이 같은 토막을 반복함 (JSON 생성 퇴화, ${text.trim().length}자에서 중단)`);
  if (doneReason && doneReason !== "stop") throw new Error(`ollama 응답이 잘림 (done_reason=${doneReason}, ${text.length}자)`);
  if (!text) throw new Error("ollama 응답이 비어 있음");
  return text;
}

export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("JSON 객체를 찾을 수 없음");
  const slice = body.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    // Show where the model's output broke so a recurring pattern can be fixed in the prompt.
    const pos = Number(/position (\d+)/.exec(e.message)?.[1] ?? -1);
    const around = pos >= 0 ? slice.slice(Math.max(0, pos - 160), pos + 80) : slice.slice(0, 240);
    const tail = body.trimEnd().slice(-160);
    throw new Error(`${e.message}\n    near: ${JSON.stringify(around)}\n    output ends with: ${JSON.stringify(tail)} (${body.length} chars)`);
  }
}
