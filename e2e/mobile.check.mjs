// Real mobile emulation. innerWidth stretches with overflowing content there, so compare with the width that was set.
import { readdirSync } from "node:fs";
import { BASE, check, finish, launch, openWithCode } from "./harness.mjs";

const ids = readdirSync(new URL("../problems/", import.meta.url)).map((f) => f.replace(/\.json$/, ""));
const browser = await launch();

for (const w of [320, 390, 600, 768, 901]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE);
  const list = await page.evaluate(() => document.documentElement.scrollWidth);
  const bad = list > w ? [`list:${list}`] : [];
  for (const id of ids) {
    await page.goto(`${BASE}#/p/${id}`);
    await page.locator(".cm-content").waitFor();
    await page.waitForTimeout(80);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > w) bad.push(`${id}:${sw}`);
  }
  check(`no sideways overflow at ${w}px on the list and ${ids.length} problems`, bad.length === 0, bad.slice(0, 3).join(" "));
  await ctx.close();
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await openWithCode(page, "two-sum", "javascript", "function twoSum() { return [0, 0] }");
const editor = page.locator(".editor-wrap");
const before = await editor.evaluate((e) => e.getBoundingClientRect().height);
await page.locator(".toolbar button.primary").scrollIntoViewIfNeeded();
await page.locator(".toolbar button.primary").tap();
await page.waitForFunction(() => document.querySelector(".results-wrap [role=status]").textContent.includes("채점 결과"));
await page.waitForTimeout(200);
const after = await editor.evaluate((e) => e.getBoundingClientRect().height);
const pos = await page.evaluate(() => ({ top: document.querySelector(".results-wrap .status").getBoundingClientRect().top, h: visualViewport.height }));
check("the editor keeps its height and the verdict is on screen after submit", after === before && pos.top < pos.h, `editor ${before}→${after}, status ${Math.round(pos.top)}/${Math.round(pos.h)}`);
await ctx.close();

await browser.close();
finish();
