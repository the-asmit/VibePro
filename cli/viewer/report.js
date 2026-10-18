const levels = ["critical", "high", "medium", "low", "informational"];
const verdictLabels = {
  confirmed: "Confirmed",
  needs_validation: "Needs validation",
  rejected: "Rejected",
};
const state = { findings: [], expanded: false };
const $ = (selector) => document.querySelector(selector);
const fileInput = $("#file-input");
const drop = $("#drop-zone");

function text(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value ?? "";
  return node;
}
function setError(message = "") {
  $("#error").textContent = message;
}
function validateShape(findings) {
  if (!Array.isArray(findings))
    throw new Error("The report must contain a JSON array of findings.");
  for (const item of findings) {
    if (
      !item ||
      !Object.hasOwn(verdictLabels, item.verdict) ||
      typeof item.title !== "string" ||
      typeof item.description !== "string" ||
      !Array.isArray(item.trace) ||
      !Array.isArray(item.evidence)
    )
      throw new Error(
        "This file does not contain valid VibePro findings records.",
      );
    if (
      item.verdict === "confirmed" &&
      (!levels.includes(item.severity?.overall_severity) ||
        typeof item.remediation?.strategy !== "string")
    )
      throw new Error(
        "A confirmed finding is missing its severity or suggested fix.",
      );
    if (
      item.verdict === "needs_validation" &&
      (!Array.isArray(item.blockers) || !item.blockers.length)
    )
      throw new Error(
        "A finding that needs validation is missing its open question.",
      );
  }
}
function renderSummary(findings) {
  const counts = { confirmed: 0, needs_validation: 0, rejected: 0 };
  for (const item of findings) counts[item.verdict]++;
  const root = $("#summary");
  root.replaceChildren();
  const notes = {
    confirmed: "Evidence supports the claim",
    needs_validation: "An open question remains",
    rejected: "The claim did not hold up",
  };
  for (const [verdict, count] of Object.entries(counts)) {
    const article = document.createElement("article");
    article.append(
      text("strong", "", count),
      text("span", "", verdictLabels[verdict]),
      text("small", "", notes[verdict]),
    );
    root.append(article);
  }
}
function renderSeverity(findings) {
  const counts = Object.fromEntries(levels.map((level) => [level, 0]));
  findings
    .filter((item) => item.verdict === "confirmed")
    .forEach((item) => counts[item.severity.overall_severity]++);
  const maximum = Math.max(1, ...Object.values(counts));
  const root = $("#severity-bars");
  root.replaceChildren();
  for (const level of levels) {
    const row = text("div", "severity-item", "");
    const track = text("div", "severity-track", "");
    const bar = document.createElement("i");
    bar.style.setProperty("--value", counts[level] / maximum);
    track.append(bar);
    row.append(text("span", "", level), track, text("b", "", counts[level]));
    row.setAttribute("aria-label", level + ": " + counts[level]);
    root.append(row);
  }
}
function sourceLocation(finding) {
  const point =
    finding.trace.find((step) => step.kind === "sink") ||
    finding.trace[0] ||
    finding.evidence[0];
  return point ? point.file + ":" + point.line : "No source location";
}
function contentSection(title, content, className = "") {
  const section = text("section", className, "");
  section.append(text("h4", "", title), text("p", "", content));
  return section;
}
function sourceTrace(item) {
  const section = text("section", "source-trace", "");
  section.append(text("h4", "", "Follow the source"));
  const trace = text("ol", "evidence-trace", "");
  for (const step of item.trace) {
    const line = document.createElement("li");
    line.append(
      text("code", "", step.file + ":" + step.line),
      text(
        "span",
        "",
        (step.kind || "trace").replaceAll("_", " ") +
          (step.scope ? " / " + step.scope : ""),
      ),
      document.createTextNode(step.description || ""),
    );
    trace.append(line);
  }
  section.append(trace);
  return section;
}
function cardFor(item, index) {
  const card = text("details", "finding", "");
  card.dataset.verdict = item.verdict;
  card.open =
    state.expanded ||
    (index === 0 && !state.findings.some((f) => f.verdict === "confirmed")) ||
    (index === 0 && item.verdict === "confirmed");
  const summary = document.createElement("summary");
  const titleBlock = document.createElement("div");
  const meta = text("div", "finding-meta", "");
  meta.append(text("span", "", sourceLocation(item)));
  if (item.verdict === "confirmed")
    meta.append(
      text(
        "span",
        "severity-badge",
        item.severity.overall_severity + " severity",
      ),
    );
  titleBlock.append(text("h3", "finding-title", item.title), meta);
  summary.append(
    text("span", "finding-badge", verdictLabels[item.verdict]),
    titleBlock,
    text("span", "finding-arrow", "+"),
  );
  const body = text("div", "finding-body", "");
  body.append(text("p", "finding-description", item.description));
  const grid = text("div", "finding-content-grid", "");
  const explanation = document.createElement("div");
  if (item.verdict === "confirmed") {
    explanation.append(
      contentSection("Root cause", item.root_cause),
      contentSection("Expected behavior", item.intended_behavior),
    );
    if (item.execution?.observed_result)
      explanation.append(
        contentSection("Observed result", item.execution.observed_result),
      );
    body.append(grid);
    grid.append(explanation, sourceTrace(item));
    body.append(
      contentSection(
        "Suggested fix",
        item.remediation.strategy,
        "suggested-fix",
      ),
    );
  } else if (item.verdict === "needs_validation") {
    body.append(
      contentSection(
        "The unresolved question",
        item.blockers.join(" "),
        "unresolved",
      ),
    );
    const plan = text("section", "", "");
    plan.append(text("h4", "", "What would settle it"));
    const list = text("dl", "validation-plan", "");
    for (const [key, label] of [
      ["local", "Validate locally"],
      ["deployment", "Check the deployment"],
    ])
      if (item.validation_plan?.[key]) {
        const group = document.createElement("div");
        group.append(
          text("dt", "", label),
          text("dd", "", item.validation_plan[key]),
        );
        list.append(group);
      }
    plan.append(list);
    grid.append(plan, sourceTrace(item));
    body.append(grid);
  } else {
    explanation.append(
      contentSection(
        "Why this was rejected",
        item.reason || "No rejection reason provided.",
        "rejected-reason",
      ),
    );
    grid.append(explanation, sourceTrace(item));
    body.append(grid);
  }
  card.append(summary, body);
  return card;
}
function filters() {
  const verdict = $("#verdict-filter").value,
    severity = $("#severity-filter").value;
  const search = $("#finding-search").value.trim().toLowerCase();
  const visible = state.findings.filter((item) => {
    const level =
      item.verdict === "confirmed" ? item.severity.overall_severity : "unrated";
    return (
      (verdict === "all" || item.verdict === verdict) &&
      (severity === "all" || level === severity) &&
      (!search ||
        (item.title + " " + sourceLocation(item))
          .toLowerCase()
          .includes(search))
    );
  });
  $("#result-count").textContent =
    visible.length + " of " + state.findings.length + " candidates";
  const root = $("#finding-list");
  root.replaceChildren();
  if (!visible.length) {
    const empty = text("div", "empty-results", "");
    empty.append(
      text(
        "h3",
        "",
        state.findings.length
          ? "No findings match these filters."
          : "No candidates in this report.",
      ),
      text(
        "p",
        "",
        state.findings.length
          ? "Try another title, file, or verdict."
          : "This report contains an empty findings array.",
      ),
    );
    if (state.findings.length) {
      const reset = text("button", "text-button", "Clear filters ↻");
      reset.type = "button";
      reset.addEventListener("click", clearFilters);
      empty.append(reset);
    }
    root.append(empty);
  } else visible.forEach((item, index) => root.append(cardFor(item, index)));
}
function clearFilters() {
  $("#finding-search").value = "";
  $("#verdict-filter").value = "all";
  $("#severity-filter").value = "all";
  filters();
}
function render(findings, name = "findings.json", sample = false) {
  validateShape(findings);
  state.findings = findings;
  state.expanded = false;
  $("#report").hidden = false;
  $("#report-empty").hidden = true;
  document.body.classList.add("has-report");
  $("#sample-label").hidden = !sample;
  $("#report-name").textContent = sample ? "A sample audit report" : name;
  $("#report-description").textContent = sample
    ? "Illustrative findings. This is not an audit of VibePro."
    : findings.length + " candidates loaded from your device";
  $("#expand-all").setAttribute("aria-expanded", "false");
  $("#expand-all").textContent = "Expand all findings +";
  renderSummary(findings);
  renderSeverity(findings);
  clearFilters();
  setError();
}
async function readFile(file) {
  try {
    if (file.size > 16 * 1024 * 1024)
      throw new Error(
        "The file is larger than 16 MB. Choose a smaller findings.json.",
      );
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    render(JSON.parse(raw), file.name);
  } catch (error) {
    setError(
      error instanceof SyntaxError
        ? "We could not parse this JSON file. Check its format and try again."
        : error.message || "Could not read findings.json.",
    );
  }
  fileInput.value = "";
}
async function loadSample() {
  const button = $("#sample-button");
  button.disabled = true;
  button.textContent = "Loading sample…";
  try {
    const response = await fetch("sample-findings.json");
    if (!response.ok)
      throw new Error("The sample could not be loaded. Please try again.");
    render(await response.json(), "Sample", true);
  } catch (error) {
    setError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Explore a sample ↗";
    document.body.classList.add("report-ready");
  }
}
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) readFile(fileInput.files[0]);
});
$("#sample-button").addEventListener("click", loadSample);
$("#verdict-filter").addEventListener("change", filters);
$("#severity-filter").addEventListener("change", filters);
$("#finding-search").addEventListener("input", filters);
$("#expand-all").addEventListener("click", () => {
  state.expanded = !state.expanded;
  document
    .querySelectorAll(".finding")
    .forEach((card) => (card.open = state.expanded));
  $("#expand-all").setAttribute("aria-expanded", String(state.expanded));
  $("#expand-all").textContent = state.expanded
    ? "Collapse all findings −"
    : "Expand all findings +";
});
for (const name of ["dragenter", "dragover"])
  drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.add("dragging");
  });
for (const name of ["dragleave", "drop"])
  drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.remove("dragging");
  });
drop.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) readFile(file);
});
const params = new URLSearchParams(window.location.search);
if (params.get("sample") === "1") loadSample();
else if (params.get("local") === "1") {
  const back = document.querySelector(".report-nav nav a");
  back.textContent = "Reload this report ↻";
  back.href = window.location.href;
  document.querySelector(".wordmark").href = window.location.href;
  fetch("/findings.json", { cache: "no-store" })
    .then((response) => {
      if (!response.ok)
        throw new Error(
          "The local report could not be loaded. Choose findings.json to open it.",
        );
      return response.json();
    })
    .then((data) => render(data))
    .catch((error) => setError(error.message))
    .finally(() => document.body.classList.add("report-ready"));
} else document.body.classList.add("report-ready");
