import vm from "node:vm";

export const LANGUAGES = ["javascript", "typescript", "python"];
export const DIFFICULTIES = ["easy", "medium", "hard"];

const PY_TYPES = {
  number: "int",
  string: "str",
  boolean: "bool",
};

export function toPyType(t) {
  const trimmed = t.trim();
  if (trimmed.endsWith("[]")) return `list[${toPyType(trimmed.slice(0, -2))}]`;
  if (/^Record<string,\s*(.+)>$/.test(trimmed)) return `dict[str, ${toPyType(trimmed.match(/^Record<string,\s*(.+)>$/)[1])}]`;
  return PY_TYPES[trimmed] ?? "object";
}

export function starterFor(language, functionName, params, returnType) {
  const names = params.map((p) => p.name).join(", ");
  if (language === "python") {
    const sig = params.map((p) => `${p.name}: ${toPyType(p.type)}`).join(", ");
    return `def ${functionName}(${sig}) -> ${toPyType(returnType)}:\n    # 여기에 코드를 작성하세요\n    pass\n`;
  }
  if (language === "typescript") {
    const sig = params.map((p) => `${p.name}: ${p.type}`).join(", ");
    return `function ${functionName}(${sig}): ${returnType} {\n  // 여기에 코드를 작성하세요\n}\n`;
  }
  return `function ${functionName}(${names}) {\n  // 여기에 코드를 작성하세요\n}\n`;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b) ? true : Math.abs(a - b) < 1e-6;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return deepEqual(ka, kb) && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

export function toJson(v) {
  if (v === undefined) return null;
  if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (Array.isArray(v)) return v.map(toJson);
  if (v instanceof Set) return Array.from(v).map(toJson);
  if (v instanceof Map) return Object.fromEntries(Array.from(v, ([k, x]) => [String(k), toJson(x)]));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]));
  return String(v);
}

/** Loads a JavaScript solution inside an isolated context and returns a callable. */
export function loadSolution(code, functionName) {
  const context = vm.createContext({ console: { log() {}, error() {}, warn() {} } });
  const src = `${code}\n;(typeof ${functionName} === "function" ? ${functionName} : undefined)`;
  const fn = vm.runInContext(src, context, { timeout: 2000 });
  if (typeof fn !== "function") throw new Error(`solution does not define function ${functionName}`);
  return fn;
}

export function runCase(fn, input, timeoutMs = 2000) {
  const context = vm.createContext({ fn, input: structuredClone(input) });
  return toJson(vm.runInContext("fn(...input)", context, { timeout: timeoutMs }));
}

function isJsonValue(v) {
  if (v === null) return true;
  const t = typeof v;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (t === "object") return Object.values(v).every(isJsonValue);
  return false;
}

/** Returns a list of shape problems; empty means the problem JSON is well-formed. */
export function validateShape(p) {
  const errors = [];
  const req = (k, type) => {
    if (p[k] === undefined || p[k] === null) errors.push(`missing ${k}`);
    else if (type && typeof p[k] !== type) errors.push(`${k} must be ${type}`);
  };
  req("id", "string");
  req("title", "string");
  req("difficulty", "string");
  req("statement", "string");
  req("functionName", "string");
  req("returnType", "string");
  req("solution", "string");
  req("createdAt", "string");
  if (p.id && !/^[a-z0-9][a-z0-9-]{2,60}$/.test(p.id)) errors.push("id must be kebab-case (a-z, 0-9, -)");
  if (p.difficulty && !DIFFICULTIES.includes(p.difficulty)) errors.push(`difficulty must be one of ${DIFFICULTIES.join(",")}`);
  if (p.functionName && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.functionName)) errors.push("functionName must be an identifier");
  if (!Array.isArray(p.tags) || p.tags.length === 0 || !p.tags.every((t) => typeof t === "string")) errors.push("tags must be a non-empty string array");
  if (!Array.isArray(p.params) || !p.params.every((x) => x && typeof x.name === "string" && typeof x.type === "string")) errors.push("params must be {name,type}[]");
  if (!p.starterCode || !LANGUAGES.every((l) => typeof p.starterCode?.[l] === "string")) errors.push(`starterCode must have ${LANGUAGES.join(",")}`);
  if (!Array.isArray(p.examples) || p.examples.length < 1) errors.push("examples must have at least 1 item");
  if (!Array.isArray(p.tests) || p.tests.length < 6) errors.push("tests must have at least 6 items");
  for (const [name, list] of [["examples", p.examples], ["tests", p.tests]]) {
    if (!Array.isArray(list)) continue;
    list.forEach((t, i) => {
      if (!t || !Array.isArray(t.input)) errors.push(`${name}[${i}].input must be an array of arguments`);
      else if (p.params && t.input.length !== p.params.length) errors.push(`${name}[${i}].input has ${t.input.length} args, expected ${p.params.length}`);
      if (t && !("expected" in t)) errors.push(`${name}[${i}] missing expected`);
      if (t && !isJsonValue(t.input) || (t && !isJsonValue(t.expected))) errors.push(`${name}[${i}] contains non-JSON values`);
    });
  }
  if (p.hints !== undefined && (!Array.isArray(p.hints) || !p.hints.every((h) => typeof h === "string"))) errors.push("hints must be a string array");
  return errors;
}

/** Runs the reference solution against examples and tests. Returns {ok, failures}. */
export function verifySolution(p) {
  const failures = [];
  let fn;
  try {
    fn = loadSolution(p.solution, p.functionName);
  } catch (e) {
    return { ok: false, failures: [`solution failed to load: ${e.message}`] };
  }
  for (const [name, list] of [["examples", p.examples], ["tests", p.tests]]) {
    list.forEach((t, i) => {
      try {
        const actual = runCase(fn, t.input);
        if (!deepEqual(actual, t.expected)) failures.push(`${name}[${i}]: expected ${JSON.stringify(t.expected)} got ${JSON.stringify(actual)}`);
      } catch (e) {
        failures.push(`${name}[${i}]: threw ${e.message}`);
      }
    });
  }
  return { ok: failures.length === 0, failures };
}
