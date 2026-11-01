/**
 * IDE-style completions for the editor.
 *
 * The language packages already complete local names (parameters, variables declared in the draft)
 * and keyword snippets. This adds what an IDE shows on top of that:
 *  - JavaScript/TypeScript: curated globals (Math, JSON, Number, Map, ...) with their members, and
 *    member methods after `value.` when the receiver's type is unknown (Array, String, Map, Set, ...).
 *  - Python: builtins come from lang-python; this adds methods of list/str/dict/set/deque/Counter
 *    after `value.` and the members of the standard modules used in coding tests (heapq, bisect, ...).
 */
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { snippetCompletion } from "@codemirror/autocomplete";
import { scopeCompletionSource } from "@codemirror/lang-javascript";

/** `foo.ba|` → head "foo", word "ba". Also `arr[0].ma|` / `f().ma|` (head is the token before the dot). */
const MEMBER_RE = /([A-Za-z_$][\w$]*|\)|\])\s*\.\s*([A-Za-z_$][\w$]*)?$/;

function memberMatch(context: CompletionContext): { head: string; from: number } | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = MEMBER_RE.exec(before);
  if (!m) return null;
  return { head: m[1], from: context.pos - (m[2]?.length ?? 0) };
}

function method(label: string, detail: string, info?: string): Completion {
  return snippetCompletion(`${label}(#{})`, { label, detail, type: "method", info });
}

const property = (label: string, detail: string): Completion => ({ label, detail, type: "property" });

/* ---------------- JavaScript / TypeScript ---------------- */

const JS_GLOBAL_SCOPE: Record<string, unknown> = {
  Math,
  JSON,
  Number,
  Object,
  Array,
  String,
  Boolean,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Symbol,
  BigInt,
  Promise,
  Error,
  RegExp,
  Date,
  Infinity,
  NaN,
  undefined,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  structuredClone,
  console,
};

/** Bare globals and `Math.` / `JSON.` style member completion from the real objects. */
const scopeSource = scopeCompletionSource(JS_GLOBAL_SCOPE);
export const jsGlobalCompletion: CompletionSource = async (context) => {
  const result = await scopeSource(context);
  // The scope walk lists inherited Object.prototype internals (__defineGetter__ ...); nobody wants those.
  return result ? { ...result, options: result.options.filter((o) => !o.label.startsWith("__")) } : null;
};

function prototypeMethods(proto: object, detail: string, skip: string[] = ["constructor"]): Completion[] {
  // Descriptors, not property reads: getters such as Map.prototype.size throw on the prototype itself.
  return Object.getOwnPropertyNames(proto)
    .filter((k) => !skip.includes(k) && !k.startsWith("__") && typeof Object.getOwnPropertyDescriptor(proto, k)?.value === "function")
    .map((k) => method(k, detail));
}

const JS_MEMBERS: Completion[] = (() => {
  const seen = new Map<string, Completion>();
  const add = (list: Completion[]) => {
    for (const c of list) if (!seen.has(c.label)) seen.set(c.label, c);
  };
  add([property("length", "Array | String"), property("size", "Map | Set")]);
  add(prototypeMethods(Array.prototype, "Array"));
  add(prototypeMethods(String.prototype, "String"));
  add(prototypeMethods(Map.prototype, "Map"));
  add(prototypeMethods(Set.prototype, "Set"));
  add(prototypeMethods(Number.prototype, "Number"));
  add(prototypeMethods(Object.prototype, "Object", ["constructor", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]));
  return Array.from(seen.values());
})();

/** Methods after `value.` when the receiver is not one of the curated globals. */
export function jsMemberCompletion(context: CompletionContext): CompletionResult | null {
  const m = memberMatch(context);
  if (!m || m.head in JS_GLOBAL_SCOPE) return null;
  return { from: m.from, options: JS_MEMBERS, validFor: /^[\w$]*$/ };
}

/* ---------------- Python ---------------- */

const PY_TYPE_METHODS: Record<string, string[]> = {
  list: ["append", "extend", "insert", "remove", "pop", "clear", "index", "count", "sort", "reverse", "copy"],
  str: [
    "lower", "upper", "strip", "lstrip", "rstrip", "split", "rsplit", "join", "replace", "find", "rfind", "index", "count",
    "startswith", "endswith", "isdigit", "isalpha", "isalnum", "isspace", "islower", "isupper", "zfill", "format", "title",
    "capitalize", "swapcase", "center", "ljust", "rjust", "partition", "rpartition", "splitlines", "encode",
  ],
  dict: ["get", "keys", "values", "items", "pop", "popitem", "setdefault", "update", "clear", "copy"],
  set: [
    "add", "remove", "discard", "pop", "clear", "union", "intersection", "difference", "symmetric_difference",
    "issubset", "issuperset", "isdisjoint", "update", "copy",
  ],
  deque: ["append", "appendleft", "pop", "popleft", "extend", "extendleft", "rotate", "clear", "count", "index", "remove", "reverse"],
  Counter: ["most_common", "elements", "update", "subtract", "total"],
};

const PY_MODULES: Record<string, { functions: string[]; values?: string[] }> = {
  math: {
    functions: ["floor", "ceil", "sqrt", "isqrt", "gcd", "lcm", "log", "log2", "log10", "pow", "factorial", "comb", "perm", "hypot", "fabs", "trunc", "prod", "fsum", "dist"],
    values: ["inf", "pi", "e", "nan"],
  },
  heapq: { functions: ["heappush", "heappop", "heapify", "heappushpop", "heapreplace", "nlargest", "nsmallest", "merge"] },
  bisect: { functions: ["bisect_left", "bisect_right", "bisect", "insort", "insort_left", "insort_right"] },
  collections: { functions: ["deque", "defaultdict", "Counter", "OrderedDict", "namedtuple", "ChainMap"] },
  itertools: {
    functions: ["permutations", "combinations", "combinations_with_replacement", "product", "accumulate", "chain", "groupby", "islice", "count", "cycle", "repeat", "pairwise", "zip_longest", "starmap", "takewhile", "dropwhile"],
  },
  functools: { functions: ["lru_cache", "cache", "reduce", "cmp_to_key", "partial"] },
  sys: { functions: ["setrecursionlimit", "getrecursionlimit"], values: ["maxsize"] },
  string: { functions: [], values: ["ascii_lowercase", "ascii_uppercase", "ascii_letters", "digits", "punctuation"] },
  re: { functions: ["match", "search", "findall", "finditer", "sub", "split", "compile", "fullmatch"] },
  typing: { functions: [], values: ["List", "Dict", "Set", "Tuple", "Optional", "Any", "Deque", "DefaultDict"] },
};

const PY_MEMBERS: Completion[] = (() => {
  const seen = new Map<string, Completion>();
  for (const [type, names] of Object.entries(PY_TYPE_METHODS)) {
    for (const name of names) {
      const existing = seen.get(name);
      if (existing) seen.set(name, { ...existing, detail: `${existing.detail} | ${type}` });
      else seen.set(name, method(name, type));
    }
  }
  return Array.from(seen.values());
})();

const PY_MODULE_MEMBERS: Record<string, Completion[]> = Object.fromEntries(
  Object.entries(PY_MODULES).map(([mod, { functions, values = [] }]) => [
    mod,
    [...functions.map((f) => method(f, mod)), ...values.map((v) => property(v, mod))],
  ]),
);

/** Module names, offered as bare completions so `import hea|` and `heapq.` both work. */
const PY_MODULE_NAMES: Completion[] = Object.keys(PY_MODULES).map((m) => ({ label: m, detail: "module", type: "namespace" }));

export function pyMemberCompletion(context: CompletionContext): CompletionResult | null {
  const m = memberMatch(context);
  if (m) {
    const options = PY_MODULE_MEMBERS[m.head] ?? PY_MEMBERS;
    return { from: m.from, options, validFor: /^\w*$/ };
  }
  const word = context.matchBefore(/\w+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: PY_MODULE_NAMES, validFor: /^\w*$/ };
}
