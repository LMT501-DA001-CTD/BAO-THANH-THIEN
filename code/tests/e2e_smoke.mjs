// E2E smoke (PROMPT §10, §12): upload -> Dispatch sees it in <= 3 s -> aiResult -> Verify -> Match -> Dispatch
// -> teams On Mission -> coordinator Finalize status change (Reporter sees Resolved).
// CAUTION: this test resets the demo data on the target server (DEMO_RESET). Use it only on a local server.
// Setup (one time):  npm install --prefix tests/e2e playwright-core@1.49.1
// Run:               NODE_PATH=tests/e2e/node_modules node tests/e2e_smoke.mjs
// Env: BASE (default http://localhost:8000), CHROMIUM (default /usr/bin/chromium).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const BASE = process.env.BASE || "http://localhost:8000";
const ROOT = new URL("..", import.meta.url).pathname;

// A fresh photo with EXIF GPS, time and the AEGIS-UAV-07 serial (same helper as the pytest tests).
const image = join(mkdtempSync(join(tmpdir(), "skyrescue-")), "uav.jpg");
execFileSync("python3", ["-c", "import sys; from tests.test_reports import jpeg; open(sys.argv[1], 'wb').write(jpeg(seed=7))", image], { cwd: ROOT });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/usr/bin/chromium" });
const errors = [];
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
function check(ok, msg) {
  if (!ok) throw new Error(`FAIL: ${msg}`);
  log(`ok  ${msg}`);
}

async function open(portal, user, password, viewport = { width: 1366, height: 900 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on("pageerror", (e) => errors.push(`${user}: ${e}`));
  await page.goto(`${BASE}/${portal}/`);
  await page.fill(`#${portal}-login-id`, user);
  await page.fill(`#${portal}-login-pass`, password);
  await Promise.all([page.waitForEvent("load"), page.click(`#${portal}-login-form button[type=submit]`)]);
  await page.waitForSelector(`#${portal}-portal-view:visible`);
  return page;
}
const statusOf = (page, rid) => page.evaluate((id) => {
  const s = SkyRescueStore.load();
  const r = s.reports.find((x) => x.id === id);
  return s.incidents.find((x) => x.id === r?.incidentId)?.status;
}, rid);
const waitStatus = (page, rid, status) => page.waitForFunction(([id, st]) => {
  const s = SkyRescueStore.load();
  const r = s.reports.find((x) => x.id === id);
  return s.incidents.find((x) => x.id === r?.incidentId)?.status === st;
}, [rid, status], { timeout: 10000 });
const waitDispatch = (page, rid, status) => page.waitForFunction(([id, st]) => {
  const s = SkyRescueStore.load();
  const r = s.reports.find((x) => x.id === id);
  const inc = s.incidents.find((x) => x.id === r?.incidentId);
  return s.dispatchOrders.find((d) => d.incidentId === inc?.id)?.status === st;
}, [rid, status], { timeout: 10000 });

try {
  const dispatch = await open("dispatch", "DISPATCH", "Dispatch#2025");
  await dispatch.evaluate(() => SkyRescueStore.reset());
  await dispatch.waitForTimeout(1200);

  // 0. National seed: 20 images, 7 provinces, 15 open + 5 resolved, all real photos.
  const seeded = await dispatch.evaluate(() => {
    const s = SkyRescueStore.load();
    return {
      incidents: s.incidents.length,
      provinces: [...new Set(s.incidents.map((i) => i.location.province))].sort(),
      samples: s.incidents.filter((i) => i.image.startsWith("/samples/EXT")).length,
      svg: s.incidents.filter((i) => i.image.endsWith(".svg")).length,
      open: s.incidents.filter((i) => i.status !== "Resolved").length,
      resolved: s.incidents.filter((i) => i.status === "Resolved").length,
      teams: s.teams.length
    };
  });
  check(seeded.incidents === 20 && seeded.samples === 20 && seeded.svg === 0, `national seed images: ${JSON.stringify(seeded)}`);
  check(seeded.provinces.length === 7, `national seed provinces: ${seeded.provinces.join(", ")}`);
  check(seeded.open === 15 && seeded.resolved === 5, `queue split open=${seeded.open} resolved=${seeded.resolved}`);
  check(seeded.teams === 18, `national team roster: ${seeded.teams}`);

  await dispatch.evaluate(() => { location.hash = "C1"; });
  await dispatch.waitForTimeout(1200);
  const nationalMap = await dispatch.evaluate(() => ({
    provinceMarkers: document.querySelectorAll(".province-cluster-marker, [data-map-province]").length,
    cards: document.querySelectorAll(".incident-card").length,
    note: document.querySelector(".page-head .muted")?.textContent || "",
    detail: document.querySelector(".card-header .muted")?.textContent || "",
    types: [...document.querySelectorAll("[data-map-type]")].map((node) => node.dataset.mapType),
    hasAllChip: [...document.querySelectorAll("[data-map-type]")].some((node) => node.innerText.includes("All Emergency")),
    layers: document.querySelectorAll("[data-map-layer]").length
  }));
  check(nationalMap.provinceMarkers === 7, `national map aggregated into ${nationalMap.provinceMarkers} province markers`);
  check(nationalMap.cards === 14, `national map shows active non-Normal incidents only (${nationalMap.cards})`);
  check(nationalMap.note.includes("National dataset"), `national dataset banner: ${nationalMap.note}`);
  check(JSON.stringify(nationalMap.types) === JSON.stringify(["Fire", "Flood", "Building Collapse", "Traffic Accident", "Unclassified"]), `map type filters: ${nationalMap.types.join(", ")}`);
  check(nationalMap.hasAllChip === false, "no All Emergency Types chip");
  check(nationalMap.layers === 0, "no Active/Resolved/Non-hazard layer buttons");

  await dispatch.click('[data-map-type="Fire"]');
  await dispatch.waitForTimeout(900);
  const fireMap = await dispatch.evaluate(() => ({
    provinceMarkers: document.querySelectorAll(".province-cluster-marker").length,
    cards: document.querySelectorAll(".incident-card").length
  }));
  check(fireMap.provinceMarkers === 3 && fireMap.cards === 3, `Fire filter narrows the map: ${JSON.stringify(fireMap)}`);
  await dispatch.click('[data-map-type="Fire"]');
  await dispatch.waitForTimeout(900);
  const clearedMap = await dispatch.evaluate(() => ({
    provinceMarkers: document.querySelectorAll(".province-cluster-marker").length,
    cards: document.querySelectorAll(".incident-card").length
  }));
  check(clearedMap.provinceMarkers === 7 && clearedMap.cards === 14, `clicking the active chip clears the filter: ${JSON.stringify(clearedMap)}`);

  await dispatch.evaluate(() => window.DispatchApp.focusProvince("Ha Noi"));
  await dispatch.waitForTimeout(1100);
  const zoomed = await dispatch.evaluate(() => ({
    provinceMarkers: document.querySelectorAll(".province-cluster-marker").length,
    paths: document.querySelectorAll("#leaflet-map path.leaflet-interactive").length,
    cards: document.querySelectorAll(".incident-card").length,
    back: document.querySelector("[data-map-province-reset]")?.textContent || ""
  }));
  check(zoomed.provinceMarkers === 0 && zoomed.paths === 3 && zoomed.cards === 3, `zoomed map shows only Ha Noi markers: ${JSON.stringify(zoomed)}`);
  check(zoomed.back.includes("Back to national view"), `province view has a back control: ${zoomed.back}`);
  await dispatch.click("[data-map-province-reset]");
  await dispatch.waitForTimeout(1100);
  const backToNational = await dispatch.evaluate(() => ({
    provinceMarkers: document.querySelectorAll(".province-cluster-marker").length,
    cards: document.querySelectorAll(".incident-card").length
  }));
  check(backToNational.provinceMarkers === 7 && backToNational.cards === 14, `back to national restores the national view: ${JSON.stringify(backToNational)}`);

  await dispatch.evaluate(() => { location.hash = "C2"; });
  await dispatch.waitForTimeout(700);
  const queueState = await dispatch.evaluate(() => ({
    tabs: [...document.querySelectorAll("[data-queue-tab]")].map((node) => node.innerText.replace(/\s+/g, " ").trim()),
    activeTab: document.querySelector(".queue-tab.active")?.innerText.replace(/\s+/g, " ").trim() || "",
    rows: document.querySelectorAll("[data-queue-incident]").length,
    thumbs: document.querySelectorAll("[data-queue-incident] img").length,
    reviewRows: document.querySelectorAll(".admin-review-inbox [data-report-review]").length,
    lifeLane: document.querySelectorAll(".life-risk-item").length,
    firstRank: document.querySelector("[data-queue-incident] .ahp-pill")?.textContent?.trim() || "",
    headers: [...document.querySelectorAll("th")].map((node) => node.innerText.trim())
  }));
  check(queueState.rows === 11 && queueState.thumbs === 11, `verified queue keeps eleven thumbnails: ${JSON.stringify(queueState)}`);
  check(queueState.activeTab.includes("Verified Incident Queue"), `verified queue tab is active by default: ${queueState.activeTab}`);
  check(queueState.reviewRows === 4, `review inbox keeps the four unverified seed images: ${queueState.reviewRows}`);
  check(queueState.lifeLane >= 3, `life-risk lane highlights mass-casualty cases: ${queueState.lifeLane}`);
  check(queueState.firstRank.startsWith("#CR-"), `Code Red is pinned first: ${queueState.firstRank}`);
  const codeRedState = await dispatch.evaluate(() => {
    const state = SkyRescueStore.load();
    const active = state.incidents.filter((incident) => incident.status !== "Resolved");
    return {
      active: active.length,
      codeRed: active.filter((incident) => SkyRescueStore.codeRedProfile(incident).critical).length,
      normalCodeRed: SkyRescueStore.codeRedProfile(state.incidents.find((incident) => incident.id === "INC-8816")).critical,
      goldenReason: SkyRescueStore.codeRedProfile(state.incidents.find((incident) => incident.id === "INC-8809")).codeRedReason
    };
  });
  check(codeRedState.codeRed === 14, `fourteen of fifteen active incidents are Code Red: ${JSON.stringify(codeRedState)}`);
  check(codeRedState.normalCodeRed === false, "Normal scenes are locked out of Code Red");
  check(codeRedState.goldenReason === "Golden Hour Escalation: Nạn nhân chờ quá 45 phút", `Golden Hour escalation reason: ${codeRedState.goldenReason}`);
  check(queueState.headers.some((h) => h.toLowerCase() === "victims") && queueState.headers.some((h) => h.toLowerCase() === "non-upright"), `queue exposes victims and non-upright columns: ${queueState.headers.join(" | ")}`);
  check(queueState.tabs.some((label) => label.includes("Resolved Cases")), `resolved tab present: ${queueState.tabs.join(" | ")}`);
  await dispatch.click('[data-queue-tab="resolved"]');
  await dispatch.waitForTimeout(500);
  const resolvedState = await dispatch.evaluate(() => ({
    rows: document.querySelectorAll("[data-queue-incident]").length,
    thumbs: document.querySelectorAll("[data-queue-incident] img").length
  }));
  check(resolvedState.rows === 5 && resolvedState.thumbs === 5, `resolved tab shows five thumbnails: ${JSON.stringify(resolvedState)}`);
  check(queueState.rows + queueState.reviewRows + resolvedState.rows === 20, `all 20 seed images remain reachable in the queue (${queueState.rows} + ${queueState.reviewRows} + ${resolvedState.rows})`);
  await dispatch.click('[data-queue-tab="auto"]');
  await dispatch.waitForTimeout(400);

  // Configuration: add a one-sided custom rule, save it, and verify it persists.
  await dispatch.evaluate(() => { location.hash = "Configuration"; });
  await dispatch.waitForTimeout(900);
  await dispatch.click('[data-action="add-custom-rule-modal"]');
  await dispatch.waitForSelector("#rule-tag");
  await dispatch.fill("#rule-name", "E2E Boat Rule");
  await dispatch.selectOption("#rule-category", "Soft");
  await dispatch.selectOption("#rule-tag", "RescueTeam.vehicle_type");
  await dispatch.fill("#rule-value", "rescue_boat");
  await dispatch.fill("#rule-weight", "7");
  await dispatch.fill("#rule-reason", "E2E regression check");
  await dispatch.click("#save-custom-rule");
  await dispatch.waitForTimeout(500);
  await dispatch.click('[data-action="save-settings"]');
  await dispatch.waitForTimeout(900);
  const savedRule = await dispatch.evaluate(() => {
    const rule = (SkyRescueStore.load().settings?.ruleEngine?.rules || []).find((item) => item.name === "E2E Boat Rule");
    return rule ? { id: rule.id, targetEntity: rule.targetEntity, customTagKey: rule.customTagKey, expectedValue: rule.expectedValue, weightDelta: rule.weightDelta } : null;
  });
  check(savedRule?.id === "CR-01" && savedRule.targetEntity === "RescueTeam" && savedRule.customTagKey === "vehicle_type" && savedRule.expectedValue === "rescue_boat" && savedRule.weightDelta === 7, `custom rule saved correctly: ${JSON.stringify(savedRule)}`);

  const reporter = await open("reporter", "REPORTER", "Reporter#2025");
  const reporterUi = await reporter.evaluate(() => ({
    scene: Boolean(document.querySelector("#r1-scene-tag")),
    victims: Boolean(document.querySelector("#r1-victims")),
    hints: document.querySelectorAll("[data-hint]").length,
    note: Boolean(document.querySelector("#r1-access-note"))
  }));
  check(!reporterUi.scene && !reporterUi.victims && reporterUi.hints === 0 && reporterUi.note, `reporter UI is note-only: ${JSON.stringify(reporterUi)}`);

  // 1. Upload
  await reporter.click('[data-action="scan"]');
  await reporter.click('[data-connect="AEGIS-UAV-07"]');
  await reporter.waitForSelector('[data-action="disconnect"]');
  const known = await reporter.evaluate(() => SkyRescueStore.load().reports.map((r) => r.id));
  await reporter.setInputFiles("#file-input", image);
  await reporter.waitForFunction(() => !document.querySelector('[data-action="submit"]')?.disabled);
  await reporter.click('[data-action="submit"]');
  const t0 = Date.now();
  const rid = await (await reporter.waitForFunction((ids) => SkyRescueStore.load().reports.find((r) => !ids.includes(r.id) && r.uploadStatus === "Uploaded")?.id, known, { timeout: 8000 })).jsonValue();
  await dispatch.waitForFunction((id) => SkyRescueStore.load().reports.some((r) => r.id === id), rid, { timeout: 10000 });
  const seenMs = Date.now() - t0;
  check(seenMs <= 3000, `${rid} visible in Dispatch after ${seenMs} ms (limit 3000)`);

  // 2. AI result (the ML job starts without a user action)
  await dispatch.waitForFunction((id) => ["Completed", "Failed"].includes(SkyRescueStore.load().reports.find((r) => r.id === id)?.processingStatus), rid, { timeout: 60000 });
  const ai = await dispatch.evaluate((id) => SkyRescueStore.load().reports.find((r) => r.id === id).aiResult, rid);
  check(ai && ai.status !== "failed", `aiResult status=${ai?.status} type=${ai?.incidentType} latency=${ai?.latencyMs} ms`);

  // 3. Verify
  await dispatch.evaluate(() => { location.hash = "C2"; });
  await dispatch.waitForSelector(`[data-report-review="${rid}"]`, { timeout: 10000, state: "attached" });
  await dispatch.evaluate((sel) => document.querySelector(sel)?.click(), `[data-report-review="${rid}"]`);
  await dispatch.waitForSelector("#admin-review-type", { timeout: 10000 });
  await dispatch.selectOption("#admin-review-type", "Flood");
  await dispatch.click('[data-action="verify-match"]');
  await waitStatus(dispatch, rid, "Matching Team");
  await dispatch.waitForFunction(() => location.hash === "#C4", null, { timeout: 5000 });
  const verifyMatch = await dispatch.evaluate(() => ({
    hash: location.hash,
    eligible: document.querySelectorAll("[data-team-select]").length,
    selected: document.querySelector("[data-team-select].selected")?.dataset.teamSelect || null,
    eta: document.body.innerText.includes("Estimated ETA")
  }));
  check(verifyMatch.hash === "#C4", `verify & match lands directly in C4: ${verifyMatch.hash}`);
  check(Boolean(verifyMatch.selected), `C4 preselects the top eligible team: ${verifyMatch.selected} of ${verifyMatch.eligible}`);
  check(verifyMatch.eta, "C4 shows an estimated ETA for the selected team");
  check(true, "verified, incident is Matching Team");

  // 4. Match team (C4) and dispatch (C5). Confirmation deploys immediately.
  await dispatch.click('[data-team-select="SAR-01"]');
  await dispatch.click('[data-screen="C5"]');
  await dispatch.click('[data-action="confirm-dispatch"]');
  await waitStatus(dispatch, rid, "In Progress");
  await waitDispatch(dispatch, rid, "Confirmed");
  const teamStatus = await dispatch.evaluate(() => SkyRescueStore.load().teams.find((t) => t.id === "SAR-01")?.status);
  check(teamStatus === "On Mission", `dispatched to SAR-01, team is ${teamStatus}, incident is In Progress`);

  // 5. Coordinator finalization: status change only, reporter sees Resolved
  const incidentId = await dispatch.evaluate((id) => SkyRescueStore.load().reports.find((r) => r.id === id).incidentId, rid);
  await dispatch.evaluate((id) => window.DispatchApp.openIncident(id), incidentId);
  await dispatch.click('[data-action="finalize"]');
  await waitStatus(dispatch, rid, "Resolved");
  await waitStatus(reporter, rid, "Resolved");
  await waitDispatch(dispatch, rid, "Completed");
  const finalized = await dispatch.evaluate((id) => {
    const s = SkyRescueStore.load();
    const order = s.dispatchOrders.find((x) => x.incidentId === id);
    const team = s.teams.find((x) => x.id === "SAR-01");
    return {
      prioritySource: order?.prioritySnapshot?.source,
      priorityScore: order?.prioritySnapshot?.score,
      dispatchStatus: order?.status,
      teamStatus: team?.status
    };
  }, incidentId);
  check(finalized.dispatchStatus === "Completed", `dispatch completed: ${JSON.stringify(finalized)}`);
  check(finalized.prioritySource === "server" && Number.isFinite(finalized.priorityScore), `server AHP snapshot: ${JSON.stringify(finalized)}`);
  check(finalized.teamStatus === "Available", `team released after finalize: ${finalized.teamStatus}`);
  check(true, `reporter sees Resolved (final status ${await statusOf(reporter, rid)})`);

  // 5b. F1/F3: a trusted UAV sample with a high-confidence emergency auto-verifies
  // and dispatches from the unified workspace with one action click.
  await reporter.evaluate(() => { location.hash = "R1"; });
  await reporter.waitForSelector("#r1-sample");
  const knownAuto = await reporter.evaluate(() => SkyRescueStore.load().reports.map((r) => r.id));
  await reporter.selectOption("#r1-sample", "EXT01.jpg");
  await reporter.waitForTimeout(1000);
  await reporter.click('[data-action="submit"]');
  const autoRid = await (await reporter.waitForFunction((ids) => SkyRescueStore.load().reports.find((r) => !ids.includes(r.id) && r.uploadStatus === "Uploaded")?.id, knownAuto, { timeout: 8000 })).jsonValue();
  await dispatch.waitForFunction((id) => {
    const s = SkyRescueStore.load();
    const report = s.reports.find((r) => r.id === id);
    const incident = s.incidents.find((x) => x.reportId === id);
    return report?.processingStatus === "Completed" && incident?.verificationStatus === "verified";
  }, autoRid, { timeout: 60000 });
  const autoState = await dispatch.evaluate((id) => {
    const s = SkyRescueStore.load();
    const report = s.reports.find((r) => r.id === id);
    const incident = s.incidents.find((x) => x.reportId === id);
    return { method: report?.verificationMethod, policy: report?.autoVerifyPolicy, status: incident?.status, type: incident?.originalType, conf: incident?.aiConfidence };
  }, autoRid);
  check(autoState.method === "auto_drone" && autoState.status === "Matching Team", `trusted UAV auto-verifies: ${JSON.stringify(autoState)}`);
  const inboxHasAuto = await dispatch.evaluate((id) => Boolean(document.querySelector(`.admin-review-inbox [data-report-review="${id}"]`)), autoRid);
  check(!inboxHasAuto, "auto-verified report is not in the manual review inbox");

  // 5c. Edit Type guardrail: an Auto-Verified incident reopens for re-verification.
  const autoIncidentId = await dispatch.evaluate((id) => SkyRescueStore.load().reports.find((r) => r.id === id)?.incidentId, autoRid);
  await dispatch.evaluate((id) => window.DispatchApp.openIncident(id), autoIncidentId);
  await dispatch.waitForSelector('[data-action="edit-type"]', { timeout: 10000 });
  await dispatch.click('[data-action="edit-type"]');
  await dispatch.waitForSelector("#admin-review-type", { timeout: 10000 });
  const reopened = await dispatch.evaluate((id) => {
    const state = SkyRescueStore.load();
    const report = state.reports.find((item) => item.id === id);
    const incident = state.incidents.find((item) => item.reportId === id);
    return { hash: location.hash, reportStatus: report?.verificationStatus, incidentStatus: incident?.status, method: report?.verificationMethod };
  }, autoRid);
  check(reopened.hash === "#C9R" && reopened.reportStatus === "unverified" && reopened.incidentStatus === "Unverified" && reopened.method === null, `Edit Type reopens Auto-Verified incident: ${JSON.stringify(reopened)}`);
  await dispatch.selectOption("#admin-review-type", "Fire");
  await dispatch.click('[data-action="verify-report"]');
  await waitStatus(dispatch, autoRid, "Matching Team");
  const reverified = await dispatch.evaluate((id) => SkyRescueStore.load().reports.find((item) => item.id === id)?.verificationMethod, autoRid);
  check(reverified === "admin", `Edit Type re-verification is recorded: ${reverified}`);

  await dispatch.evaluate(() => { location.hash = "C2"; });
  await dispatch.waitForSelector('[data-c2-mode="workspace"]');
  await dispatch.evaluate(() => document.querySelector('[data-c2-mode="workspace"]')?.click());
  await dispatch.waitForSelector(`[data-workspace-select="${autoRid}"]`, { timeout: 10000 });
  await dispatch.evaluate((sel) => document.querySelector(sel)?.click(), `[data-workspace-select="${autoRid}"]`);
  await dispatch.waitForTimeout(400);
  const workspaceButton = await dispatch.evaluate(() => ({
    text: document.querySelector(".triage-dispatch-btn")?.innerText.trim() || "",
    disabled: document.querySelector(".triage-dispatch-btn")?.disabled ?? null
  }));
  check(workspaceButton.text.includes("Confirm Dispatch") && workspaceButton.disabled === false, `workspace offers one-click dispatch: ${JSON.stringify(workspaceButton)}`);
  await dispatch.evaluate(() => document.querySelector(".triage-dispatch-btn")?.click());
  await waitStatus(dispatch, autoRid, "In Progress");
  await waitDispatch(dispatch, autoRid, "Confirmed");
  await dispatch.evaluate((id) => window.DispatchApp.openIncident(id), autoIncidentId);
  await dispatch.click('[data-action="finalize"]');
  await waitStatus(dispatch, autoRid, "Resolved");
  check(true, `auto-verified ${autoRid} dispatched from workspace and finalized`);

  // 6. Audit actors come from the server sessions and the override/finalize events exist.
  const audit = await dispatch.evaluate(() => SkyRescueStore.load().audit.slice(0, 30).map((a) => `${a.event}/${a.actor?.id}`));
  check(audit.includes("DISPATCH_CONFIRMED/DISPATCH") && audit.includes("INCIDENT_RESOLVED/DISPATCH") && audit.includes("AI_COMPLETED/SYSTEM"), `audit: ${audit.join(", ")}`);
  check(audit.includes("REPORT_AUTO_VERIFIED/DISPATCH") && audit.includes("TRIAGE_VERIFY_AND_DISPATCH/DISPATCH"), `auto-verify/workspace audit: ${audit.join(", ")}`);
  check(audit.includes("REPORT_REOPENED_FOR_REVERIFICATION/DISPATCH"), `Edit Type audit: ${audit.join(", ")}`);

  // 7. Phone width: no horizontal page scroll in the Reporter portal
  const phone = await open("reporter", "CITIZEN", "Citizen#2025", { width: 390, height: 844 });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `Reporter at 390 px: horizontal overflow ${overflow} px`);

  check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  log("PASS");
} finally {
  await browser.close();
}
