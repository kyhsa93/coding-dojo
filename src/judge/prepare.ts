import { transform } from "sucrase";
import type { Language } from "../lib/types";

/** Strips ES module syntax that cannot run inside `new Function` and transpiles TypeScript. */
export function prepareJs(code: string, language: Language): string {
  let src = code;
  if (language === "typescript") {
    src = transform(src, { transforms: ["typescript"], disableESTransforms: true }).code;
  }
  return src
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+(?=(const|let|var|function|class|async)\b)/gm, "")
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
    .replace(/^\s*import\s[^;]*;?\s*$/gm, "");
}
