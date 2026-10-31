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

export async function callOllama(prompt, options) {
  const controller = new AbortController();
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: true,
      format: "json",
      options,
      ...(DISABLE_THINKING ? { think: false } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let doneReason = null;
  let degenerated = false;
  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const chunk = JSON.parse(trimmed);
    if (chunk.error) throw new Error(`ollama error: ${chunk.error}`);
    if (typeof chunk.response === "string") text += chunk.response;
    if (chunk.done) doneReason = chunk.done_reason ?? "stop";
    if (/\s{200,}$/.test(text.slice(-MAX_TRAILING_WHITESPACE - 1))) {
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
    if (!degenerated) throw e;
  }
  if (degenerated) throw new Error(`ollama 출력이 공백만 반복함 (JSON 생성 퇴화, ${text.trim().length}자에서 중단)`);
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
    throw new Error(`${e.message}\n    near: ${JSON.stringify(around)}`);
  }
}
