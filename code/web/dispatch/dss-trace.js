// Dispatch views for live ML results: evidence with real boxes, AI status badges and the DSS Trace.
(function () {
  "use strict";

  const e = (value) => window.SkyUI.escape(value);
  const badge = (text, tone = "") => window.SkyUI.badge(text, tone);
  const TONE = { Queued: "neutral", Running: "warning", Completed: "success", Failed: "danger" };

  function isLive(report) {
    return report?.dataOrigin === "Live upload";
  }

  // Data origin + metadata source + AI status + review flags for one report.
  function badges(report) {
    if (!report) return "";
    const out = [];
    out.push(isLive(report) ? badge("Live upload", "success") : badge("Seeded sample", "neutral"));
    if (report.metadataSource === "demo_preset") out.push(badge("Simulated metadata (demo)", "warning"));
    if (isLive(report)) {
      const status = report.processingStatus || "Queued";
      out.push(badge(status === "Running" ? "AI processing…" : `AI ${status}`, TONE[status] || "neutral"));
      const ai = report.aiResult;
      if (ai?.status === "stopped_normal") out.push(badge("Model 1: Normal (stopped)", "neutral"));
      // Flood without an Upright reference person cannot be measured: the wrapper gives severity 1.0 (fail-safe).
      const failSafe = ai?.incidentType === "Flood" && ai?.details?.n_reference === 0;
      if (ai?.needsReview) out.push(badge(failSafe ? "Fail-safe · needs review" : "Needs review", "danger"));
      if (ai?.routedByReview) out.push(badge(`Routed by review · P(Normal) ${Number(ai.pNormal).toFixed(2)}`, "warning"));
      if (ai?.contradiction) out.push(badge("Contradiction", "danger"));
    }
    return `<div class="row" style="gap:6px;flex-wrap:wrap">${out.join("")}</div>`;
  }

  // Image with boxes. Live images keep their aspect ratio, so the percent boxes match the pixels.
  function evidence(report, incident) {
    const live = isLive(report);
    const dets = incident?.detections || [];
    const boxes = live ? dets.map((d) => `<span class="bbox ${d.pose === "Non-Upright" ? "non-upright" : ""}" style="left:${d.bbox[0]}%;top:${d.bbox[1]}%;width:${d.bbox[2]}%;height:${d.bbox[3]}%"><span>${e(d.id)} · ${e(d.pose)} · ${d.confidence}%</span></span>`).join("") : "";
    const caption = live
      ? `Live ML inference · ${dets.length} people detected`
      : "Seeded sample image (no live inference)";
    return `<div class="evidence-viewer ${live ? "live" : ""}"><img src="${e(report?.image || incident?.image)}" alt="Evidence for ${e(report?.id || incident?.id)}">${boxes}<div class="viewer-caption">${e(caption)}</div></div>`;
  }

  function row(label, value) {
    return `<div class="setting-row"><span>${label}</span><strong>${value}</strong></div>`;
  }

  // One row for each pipeline tier, with the real numbers (PROMPT §7.9).
  function trace(report, incident, shared, metrics) {
    if (!isLive(report)) {
      return `<section class="card"><div class="card-header"><div><p class="eyebrow">DSS Trace</p><h2>Decision pipeline</h2></div>${badge("Seeded sample", "neutral")}</div><p class="muted">This is seeded demo data. Only live uploads have a model trace.</p></section>`;
    }
    const ai = report.aiResult;
    const rerun = `<button class="btn ghost small" data-action="rerun-ai" data-report="${e(report.id)}">↻ Re-run AI</button>`;
    if (!ai) {
      return `<section class="card"><div class="card-header"><div><p class="eyebrow">DSS Trace</p><h2>Decision pipeline</h2></div>${badge(report.processingStatus || "Queued", "warning")}</div><p class="muted">The models are processing this image. The result shows here without a reload.</p></section>`;
    }
    if (ai.status === "failed") {
      return `<section class="card"><div class="card-header"><div><p class="eyebrow">DSS Trace</p><h2>Decision pipeline</h2></div>${rerun}</div><div class="alert danger"><span>!</span><div><strong>AI failed</strong><div>${e(ai.error || "Unknown error")}. The type is Unclassified, so Verify stays locked until you select a type.</div></div></div></section>`;
    }
    const probs = Object.entries(ai.probs || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${e(k)} ${(v * 100).toFixed(1)}%`).join(" · ");
    const details = ai.details || {};
    const detailText = Object.entries(details).filter(([, v]) => v !== null && typeof v !== "object").slice(0, 8).map(([k, v]) => `${e(k)}=${e(typeof v === "number" ? Number(v.toFixed ? v.toFixed(3) : v) : v)}`).join(" · ");
    const weights = metrics.ahpWeights || {};
    const weightText = ["severity_score", "distance_to_nearest_team_km", "free_teams"]
      .map((key) => `${key}=${Number(weights[key] ?? 0).toFixed(3)}`).join(" · ");
    const altitudeNote = ai.incidentType === "Traffic Accident" ? " · altitude assumed 12 m (no telemetry)" : "";
    return `<section class="card"><div class="card-header"><div><p class="eyebrow">DSS Trace</p><h2>Decision pipeline</h2><p class="muted">Live ML inference · ${e(ai.models?.m1)} + ${e(ai.models?.m2)} · ${ai.latencyMs} ms</p></div>${rerun}</div>
      ${row("Tier 1 · Model 1 (scene class)", `${e(ai.incidentType)} · ${Number(ai.aiConfidence).toFixed(1)}%`)}
      <div class="muted" style="font-size:12px;margin:-4px 0 8px">${probs}${ai.status === "stopped_normal" ? " · P(Normal) ≥ 0.9: pipeline stopped" : ""}</div>
      ${row("Tier 2 · Model 2 (people + pose)", `${ai.detectedPeopleCount} people · ${ai.nonUprightCount} Non-Upright · mean conf ${Number(ai.poseConfidence).toFixed(1)}%`)}
      ${row("Tier 3 · Severity wrapper", `${Number(ai.severityScore).toFixed(1)} / 100 · ${e(ai.severityLevel || "—")}${altitudeNote}`)}
      ${detailText ? `<div class="muted mono" style="font-size:11px;margin:-4px 0 8px">${detailText}</div>` : ""}
      ${row("Tier 4 · Priority (AHP/TOPSIS)", `${metrics.priorityScore.toFixed(4)} · rank ${Number.isFinite(metrics.ahpRank) ? `#${metrics.ahpRank}` : "—"}`)}
      <div class="muted" style="font-size:12px">${metrics.ahpActive ? `Server AHP weights: ${weightText} · CR ${Number(metrics.ahpCr ?? 0).toFixed(3)}. ` : "Optimistic client preview (server snapshot pending; not official). "}Direction: farther nearest-team distance and fewer free teams raise priority. Severity ${Number(incident.severityScore).toFixed(1)}/100. d_min ${Number(metrics.distanceKm).toFixed(1)} km · covering free teams ${metrics.freeTeams}${metrics.nearestTeamId ? ` · nearest ${e(metrics.nearestTeamId)}` : ""}${metrics.assignedTeamId ? ` · assigned ${e(metrics.assignedTeamId)}` : ""}.</div>
    </section>`;
  }

  async function rerun(reportId) {
    const res = await fetch("/api/ml/rerun", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Portal": "dispatch" },
      body: JSON.stringify({ reportId })
    });
    window.SkyUI.toast(res.ok ? `AI re-run queued for ${reportId}.` : `AI re-run failed (HTTP ${res.status}).`, res.ok ? "success" : "error");
  }

  window.SkyDssTrace = { isLive, badges, evidence, trace, rerun };
})();
