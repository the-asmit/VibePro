const publicKeyPem =
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA89eYqSksJnd9qta/MoyXjVqebeI+aaD5zywvdXXCmTw=\n-----END PUBLIC KEY-----\n";
const $ = (selector) => document.querySelector(selector);
const localDemo = ["localhost", "127.0.0.1", "[::1]"].includes(
  location.hostname,
);
const localApi =
  localDemo && location.port && location.port !== "8011"
    ? " --api " + location.origin
    : "";
const installer = localDemo ? "npx vibepro-cli" : "npx https://vibepro-audit.vercel.app/cli.tgz";
const command = installer + " install" + localApi;
$(".hero-command code").textContent = command;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let manifest;
let selectedAgent = "codex";
let toastTimer;

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function text(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}
async function request(url) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response;
}
async function verificationPublicKey() {
  if (!localDemo) return publicKeyPem;
  const response = await fetch('/.vibepro-dev.json', {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) return publicKeyPem;
  if (!response.ok) throw new Error('Local verification configuration is unavailable');
  const configuration = await response.json();
  if (typeof configuration.publicKeyPem !== 'string') throw new Error('Invalid local verification configuration');
  return configuration.publicKeyPem;
}
function feedback(message) {
  const toast = $("#global-feedback");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}
async function copy(value, button) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "Copied";
    feedback("Copied to clipboard.");
    if (button.id === "copy-command")
      $("#copy-feedback").textContent = "Command copied to clipboard.";
    setTimeout(() => {
      button.textContent = label;
      $("#copy-feedback").textContent = "";
    }, 2000);
  } catch {
    feedback("Select the text and copy it with your keyboard.");
  }
}

async function loadManifest() {
  const status = $("#manifest-status");
  status.textContent = "Checking signature…";
  status.className = "";
  $("#retry-manifest").hidden = true;
  $("#hash-run").disabled = true;
  $("#hash-file").disabled = true;
  try {
    const envelope = await (
      await request("/api/v1/manifest/signed?version=latest")
    ).json();
    const body = (await verificationPublicKey())
      .replace(/-----[^-]+-----/g, "")
      .replace(/\s+/g, "");
    const keyBytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    if (
      hex(await crypto.subtle.digest("SHA-256", keyBytes)) !== envelope.key_id
    )
      throw new Error("Untrusted signing key");
    const key = await crypto.subtle.importKey(
      "spki",
      keyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const signature = Uint8Array.from(atob(envelope.signature), (c) =>
      c.charCodeAt(0),
    );
    if (
      !(await crypto.subtle.verify(
        "Ed25519",
        key,
        signature,
        new TextEncoder().encode(canonical(envelope.manifest)),
      ))
    )
      throw new Error("Signature did not verify");
    manifest = envelope.manifest;
    if (!Array.isArray(manifest.files) || !manifest.files.length)
      throw new Error("Release has no files");
    status.textContent = "Signature verified";
    status.className = "verified";
    $(".release-status").classList.add("is-verified");
    $("#manifest-version").textContent = "v" + manifest.version;
    $("#manifest-count").textContent = String(manifest.files.length);
    $("#public-key-fingerprint").textContent = envelope.key_id;
    $("#copy-fingerprint").disabled = false;
    $("#engine-live").textContent =
      "Audit engine v" +
      manifest.version +
      " · " +
      manifest.files.length +
      " signed files";
    const list = $("#manifest-files");
    list.replaceChildren();
    const select = $("#hash-file");
    select.replaceChildren();
    const ordered = [...manifest.files].sort((a, b) =>
      a.path === "SKILL.md"
        ? -1
        : b.path === "SKILL.md"
          ? 1
          : a.path.localeCompare(b.path),
    );
    for (const file of ordered) {
      const option = document.createElement("option");
      option.value = file.path;
      option.textContent = file.path;
      select.append(option);
      const row = text("div", "manifest-file", "");
      row.append(
        text("code", "manifest-name", file.path),
        text("code", "manifest-hash", file.sha256),
      );
      list.append(row);
    }
    select.disabled = false;
    $("#hash-run").disabled = false;
    selectFile();
  } catch {
    manifest = null;
    status.textContent = "Signature could not be verified";
    status.className = "signature-error";
    $(".release-status").classList.remove("is-verified");
    $("#engine-live").textContent =
      "Live release details are temporarily unavailable.";
    $("#manifest-version").textContent = "Unavailable";
    $("#manifest-count").textContent = "No";
    $("#manifest-files").replaceChildren(
      text(
        "p",
        "loading-line",
        "We could not load and verify the release. Please try again.",
      ),
    );
    $("#public-key-fingerprint").textContent = "No verified manifest available";
    $("#copy-fingerprint").disabled = true;
    $("#hash-file").replaceChildren(
      new Option("Verified release unavailable", ""),
    );
    $("#retry-manifest").hidden = false;
    $("#hash-result").textContent = "File checks need a verified manifest.";
  }
}
function selectFile() {
  if (!manifest) return;
  const file = manifest.files.find(
    (file) => file.path === $("#hash-file").value,
  );
  $("#expected-hash").textContent = file.sha256;
  $("#computed-hash").textContent = "Run the check to compute this digest.";
  $("#hash-result").className = "hash-result";
  $("#hash-result").textContent = "Ready to check " + file.path + ".";
  $(".hash-visual").classList.remove("is-checked");
  $(".hash-end").textContent = "COMPARE";
  $("#byte-field")
    .querySelectorAll("span")
    .forEach((byte) => {
      byte.textContent = "--";
    });
}
async function hashFile() {
  if (!manifest) return;
  const file = manifest.files.find(
    (file) => file.path === $("#hash-file").value,
  );
  const button = $("#hash-run"),
    visual = $(".hash-visual"),
    result = $("#hash-result");
  button.disabled = true;
  $("#hash-file").disabled = true;
  visual.classList.remove("is-checked");
  visual.classList.add("is-hashing");
  button.textContent = "Checking bytes…";
  result.className = "hash-result";
  result.textContent = "Downloading " + file.path + "…";
  try {
    const path = file.path.split("/").map(encodeURIComponent).join("/");
    const bytes = await (
      await request(
        "/api/v1/versions/" +
          encodeURIComponent(manifest.version) +
          "/files/" +
          path,
      )
    ).arrayBuffer();
    const preview = new Uint8Array(bytes).slice(0, 32);
    $("#byte-field")
      .querySelectorAll("span")
      .forEach((node, index) => {
        node.textContent =
          index < preview.length
            ? preview[index].toString(16).padStart(2, "0")
            : "--";
      });
    const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
    $("#computed-hash").textContent = digest;
    const valid = digest === file.sha256 && bytes.byteLength === file.size;
    $(".hash-end").textContent = valid ? "MATCH" : "MISMATCH";
    result.className = "hash-result " + (valid ? "pass" : "error");
    result.textContent = valid
      ? "Match confirmed. " +
        bytes.byteLength.toLocaleString() +
        " bytes verified."
      : "Mismatch. These bytes do not match the signed release.";
    if (valid) visual.classList.add("is-checked");
  } catch {
    result.className = "hash-result error";
    result.textContent =
      "The file could not be checked. Try again when the API is available.";
  } finally {
    visual.classList.remove("is-hashing");
    button.disabled = false;
    $("#hash-file").disabled = false;
    button.textContent = "Verify this file ↗";
  }
}
async function loadStats() {
  const root = $("#live-stats");
  root.hidden = false;
  $("#stats-fallback").hidden = true;
  try {
    const stats = await (await request("/api/v1/stats")).json();
    const total = Number(stats.total_installs);
    if (!Number.isSafeInteger(total) || total < 0)
      throw new Error("Invalid stats");
    root.replaceChildren();
    const heading = text("div", "stats-heading", "");
    const label = text(
      "p",
      "",
      total === 1
        ? "recorded install or update"
        : "recorded installs and updates",
    );
    label.append(
      text(
        "small",
        "",
        Number(stats.last_30_days).toLocaleString() + " in the last 30 days",
      ),
    );
    heading.append(text("strong", "", total.toLocaleString()), label);
    const agents = text("div", "agent-counts", "");
    for (const [key, name] of [
      ["codex", "Codex"],
      ["claude", "Claude"],
      ["cursor", "Cursor"],
      ["antigravity", "Antigravity"],
      ["gemini", "Gemini"],
    ]) {
      const cell = document.createElement("div");
      cell.append(
        text("b", "", Number(stats.by_agent?.[key] || 0).toLocaleString()),
        text("span", "", name),
      );
      agents.append(cell);
    }
    const caption =
      total === 0
        ? "No installs recorded yet. Events will appear here as people use the installer."
        : total < 20
          ? "Anonymous install and update events. These are not unique-user counts."
          : "Live event totals, including updates. These are not unique-user counts.";
    root.append(heading, agents, text("p", "stats-caption", caption));
  } catch {
    root.hidden = true;
    $("#stats-fallback").hidden = false;
  }
}

const stages = [
  {
    phase: "Reconnaissance",
    title: "Who can ask for this profile?",
    code: "GET /api/profile/another-user-id\n\nquery({ id: req.params.userId })",
    note: "Start with the route, the signed-in user, and the data the handler returns.",
    state: "QUESTION OPEN",
    verdict: "Ownership check?",
    source: "src/routes/profile.js:18 → :24",
  },
  {
    phase: "Coverage-led hunting",
    title: "The request reaches another user’s data.",
    code: "req.params.userId\n  → profile query\n  → res.json(profile)",
    note: "The path parameter reaches the database query without an ownership predicate.",
    state: "CANDIDATE",
    verdict: "Trace established",
    source: "Request input → handler → data returned",
  },
  {
    phase: "Adversarial validation",
    title: "What can’t the source tell us?",
    code: "verifySignature(request,\n  env.PAYMENT_WEBHOOK_SECRET)",
    note: "The webhook claim depends on a deployed secret binding. The repository alone does not settle it.",
    state: "NEEDS VALIDATION",
    verdict: "Check deployment",
    source: "src/routes/webhook.js:36",
  },
  {
    phase: "Structured evidence",
    title: "Make the claim reproducible.",
    code: 'verdict: "confirmed"\nfile: "src/routes/profile.js"\nline: 24\nseverity: "high"',
    note: "The profile finding records the path, required session, observed result, and a specific authorization fix.",
    state: "EVIDENCE RECORDED",
    verdict: "Ready for review",
    source: "Schema-checked findings.json",
  },
  {
    phase: "Independent review",
    title: "This query claim gets rejected.",
    code: 'db.query("… WHERE term = ?",\n  [req.query.term])',
    note: "The driver binds the search term as a value. Independent review rejects the suspected SQL injection.",
    state: "REJECTED",
    verdict: "Parameterized query",
    source: "src/routes/search.js:22",
    className: "is-rejected",
  },
  {
    phase: "Report",
    title: "Show the result, including the doubts.",
    code: "confirmed         1\nneeds_validation  1\nrejected          1",
    note: "The sample report keeps the profile issue, the webhook question, and the rejected query claim visible.",
    state: "REVIEW COMPLETE",
    verdict: "Open the evidence",
    source: "Illustrative sample findings",
    className: "is-confirmed",
  },
];
const chapters = [...document.querySelectorAll(".story-chapter")];
function setStage(index) {
  const stage = stages[index];
  if (
    !reducedMotion.matches &&
    !document.body.classList.contains("motion-paused")
  ) {
    const snippet = $(".evidence-snippet");
    snippet.getAnimations().forEach((animation) => animation.cancel());
    snippet.animate(
      [
        { opacity: 0.55, transform: "translateY(4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 260, easing: "ease-out" },
    );
  }

  $(".evidence-board").dataset.currentStage = String(index);
  $(".evidence-progress").setAttribute(
    "aria-label",
    "Audit pass " + (index + 1) + " of 6: " + stage.phase,
  );
  $("#evidence-stage").textContent = stage.phase;
  $("#evidence-title").textContent = stage.title;
  $(".evidence-snippet code").textContent = stage.code;
  $("#evidence-observation").textContent = stage.note;
  $("#evidence-reference").textContent = stage.source;
  const verdict = $("#evidence-verdict");
  verdict.className = "evidence-verdict " + (stage.className || "");
  verdict.replaceChildren(
    text("span", "", stage.state),
    text("b", "", stage.verdict),
  );
  document
    .querySelectorAll(".evidence-progress>span")
    .forEach((line, i) => line.classList.toggle("is-done", i <= index));
  chapters.forEach((chapter, i) => {
    chapter.classList.toggle("is-current", i === index);
    chapter
      .querySelector("button")
      .setAttribute("aria-pressed", String(i === index));
  });
}
chapters.forEach((chapter, i) =>
  chapter.querySelector("button").addEventListener("click", () => setStage(i)),
);
setStage(0);
function updateCommand() {
  $("#agent-command").textContent =
    command +
    " --agent " +
    selectedAgent +
    ($("#preview-install").checked ? " --dry-run" : "");
}
document.querySelectorAll("[data-agent]").forEach((button) =>
  button.addEventListener("click", () => {
    selectedAgent = button.dataset.agent;
    document.querySelectorAll("[data-agent]").forEach((item) => {
      item.classList.toggle("is-active", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    updateCommand();
  }),
);
$("#preview-install").addEventListener("change", updateCommand);
$("#copy-command").addEventListener("click", (event) =>
  copy(command, event.currentTarget),
);
document
  .querySelectorAll("[data-copy-agent]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      copy($("#agent-command").textContent, button),
    ),
  );
$("#copy-fingerprint").addEventListener("click", (event) =>
  copy($("#public-key-fingerprint").textContent, event.currentTarget),
);
$("#hash-file").addEventListener("change", selectFile);
$("#hash-run").addEventListener("click", hashFile);
$("#retry-manifest").addEventListener("click", loadManifest);
$("#retry-stats").addEventListener("click", loadStats);

for (let i = 0; i < 32; i++) $("#byte-field").append(text("span", "", "--"));
updateCommand();
loadManifest();
loadStats();
