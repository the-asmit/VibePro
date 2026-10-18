const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../tools/node_modules/playwright");
const AxeBuilder =
  require("../tools/node_modules/@axe-core/playwright").default;

const root = path.resolve(__dirname, "..");
const output = path.resolve(
  root,
  process.env.REVIEW_OUTPUT || "artifacts/design/baseline",
);
const origin = process.env.REVIEW_ORIGIN || "http://127.0.0.1:8011";
async function main() {
  fs.mkdirSync(output, { recursive: true });
  let executablePath = process.env.VIBEPRO_BROWSER_PATH;
  const cache = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!executablePath && process.platform === "win32" && fs.existsSync(cache)) {
    for (const name of fs
      .readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort()
      .reverse()) {
      const candidate = path.join(cache, name, "chrome-win64", "chrome.exe");
      if (fs.existsSync(candidate)) {
        executablePath = candidate;
        break;
      }
    }
  }
  const browser = await chromium.launch({ headless: true, executablePath });
  const results = [];
  try {
    for (const width of [1440, 1024, 768, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 960 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.reviewCLS = 0;
        new PerformanceObserver((list) =>
          list.getEntries().forEach((entry) => {
            if (!entry.hadRecentInput) window.reviewCLS += entry.value;
          }),
        ).observe({ type: "layout-shift", buffered: true });
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const [name, route] of [
        ["home", "/"],
        ["report", "/report.html?sample=1"],
      ]) {
        await page.goto(origin + route, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        const initialCLS = await page.evaluate(() => window.reviewCLS);
        if (name === "home") {
          await page.locator("#manifest-status.verified").waitFor();
          await page.locator(".release-inspection > summary").click();
          await page.locator("#hash-run").click();
          await page.locator("#hash-result.pass").waitFor();
          await page.locator(".release-inspection > summary").click();
        }
        const height = await page.evaluate(
          () => document.documentElement.scrollHeight,
        );
        for (let y = 0; y < height; y += 650) {
          await page.evaluate((y) => window.scrollTo(0, y), y);
          await page.waitForTimeout(70);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(350);
        await page.screenshot({
          path: path.join(output, `${name}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
        const dimensions = await page.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        }));
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.width && (rect.right > innerWidth + 1 || rect.left < -1)
              );
            })
            .slice(0, 14)
            .map((node) => ({
              tag: node.tagName,
              class: node.className,
              width: node.getBoundingClientRect().width,
              right: node.getBoundingClientRect().right,
            })),
        );
        const accessibility = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        results.push({
          name,
          initialCLS,
          ...dimensions,
          errors: [...errors],
          overflow,
          violations: accessibility.violations.map((item) => ({
            id: item.id,
            impact: item.impact,
            nodes: item.nodes.map((node) => ({
              target: node.target,
              summary: node.failureSummary,
            })),
          })),
        });
        console.log(
          name,
          width,
          "overflow:",
          dimensions.scrollWidth - width,
          "a11y violations:",
          accessibility.violations.length,
          "script errors:",
          errors.length,
          "initial CLS:",
          initialCLS.toFixed(4),
        );
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  if (
    process.env.REVIEW_STRICT === "1" &&
    results.some(
      (item) =>
        item.scrollWidth > item.width ||
        item.errors.length ||
        item.violations.length ||
        item.initialCLS > 0.01,
    )
  )
    throw new Error("Design review found failures. See results.json.");
  console.log("Screenshots and accessibility results saved to " + output);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
