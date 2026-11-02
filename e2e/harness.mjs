// Shared by the browser checks. E2E_BASE points them at another deployment (e.g. the live site); E2E_CHROME at a
// browser binary when the one Playwright expects is not installed.
import { chromium } from "playwright";

export const BASE = process.env.E2E_BASE ?? "http://localhost:4173/coding-dojo/";

export function launch() {
  return chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
}

let passed = 0;
let total = 0;

export function check(name, ok, detail = "") {
  total++;
  if (ok) passed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

export function finish() {
  console.log(`\n${passed}/${total} passed`);
  process.exitCode = passed === total ? 0 : 1;
}

/** Sets a saved draft and the language, then loads the problem fresh so the page reads them. */
export async function openWithCode(page, id, language, code) {
  await page.goto(BASE);
  await page.evaluate(
    ([id, language, code]) => {
      localStorage.setItem(`coding-dojo:draft:${id}:${language}`, JSON.stringify(code));
      localStorage.setItem("coding-dojo:language", JSON.stringify(language));
    },
    [id, language, code],
  );
  await page.goto(`${BASE}#/p/${id}`);
  await page.reload();
  await page.locator(".cm-content").waitFor();
}

export const idle = (page, timeout = 150000) => page.locator(".toolbar button:has-text('예제 실행')").waitFor({ timeout });

/** Clicks a run button and returns the text of the results panel when the run has finished. */
export async function run(page, which = "examples", timeout = 150000) {
  await page.click(which === "submit" ? ".toolbar button.primary" : ".toolbar button:has-text('예제 실행')");
  await idle(page, timeout);
  return page.locator(".results-wrap").innerText();
}
