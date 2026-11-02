// JavaScript / TypeScript flows, the learning flow and what submitted code can reach.
import { BASE, check, finish, idle, launch, openWithCode, run } from "./harness.mjs";

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && !m.text().includes("example.com") && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

const js = `function twoSum(nums, target) {\n  const seen = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}`;

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await openWithCode(page, "two-sum", "javascript", js);
check("JS examples pass", /예제 결과: 2 \/ 2 통과/.test(await run(page)));
check("no solved badge before submit", (await page.locator(".badge.solved").count()) === 0);
check("JS submit passes", /채점 결과: 9 \/ 9 통과/.test(await run(page, "submit")));
check("solved badge appears at once", (await page.locator(".badge.solved").count()) === 1);
check("solution button after a full pass", (await page.locator("text=참고 풀이 보기").count()) === 1);

await page.locator(".cm-content").click();
await page.keyboard.press("Control+Enter");
await idle(page);
check("Ctrl+Enter runs the examples and stays in the editor", /예제 결과/.test(await page.locator(".results-wrap").innerText()) && (await page.evaluate(() => !!document.activeElement.closest(".cm-editor"))));

await openWithCode(page, "two-sum", "javascript", "function twoSum() { return [0, 0] }");
const wrong = await run(page, "submit");
check("wrong answer fails", /채점 결과: \d \/ 9 통과/.test(wrong) && !/9 \/ 9/.test(wrong));
const fail = await page.locator(".result.fail").first().innerText();
check("failed hidden test shows expected and actual, not the input", fail.includes("표시하지 않음") && fail.includes("실제"));

await openWithCode(page, "two-sum", "typescript", "function twoSum(nums: number[] {\n}");
const syntax = await run(page);
check("syntax error is labelled with its position", syntax.includes("문법 오류") && /줄 \d+, 열 \d+/.test(syntax));
await openWithCode(page, "two-sum", "javascript", "import _ from 'lodash'\nfunction twoSum() {}");
const top = await run(page);
check("external import is explained", top.includes("함수 바깥") && top.includes("lodash"));
await openWithCode(page, "two-sum", "typescript", "export function twoSum(nums: number[], target: number): number[] {\n  for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) if (nums[i] + nums[j] === target) return [i, j];\n  return [];\n}");
check("TS with exports and types passes", /2 \/ 2 통과/.test(await run(page)));

await openWithCode(page, "two-sum", "javascript", "function twoSum(nums) { if (nums.length > 3) for(;;){} return [0,1] }");
const t0 = Date.now();
await run(page, "submit", 20000);
const statuses = await page.locator(".result").evaluateAll((els) => els.map((e) => e.className.replace("result ", "")));
check("infinite loop stops in about 3s and the rest is skipped", Date.now() - t0 < 8000 && statuses.includes("timeout") && statuses.at(-1) === "skipped", `${Date.now() - t0}ms`);

await page.click(".toolbar button.primary");
await page.locator("text=중단").click();
await idle(page, 5000);
check("stop button cancels", (await page.locator(".results-wrap").innerText()).includes("중단됨"));

await openWithCode(page, "two-sum", "javascript", "function twoSum() { for(;;){} }");
await page.evaluate(() => localStorage.setItem("coding-dojo:draft:valid-parentheses:javascript", JSON.stringify("function isValid(s) { return true }")));
await page.click(".toolbar button.primary");
await page.goto(`${BASE}#/p/valid-parentheses`);
await page.locator(".cm-content").waitFor();
const after = await run(page);
check("a run after leaving a hanging one is not hit by its timeout", /예제 결과/.test(after) && !after.includes("시간 초과"));

// live region: one element from before the run until the verdict
await openWithCode(page, "two-sum", "javascript", "function twoSum() { const end = Date.now() + 300; while (Date.now() < end); return [0, 1] }");
const region = await page.evaluateHandle(() => document.querySelector(".results-wrap [role=status]"));
await page.click(".toolbar button.primary");
const ticks = await page.evaluate(
  (el) =>
    new Promise((resolve) => {
      let n = 0;
      const seen = [];
      const o = new MutationObserver(() => {
        n++;
        seen.push(el.textContent);
      });
      o.observe(el, { subtree: true, childList: true, characterData: true });
      const stop = setInterval(() => {
        if (el.textContent.includes("결과")) {
          clearInterval(stop);
          o.disconnect();
          resolve({ n, connected: el.isConnected, text: el.textContent });
        }
      }, 50);
    }),
  region,
);
check("the verdict lands in the live region that existed before the run", ticks.connected && ticks.text.includes("채점 결과"), ticks.text);
check("the live region only changes when progress does", ticks.n <= 12, `${ticks.n} changes`);

// keyboard focus survives the button swap
await openWithCode(page, "two-sum", "javascript", "function twoSum() { for(;;){} }");
await page.locator(".toolbar button.primary").focus();
await page.keyboard.press("Enter");
await page.locator("text=중단").waitFor();
await page.waitForTimeout(100);
check("focus moves to the stop button", (await page.evaluate(() => document.activeElement.textContent.trim())) === "중단");
await page.keyboard.press("Enter");
await idle(page, 5000);
await page.waitForTimeout(100);
check("focus returns to the button that started the run", (await page.evaluate(() => document.activeElement.textContent.trim())) === "제출");

// what submitted code can reach
await openWithCode(page, "two-sum", "javascript", "function twoSum() { return [typeof fetch, typeof indexedDB, typeof caches, typeof Worker, typeof postMessage, typeof navigator.storage, typeof navigator.storageBuckets, typeof navigator.locks, typeof webkitRequestFileSystem] }");
const reach = await run(page);
check("network and storage APIs are gone from the judge worker", reach.includes(`[${Array(9).fill('"undefined"').join(",")}]`));

const probe = (p) =>
  p.evaluate(async () => {
    const src = `const o = {};
      try { await fetch("https://example.com/?e2e", { mode: "no-cors" }); o.fetch = "reached"; } catch { o.fetch = "blocked"; }
      try { await import("https://cdn.jsdelivr.net/npm/is-number@7.0.0/+esm"); o.npm = "loaded"; } catch { o.npm = "blocked"; }
      try { await import("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs"); o.pyodide = "loaded"; } catch { o.pyodide = "blocked"; }
      postMessage(o);`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })), { type: "module" });
    return new Promise((r) => {
      w.onmessage = (e) => r(e.data);
      setTimeout(() => r({ timeout: true }), 20000);
    });
  });
await page.goto(BASE);
const strict = await probe(page);
check("CSP reaches blob workers: only the Pyodide path is open", strict.fetch === "blocked" && strict.npm === "blocked" && strict.pyodide === "loaded", JSON.stringify(strict));
const open = await browser.newContext({ bypassCSP: true });
const control = await open.newPage();
await control.goto(BASE);
const loose = await probe(control);
check("control: the same requests get through without CSP", loose.fetch === "reached" && loose.npm === "loaded", JSON.stringify(loose));
await open.close();

// saving, undo, hints, solution gate, list filters
await openWithCode(page, "two-sum", "javascript", "// keep me\nfunction twoSum() {}");
await page.locator(".cm-content").click();
await page.keyboard.press("End");
await page.keyboard.type(" ");
check("autosave status", (await page.locator(".save-state").innerText()).includes("자동 저장됨"));
await page.reload();
await page.locator(".cm-content").waitFor();
check("draft restored after reload", (await page.locator(".cm-content").innerText()).includes("keep me"));
await page.click("text=초기화");
check("reset applies the starter code", !(await page.locator(".cm-content").innerText()).includes("keep me"));
await page.click("text=되돌리기");
check("undo restores the code", (await page.locator(".cm-content").innerText()).includes("keep me"));

await page.evaluate(() => localStorage.removeItem("coding-dojo:solved"));
await page.goto(`${BASE}#/p/merge-intervals`);
await page.reload();
await page.locator(".cm-content").waitFor();
check("hints stay hidden until asked", (await page.locator(".hints li").count()) === 0);
await page.locator(".hints button").click();
check("one hint at a time", (await page.locator(".hints li").count()) === 1);
page.removeAllListeners("dialog");
let dialogs = 0;
page.on("dialog", (d) => {
  dialogs++;
  d.dismiss();
});
await page.click("summary:has-text('참고 풀이')");
check("solution asks first when unsolved", dialogs === 1 && !(await page.locator("details:has(summary:has-text('참고 풀이'))").evaluate((d) => d.open)));
page.removeAllListeners("dialog");
page.on("dialog", (d) => d.accept());

await page.goto(BASE);
await page.selectOption("select[aria-label='난이도']", "easy");
await page.fill("input[aria-label='제목 검색']", "two");
await page.waitForTimeout(200);
check("filters go to the URL", page.url().includes("d=easy") && page.url().includes("q=two"), page.url());
await page.click(".problem-table a");
await page.locator(".cm-content").waitFor();
await page.click(".crumbs a");
await page.locator(".problem-table").waitFor();
check("breadcrumb returns with the filters", page.url().includes("d=easy") && (await page.inputValue("input[aria-label='제목 검색']")) === "two");

// Korean composition and the caret in the URL-bound search box (HashRouter useTransitions)
await page.goto(BASE);
const box = page.locator("input[aria-label='제목 검색']");
await box.click();
const cdp = await context.newCDPSession(page);
for (const t of ["ㅇ", "이", "인", "인ㅌ", "인터"]) {
  await cdp.send("Input.imeSetComposition", { text: t, selectionStart: t.length, selectionEnd: t.length });
  await page.waitForTimeout(40);
}
await cdp.send("Input.insertText", { text: "인터" });
await page.waitForTimeout(100);
check("Korean composition keeps its text", (await box.inputValue()) === "인터", await box.inputValue());
await box.fill("abcd");
await page.waitForTimeout(100);
await box.evaluate((e) => e.setSelectionRange(1, 1));
await page.keyboard.type("X", { delay: 20 });
await page.waitForTimeout(60);
check("caret stays where typing happens", (await box.inputValue()) === "aXbcd" && (await box.evaluate((e) => e.selectionStart)) === 2);
await box.fill("");
await box.click();
await page.keyboard.type("abcdefgh", { delay: 0 });
await page.waitForTimeout(150);
check("fast typing loses nothing", (await box.inputValue()) === "abcdefgh", await box.inputValue());
await box.fill("");
await page.click(".tags button.tag >> nth=0");
const on = page.url();
await page.click(".tags button.tag[aria-pressed='true'] >> nth=0");
await page.waitForTimeout(100);
check("tag button toggles off", on.includes("tag=") && !page.url().includes("tag="));

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
finish();
