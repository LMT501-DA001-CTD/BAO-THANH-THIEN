// PROMPT A.10 test vectors. A wrong value is a blocking error (PROMPT §10).
// Run: node --test 'tests/*.test.mjs'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Load the real browser file. The page globals that the formulas do not use are empty stubs.
const window = { SkyRescueDemo: { DEFAULT_RULE_ENGINE: { rules: [] }, CUSTOM_TAG_SCHEMA: [] }, SkyRescueSync: { setRemoteHandler() {} }, addEventListener() {} };
vm.runInNewContext(readFileSync(new URL("../web/common/js/shared-state.js", import.meta.url), "utf8"), { window, console });
const Store = window.SkyRescueStore;

// Direction locked 02-03/11 (see backend_ml/ahp_topsis.py AHPConfig): farther from the nearest
// team and fewer free teams both raise priority. 0.916*0.648 + (3/20)*0.230 + (1-1/3)*0.122 = 0.7094.
test("P = 0.7094 (Sev 91.6, distance to nearest team 3 km, 1 free team)", () => {
  assert.equal(Store.priorityScore(91.6, 3, 1), 0.7094);
});

test("P treats a no-team case as the best case on both distance and free-team criteria", () => {
  // distanceKm >= 20 clamps to 1 (farthest-in-batch fallback), freeTeams = 0 clamps the
  // (1 - freeTeams/3) term to 1 too — matching ahp_topsis.py's no-team placeholder values.
  const noTeam = Store.priorityScore(91.6, 20, 0);
  const sameSeverityWithTeam = Store.priorityScore(91.6, 3, 2);
  assert.equal(noTeam, 0.9456); // (0.916*0.648 + 0.23 + 0.122) rounded to 4 places by priorityScore
  assert.ok(noTeam > sameSeverityWithTeam);
});

// EXIF capture time: OffsetTimeOriginal (0x9011) wins over the browser time zone. The server does the same (server/exif.py).
test("EXIF capture time uses the EXIF offset when it is present", () => {
  assert.equal(Store.exifCaptureTime("2026:10:30 15:36:00", "+00:00"), "2026-10-30T15:36:00.000Z");
  assert.equal(Store.exifCaptureTime("2026:10:30 22:36:00", "+07:00"), "2026-10-30T15:36:00.000Z");
  assert.equal(Store.exifCaptureTime("2026:10:30 08:36:00", "-07:00"), "2026-10-30T15:36:00.000Z");
  assert.equal(Store.exifCaptureTime("not a date", "+07:00"), null);
});

// defaultReportAttributes preserves explicit narrow_entrance boolean attribute.
test("defaultReportAttributes preserves explicit narrow_entrance value", () => {
  const demoWindow = {};
  vm.runInNewContext(readFileSync(new URL("../web/common/js/demo-data.js", import.meta.url), "utf8"), { window: demoWindow, console });
  const attrs = demoWindow.SkyRescueDemo.defaultReportAttributes({ type: "Flood", district: "District 1", count: 3, customAttributes: { narrow_entrance: { value: true } } });
  assert.equal(attrs.narrow_entrance.value, true);
  const plain = demoWindow.SkyRescueDemo.defaultReportAttributes({ type: "Flood", district: "District 1", count: 3, customAttributes: { narrow_entrance: false } });
  assert.equal(plain.narrow_entrance.value, false);
});

// A one-sided custom equality rule must affect team eligibility/scoring. This is the
// exact shape produced by the Configuration "Add Configurable Rule" modal.
test("custom equality rule applies to a RescueTeam tag and rejects on a hard mismatch", () => {
  const state = {
    customTagSchema: [
      { key: "vehicle_type", label: "Vehicle type", dataType: "Enum", enumValues: ["rescue_van", "rescue_boat"], source: "Admin", targetEntity: "RescueTeam" }
    ],
    regionMeta: { sectors: [{ name: "District 1", customAttributes: {} }] },
    reports: [],
    settings: {
      ruleEngine: {
        version: "test",
        missingDataPolicy: "soft_warning",
        conflictPolicy: "hard_overrides_soft",
        rules: [
          { id: "CR-01", name: "Boat bonus", category: "Soft", enabled: true, targetEntity: "RescueTeam", customTagKey: "vehicle_type", expectedValue: "rescue_boat", weightDelta: 15 },
          { id: "CR-02", name: "Van gate", category: "Hard", enabled: true, targetEntity: "RescueTeam", customTagKey: "vehicle_type", expectedValue: "rescue_van", weightDelta: 0 }
        ]
      }
    }
  };
  const team = {
    id: "T-01", name: "Boat unit", area: "District 1", latitude: 10.78, longitude: 106.7,
    status: "Available", specialty: "water_rescue", capacity: 8, members: 8,
    customAttributes: { vehicle_type: { value: "rescue_boat", source: "Admin" } }
  };
  const incident = {
    id: "INC-T", originalType: "Flood", severityScore: 80, detectedPeopleCount: 2,
    location: { district: "District 1", province: "Ho Chi Minh City", latitude: 10.78, longitude: 106.7 },
    customAttributes: {}, customTags: []
  };
  const result = Store.evaluateTeamRules(team, incident, state);
  assert.equal(result.eligible, false);
  assert.ok(result.hardFailed.some((rule) => rule.id === "CR-02"));
  assert.ok(result.softApplied.some((rule) => rule.id === "CR-01" && rule.delta === 15));
});

// SafeGuardMechanic: Code Red needs the Layer 1 confidence gates and disaster context.
test("Code Red requires confidence gates and a confirmed disaster context", () => {
  const base = {
    originalType: "Fire", detectedPeopleCount: 1, status: "Matching Team",
    createdAt: new Date().toISOString(),
    detections: [{ pose: "Non-Upright", confidence: 69 }], poseConfidence: 95
  };
  assert.equal(Store.codeRedProfile(base).critical, false);
  assert.equal(Store.codeRedProfile({ ...base, detections: [{ pose: "Non-Upright", confidence: 70 }] }).critical, true);
  assert.equal(Store.codeRedProfile({ ...base, originalType: "Normal", detections: [{ pose: "Non-Upright", confidence: 99 }] }).critical, false);
  const mci = { ...base, detectedPeopleCount: 3, detections: [{ pose: "Upright", confidence: 90 }], poseConfidence: 74 };
  assert.equal(Store.codeRedProfile(mci).critical, false);
  assert.equal(Store.codeRedProfile({ ...mci, poseConfidence: 75 }).critical, true);
});

test("Golden Hour escalates an unassigned victim incident at 45 minutes", () => {
  const incident = {
    originalType: "Flood", detectedPeopleCount: 1, status: "Matching Team",
    createdAt: new Date(Date.now() - 46 * 60000).toISOString(),
    detections: [{ pose: "Upright", confidence: 99 }], poseConfidence: 90
  };
  const profile = Store.codeRedProfile(incident);
  assert.equal(profile.critical, true);
  assert.equal(profile.codeRedLayer, "golden_hour");
  assert.equal(profile.codeRedReason, "Golden Hour Escalation: Nạn nhân chờ quá 45 phút");
  assert.equal(Store.codeRedProfile({ ...incident, assignedTeamId: "SAR-01" }).critical, false);
  assert.equal(Store.codeRedProfile({ ...incident, originalType: "Normal" }).critical, false);
  const warning = Store.codeRedProfile({ ...incident, createdAt: new Date(Date.now() - 35 * 60000).toISOString() });
  assert.equal(warning.critical, false);
  assert.equal(warning.goldenHourWarning, true);
});

// F1: trusted sources auto-verify only for a valid AI emergency; citizens wait.
test("auto-verify policy accepts a verified reporter with a valid AI emergency", () => {
  const report = {
    id: "REP-1", autoVerifyPolicy: "trusted", sourceType: "citizen",
    reporter: { id: "REPORTER", verified: true, trustTier: "Standard Reporter" },
    aiResult: { aiConfidence: 91, needsReview: false, contradiction: false, pNormal: 0.12 }
  };
  const incident = {
    id: "INC-1", reportId: "REP-1", originalType: "Flood", reviewedType: "Flood",
    aiConfidence: 91, severityScore: 70, detectedPeopleCount: 2, detections: [],
    verificationStatus: "unverified", status: "Unverified"
  };
  const policy = Store.autoVerifyPolicy({ reports: [report], incidents: [incident] }, report, incident);
  assert.equal(policy.eligible, true);
  assert.equal(policy.method, "auto_reporter");
  const citizen = { ...report, autoVerifyPolicy: "citizen", reporter: { id: "CITIZEN", verified: false, trustTier: "Unverified Citizen" } };
  assert.equal(Store.autoVerifyPolicy({ reports: [citizen], incidents: [incident] }, citizen, incident).eligible, false);
  const normal = { ...incident, originalType: "Normal", reviewedType: "Normal" };
  assert.equal(Store.autoVerifyPolicy({ reports: [report], incidents: [normal] }, report, normal).eligible, false);
  const flagged = { ...incident, needsReview: true };
  assert.equal(Store.autoVerifyPolicy({ reports: [report], incidents: [flagged] }, report, flagged).eligible, false);
});

test("evaluateReportVerification marks a trusted report verified and the incident Matching Team", () => {
  const report = {
    id: "REP-E", incidentId: "INC-E", uploadStatus: "Uploaded", autoVerifyPolicy: "trusted", sourceType: "citizen",
    reporter: { id: "REPORTER", verified: true, trustTier: "Standard Reporter" },
    aiResult: { aiConfidence: 92, needsReview: false, contradiction: false, pNormal: 0.1 }
  };
  const incident = {
    id: "INC-E", reportId: "REP-E", originalType: "Fire", reviewedType: "Fire",
    aiConfidence: 92, severityScore: 80, detectedPeopleCount: 1, detections: [],
    verificationStatus: "unverified", status: "Unverified"
  };
  const state = { schemaVersion: 2, reports: [report], incidents: [incident], teams: [], dispatchOrders: [] };
  Store.evaluateReportVerification(state, "REP-E");
  assert.equal(report.verificationStatus, "verified");
  assert.equal(report.verificationMethod, "auto_reporter");
  assert.equal(incident.verificationStatus, "verified");
  assert.equal(incident.status, "Matching Team");
});

test("citizens are never auto-verified by a second report in the same area", () => {
  const now = new Date().toISOString();
  const makeReport = (id, fingerprint) => ({
    id, incidentId: `INC-${id}`, uploadStatus: "Uploaded", processingStatus: "Completed",
    autoVerifyPolicy: "citizen", sourceType: "citizen", fingerprint,
    reporter: { id: `U-${id}`, verified: false, trustTier: "Unverified Citizen" },
    createdAt: now, metadata: { latitude: 10.8, longitude: 106.7 },
    aiResult: { aiConfidence: 95, needsReview: false, contradiction: false, pNormal: 0.1 }
  });
  const makeIncident = (id) => ({
    id: `INC-${id}`, reportId: id, originalType: "Flood", reviewedType: "Flood",
    aiConfidence: 95, severityScore: 80, detectedPeopleCount: 2, detections: [],
    verificationStatus: "unverified", status: "Unverified"
  });
  const reports = [makeReport("A", "fp-a"), makeReport("B", "fp-b")];
  const incidents = [makeIncident("A"), makeIncident("B")];
  const state = { schemaVersion: 2, reports, incidents, teams: [], dispatchOrders: [] };
  Store.evaluateReportVerification(state, "A");
  Store.evaluateReportVerification(state, "B");
  assert.equal(reports[0].verificationStatus, "unverified");
  assert.equal(reports[1].verificationStatus, "unverified");
  assert.equal(reports[0].verificationMethod, null);
  assert.equal(incidents[0].status, "Unverified");
  assert.equal(incidents[1].status, "Unverified");
});
