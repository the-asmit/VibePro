const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../tools/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const origin = process.env.REVIEW_ORIGIN || "http://127.0.0.1:8011";
const output = path.join(root, "artifacts/design/interactions");
const sample = fs.readFileSync(path.join(root, "web/sample-findings.json"));

async function captureSection(page, selector, filename) {
  const bounds = await page.locator(selector).evaluate((node) => ({
    top: node.getBoundingClientRect().top + scrollY,
    height: node.getBoundingClientRect().height,
  }));
  for (let y = bounds.top; y < bounds.top + bounds.height; y += 550) {
    await page.evaluate((y) => scrollTo(0, y), y);
    await page.waitForTimeout(90);
  }
  await page.evaluate((y) => scrollTo(0, y), bounds.top);
  await page.waitForTimeout(700);
  await page
    .locator(selector)
    .screenshot({ path: path.join(output, filename), animations: "disabled" });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const cached = path.join(
    process.env.LOCALAPPDATA || "",
    "ms-playwright/chromium-1234/chrome-win64/chrome.exe",
  );
  const browser = await chromium.launch({
    executablePath:
      process.env.VIBEPRO_BROWSER_PATH ||
      (fs.existsSync(cached) ? cached : undefined),
    headless: true,
  });
  const checks = [];
  const errors = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const passed = (name) => {
    checks.push(name);
    console.log("PASS", name);
  };
  try {
    await page.goto(origin);
    await page.locator("#manifest-status.verified").waitFor();
    const currentEnvelope = await (
      await page.request.get(origin + "/api/v1/manifest/signed?version=latest")
    ).json();
    const current = currentEnvelope.manifest;
    assert.ok(
      (await page.locator("#engine-live").textContent()).includes(
        "v" + current.version + " · " + current.files.length + " signed files",
      ),
    );
    passed("Live signed manifest and hero metadata");
    const core = page.locator("#security-core");
    await page.locator(".canvas-ready").waitFor();
    const firstFrame = await core.getAttribute("data-frame");
    await page.waitForFunction(
      (before) =>
        document.querySelector("#security-core").dataset.frame !== before,
      firstFrame,
    );
    assert.equal(await page.locator("#motion-toggle").count(), 0);
    const runningFrame = await core.getAttribute("data-frame");
    await page.waitForTimeout(5000);
    assert.equal(await core.getAttribute("data-motion"), "playing");
    assert.notEqual(await core.getAttribute("data-frame"), runningFrame);
    assert.equal(await page.locator("video").count(), 0);
    assert.equal(await page.getByText(/Asmit|Arnav/).count(), 0);
    passed("Custom security graphic keeps animating without a control overlay");
    await page.locator('.story-chapter[data-stage="4"] button').click();
    assert.match(
      await page.locator("#evidence-verdict").textContent(),
      /REJECTED/,
    );
    await page.locator(".evidence-board").screenshot({
      path: path.join(output, "audit-rejected-1440.png"),
      animations: "disabled",
    });
    passed("Selecting independent review shows the rejected claim");
    await page.waitForTimeout(180);
    const offscreenFrame = await core.getAttribute("data-frame");
    await page.waitForTimeout(180);
    assert.equal(await core.getAttribute("data-frame"), offscreenFrame);

    await page.locator(".release-inspection > summary").click();
    await page.locator("#hash-run").click();
    await page.locator("#hash-result.pass").waitFor();
    assert.equal(
      await page.locator("#computed-hash").textContent(),
      await page.locator("#expected-hash").textContent(),
    );
    await captureSection(page, "#verify", "home-release-1440.png");
    passed("A real engine file hashes to its signed digest in the browser");
    await page.locator(".manifest-details summary").click();
    assert.equal(
      await page.locator(".manifest-file").count(),
      current.files.length,
    );
    await page.locator(".fingerprint-details > summary").click();
    await page.locator("#copy-fingerprint").click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      await page.locator("#public-key-fingerprint").textContent(),
    );
    passed("Live file list and fingerprint copy");
    await page.locator('[data-agent="cursor"]').click();
    await page.locator("#preview-install").check();
    assert.match(
      await page.locator("#agent-command").textContent(),
      /--agent cursor --dry-run/,
    );
    await page.locator("[data-copy-agent]").click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      await page.locator("#agent-command").textContent(),
    );
    await page.locator("#copy-command").click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "npx vibepro-cli install",
    );
    passed("Agent selection, preview option, and both command copy buttons");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.story-chapter[data-stage="2"] button').click();
    assert.match(
      await page.locator("#evidence-verdict").textContent(),
      /NEEDS VALIDATION/,
    );
    await page.locator(".menu-toggle").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page
        .getByRole("link", { name: "Reports", exact: true })
        .isVisible(),
      true,
    );
    await page.keyboard.press("Escape");
    passed("Phone audit controls and keyboard navigation");

    await page.route("**/api/v1/manifest/signed?version=latest", (route) =>
      route.fulfill({ status: 503, body: "{}" }),
    );
    await page.route("**/api/v1/stats", (route) =>
      route.fulfill({ status: 503, body: "{}" }),
    );
    await page.goto(origin);
    await page.locator("#retry-manifest").waitFor();
    assert.equal(await page.locator("#hash-run").isDisabled(), true);
    await page.locator(".activity-details > summary").click();
    assert.equal(await page.locator("#stats-fallback").isVisible(), true);
    await captureSection(page, "#verify", "api-error-390.png");
    await page.unroute("**/api/v1/manifest/signed?version=latest");
    await page.unroute("**/api/v1/stats");
    await page.locator("#retry-manifest").click();
    await page.locator("#manifest-status.verified").waitFor();
    await page.locator("#retry-stats").click();
    await page.locator(".stats-heading").waitFor();
    passed("API failure states and retry recovery");
    await page.route("**/api/v1/stats", (route) =>
      route.fulfill({
        json: { total_installs: 0, by_agent: {}, by_os: {}, last_30_days: 0 },
      }),
    );
    await page.goto(origin);
    await page.locator(".stats-caption").waitFor({ state: "attached" });
    await page.locator(".activity-details > summary").click();
    assert.match(
      await page.locator(".stats-caption").textContent(),
      /No installs recorded/,
    );
    await captureSection(page, ".usage-ledger", "stats-empty-390.png");
    await page.unroute("**/api/v1/stats");
    passed("A real empty stats state without invented activity");
    const envelope = await (
      await page.request.get(origin + "/api/v1/manifest/signed?version=latest")
    ).json();
    envelope.manifest.version = "9.9.9";
    await page.route("**/api/v1/manifest/signed?version=latest", (route) =>
      route.fulfill({ json: envelope }),
    );
    await page.goto(origin);
    await page.locator("#manifest-status.signature-error").waitFor();
    assert.equal(await page.locator("#hash-run").isDisabled(), true);
    await page.unroute("**/api/v1/manifest/signed?version=latest");
    passed("A tampered manifest is refused in the website");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(origin);
    assert.equal(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
      ),
      0,
    );
    assert.equal(
      await page.locator("#security-core").getAttribute("data-motion"),
      "paused",
    );
    const stillFrame = await page
      .locator("#security-core")
      .getAttribute("data-frame");
    await page.waitForTimeout(150);
    assert.equal(
      await page.locator("#security-core").getAttribute("data-frame"),
      stillFrame,
    );
    passed("Reduced motion disables animations and preserves all content");

    let uploads = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") uploads++;
    });
    await page.goto(origin + "/report.html?sample=1");
    await page.locator(".finding").first().waitFor();
    assert.equal(await page.locator(".finding").count(), 3);
    await page.locator("#verdict-filter").selectOption("needs_validation");
    await page.locator(".finding summary").click();
    assert.match(
      await page.locator(".unresolved").textContent(),
      /PAYMENT_WEBHOOK_SECRET/,
    );
    await page.locator("#finding-search").fill("does-not-exist");
    assert.equal(await page.locator(".empty-results").isVisible(), true);
    await page.locator(".empty-results button").click();
    assert.equal(await page.locator(".finding").count(), 3);
    await page.locator("#severity-filter").selectOption("high");
    assert.equal(await page.locator(".finding").count(), 1);
    passed("Report verdict, severity, and source search filters");
    await page.locator("#file-input").setInputFiles({
      name: "my-audit.json",
      mimeType: "application/json",
      buffer: sample,
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#report-name").textContent === "my-audit.json",
    );
    assert.equal(
      await page.locator("#report-name").textContent(),
      "my-audit.json",
    );
    assert.equal(await page.locator("#sample-label").isVisible(), false);
    await page.locator("#expand-all").click();
    assert.equal(await page.locator(".finding[open]").count(), 3);
    assert.equal(uploads, 0);
    passed(
      "Local file loading, explicit sample labeling, expansion, and no uploads",
    );
    await page.locator("#file-input").setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    });
    await page.waitForFunction(() =>
      document.querySelector("#error").textContent.includes("could not parse"),
    );
    assert.match(await page.locator("#error").textContent(), /could not parse/);
    await page.locator("#file-input").setInputFiles({
      name: "empty.json",
      mimeType: "application/json",
      buffer: Buffer.from("[]"),
    });
    await page.waitForFunction(
      () => document.querySelector("#report-name").textContent === "empty.json",
    );
    assert.match(
      await page.locator(".empty-results").textContent(),
      /No candidates/,
    );
    await page.screenshot({
      path: path.join(output, "report-empty-390.png"),
      fullPage: true,
      animations: "disabled",
    });
    passed("Malformed and empty report states");

    const { openLocalReport } = await import(
      pathToFileURL(path.join(root, "cli/lib/report.js"))
    );
    const local = await openLocalReport(sample, { launchBrowser: false });
    try {
      await page.goto(local.url);
      await page.locator(".finding").first().waitFor();
      assert.equal(await page.locator(".finding").count(), 3);
      assert.equal(
        (
          await page.request.get(
            new URL("/fonts/geist-latin.woff2", local.url).href,
          )
        ).status(),
        200,
      );
      passed("The packaged CLI viewer loads its report and local fonts");
    } finally {
      local.server.closeAllConnections?.();
      await new Promise((resolve) => local.server.close(resolve));
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, "checks.json"),
      JSON.stringify({ checks, pageErrors: errors }, null, 2),
    );
    console.log(checks.length + " interaction checks passed.");
  } finally {
    await context.close();
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
