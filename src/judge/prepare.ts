import { transform } from "sucrase";
import type { Language } from "../lib/types";

/**
 * Turns a JavaScript or TypeScript submission into a script body for `new Function("exports", "module", "require", ...)`.
 *
 * Supported: everything Sucrase parses for the language (TypeScript types, enums, `import type`), plus ES module
 * syntax, which Sucrase rewrites to CommonJS by token rather than by line, so `export` inside strings and comments
 * is left alone and an `import` without a semicolon cannot swallow the next statement. Exported declarations stay
 * in scope under their own names. Not supported: JSX, and importing anything — `require` is the stub below, so
 * `import _ from "lodash"` fails with a message that names the module.
 *
 * Sucrase keeps line numbers, and its parse errors carry `(line:column)`.
 */
export function prepareJs(code: string, language: Language): string {
  const transforms: ("typescript" | "imports")[] = language === "typescript" ? ["typescript", "imports"] : ["imports"];
  return transform(code, { transforms, disableESTransforms: true }).code;
}

export const MODULE_PARAMS = ["exports", "module", "require"] as const;

export function moduleArgs(): [Record<string, unknown>, { exports: Record<string, unknown> }, (name: string) => never] {
  const exports: Record<string, unknown> = {};
  const require = (name: string): never => {
    throw new Error(`외부 모듈 '${name}' 은(는) 사용할 수 없습니다. 채점 환경에는 언어 기본 기능만 있습니다.`);
  };
  return [exports, { exports }, require];
}
