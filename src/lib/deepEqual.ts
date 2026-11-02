import type { JudgeValue } from "./types";

export const DEFAULT_TOLERANCE = 1e-6;
/** Relative slack for large non-integers, where 1e-6 is finer than a double can resolve. */
const RELATIVE_TOLERANCE = 1e-9;

export interface CompareOptions {
  /** Absolute error allowed between non-integers. 0 makes every number compare exactly. */
  tolerance?: number;
}

/**
 * Judge comparison policy:
 * - integers (number or bigint) compare exactly while both fit in a double; past 2^53 they compare at double
 *   precision, because expected values are JSON numbers and carry no more precision than that
 * - otherwise numbers pass when |a - b| <= tolerance (default 1e-6); two non-integers also pass within 1e-9 of
 *   their magnitude, for large values where 1e-6 is finer than a double resolves
 * - NaN and ±Infinity equal only themselves; expected values are finite JSON, so returning them never passes
 * - null and undefined are the same (a function that falls off the end returns null)
 * - arrays compare element by element and never equal a plain object; objects compare by their key sets
 */
export function deepEqual(a: unknown, b: unknown, opts: CompareOptions = {}): boolean {
  return equal(a, b, opts.tolerance ?? DEFAULT_TOLERANCE);
}

function equal(a: unknown, b: unknown, tolerance: number): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (isNumeric(a) && isNumeric(b)) return numbersEqual(a, b, tolerance);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => equal(v, b[i], tolerance));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tolerance));
  }
  return false;
}

function isNumeric(v: unknown): v is number | bigint {
  return typeof v === "number" || typeof v === "bigint";
}

function numbersEqual(a: number | bigint, b: number | bigint, tolerance: number): boolean {
  if (typeof a === "bigint" || typeof b === "bigint") {
    if (typeof a === "bigint" && typeof b === "bigint") return a === b;
    const big = (typeof a === "bigint" ? a : b) as bigint;
    const num = (typeof a === "bigint" ? b : a) as number;
    if (Number.isSafeInteger(num)) return BigInt(num) === big;
    return Number(big) === num;
  }
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const integers = Number(Number.isInteger(a)) + Number(Number.isInteger(b));
  if (integers === 2 || tolerance === 0) return a === b;
  const diff = Math.abs(a - b);
  if (diff <= tolerance) return true;
  // Only between two non-integers: an integer answer stays within the absolute tolerance however large it is.
  return integers === 0 && diff <= RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

/**
 * Converts what a submission returned into plain data that survives postMessage and compares with `deepEqual`:
 * undefined → null, Set and typed arrays → arrays (Set keeps insertion order), Map → object with string keys,
 * bigint → number when it is a safe integer. Throws on circular references instead of overflowing the stack.
 */
export function toJson(value: unknown): JudgeValue {
  return convert(value, new Set());
}

function convert(value: unknown, ancestors: Set<object>): JudgeValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  if (typeof value !== "object") return String(value);
  if (ancestors.has(value)) throw new TypeError("반환값에 순환 참조가 있어 채점할 수 없습니다");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => convert(v, ancestors));
    if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number | bigint>, (v) => convert(v, ancestors));
    if (value instanceof Set) return Array.from(value, (v) => convert(v, ancestors));
    if (value instanceof Map) return Object.fromEntries(Array.from(value, ([k, v]) => [String(k), convert(v, ancestors)]));
    const out: Record<string, JudgeValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = convert(v, ancestors);
    return out;
  } finally {
    ancestors.delete(value);
  }
}

/** JSON-like text that also shows bigint, NaN and Infinity as written instead of `null` or a thrown error. */
export function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}:${formatValue(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** `formatValue` cut to `max` characters so a 400 KB test value does not stall the results panel. */
export function previewValue(value: unknown, max = 2000): string {
  const text = formatValue(value);
  return text.length <= max ? text : `${text.slice(0, max)}… (${(text.length - max).toLocaleString()}자 생략)`;
}
