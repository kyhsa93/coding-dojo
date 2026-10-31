import type { JsonValue } from "./types";

const EPSILON = 1e-6;

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) < EPSILON;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (!deepEqual(ka, kb)) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** Converts runtime values (Map, Set, typed arrays, undefined) into plain JSON. */
export function toJson(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value) as unknown as number;
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(toJson);
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>).map(toJson);
  if (value instanceof Set) return Array.from(value).map(toJson);
  if (value instanceof Map) return Object.fromEntries(Array.from(value, ([k, v]) => [String(k), toJson(v)]));
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJson(v);
    return out;
  }
  return String(value);
}

export function formatValue(value: unknown): string {
  return JSON.stringify(value);
}
