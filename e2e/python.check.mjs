// Python through Pyodide: needs the CDN once, then the service worker's cache.
import { BASE, check, finish, launch, openWithCode, run } from "./harness.mjs";

const browser = await launch();
const good = "def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []\n";
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());

await openWithCode(page, "two-sum", "python", good);
const loading = page.locator("text=Python 런타임을 내려받는 중").waitFor({ timeout: 20000 }).then(() => true, () => false);
let text = await run(page);
check("loading state shown on the first Python run", await loading);
check("Python examples pass", /예제 결과: 2 \/ 2 통과/.test(text));
check("runtime preparation is reported apart from the judged time", text.includes("런타임 준비"));
const t0 = Date.now();
text = await run(page, "submit");
check("a consecutive run reuses the runtime", /9 \/ 9 통과/.test(text) && Date.now() - t0 < 3000, `${Date.now() - t0}ms`);

await openWithCode(page, "two-sum", "python", "LEAK = 41\nprint('partial', end='')\ndef twoSum(nums, target):\n    return [0, 1]\n");
await run(page);
await page.evaluate((c) => localStorage.setItem("coding-dojo:draft:two-sum:python", JSON.stringify(c)), "def twoSum(nums, target):\n    print('second')\n    return [LEAK, 1]\n");
await page.selectOption("select[aria-label='언어']", "javascript");
await page.selectOption("select[aria-label='언어']", "python");
await page.locator(".cm-content").waitFor();
text = await run(page);
check("globals from the previous submission on the same worker do not leak", text.includes("NameError"));
const stdout = await page.locator(".stdout").innerText();
check("unflushed print from the previous run does not leak", !stdout.includes("partial") && stdout.includes("second"), JSON.stringify(stdout));

await openWithCode(page, "two-sum", "python", "def twoSum(nums, target)\n    return []\n");
text = await run(page);
check("Python syntax error is labelled and trimmed", text.includes("문법 오류") && text.includes("SyntaxError") && !text.includes("_pyodide/_base.py"));
await openWithCode(page, "two-sum", "python", "def twoSum(nums, target):\n    return nums[100]\n");
text = await run(page);
check("Python runtime error is reported per test with its line", text.includes("IndexError") && text.includes("line 2"));
await openWithCode(page, "two-sum", "python", "def twoSum(nums, target):\n    return 2 ** 70\n");
check("big Python int is shown exactly", (await run(page)).includes("1180591620717411303424"));

await openWithCode(page, "two-sum", "python", "def twoSum(nums, target):\n    while True:\n        pass\n");
check("Python infinite loop times out", (await run(page)).includes("시간 초과"));
await openWithCode(page, "two-sum", "python", good);
check("the next run works after the worker was terminated", /2 \/ 2 통과/.test(await run(page)));

for (const [name, code] of [
  ["inside the function", "import os\ndef twoSum(nums, target):\n    os.abort()\n"],
  ["at top level", "import os\nos.abort()\ndef twoSum(nums, target):\n    return [0, 1]\n"],
]) {
  await openWithCode(page, "two-sum", "python", code);
  await run(page);
  await page.evaluate((c) => localStorage.setItem("coding-dojo:draft:two-sum:python", JSON.stringify(c)), good);
  await page.selectOption("select[aria-label='언어']", "javascript");
  await page.selectOption("select[aria-label='언어']", "python");
  await page.locator(".cm-content").waitFor();
  text = await run(page);
  check(`os.abort() ${name}: the next run works without a fake timeout`, /2 \/ 2 통과/.test(text) && !text.includes("시간 초과"));
}

await openWithCode(page, "two-sum", "python", good);
await page.evaluate(() => navigator.serviceWorker.ready);
await run(page);
await ctx.setOffline(true);
await page.reload();
await page.locator(".cm-content").waitFor();
check("offline: app and Python runtime come from the cache", /2 \/ 2 통과/.test(await run(page)));
await ctx.setOffline(false);
await ctx.close();

const down = await browser.newContext({ serviceWorkers: "block" });
await down.route(/cdn\.jsdelivr\.net/, (r) => r.abort());
const p2 = await down.newPage();
await openWithCode(p2, "two-sum", "python", good);
text = await run(p2);
check("CDN failure is shown as a runtime load error", text.includes("실행 환경 오류") && text.includes("Python 런타임을 불러오지 못했습니다"));
await down.unroute(/cdn\.jsdelivr\.net/);
check("retry succeeds once the CDN is back", /2 \/ 2 통과/.test(await run(p2)));
await down.close();

await browser.close();
void BASE;
finish();
