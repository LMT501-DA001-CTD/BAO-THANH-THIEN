(function () {
  "use strict";

  const KEY = "skyrescue.v2.state.group1";
  const CHANGE_EVENT = "skyrescue:v2:change";
  const Demo = window.SkyRescueDemo;
  const Sync = window.SkyRescueSync; // server storage (sync-client.js)
  // Remote writes (SSE/polling) must wake the portals, not only refresh the cache.
  if (Sync && typeof Sync.setRemoteHandler === "function") {
    Sync.setRemoteHandler((remoteState) => {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: clone(remoteState) }));
    });
  }
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function isValid(state) {
    return state && state.schemaVersion === 2 && Array.isArray(state.reports) && Array.isArray(state.incidents) && Array.isArray(state.teams);
  }

  function load() {
    const current = Sync.read();
    if (isValid(current)) {
      const normalized = normalizeVerificationFields(clone(current));
      // Persist migrations (status names, team ids, retired tags) one time.
      if (JSON.stringify(normalized) !== JSON.stringify(current)) Sync.write(normalized, clone(current), null);
      return normalized;
    }
    // The server has no state yet: the first signed-in client sends the seed.
    const initial = Demo.buildInitialState();
    const normalized = normalizeVerificationFields(initial);
    Sync.write(clone(normalized), null, null);
    return normalized;
  }

  // ---- Audit log -----------------------------------------------------------
  // Every Store.update() is diffed (before vs after) so the log records WHO changed WHAT,
  // from which value to which value, without each call site having to describe it.
  const AUDIT_LIMIT = 1000;
  const AUDIT_MAX_CHANGES = 40;
  const AUDIT_COLLECTIONS = { incidents: "Incident", reports: "Report", teams: "Team", dispatchOrders: "DispatchOrder" };
  const AUDIT_SKIP_KEYS = new Set(["updatedAt", "schemaVersion", "audit", "auditSeq", "counters", "regionMeta", "evidence", "image", "imageData", "dataUrl", "thumbnail", "photo"]);

  function auditActor() {
    try {
      const u = window.SkyUI && typeof window.SkyUI.currentUser === "function" ? window.SkyUI.currentUser() : null;
      if (u) return { id: u.id || "", name: u.name || u.id || "", role: u.role || "" };
    } catch (_) {}
    return { id: "SYSTEM", name: "System", role: "System" };
  }

  function auditValue(v) {
    if (v === undefined) return "—";
    if (v === null) return "null";
    if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 117)}…` : v;
    if (typeof v === "number" || typeof v === "boolean") return v;
    const j = JSON.stringify(v);
    return j.length > 120 ? (Array.isArray(v) ? `[${v.length} items]` : "{…}") : j;
  }

  function auditFlatten(value, prefix, out, depth) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || depth >= 3) {
      out[prefix] = value;
      return;
    }
    Object.keys(value).forEach((key) => {
      if (AUDIT_SKIP_KEYS.has(key)) return;
      auditFlatten(value[key], prefix ? `${prefix}.${key}` : key, out, depth + 1);
    });
  }

  function auditDiff(before, after) {
    const changes = [];
    const push = (entity, id, field, from, to) => {
      if (changes.length < AUDIT_MAX_CHANGES) changes.push({ entity, id, field, from: auditValue(from), to: auditValue(to) });
    };
    const compareObjects = (entity, id, a, b) => {
      const fa = {}; const fb = {};
      auditFlatten(a, "", fa, 0);
      auditFlatten(b, "", fb, 0);
      new Set([...Object.keys(fa), ...Object.keys(fb)]).forEach((field) => {
        if (JSON.stringify(fa[field]) !== JSON.stringify(fb[field])) push(entity, id, field || "(value)", fa[field], fb[field]);
      });
    };
    Object.entries(AUDIT_COLLECTIONS).forEach(([key, entity]) => {
      const a = new Map((before[key] || []).map((x) => [x.id, x]));
      const b = new Map((after[key] || []).map((x) => [x.id, x]));
      b.forEach((item, id) => {
        if (!a.has(id)) push(entity, id, "(created)", "—", "created");
        else compareObjects(entity, id, a.get(id), item);
      });
      a.forEach((_, id) => { if (!b.has(id)) push(entity, id, "(deleted)", "exists", "deleted"); });
    });
    if (JSON.stringify(before.settings) !== JSON.stringify(after.settings)) compareObjects("Settings", "settings", before.settings || {}, after.settings || {});
    return changes;
  }

  function save(state, detail, before) {
    state.updatedAt = new Date().toISOString();
    if (detail) {
      state.audit = state.audit || [];
      state.auditSeq = Math.max(Number(state.auditSeq || 0), state.audit.length) + 1;
      const changes = before ? auditDiff(before, state) : [];
      state.audit.unshift({
        id: `AUD-${String(state.auditSeq).padStart(5, "0")}`,
        event: detail.event || "STATE_UPDATED",
        detail: detail.detail || "",
        at: state.updatedAt,
        actor: auditActor(),
        changes
      });
      state.audit = state.audit.slice(0, AUDIT_LIMIT);
    }
    // The server adds the audit id, time and actor from the session. The local record shows at once.
    const audit = detail ? { event: state.audit[0].event, detail: state.audit[0].detail, changes: state.audit[0].changes } : null;
    Sync.write(clone(state), before ? clone(before) : null, audit);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: clone(state) }));
    return clone(state);
  }

  function update(detail, mutator) {
    const before = load();
    const state = clone(before);
    const result = mutator(state);
    save(state, typeof detail === "string" ? { event: detail } : detail, before);
    return result === undefined ? clone(state) : result;
  }

  function reset() {
    const previousAudit = (load().audit || []);
    const initial = normalizeVerificationFields(Demo.buildInitialState());
    initial.audit = previousAudit;      // resetting demo data must not erase the history of who reset it
    initial.auditSeq = previousAudit.length;
    save(initial, { event: "DEMO_RESET", detail: "Demo data restored to its deterministic baseline" });
    return clone(initial);
  }

  function nextId(state, counter, prefix) {
    state.counters = state.counters || {};
    state.counters[counter] = Number(state.counters[counter]) || 0;
    let id;
    do {
      state.counters[counter] += 1;
      id = `${prefix}-${state.counters[counter]}`;
    } while (prefix === "INC" && [...(state.incidents || []), ...(state.reports || [])].some((item) => item.id === id || item.incidentId === id));
    return id;
  }

  function effectiveType(incident) {
    return incident.reviewedType || incident.originalType;
  }

  // Target schema: RescueTeam.capacity is headcount. Seeded/demo records use members.
  function teamHeadcount(team) {
    return Number(team?.capacity ?? team?.members ?? 0);
  }

  function activeAssignmentForTeam(state, teamId) {
    return (state.dispatchOrders || []).find((order) => order.teamId === teamId && !["Completed", "Cancelled"].includes(order.status));
  }

  // One assignment record per incident. The historical `missionForIncident`
  // name is kept as a compatibility alias while the UI moves to Dispatch.
  function dispatchForIncident(state, incidentId) {
    return (state.dispatchOrders || []).find((order) => order.incidentId === incidentId && order.status !== "Cancelled");
  }

  function missionForIncident(state, incidentId) {
    return dispatchForIncident(state, incidentId);
  }

  function sourceTypeForReport(report) {
    if (report?.sourceType) return report.sourceType;
    if (report?.uav) return "drone";
    const role = String(report?.reporter?.role || "").toLowerCase();
    if (role.includes("ctv") || role.includes("specialist") || role.includes("chuyên môn")) return "specialist";
    return "citizen";
  }

  function sourceIdentityForReport(report) {
    return report?.sourceIdentity || report?.uav?.serial || report?.uav?.id || report?.reporter?.id || report?.id;
  }

  const AUTO_EMERGENCY_TYPES = ["Flood", "Fire", "Building Collapse", "Traffic Accident"];
  const CODE_RED_NON_UPRIGHT_CONFIDENCE = 70;
  const CODE_RED_MCI_CONFIDENCE = 75;
  const CODE_RED_MCI_VICTIMS = 3;
  const GOLDEN_HOUR_WARNING_MINUTES = 30;
  const GOLDEN_HOUR_ESCALATION_MINUTES = 45;
  const GOLDEN_HOUR_REASON = "Golden Hour Escalation: Nạn nhân chờ quá 45 phút";

  function confidencePercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return number <= 1 ? number * 100 : number;
  }

  // Reinforced Code Red fast track (SafeGuardMechanic.docx):
  // Layer 1 - high-confidence non-upright casualty or MCI count;
  // Layer 2 - confirmed disaster context (Normal/Unclassified are locked out);
  // Layer 3 - Golden Hour escalation for an unassigned victim incident at 45 min.
  // AHP criterion C1 keeps the raw severity; this is an operational pin only.
  function codeRedProfile(incident, now = Date.now()) {
    const victims = Math.max(0, Number(incident?.detectedPeopleCount || 0), Array.isArray(incident?.detections) ? incident.detections.length : 0);
    const detections = Array.isArray(incident?.detections) ? incident.detections : [];
    const nonUprightDetections = detections.filter((item) => item.pose === "Non-Upright");
    const nonUpright = Math.max(0, Math.min(
      victims,
      Number(incident?.nonUprightCount == null ? nonUprightDetections.length : incident.nonUprightCount) || 0
    ));
    const nonUprightConfidence = nonUprightDetections.length
      ? Math.max(...nonUprightDetections.map((item) => confidencePercent(item.confidence ?? item.conf)))
      : confidencePercent(incident?.poseConfidence);
    const detectionConfidence = detections.length
      ? detections.reduce((sum, item) => sum + confidencePercent(item.confidence ?? item.conf), 0) / detections.length
      : 0;
    const poseConfidence = confidencePercent(incident?.poseConfidence) || detectionConfidence;
    const type = effectiveType(incident);
    const emergency = AUTO_EMERGENCY_TYPES.includes(type);
    const created = new Date(incident?.createdAt).getTime();
    const ageMinutes = Number.isFinite(created) ? Math.max(0, (now - created) / 60000) : 0;
    const assigned = Boolean(incident?.assignedTeamId || incident?.dispatchId) || ["In Progress", "Resolved"].includes(incident?.status);

    const layer1NonUpright = nonUpright >= 1 && nonUprightConfidence >= CODE_RED_NON_UPRIGHT_CONFIDENCE;
    const layer1Mci = victims >= CODE_RED_MCI_VICTIMS && poseConfidence >= CODE_RED_MCI_CONFIDENCE;
    const goldenHour = emergency && victims >= 1 && !assigned && ageMinutes >= GOLDEN_HOUR_ESCALATION_MINUTES;
    const critical = emergency && (layer1NonUpright || layer1Mci || goldenHour);
    const goldenHourWarning = emergency && !critical && victims >= 1 && !assigned
      && ageMinutes >= GOLDEN_HOUR_WARNING_MINUTES && ageMinutes < GOLDEN_HOUR_ESCALATION_MINUTES;

    const layer1Reason = layer1NonUpright
      ? `Non-Upright victim detected (Conf ${nonUprightConfidence.toFixed(1)}% ≥ 70%)`
      : layer1Mci
        ? `MCI: ${victims} victims (Conf ${poseConfidence.toFixed(1)}% ≥ 75%)`
        : "";
    return {
      victims,
      nonUpright,
      nonUprightConfidence,
      poseConfidence,
      ageMinutes,
      assigned,
      emergency,
      critical,
      codeRed: critical,
      codeRedLayer: goldenHour ? "golden_hour" : layer1NonUpright ? "non_upright" : layer1Mci ? "mci" : null,
      codeRedReason: goldenHour ? GOLDEN_HOUR_REASON : layer1Reason,
      layer1Reason,
      goldenHour,
      goldenHourWarning,
      severityRaw: Math.max(0, Math.min(100, Number(incident?.severityScore || 0)))
    };
  }

  // F1: one explainable policy shared by the reviewer, the auto-verify runner
  // and the workspace. It never dispatches; it only decides whether the data
  // can be trusted without manual verification.
  function autoVerifyPolicy(state, report, incident = null) {
    const sourceType = sourceTypeForReport(report);
    const trustedDevice = sourceType === "drone" && report?.sourceAssurance?.deviceRegistered && report?.sourceAssurance?.metadataMatched;
    const trustedSpecialist = sourceType === "specialist" && report?.sourceAssurance?.credentialVerified;
    const trustedReporter = Boolean(report?.reporter?.verified) && String(report?.reporter?.trustTier || "").toLowerCase() !== "unverified citizen";
    const trusted = trustedDevice || trustedSpecialist || trustedReporter;
    const method = trustedDevice ? "auto_drone" : trustedSpecialist ? "auto_specialist" : trustedReporter ? "auto_reporter" : "admin";

    // Legacy records (seeds, pre-1.1 reports) keep the old admin-review behaviour.
    if (!report?.autoVerifyPolicy && report?.requiresAdminReview) {
      return { eligible: false, trusted: false, method: "admin", reason: "Legacy report requires Admin review." };
    }
    if (!trusted) {
      return { eligible: false, trusted: false, method: "admin", reason: "Citizen report: manual Coordinator verification is required." };
    }
    if (!incident) {
      return { eligible: false, trusted: true, method, reason: "No linked incident yet; waiting for the AI result." };
    }
    const type = effectiveType(incident);
    if (!AUTO_EMERGENCY_TYPES.includes(type)) {
      return { eligible: false, trusted: true, method, reason: `${type} is not an auto-verifiable emergency.` };
    }
    const ai = report.aiResult || {};
    if (incident.aiStatus === "Failed" || ai.status === "failed") {
      return { eligible: false, trusted: true, method, reason: "AI failed; manual review required." };
    }
    if (Number(incident.aiConfidence || ai.aiConfidence || 0) < 85) {
      return { eligible: false, trusted: true, method, reason: "AI confidence below 85%; manual review required." };
    }
    if (incident.needsReview === true || ai.needsReview === true) {
      return { eligible: false, trusted: true, method, reason: "The AI router flagged this report for coordinator review." };
    }
    if (incident.contradiction === true || ai.contradiction === true) {
      return { eligible: false, trusted: true, method, reason: "Tier 2 contradiction flag." };
    }
    if (Number(ai.pNormal) >= 0.90) {
      return { eligible: false, trusted: true, method, reason: "P(Normal) is above the stop threshold." };
    }
    if (report.metadataFlags?.gpsConflict) {
      return { eligible: false, trusted: true, method, reason: "EXIF GPS and live GPS conflict." };
    }
    if (report.nearDuplicate) {
      return { eligible: false, trusted: true, method, reason: "Near-duplicate image; manual review required." };
    }
    return { eligible: true, trusted: true, method, reason: "Trusted source, AI emergency, confidence ≥ 85%, no review flags." };
  }

  function verificationDefaults(report) {
    if (report?.autoVerifyPolicy === "trusted") {
      return {
        status: "unverified",
        label: "Unverified",
        reason: "Trusted source · waiting for the AI result before auto-verification."
      };
    }
    if (report?.autoVerifyPolicy === "citizen") {
      return {
        status: "unverified",
        label: "Unverified",
        reason: "Citizen report: manual Coordinator verification is required."
      };
    }
    if (report?.requiresAdminReview) {
      return {
        status: "unverified",
        label: "Unverified",
        reason: "Every new report requires Admin review in C2 · Verified / Pending Queues before team matching."
      };
    }
    const sourceType = sourceTypeForReport(report);
    const uploaded = report?.uploadStatus === "Uploaded";
    if (uploaded && sourceType === "drone" && report?.sourceAssurance?.deviceRegistered && report?.sourceAssurance?.metadataMatched) {
      return {
        status: "verified",
        label: "Verified (Drone Telemetry)",
        reason: "Registered UAV device information matched the submitted telemetry metadata."
      };
    }
    if (uploaded && sourceType === "specialist" && report?.sourceAssurance?.credentialVerified) {
      return {
        status: "verified",
        label: "Verified (Specialist/CTV)",
        reason: "The submitting account is marked as a verified Specialist/CTV."
      };
    }
    return {
      status: "unverified",
      label: "Unverified",
      reason: "Citizen report: manual Coordinator verification is required."
    };
  }

  function normalizeVerificationFields(state) {
    if (!state) return state;

    const mapTeamId = (id) => {
      const map = {
        "PCCC-BT": "FIRE-01", "TN-SG": "VOL-01", "MED-02": "MED-01", "SAR-05": "SAR-03",
        "CT-PCCC-NK": "CT-FIRE-01", "CT-EROSION-02": "CT-SAR-02", "CT-VOL-PD": "CT-VOL-01",
        "HN-PCCC-DD": "HN-FIRE-01", "HN-MOTO-PCCC": "HN-FIRE-02", "HN-SAR-HK": "HN-SAR-01",
        "HN-WATER-CM": "HN-WATER-01", "HN-MED-CG": "HN-MED-01",
        "DN-PCCC-ST": "DN-FIRE-01", "DN-ENG-LC": "DN-SAR-02",
        "USAR-CA1": "US-SAR-01", "LAFD-02": "US-WATER-01", "SMR-03": "US-MED-01",
        "PAS-04": "US-FIRE-01", "LBFD-05": "US-WATER-02"
      };
      return map[id] || id;
    };
    const mapTeamName = (id, name) => {
      if (id === "SAR-01" && (!name || name === "Team SAR-01 Rapid Response Unit")) return "Team SAR-01 Rapid Search & Rescue Unit";
      if (id === "FIRE-01" && (!name || name === "Binh Thanh Fire & Rescue Unit")) return "Team FIRE-01 Fire & Rescue Unit";
      if (id === "VOL-01" && (!name || name === "Saigon Volunteer Rescue Corps")) return "Team VOL-01 Volunteer Rescue Corps";
      if (id === "SAR-02" && (!name || name === "SAR-02 High Ground Search")) return "Team SAR-02 High-Ground & Collapse Search Unit";
      if (id === "WATER-01" && (!name || name === "Saigon Waterway Rescue Unit")) return "Team WATER-01 Waterway & Flood Rescue Unit";
      if (id === "MED-01" && (!name || name === "Mobile Field Medical Unit")) return "Team MED-01 Mobile Field Medical Unit";
      if (id === "SAR-03" && (!name || name === "UAV Technical Support Team")) return "Team SAR-03 UAV Technical Support Unit";
      if (name && !name.startsWith("Team ") && id) return `Team ${id} ${name}`;
      return name;
    };

    (state.teams || []).forEach((team) => {
      team.id = mapTeamId(team.id);
      team.name = mapTeamName(team.id, team.name);
    });
    (state.incidents || []).forEach((incident) => {
      if (incident.teamId) incident.teamId = mapTeamId(incident.teamId);
      if (incident.assignedTeamId) incident.assignedTeamId = mapTeamId(incident.assignedTeamId);
    });
    (state.dispatchOrders || []).forEach((order) => {
      if (order.teamId) order.teamId = mapTeamId(order.teamId);
      if (["Sent", "Accepted", "Assigned", "Enroute", "In Progress"].includes(order.status)) order.status = "Confirmed";
      delete order.coalitionTeamIds;
      delete order.supportTeamIds;
      delete order.equipmentRebalancing;
    });
    // The retired mission collection is replaced by the single Dispatch order.
    delete state.missions;
    const activeAssignmentTeamIds = new Set();
    (state.dispatchOrders || []).forEach((order) => {
      if (["Completed", "Cancelled"].includes(order.status)) return;
      if (order.teamId) activeAssignmentTeamIds.add(order.teamId);
    });
    (state.teams || []).forEach((team) => {
      if (activeAssignmentTeamIds.has(team.id) && team.status === "Available") team.status = "On Mission";
    });

    const reportsById = new Map();
    (state.reports || []).forEach((report) => {
      const defaults = verificationDefaults(report);
      report.sourceType = sourceTypeForReport(report);
      report.sourceIdentity = sourceIdentityForReport(report);
      report.verificationStatus = report.verificationStatus || defaults.status;
      report.verificationLabel = report.verificationLabel || defaults.label;
      report.verificationReason = report.verificationReason || defaults.reason;
      report.corroboratedBy = Array.isArray(report.corroboratedBy) ? report.corroboratedBy : [];
      if (!report.reporter) report.reporter = { id: "USR-PUBLIC", name: "Citizen Reporter", trustScore: 50 };
      if (report.reporter.trustScore == null) report.reporter.trustScore = report.reporter.verified ? 85 : 50;
      reportsById.set(report.id, report);
    });

    (state.incidents || []).forEach((incident) => {
      const report = reportsById.get(incident.reportId);
      const defaults = report ? verificationDefaults(report) : { status: "unverified", label: "Unverified", reason: "No linked source-verification record is available." };
      incident.verificationStatus = incident.verificationStatus || report?.verificationStatus || defaults.status;
      incident.verificationLabel = incident.verificationLabel || report?.verificationLabel || defaults.label;
      incident.verificationReason = incident.verificationReason || report?.verificationReason || defaults.reason;
      incident.verificationMethod = incident.verificationMethod || report?.verificationMethod || null;
      incident.autoVerifiedAt = incident.autoVerifiedAt || report?.autoVerifiedAt || null;
      incident.corroboratedBy = Array.isArray(incident.corroboratedBy) ? incident.corroboratedBy : (report?.corroboratedBy || []);

      // Unified four-state lifecycle: Unverified -> Matching Team -> In Progress -> Resolved.
      if (["Not Reviewed", "Pending Verification", "Under Review"].includes(incident.status)) {
        incident.status = "Unverified";
      } else if (["Team Matched", "Assigned", "Dispatched", "Enroute", "Result Submitted", "Partial — Action Required"].includes(incident.status)) {
        incident.status = "In Progress";
      } else if (incident.status === "Verified Normal") {
        incident.status = "Resolved";
      } else if (!["Unverified", "Matching Team", "In Progress", "Resolved"].includes(incident.status)) {
        incident.status = "Unverified";
      }

      if (incident.status === "Unverified") {
        incident.verificationStatus = "unverified";
        incident.verificationLabel = "Unverified";
        if (report) {
          report.verificationStatus = "unverified";
          report.verificationLabel = "Unverified";
        }
      } else {
        incident.verificationStatus = "verified";
        if (report) report.verificationStatus = "verified";
      }
    });

    // Retire removed attributes and rules from persisted demo state.
    const REMOVED_TAGS = new Set(["road_width_m", "water_depth_m", "flood_current_knot", "min_road_clearance_m", "water_rescue_capable"]);
    const REMOVED_RULES = new Set(["HC-01", "SC-02", "SC-05"]);
    if (Array.isArray(state.customTagSchema)) {
      state.customTagSchema = state.customTagSchema.filter((tag) => !REMOVED_TAGS.has(tag.key));
    }
    if (state.settings?.ruleEngine && Array.isArray(state.settings.ruleEngine.rules)) {
      const defMap = new Map((Demo.DEFAULT_RULE_ENGINE?.rules || []).map((rule) => [rule.id, rule]));
      state.settings.ruleEngine.rules = state.settings.ruleEngine.rules
        .filter((rule) => !REMOVED_RULES.has(rule.id))
        .map((rule) => {
          if (rule.id === "HC-03" && defMap.has("HC-03")) {
            return { ...defMap.get("HC-03"), enabled: rule.enabled !== false };
          }
          return rule;
        });
    }
    (state.teams || []).forEach((team) => {
      if (team.customAttributes) REMOVED_TAGS.forEach((key) => delete team.customAttributes[key]);
    });
    (state.incidents || []).forEach((incident) => {
      if (incident.customAttributes) REMOVED_TAGS.forEach((key) => delete incident.customAttributes[key]);
    });
    (state.reports || []).forEach((report) => {
      if (report.customAttributes) REMOVED_TAGS.forEach((key) => delete report.customAttributes[key]);
    });

    state.settings = state.settings || {};
    state.settings.matchConfig = {
      bonusPoints: 5,
      distanceDivisorKm: 15,
      sameAreaBonus: 10,
      ...(state.settings.matchConfig || {})
    };

    const sectorByName = new Map(((state.regionMeta || {}).sectors || []).map((sector) => [sector.name, sector]));
    (state.teams || []).forEach((team) => {
      const sector = sectorByName.get(team.area);
      if (sector && (team.latitude == null || team.longitude == null)) {
        team.latitude = Number(sector.latitude ?? sector.lat);
        team.longitude = Number(sector.longitude ?? sector.lng);
      }
      if (!team.equipment_inventory && Demo.enrichTeamAttributes) {
        Object.assign(team, Demo.enrichTeamAttributes(team));
      }
    });
    refreshStoredGpsLocationLabels(state);
    return state;
  }

  function refreshStoredGpsLocationLabels(state) {
    const incidentsByReport = new Map((state.incidents || []).map((incident) => [incident.reportId, incident]));
    (state.reports || []).forEach((report) => {
      if (!report?.requiresAdminReview || report.uploadStatus !== "Uploaded") return;
      if (String(report.autoGeo?.source || "").includes("Reverse Geocoding")) return;
      const coords = reportCoordinates(report);
      if (!coords) return;
      const detected = detectLocationFromGps(coords.latitude, coords.longitude, state);
      if (!detected) return;
      report.autoGeo = { ...(report.autoGeo || {}), ...detected };
      const incident = incidentsByReport.get(report.id);
      if (incident?.location) {
        incident.location.district = detected.district;
        incident.location.province = detected.province;
        incident.location.latitude = coords.latitude;
        incident.location.longitude = coords.longitude;
      }
    });
  }

  function reportCoordinates(report) {
    const latitude = Number(report?.metadata?.latitude);
    const longitude = Number(report?.metadata?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  function haversineMeters(a, b) {
    if (!a || !b) return Infinity;
    const radians = (degrees) => degrees * Math.PI / 180;
    const earthRadius = 6371000;
    const dLat = radians(b.latitude - a.latitude);
    const dLng = radians(b.longitude - a.longitude);
    const lat1 = radians(a.latitude);
    const lat2 = radians(b.latitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function setReportVerification(state, report, label, reason, corroboratedBy = [], method = "admin") {
    report.verificationStatus = "verified";
    report.verificationLabel = label;
    report.verificationReason = reason;
    report.verificationMethod = method;
    report.autoVerifiedAt = method === "admin" ? null : (report.autoVerifiedAt || new Date().toISOString());
    report.corroboratedBy = [...new Set(corroboratedBy.filter((id) => id && id !== report.id))];
    report.sourceVerifiedAt = report.sourceVerifiedAt || report.autoVerifiedAt || new Date().toISOString();
    const incident = state.incidents.find((item) => item.reportId === report.id);
    if (incident) {
      incident.verificationStatus = report.verificationStatus;
      incident.verificationLabel = report.verificationLabel;
      incident.verificationReason = report.verificationReason;
      incident.verificationMethod = method;
      incident.autoVerifiedAt = report.autoVerifiedAt;
      incident.corroboratedBy = report.corroboratedBy.slice();
      incident.sourceVerifiedAt = report.sourceVerifiedAt;
      if (["Unverified", "Pending Verification", "Not Reviewed"].includes(incident.status)) incident.status = "Matching Team";
    }
  }

  function setReportPending(state, report, reason = null) {
    if (report.verificationStatus === "verified") return;
    report.verificationStatus = "unverified";
    report.verificationLabel = "Unverified";
    report.verificationReason = reason || "Citizen report: manual Coordinator verification is required.";
    report.verificationMethod = null;
    report.corroboratedBy = [];
    const incident = state.incidents.find((item) => item.reportId === report.id);
    if (incident) {
      incident.verificationStatus = report.verificationStatus;
      incident.verificationLabel = report.verificationLabel;
      incident.verificationReason = report.verificationReason;
      incident.verificationMethod = null;
      incident.corroboratedBy = [];
      if (!["Resolved", "In Progress"].includes(incident.status)) {
        incident.status = "Unverified";
      }
    }
  }

  function evaluateReportVerification(state, reportId) {
    normalizeVerificationFields(state);
    const report = state.reports.find((item) => item.id === reportId);
    if (!report || report.uploadStatus !== "Uploaded") return null;
    const incident = state.incidents.find((item) => item.reportId === report.id) || null;
    const policy = autoVerifyPolicy(state, report, incident);

    // Hybrid trust: trusted sources auto-verify when the full policy passes.
    // Unverified Citizen reports always stay pending for a Coordinator decision.
    if (report.autoVerifyPolicy) {
      if (policy.eligible) {
        const label = policy.method === "auto_drone"
          ? "Verified (Drone Telemetry)"
          : policy.method === "auto_specialist"
            ? "Verified (Specialist/CTV)"
            : "Verified (Identified Reporter)";
        setReportVerification(state, report, label, policy.reason, [], policy.method);
      } else {
        setReportPending(state, report, policy.reason);
      }
      return report;
    }
    if (report.requiresAdminReview) {
      setReportPending(state, report);
      return report;
    }

    // Legacy records without autoVerifyPolicy: only a trusted device/account
    // can auto-verify. A citizen report is never auto-verified.
    const sourceType = sourceTypeForReport(report);
    if (sourceType === "drone" && report.sourceAssurance?.deviceRegistered && report.sourceAssurance?.metadataMatched) {
      setReportVerification(state, report, "Verified (Drone Telemetry)", "Registered AEGIS-UAV device information and serial metadata matched.", [], "auto_drone");
      return report;
    }
    if (sourceType === "specialist" && report.sourceAssurance?.credentialVerified) {
      setReportVerification(state, report, "Verified (Specialist/CTV)", "Verified Specialist/CTV account credentials were present at submission.", [], "auto_specialist");
      return report;
    }
    setReportPending(state, report);
    return report;
  }

  function normalizeBounds(b, center = [16.0544, 108.2022]) {
    if (Array.isArray(b) && Array.isArray(b[0]) && Array.isArray(b[1])) {
      const minLat = Number(b[0][0]);
      const minLng = Number(b[0][1]);
      const maxLat = Number(b[1][0]);
      const maxLng = Number(b[1][1]);
      return { minLat, maxLat, minLng, maxLng };
    }
    if (b && typeof b === "object" && typeof b.minLat === "number") {
      return {
        minLat: Number(b.minLat),
        maxLat: Number(b.maxLat),
        minLng: Number(b.minLng),
        maxLng: Number(b.maxLng)
      };
    }
    return {
      minLat: Number((center[0] - 0.18).toFixed(4)),
      maxLat: Number((center[0] + 0.18).toFixed(4)),
      minLng: Number((center[1] - 0.18).toFixed(4)),
      maxLng: Number((center[1] + 0.18).toFixed(4))
    };
  }

  function regionMeta(state = load()) {
    const rawMeta = state.regionMeta || state.datasetMeta;
    const areaName = state.settings?.operatingArea || rawMeta?.operatingArea || rawMeta?.regionName || state.incidents?.[0]?.location?.province || "Vietnam";
    const preset = Demo.REGION_PROFILES?.[areaName];
    const base = rawMeta && (rawMeta.operatingArea === areaName || rawMeta.regionName === areaName)
      ? clone(rawMeta)
      : preset
        ? clone(preset)
        : {
            regionId: `REGION-${areaName.toUpperCase().replace(/\s+/g, "-")}`,
            operatingArea: areaName,
            country: rawMeta?.country || "Custom Region",
            center: [16.0544, 108.2022],
            defaultZoom: 6,
            coverageBounds: { minLat: 8.55, maxLat: 23.39, minLng: 102.14, maxLng: 109.47 },
            sectors: []
          };

    const coords = (state.incidents || [])
      .map((inc) => inc.location)
      .filter((loc) => loc && typeof loc.latitude === "number" && typeof loc.longitude === "number");

    if (coords.length > 0 && (!rawMeta || (rawMeta.operatingArea !== areaName && rawMeta.regionName !== areaName)) && !preset) {
      const lats = coords.map((c) => c.latitude);
      const lngs = coords.map((c) => c.longitude);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      base.center = [Number(((minLat + maxLat) / 2).toFixed(4)), Number(((minLng + maxLng) / 2).toFixed(4))];
      base.coverageBounds = {
        minLat: Number((minLat - 0.15).toFixed(4)),
        maxLat: Number((maxLat + 0.15).toFixed(4)),
        minLng: Number((minLng - 0.15).toFixed(4)),
        maxLng: Number((maxLng + 0.15).toFixed(4))
      };
    }

    base.center = Array.isArray(base.center) && base.center.length === 2
      ? [Number(base.center[0]), Number(base.center[1])]
      : [16.0544, 108.2022];
    base.coverageBounds = normalizeBounds(base.coverageBounds, base.center);

    // Ensure all districts present in incidents or teams are represented in sectors with both lat/lng and latitude/longitude
    const sectorMap = new Map();
    (base.sectors || []).forEach((s) => {
      if (!s || !s.name) return;
      const lat = Number(s.latitude ?? s.lat ?? base.center[0]);
      const lng = Number(s.longitude ?? s.lng ?? base.center[1]);
      sectorMap.set(s.name, { name: s.name, province: s.province || areaName, lat, lng, latitude: lat, longitude: lng });
    });
    // Merge newly shipped preset sectors into older saved browser states.
    (preset?.sectors || []).forEach((s) => {
      if (!s || !s.name || sectorMap.has(s.name)) return;
      const lat = Number(s.latitude ?? s.lat ?? base.center[0]);
      const lng = Number(s.longitude ?? s.lng ?? base.center[1]);
      sectorMap.set(s.name, { name: s.name, province: s.province || areaName, lat, lng, latitude: lat, longitude: lng });
    });
    (state.incidents || []).forEach((inc) => {
      const d = inc.location?.district;
      if (d && !sectorMap.has(d)) {
        const lat = Number(inc.location.latitude ?? base.center[0]);
        const lng = Number(inc.location.longitude ?? base.center[1]);
        sectorMap.set(d, { name: d, province: inc.location.province || areaName, lat, lng, latitude: lat, longitude: lng });
      }
    });
    (state.teams || []).forEach((team) => {
      const d = team.area;
      if (d && !sectorMap.has(d)) {
        sectorMap.set(d, { name: d, province: team.province || areaName, lat: base.center[0], lng: base.center[1], latitude: base.center[0], longitude: base.center[1] });
      }
    });
    base.sectors = Array.from(sectorMap.values());
    base.operatingArea = areaName;
    if (!base.timeZone) {
      if (preset?.timeZone) {
        base.timeZone = preset.timeZone;
        base.tzShort = preset.tzShort || "ICT (UTC+07:00)";
      } else if (String(base.country || "").toLowerCase().includes("united states") || Number(base.center?.[1]) < -50) {
        base.timeZone = "America/Los_Angeles";
        base.tzShort = "PDT (UTC-07:00)";
      } else {
        base.timeZone = "Asia/Ho_Chi_Minh";
        base.tzShort = "ICT (UTC+07:00)";
      }
    }
    if (!base.tzShort) {
      base.tzShort = base.timeZone === "America/Los_Angeles" ? "PDT (UTC-07:00)" : "ICT (UTC+07:00)";
    }
    return base;
  }

  const VN_FALLBACK_SECTORS = [
    { district: "Hue City", province: "Thua Thien Hue", lat: 16.4637, lng: 107.5909 },
    { district: "Huong Thuy Town", province: "Thua Thien Hue", lat: 16.4182, lng: 107.6821 },
    { district: "Nha Trang City", province: "Khanh Hoa", lat: 12.2388, lng: 109.1967 },
    { district: "Hong Bang District", province: "Hai Phong", lat: 20.8449, lng: 106.6881 },
    { district: "Ha Long City", province: "Quang Ninh", lat: 20.9599, lng: 107.0425 },
    { district: "Vung Tau City", province: "Ba Ria - Vung Tau", lat: 10.3460, lng: 107.0843 },
    { district: "Da Lat City", province: "Lam Dong", lat: 11.9404, lng: 108.4583 },
    { district: "Bien Hoa City", province: "Dong Nai", lat: 10.9574, lng: 106.8427 },
    { district: "Thu Dau Mot City", province: "Binh Duong", lat: 10.9804, lng: 106.6519 },
    { district: "Quy Nhon City", province: "Binh Dinh", lat: 13.7820, lng: 109.2197 },
    { district: "Vinh City", province: "Nghe An", lat: 18.6796, lng: 105.6813 },
    { district: "Dong Hoi City", province: "Quang Binh", lat: 17.4689, lng: 106.6223 },
    { district: "Dong Ha City", province: "Quang Tri", lat: 16.8163, lng: 107.1003 },
    { district: "Lao Cai City", province: "Lao Cai", lat: 22.4856, lng: 103.9707 },
    { district: "Ca Mau City", province: "Ca Mau", lat: 9.1768, lng: 105.1524 }
  ];

  function detectLocationFromGps(latitude, longitude, state = load()) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (latitude == null || longitude == null || isNaN(lat) || isNaN(lng)) return null;

    const currentMeta = regionMeta(state);
    const currentArea = currentMeta.operatingArea || "Vietnam";

    // Build candidate list across active region, all preset REGION_PROFILES, and VN_FALLBACK_SECTORS
    const candidates = [];

    (currentMeta.sectors || []).forEach((s) => {
      if (!s || !s.name) return;
      candidates.push({
        district: s.name,
        province: s.province || currentArea,
        lat: Number(s.latitude ?? s.lat),
        lng: Number(s.longitude ?? s.lng),
        matchedProfile: s.province || (Demo.REGION_PROFILES?.[currentArea] ? currentArea : null),
        fromActive: true
      });
    });

    Object.entries(Demo.REGION_PROFILES || {}).forEach(([provName, profile]) => {
      (profile.sectors || []).forEach((s) => {
        candidates.push({
          district: s.name,
          province: provName,
          lat: Number(s.latitude ?? s.lat),
          lng: Number(s.longitude ?? s.lng),
          matchedProfile: provName,
          fromActive: provName === currentArea
        });
      });
    });

    VN_FALLBACK_SECTORS.forEach((s) => {
      candidates.push({
        district: s.district,
        province: s.province,
        lat: s.lat,
        lng: s.lng,
        matchedProfile: null,
        fromActive: s.province === currentArea
      });
    });

    let best = null;
    let bestDistSq = Infinity;
    candidates.forEach((cand) => {
      if (isNaN(cand.lat) || isNaN(cand.lng)) return;
      const dSq = (cand.lat - lat) ** 2 + (cand.lng - lng) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = cand;
      }
    });

    const distDeg = Math.sqrt(bestDistSq);
    const approxKm = Number((distDeg * 111.32).toFixed(1));

    if (best && distDeg <= 0.48) {
      const isCrossRegion = currentArea !== "Vietnam" && best.province !== currentArea;
      return {
        district: best.district,
        province: best.province,
        matchedProfile: best.matchedProfile,
        isCrossRegion,
        distanceKm: approxKm,
        latitude: lat,
        longitude: lng,
        source: isCrossRegion
          ? `EXIF GPS Auto-Track (Detected new region: ${best.province})`
          : `EXIF GPS Auto-Track (Matched active region: ${currentArea})`
      };
    }

    const dynDistrict = `GPS Sector (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
    const dynProvince = best ? `Greater ${best.province} Area` : "New Tactical Zone";
    return {
      district: dynDistrict,
      province: dynProvince,
      matchedProfile: null,
      isCrossRegion: true,
      distanceKm: approxKm,
      latitude: lat,
      longitude: lng,
      source: "EXIF GPS Auto-Track (Dynamic Sector Initialized)"
    };
  }

  function adaptRegionToIncident(state, autoGeo, latitude, longitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!autoGeo || isNaN(lat) || isNaN(lng)) return;

    const currentMeta = regionMeta(state);
    const currentArea = currentMeta.operatingArea;
    const targetProvince = autoGeo.province || currentArea;
    const targetDistrict = autoGeo.district || "Sector 1";

    if (autoGeo.isCrossRegion) {
      if (autoGeo.matchedProfile && Demo.REGION_PROFILES?.[autoGeo.matchedProfile]) {
        const profile = clone(Demo.REGION_PROFILES[autoGeo.matchedProfile]);
        state.settings.operatingArea = autoGeo.matchedProfile;
        state.regionMeta = profile;
        if (Demo.buildRegionDataset) {
          const regDataset = Demo.buildRegionDataset(autoGeo.matchedProfile);
          state.teams = regDataset.teams || state.teams;
          state.incidents = regDataset.incidents || [];
          state.dispatchOrders = regDataset.dispatchOrders || [];
            const activeRep = state.reports?.[0];
          state.reports = activeRep ? [activeRep, ...(regDataset.reports || [])] : (regDataset.reports || []);
        }
      } else {
        // Brand-new custom province / region outside the 4 presets
        state.settings.operatingArea = targetProvince;
        state.regionMeta = {
          regionId: `REGION-${targetProvince.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
          operatingArea: targetProvince,
          country: "Vietnam (Auto-Tracked from UAV EXIF)",
          center: [Number(lat.toFixed(4)), Number(lng.toFixed(4))],
          defaultZoom: 13,
          coverageBounds: {
            minLat: Number((lat - 0.08).toFixed(4)),
            maxLat: Number((lat + 0.08).toFixed(4)),
            minLng: Number((lng - 0.08).toFixed(4)),
            maxLng: Number((lng + 0.08).toFixed(4))
          },
          sectors: [
            { name: targetDistrict, lat, lng, latitude: lat, longitude: lng }
          ]
        };
        state.incidents = state.incidents.filter((inc) => inc.location?.province === targetProvince);
        state.dispatchOrders = [];
            state.teams.forEach((t, idx) => {
          t.area = targetDistrict;
          t.currentMissionId = null;
          if (idx < 5) t.status = "Available";
        });
      }
    }

    // Ensure the detected district is in regionMeta.sectors and bounds cover (lat, lng)
    if (!state.regionMeta) state.regionMeta = regionMeta(state);
    if (!Array.isArray(state.regionMeta.sectors)) state.regionMeta.sectors = [];
    if (!state.regionMeta.sectors.some((s) => s.name === targetDistrict)) {
      state.regionMeta.sectors.push({ name: targetDistrict, lat, lng, latitude: lat, longitude: lng });
    }
    const b = normalizeBounds(state.regionMeta.coverageBounds, state.regionMeta.center || [lat, lng]);
    state.regionMeta.coverageBounds = {
      minLat: Number(Math.min(b.minLat, lat - 0.04).toFixed(4)),
      maxLat: Number(Math.max(b.maxLat, lat + 0.04).toFixed(4)),
      minLng: Number(Math.min(b.minLng, lng - 0.04).toFixed(4)),
      maxLng: Number(Math.max(b.maxLng, lng + 0.04).toFixed(4))
    };
  }

  function switchRegionDataset(regionName) {
    const nextState = normalizeVerificationFields(Demo.buildRegionDataset ? Demo.buildRegionDataset(regionName) : Demo.buildInitialState());
    save(nextState, { event: "REGION_DATASET_SWITCHED", detail: `Switched active dataset to ${regionName}` });
    return clone(nextState);
  }

  function importDataset(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.incidents) || !Array.isArray(raw.teams)) {
      throw new Error("Invalid JSON dataset: must contain 'incidents' and 'teams' arrays.");
    }
    const fallback = Demo.buildInitialState();
    const rawMeta = raw.regionMeta || raw.datasetMeta || {};
    const areaName = raw.settings?.operatingArea || rawMeta.operatingArea || rawMeta.regionName || raw.incidents[0]?.location?.province || "Custom Region";
    const normalized = {
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
      regionMeta: {
        ...rawMeta,
        operatingArea: areaName
      },
      uavs: Array.isArray(raw.uavs) && raw.uavs.length ? raw.uavs : clone(Demo.UAVS),
      reports: Array.isArray(raw.reports) ? raw.reports : [],
      incidents: raw.incidents.map((inc, idx) => ({
        id: inc.id || `INC-${9000 + idx}`,
        reportId: inc.reportId || `REP-${9000 + idx}`,
        originalType: inc.originalType || inc.type || "Flood",
        reviewedType: inc.reviewedType ?? null,
        draftReviewedType: inc.draftReviewedType || inc.reviewedType || inc.originalType || inc.type || "Flood",
        aiConfidence: Number(inc.aiConfidence ?? 92.0),
        poseConfidence: Number(inc.poseConfidence ?? 88.5),
        severityScore: Number(inc.severityScore ?? 75.0),
        severitySource: inc.severitySource || "Imported custom dataset",
        detectedPeopleCount: Number(inc.detectedPeopleCount ?? (inc.detections?.length || 1)),
        customTags: Array.isArray(inc.customTags) ? inc.customTags : [],
        customAttributes: inc.customAttributes ? JSON.parse(JSON.stringify(inc.customAttributes)) : null,
        detections: Array.isArray(inc.detections)
          ? inc.detections
          : Demo.detections(inc.location?.latitude || 16.0544, inc.location?.longitude || 108.2022, Number(inc.detectedPeopleCount ?? 1)),
        location: {
          district: inc.location?.district || "Sector 1",
          province: inc.location?.province || areaName,
          latitude: Number(inc.location?.latitude ?? 16.0544),
          longitude: Number(inc.location?.longitude ?? 108.2022)
        },
        status: inc.status || "Unverified",
        assignedTeamId: inc.assignedTeamId ?? null,
        dispatchId: inc.dispatchId ?? null,
        createdAt: inc.createdAt || new Date().toISOString(),
        verifiedAt: inc.verifiedAt ?? null,
        closedAt: inc.closedAt ?? null,
        image: inc.image || `assets/evidence-${String(inc.originalType || "Flood").toLowerCase().replaceAll(" ", "-")}.svg`,
        reviewNotes: inc.reviewNotes || "",
        resolutionNote: inc.resolutionNote || ""
      })),
      teams: raw.teams.map((t, idx) => ({
        id: t.id || `TEAM-${idx + 1}`,
        name: t.name || `Rescue Unit ${idx + 1}`,
        commander: t.commander || "Field Commander",
        members: Number(t.members ?? 8),
        area: t.area || "Sector 1",
        latitude: t.latitude ?? null,
        longitude: t.longitude ?? null,
        status: t.status || "Available",
        currentMissionId: t.currentMissionId ?? null,
        distanceKm: Number(t.distanceKm ?? 3.5),
        matchScore: Number(t.matchScore ?? 85),
        equipment: t.equipment || "General rescue kit",
        customTags: Array.isArray(t.customTags) ? t.customTags : [],
        customAttributes: t.customAttributes ? JSON.parse(JSON.stringify(t.customAttributes)) : undefined
      })),
      dispatchOrders: Array.isArray(raw.dispatchOrders) ? raw.dispatchOrders : [],
      settings: {
        ...fallback.settings,
        ...(raw.settings || {}),
        operatingArea: areaName,
        notificationChannels: {
          ...fallback.settings.notificationChannels,
          ...(raw.settings?.notificationChannels || {})
        },
        alertThresholds: {
          ...fallback.settings.alertThresholds,
          ...(raw.settings?.alertThresholds || {})
        },
        matchConfig: {
          ...(fallback.settings.matchConfig || {}),
          ...(raw.settings?.matchConfig || {})
        }
      },
      counters: {
        ...fallback.counters,
        ...(raw.counters || {})
      },
      audit: Array.isArray(raw.audit) ? raw.audit : [],
      auditSeq: Number(raw.auditSeq || (Array.isArray(raw.audit) ? raw.audit.length : 0))
    };
    normalized.regionMeta = regionMeta(normalized);
    if (Array.isArray(normalized.regionMeta.sectors) && Demo.enrichSectorAttributes) {
      normalized.regionMeta.sectors = normalized.regionMeta.sectors.map(Demo.enrichSectorAttributes);
    }
    if (Array.isArray(normalized.teams) && Demo.enrichTeamAttributes) {
      normalized.teams = normalized.teams.map(Demo.enrichTeamAttributes);
    }
    if (Array.isArray(normalized.incidents) && Demo.defaultReportAttributes) {
      normalized.incidents = normalized.incidents.map((inc) => ({
        ...inc,
        customAttributes: inc.customAttributes || Demo.defaultReportAttributes({
          type: inc.originalType,
          district: inc.location?.district,
          customTags: inc.customTags,
          count: inc.detectedPeopleCount
        })
      }));
    }
    normalized.customTagSchema = Array.isArray(raw.customTagSchema) ? raw.customTagSchema : clone(Demo.CUSTOM_TAG_SCHEMA || []);
    if (!normalized.settings.ruleEngine) {
      normalized.settings.ruleEngine = clone(Demo.DEFAULT_RULE_ENGINE);
    }
    const imported = normalizeVerificationFields(normalized);
    save(imported, { event: "CUSTOM_DATASET_IMPORTED", detail: `Imported dataset for ${areaName} (${imported.incidents.length} incidents, ${imported.teams.length} teams)` });
    return clone(imported);
  }

  function customTagSchema(state = load()) {
    return Array.isArray(state?.customTagSchema) && state.customTagSchema.length
      ? state.customTagSchema
      : clone(Demo.CUSTOM_TAG_SCHEMA || []);
  }

  function ruleEngineConfig(state = load()) {
    const raw = state?.settings?.ruleEngine || clone(Demo.DEFAULT_RULE_ENGINE);
    if (raw && Array.isArray(raw.rules)) {
      const defaultMap = new Map((Demo.DEFAULT_RULE_ENGINE.rules || []).map((r) => [r.id, r]));
      raw.rules.forEach((r) => {
        const def = defaultMap.get(r.id);
        if (def && (!r.contextWeights || Object.keys(r.contextWeights).length === 0) && def.contextWeights) {
          r.contextWeights = clone(def.contextWeights);
        }
      });
    }
    return raw;
  }

  function validateCustomTagValue(tagDef, rawVal) {
    if (!tagDef) return { valid: false, error: "Undefined tag schema" };
    if (rawVal === null || rawVal === undefined || rawVal === "") {
      return { valid: true, missing: true, normalizedValue: null };
    }
    if (tagDef.dataType === "Boolean") {
      if (typeof rawVal === "boolean") return { valid: true, missing: false, normalizedValue: rawVal };
      if (rawVal === "true" || rawVal === "1" || rawVal === 1) return { valid: true, missing: false, normalizedValue: true };
      if (rawVal === "false" || rawVal === "0" || rawVal === 0) return { valid: true, missing: false, normalizedValue: false };
      return { valid: false, error: `Tag "${tagDef.key}" expects Boolean (true/false).` };
    }
    if (tagDef.dataType === "Number") {
      const num = Number(rawVal);
      if (Number.isNaN(num)) return { valid: false, error: `Tag "${tagDef.key}" expects a valid Number.` };
      if (tagDef.min != null && num < tagDef.min) return { valid: false, error: `Tag "${tagDef.key}" must be >= ${tagDef.min}.` };
      if (tagDef.max != null && num > tagDef.max) return { valid: false, error: `Tag "${tagDef.key}" must be <= ${tagDef.max}.` };
      return { valid: true, missing: false, normalizedValue: num };
    }
    if (tagDef.dataType === "Enum") {
      const str = String(rawVal).trim();
      const allowed = Array.isArray(tagDef.enumValues) ? tagDef.enumValues : [];
      if (allowed.length && !allowed.includes(str)) {
        return { valid: false, error: `Tag "${tagDef.key}" must be one of [${allowed.join(", ")}].` };
      }
      return { valid: true, missing: false, normalizedValue: str };
    }
    return { valid: false, error: `Unsupported dataType: ${tagDef.dataType}` };
  }

  function validateRuleEngineConfig(engineCfg, schema = customTagSchema()) {
    const issues = [];
    const conflicts = [];
    const schemaMap = new Map(schema.map((t) => [t.key, t]));
    const rules = Array.isArray(engineCfg?.rules) ? engineCfg.rules : [];

    rules.forEach((rule) => {
      (rule.requiredTags || []).forEach((tagKey) => {
        if (!schemaMap.has(tagKey)) {
          issues.push(`Rule ${rule.id} references unregistered tag "${tagKey}".`);
        }
      });
    });

    const enabledHard = rules.filter((r) => r.enabled && r.category === "Hard");
    const enabledSoft = rules.filter((r) => r.enabled && r.category === "Soft");
    if (enabledHard.some((r) => r.id === "HC-02") && enabledSoft.some((r) => r.id === "SC-01" && r.weightDelta < 0)) {
      conflicts.push("Conflict between HC-02 (blocks heavy trucks in narrow alleys) and negative SC-01 weight on agile vehicles.");
    }
    const duplicateIds = rules.map((r) => r.id).filter((id, i, arr) => arr.indexOf(id) !== i);
    if (duplicateIds.length) {
      conflicts.push(`Duplicate rule IDs detected: ${duplicateIds.join(", ")}`);
    }

    return {
      valid: issues.length === 0 && conflicts.length === 0,
      issues,
      conflicts
    };
  }

  function resolveIncidentContextAttributes(incident, state = load()) {
    const schema = customTagSchema(state);
    const meta = regionMeta(state);
    const sector = (meta.sectors || []).find((s) => s.name === incident?.location?.district) || {};
    const enrichedSector = Demo.enrichSectorAttributes ? Demo.enrichSectorAttributes(sector) : sector;
    const reportObj = (state.reports || []).find((r) => r.id === incident?.reportId) || {};
    const fallbackReportAttrs = Demo.defaultReportAttributes
      ? Demo.defaultReportAttributes({
          type: incident?.originalType,
          district: incident?.location?.district,
          customTags: incident?.customTags,
          count: incident?.detectedPeopleCount,
          customAttributes: incident?.customAttributes || reportObj?.customAttributes
        })
      : {};

    const reportAttrs = {
      ...fallbackReportAttrs,
      ...(reportObj.customAttributes || {}),
      ...(incident?.customAttributes || {})
    };
    const locationAttrs = enrichedSector.customAttributes || {};

    const resolved = {};
    schema.filter((t) => t.targetEntity === "Report" || t.targetEntity === "Location").forEach((tagDef) => {
      const rawEntry = tagDef.targetEntity === "Report" ? reportAttrs[tagDef.key] : locationAttrs[tagDef.key];
      const rawVal = rawEntry && typeof rawEntry === "object" && "value" in rawEntry ? rawEntry.value : rawEntry;
      const source = (rawEntry && typeof rawEntry === "object" && rawEntry.source) || tagDef.source;
      const check = validateCustomTagValue(tagDef, rawVal);
      resolved[tagDef.key] = {
        key: tagDef.key,
        label: tagDef.label,
        dataType: tagDef.dataType,
        unit: tagDef.unit || "",
        targetEntity: tagDef.targetEntity,
        source,
        aiOutput: Boolean(tagDef.aiOutput),
        value: check.valid ? check.normalizedValue : null,
        missing: Boolean(check.missing || !check.valid),
        validationError: check.valid ? null : check.error
      };
    });
    return resolved;
  }

  function resolveTeamAttributes(team, state = load()) {
    const schema = customTagSchema(state);
    const enriched = Demo.enrichTeamAttributes ? Demo.enrichTeamAttributes(team) : team;
    const teamAttrs = enriched.customAttributes || {};
    const resolved = {};
    schema.filter((t) => t.targetEntity === "RescueTeam").forEach((tagDef) => {
      const rawEntry = teamAttrs[tagDef.key];
      const rawVal = rawEntry && typeof rawEntry === "object" && "value" in rawEntry ? rawEntry.value : rawEntry;
      const source = (rawEntry && typeof rawEntry === "object" && rawEntry.source) || tagDef.source;
      const check = validateCustomTagValue(tagDef, rawVal);
      resolved[tagDef.key] = {
        key: tagDef.key,
        label: tagDef.label,
        dataType: tagDef.dataType,
        unit: tagDef.unit || "",
        targetEntity: "RescueTeam",
        source,
        aiOutput: false,
        value: check.valid ? check.normalizedValue : null,
        missing: Boolean(check.missing || !check.valid),
        validationError: check.valid ? null : check.error
      };
    });
    return resolved;
  }

  function evaluateTeamRules(team, incident, state = load()) {
    const engine = ruleEngineConfig(state);
    const rules = Array.isArray(engine.rules) ? engine.rules : [];
    const missingPolicy = engine.missingDataPolicy || "soft_warning";
    const incAttrs = resolveIncidentContextAttributes(incident, state);
    const teamAttrs = resolveTeamAttributes(team, state);
    const type = effectiveType(incident);
    const sameArea = team.area === incident.location?.district;

    const hardPassed = [];
    const hardFailed = [];
    const softApplied = [];
    const missingWarnings = [];

    const val = (map, k) => map[k]?.value;
    const isMissing = (map, k) => Boolean(map[k]?.missing || map[k]?.value === null || map[k]?.value === undefined);

    rules.filter((r) => r.enabled).forEach((rule) => {
      if (rule.category === "Hard") {
        if (rule.id === "HC-01") {
          if (isMissing(incAttrs, "road_width_m") || isMissing(teamAttrs, "min_road_clearance_m")) {
            if (missingPolicy === "strict_block") {
              hardFailed.push({ id: rule.id, name: rule.name, reason: "Missing road_width_m or min_road_clearance_m under strict_block policy." });
            } else if (missingPolicy === "soft_warning") {
              missingWarnings.push({ id: rule.id, tag: "road_width_m", message: "road_width_m is missing; HC-01 converted to soft caution." });
            }
          } else {
            const roadW = Number(val(incAttrs, "road_width_m"));
            const reqW = Number(val(teamAttrs, "min_road_clearance_m"));
            if (roadW < reqW) {
              hardFailed.push({
                id: rule.id,
                name: rule.name,
                reason: `Approach road (${roadW.toFixed(1)}m) is narrower than vehicle clearance (${reqW.toFixed(1)}m).`
              });
            } else {
              hardPassed.push({
                id: rule.id,
                name: rule.name,
                detail: `Road width ${roadW.toFixed(1)}m ≥ required ${reqW.toFixed(1)}m`
              });
            }
          }
        } else if (rule.id === "HC-02") {
          if (val(incAttrs, "narrow_entrance") === true && val(teamAttrs, "vehicle_type") === "heavy_truck") {
            hardFailed.push({
              id: rule.id,
              name: rule.name,
              reason: "Heavy truck cannot enter incident with narrow_entrance = true."
            });
          } else {
            hardPassed.push({
              id: rule.id,
              name: rule.name,
              detail: val(incAttrs, "narrow_entrance") ? `Vehicle (${val(teamAttrs, "vehicle_type")}) permitted in narrow entrance` : "Standard entrance clearance"
            });
          }
        } else if (rule.id === "HC-03") {
          const deepFlood = type === "Flood" && (
            val(incAttrs, "access_terrain") === "riverine_canal" ||
            (Array.isArray(incident.customTags) && incident.customTags.includes("deep_submerged"))
          );
          if (deepFlood && val(teamAttrs, "vehicle_type") !== "rescue_boat") {
            hardFailed.push({
              id: rule.id,
              name: rule.name,
              reason: "Deep or riverine flood requires a rescue_boat deployment vehicle."
            });
          } else {
            hardPassed.push({
              id: rule.id,
              name: rule.name,
              detail: deepFlood ? "Rescue boat available for riverine flood operations" : "Water gate satisfied"
            });
          }
        } else if (rule.id === "HC-04") {
          const criticalCollapse = type === "Building Collapse" && Number(incident.severityScore || 0) >= 88;
          if (criticalCollapse && val(teamAttrs, "heavy_debris_gear") !== true) {
            hardFailed.push({
              id: rule.id,
              name: rule.name,
              reason: "Critical building collapse (Severity ≥ 88) requires heavy_debris_gear = true."
            });
          } else {
            hardPassed.push({
              id: rule.id,
              name: rule.name,
              detail: criticalCollapse ? "Equipped with heavy shoring/extrication gear" : "Extrication gate satisfied"
            });
          }
        } else if (rule.customTagKey) {
          // User-defined custom Hard Constraint
          const targetMap = rule.targetEntity === "RescueTeam" ? teamAttrs : incAttrs;
          if (isMissing(targetMap, rule.customTagKey)) {
            if (missingPolicy === "soft_warning") {
              missingWarnings.push({ id: rule.id, tag: rule.customTagKey, message: `Missing ${rule.customTagKey}; converted to soft warning.` });
            }
          } else {
            const actual = val(targetMap, rule.customTagKey);
            const expected = rule.expectedValue;
            const pass = String(actual) === String(expected);
            if (!pass) {
              hardFailed.push({ id: rule.id, name: rule.name, reason: rule.failureReason || `${rule.customTagKey} (${actual}) != ${expected}` });
            } else {
              hardPassed.push({ id: rule.id, name: rule.name, detail: `${rule.customTagKey} == ${expected}` });
            }
          }
        }
      } else if (rule.category === "Soft") {
        let delta = Number(rule.weightDelta || 0);
        let isZeroOverridden = false;
        if (rule.contextWeights && typeof rule.contextWeights[type] === "number") {
          delta = Number(rule.contextWeights[type]);
          if (delta === 0) {
            isZeroOverridden = true;
          }
        } else if (rule.id === "SC-04" && !["Building Collapse", "Traffic Accident"].includes(type)) {
          delta = 0;
          isZeroOverridden = true;
        } else if (rule.id === "SC-02" && type !== "Flood") {
          delta = 0;
          isZeroOverridden = true;
        }

        if (rule.id === "SC-01") {
          if (val(incAttrs, "narrow_entrance") === true && ["compact_moto", "rescue_van"].includes(val(teamAttrs, "vehicle_type"))) {
            if (isZeroOverridden) {
              softApplied.push({ id: rule.id, name: rule.name, delta: 0, zeroWeightOverride: true, reason: `Context Zero-Weight Override: Inactive for ${type} (0 pts)` });
            } else {
              softApplied.push({ id: rule.id, name: rule.name, delta, zeroWeightOverride: false, reason: `Agile vehicle (${val(teamAttrs, "vehicle_type")}) suited for narrow alley (+${delta} pts)` });
            }
          }
        } else if (rule.id === "SC-02") {
          if (Number(val(incAttrs, "flood_current_knot") || 0) >= 2.5 && val(teamAttrs, "vehicle_type") === "rescue_boat") {
            if (isZeroOverridden) {
              softApplied.push({ id: rule.id, name: rule.name, delta: 0, zeroWeightOverride: true, reason: `Context Zero-Weight Override: Inactive for ${type} (0 pts)` });
            } else {
              softApplied.push({ id: rule.id, name: rule.name, delta, zeroWeightOverride: false, reason: `Rescue boat matched to fast waterway current (+${delta} pts)` });
            }
          }
        } else if (rule.id === "SC-03") {
          if (val(incAttrs, "population_density") === "ultra_dense" && sameArea) {
            if (isZeroOverridden) {
              softApplied.push({ id: rule.id, name: rule.name, delta: 0, zeroWeightOverride: true, reason: `Context Zero-Weight Override: Inactive for ${type} (0 pts)` });
            } else {
              softApplied.push({ id: rule.id, name: rule.name, delta, zeroWeightOverride: false, reason: `Same-sector rapid response in ultra-dense zone (+${delta} pts)` });
            }
          }
        } else if (rule.id === "SC-04") {
          if (val(teamAttrs, "heavy_debris_gear") === true) {
            if (isZeroOverridden) {
              softApplied.push({ id: rule.id, name: rule.name, delta: 0, zeroWeightOverride: true, reason: `Context Zero-Weight Override: Inactive for ${type} (0 pts)` });
            } else {
              softApplied.push({ id: rule.id, name: rule.name, delta, zeroWeightOverride: false, reason: `Heavy extrication & hydraulic cutter gear ready (+${delta} pts)` });
            }
          }
        } else if (rule.id === "SC-05") {
          if (isMissing(incAttrs, "road_width_m") && val(teamAttrs, "vehicle_type") === "heavy_truck") {
            if (isZeroOverridden) {
              softApplied.push({ id: rule.id, name: rule.name, delta: 0, zeroWeightOverride: true, reason: `Context Zero-Weight Override: Inactive for ${type} (0 pts)` });
            } else {
              softApplied.push({ id: rule.id, name: rule.name, delta, zeroWeightOverride: false, reason: `Missing road_width_m caution penalty for heavy truck (${delta} pts)` });
            }
          }
        } else if (rule.customTagKey) {
          const targetMap = rule.targetEntity === "RescueTeam" ? teamAttrs : incAttrs;
          if (!isMissing(targetMap, rule.customTagKey) && String(val(targetMap, rule.customTagKey)) === String(rule.expectedValue)) {
            if (isZeroOverridden) {
              softApplied.push({ id: rule.id, name: rule.name, delta: 0, zeroWeightOverride: true, reason: `Context Zero-Weight Override: Inactive for ${type} (0 pts)` });
            } else {
              softApplied.push({ id: rule.id, name: rule.name, delta, zeroWeightOverride: false, reason: rule.reasonText || `${rule.customTagKey} == ${rule.expectedValue} (+${delta} pts)` });
            }
          }
        }
      }
    });

    const softDelta = softApplied.reduce((sum, item) => sum + item.delta, 0);
    return {
      eligible: hardFailed.length === 0,
      hardPassed,
      hardFailed,
      softApplied,
      missingWarnings,
      softDelta,
      ruleVersion: engine.version || "v2.5.0-controlled",
      incAttrs,
      teamAttrs
    };
  }

  function applyScenario(name) {
    reset();
    if (name === "baseline" || name === "successful") return load();
    update({ event: "SCENARIO_APPLIED", detail: name }, (state) => {
      if (name === "no-teams") {
        state.teams.forEach((team) => {
          if (team.id !== "SAR-02") {
            team.status = "Offline";
            team.currentMissionId = null;
          }
        });
      }
      if (name === "ai-correction") {
        const incident = state.incidents.find((item) => item.status === "Unverified" && item.originalType !== "Normal")
          || state.incidents.find((item) => item.id === "INC-8801");
        if (incident) {
          incident.draftReviewedType = "Flood";
          incident.reviewedType = "Flood";
          incident.verifiedAt = new Date().toISOString();
          incident.status = "Matching Team";
          incident.verificationStatus = "verified";
        }
      }
      if (name === "partial") {
        const incident = state.incidents.find((item) => item.status === "Matching Team")
          || state.incidents.find((item) => item.id === "INC-8802");
        const team = state.teams.find((item) => item.id === "SAR-01" && item.status === "Available")
          || state.teams.find((item) => item.status === "Available");
        if (!incident || !team) return;
        const dispatchId = nextId(state, "dispatch", "DSP");
        incident.status = "In Progress";
        incident.assignedTeamId = team.id;
        incident.dispatchId = dispatchId;
        state.dispatchOrders.push({
          id: dispatchId,
          incidentId: incident.id,
          teamId: team.id,
          matchScore: team.matchScore,
          distanceKm: team.distanceKm,
          status: "Confirmed",
          createdAt: new Date(Date.now() - 25 * 60000).toISOString(),
          confirmedAt: new Date(Date.now() - 25 * 60000).toISOString(),
          completedAt: null
        });
        team.status = "On Mission";
        team.currentMissionId = null;
      }
    });
    return load();
  }

  // =========================================================================
  // AHP priority preview and EXIF helpers
  // =========================================================================

  function exifCaptureTime(dateText, offsetText) {
    const m = String(dateText || "").match(/(\d+):(\d+):(\d+) (\d+):(\d+):(\d+)/);
    if (!m) return null;
    const off = String(offsetText || "").match(/^([+-])(\d{2}):(\d{2})$/);
    if (!off) return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString();
    const offsetMin = (off[1] === "-" ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3]));
    return new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - offsetMin * 60000).toISOString();
  }

  // Optimistic client preview for the C2 queue while the server AHP/TOPSIS
  // response is in flight. Never persist this value as the official score.
  // Weights: severity 0.648, distance 0.230, free teams 0.122.
  // 03/11 direction: farther distance and fewer free teams raise priority.
  function priorityScore(severity, distanceKm, freeTeams) {
    const clamp = (v) => Math.max(0, Math.min(1, v));
    return Number((clamp(severity / 100) * 0.648 + clamp(distanceKm / 20) * 0.230 + clamp(1 - freeTeams / 3) * 0.122).toFixed(4));
  }

  // PROMPT A.4: U_cluster = U_max x B, B = 1 + min(0.24, 0.06 x (n - 1)).
  function subscribe(callback) {
    const local = (event) => callback(event.detail || load());
    window.addEventListener(CHANGE_EVENT, local);
    return () => window.removeEventListener(CHANGE_EVENT, local);
  }

  window.SkyRescueStore = {
    priorityScore,
    exifCaptureTime,
    KEY,
    load,
    save,
    update,
    reset,
    nextId,
    effectiveType,
    activeAssignmentForTeam,
    missionForIncident,
    dispatchForIncident,
    sourceTypeForReport,
    sourceIdentityForReport,
    codeRedProfile,
    autoVerifyPolicy,
    reportCoordinates,
    haversineMeters,
    evaluateReportVerification,
    setReportVerification,
    regionMeta,
    detectLocationFromGps,
    adaptRegionToIncident,
    switchRegionDataset,
    importDataset,
    customTagSchema,
    ruleEngineConfig,
    validateCustomTagValue,
    validateRuleEngineConfig,
    resolveIncidentContextAttributes,
    resolveTeamAttributes,
    evaluateTeamRules,
    applyScenario,
    subscribe
  };
})();
