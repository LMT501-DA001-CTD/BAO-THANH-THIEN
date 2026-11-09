function normalizeTeamDisplay(rawId) {
  if (!rawId || rawId === "-") return "-";
  if (rawId === "PCCC-BT") return "FIRE-01";
  if (rawId === "TN-SG") return "VOL-01";
  if (rawId === "MED-02") return "MED-01";
  if (rawId === "SAR-05") return "SAR-03";
  if (rawId === "CT-PCCC-NK") return "CT-FIRE-01";
  if (rawId === "CT-EROSION-02") return "CT-SAR-02";
  if (rawId === "CT-VOL-PD") return "CT-VOL-01";
  if (rawId === "HN-PCCC-DD") return "HN-FIRE-01";
  if (rawId === "HN-MOTO-PCCC") return "HN-FIRE-02";
  if (rawId === "HN-SAR-HK") return "HN-SAR-01";
  if (rawId === "HN-WATER-CM") return "HN-WATER-01";
  if (rawId === "HN-MED-CG") return "HN-MED-01";
  if (rawId === "DN-PCCC-ST") return "DN-FIRE-01";
  if (rawId === "DN-ENG-LC") return "DN-SAR-02";
  if (rawId === "USAR-CA1") return "US-SAR-01";
  if (rawId === "LAFD-02") return "US-WATER-01";
  if (rawId === "SMR-03") return "US-MED-01";
  if (rawId === "PAS-04") return "US-FIRE-01";
  if (rawId === "LBFD-05") return "US-WATER-02";
  return rawId;
}
(function () {
  "use strict";

  const Demo = window.SkyRescueDemo;
  const Store = window.SkyRescueStore;
  const UI = window.SkyUI;
  const Trace = window.SkyDssTrace;
  const root = document.querySelector("#dispatch-app");
  const navRoot = document.querySelector("#dispatch-nav");
  const e = UI.escape;
  const COLORS = { Fire: "#d8352a", Flood: "#2f79bd", "Building Collapse": "#8a6335", "Traffic Accident": "#d99620", Unclassified: "#748197", Normal: "#1f9d6b" };
  const SCREENS = [
    ["C1", "Tactical Map", "⌖"], ["C2", "Verified / Pending Queues", "≡"], ["C7", "Rescue Teams", "✦"], ["Configuration", "Configuration", "⚙"], ["Audit", "Audit Log", "☰"], ["C9", "Reports & Export", "▤"]
  ];
  const MAP_TYPES = Demo.TYPES.filter((type) => type !== "Normal");
  const TIME_RANGES = [
    ["24h", "Last 24 Hours"],
    ["7d", "Last 7 Days"],
    ["30d", "Last 30 Days"],
    ["all", "All Time"]
  ];

  const ui = {
    screen: location.hash.replace("#", "") || "C1",
    selectedIncidentId: "INC-8802",
    selectedTeamId: null,
    selectedDetectionId: null,
    focusedIncidentId: null,
    queue: { type: "All", district: "All", severity: "All", status: "All", sort: "priority", tab: "auto", timeRange: "7d", viewMode: "table", codeRedOnly: false },
    c2Mode: "queue",
    workspaceIncidentId: null,
    mapType: "All",
    mapTimeRange: "7d",
    mapProvince: null,
    mapView: null,
    mapScopeKey: null,
    mapResetPending: false,
    teams: { status: "All", search: "" },
    reportFilters: { range: "All", type: "All", district: "All", status: "All", team: "All" },
    reviewingReportId: null,
    highlightedIncidentId: null,
    highlightScrollPending: false,
    dossierId: null,
    settingsDraft: null,
    map: null,
    markers: new Map()
  };
  if (![...SCREENS.map((item) => item[0]), "C3", "C4", "C5", "C9R", "C9D"].includes(ui.screen)) ui.screen = "C1";
  ui.audit = { q: "", event: "All", actor: "All", entity: "All", limit: 100 };

  // Server-side AHP/TOPSIS snapshot (backend_ml/ahp_topsis.py via /api/ahp/priority).
  // The local formula in Store.priorityScore() stays as the fallback if the request fails.
  const AHP_DEFAULT_RANGE = "7d";
  const ahpSnapshot = { range: null, rows: new Map(), weights: null, cr: null, pending: false, pendingEpoch: null, epoch: 0, failedRange: null, failedAt: 0 };

  function ahpRange() {
    return ui.queue.timeRange || AHP_DEFAULT_RANGE;
  }

  // M4: bump the epoch on every state change so a request that was already in
  // flight cannot write a stale snapshot back after verify/dispatch/finalize.
  function invalidateAhpSnapshot() {
    ahpSnapshot.range = null;
    ahpSnapshot.pending = false;
    ahpSnapshot.pendingEpoch = null;
    ahpSnapshot.epoch += 1;
  }

  function applyAhpPayload(data, range) {
    if (!data || !Array.isArray(data.rows)) return false;
    ahpSnapshot.range = range;
    ahpSnapshot.rows = new Map(data.rows.map((row) => [row.incidentId, row]));
    ahpSnapshot.weights = data.weights || null;
    ahpSnapshot.cr = data.consistencyRatio ?? null;
    return true;
  }

  async function requestAhpSnapshot(range) {
    const response = await fetch(`/api/ahp/priority?range=${encodeURIComponent(range)}`, {
      credentials: "same-origin",
      headers: { "X-Portal": "dispatch" }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return applyAhpPayload(data, range) ? data : null;
  }

  function ensureAhpSnapshot() {
    if (!window.SkyRescueSync?.user) return;
    const range = ahpRange();
    if (ahpSnapshot.range === range || ahpSnapshot.pending) return;
    if (ahpSnapshot.failedRange === range && Date.now() - ahpSnapshot.failedAt < 5000) return;
    const epoch = ahpSnapshot.epoch;
    ahpSnapshot.pending = true;
    ahpSnapshot.pendingEpoch = epoch;
    requestAhpSnapshot(range)
      .then((data) => {
        if (ahpSnapshot.pendingEpoch !== epoch) return; // a newer state superseded this request
        ahpSnapshot.pending = false;
        ahpSnapshot.pendingEpoch = null;
        if (!data) {
          ahpSnapshot.failedRange = range;
          ahpSnapshot.failedAt = Date.now();
          return;
        }
        if (!document.querySelector(".modal-backdrop")) render();
      })
      .catch(() => {
        if (ahpSnapshot.pendingEpoch !== epoch) return;
        ahpSnapshot.pending = false;
        ahpSnapshot.pendingEpoch = null;
        ahpSnapshot.failedRange = range;
        ahpSnapshot.failedAt = Date.now();
      });
  }



  function matchesTimeRange(createdAt, rangeKey = "7d") {
    if (!rangeKey || rangeKey === "all" || rangeKey === "All") return true;
    const ts = new Date(createdAt).getTime();
    if (Number.isNaN(ts)) return true;
    const diffMs = Date.now() - ts;
    if (rangeKey === "24h") return diffMs <= 24 * 3600000;
    if (rangeKey === "7d") return diffMs <= 7 * 86400000;
    if (rangeKey === "30d") return diffMs <= 30 * 86400000;
    return true;
  }

  function activeNav() {
    if (ui.screen === "C8" || ui.screen === "Configuration") return "Configuration";
    return ({ C3: "C2", C4: "C2", C5: "C2", C9R: "C2", C9D: "C9" })[ui.screen] || ui.screen;
  }

  function renderNav() {
    navRoot.innerHTML = SCREENS.map(([code, label, icon]) => `<button class="${activeNav() === code ? "active" : ""}" data-nav="${code}"><span>${icon} ${label}</span></button>`).join("");
    navRoot.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => go(button.dataset.nav)));
    const meta = Store.regionMeta(Store.load());
    const topStation = document.querySelector(".portal-top strong");
    if (topStation) topStation.textContent = `${meta.operatingArea} Dispatch Station (${meta.country || "Vietnam"})`;
    const clock = document.querySelector("#dispatch-clock");
    if (clock && UI.formatRegionClock) clock.textContent = `Operational console · ${UI.formatRegionClock()}`;
    const footStation = document.querySelector(".sidebar-foot p");
    if (footStation) footStation.innerHTML = `${e(meta.operatingArea)} Command<br><span class="muted">${e(meta.country || "Vietnam")} · ${e(meta.tzShort || "ICT (UTC+07:00)")}</span>`;
    UI.mountHeaderProfile?.();
  }

  function go(screen, incidentId) {
    if (ui.map) { try { ui.map.stop(); } catch (_) {} try { ui.map.remove(); } catch (_) {} ui.map = null; ui.markerLayer = null; ui.markers = new Map(); }
    ui.mapView = null;
    ui.mapScopeKey = null;
    if (incidentId) ui.selectedIncidentId = incidentId;
    let target = screen;
    if (target === "C8" || target === "configuration" || target === "cfg") target = "Configuration";
    if (target === "Configuration" && UI.canAccess && !UI.canAccess("canConfig")) {
      UI.toast("Access Restricted: System Configuration is reserved for Command Coordinators.", "warning");
      return;
    }
    if (target === "Audit" && UI.canAccess && !UI.canAccess("canConfig")) {
      UI.toast("Access Restricted: The Audit Log is reserved for Dispatch Admins.", "warning");
      return;
    }
    ui.screen = target;
    ui.editingType = false;
    ui.selectedDetectionId = null;
    if (target === "Configuration" || target === "C8") ui.settingsDraft = JSON.parse(JSON.stringify(Store.load().settings));
    location.hash = target;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectedIncident(shared = Store.load()) {
    return shared.incidents.find((item) => item.id === ui.selectedIncidentId) || shared.incidents[0];
  }

  function adminReviewComplete(shared, incident) {
    const report = shared.reports.find((item) => item.id === incident?.reportId);
    const autoVerified = Boolean(report?.verificationMethod && report.verificationMethod !== "admin");
    return Boolean(
      incident &&
      incident.verificationStatus === "verified" &&
      Store.effectiveType(incident) !== "Unclassified" &&
      Store.effectiveType(incident) !== "Normal" &&
      (!report?.requiresAdminReview || autoVerified || report.adminReview?.verifiedAt)
    );
  }

  function statusForTeam(shared, team) {
    const open = Store.activeAssignmentForTeam(shared, team.id);
    if (open) return "On Mission";
    return team.status;
  }

  function pageHead(code, title, subtitle, actions = "") {
    return `<div class="page-head"><div><p class="eyebrow">${code}</p><h1>${e(title)}</h1>${subtitle ? `<p class="muted">${e(subtitle)}</p>` : ""}</div><div class="page-actions">${actions}</div></div>`;
  }

  function provinceBuckets(incidents) {
    const buckets = new Map();
    incidents.forEach((incident) => {
      const province = incident.location?.province || "Unknown";
      if (!buckets.has(province)) {
        buckets.set(province, { province, count: 0, lats: [], lngs: [], types: {}, severity: 0 });
      }
      const bucket = buckets.get(province);
      bucket.count += 1;
      bucket.lats.push(Number(incident.location.latitude));
      bucket.lngs.push(Number(incident.location.longitude));
      const type = Store.effectiveType(incident);
      bucket.types[type] = (bucket.types[type] || 0) + 1;
      bucket.severity = Math.max(bucket.severity, Number(incident.severityScore) || 0);
    });
    return [...buckets.values()].map((bucket) => {
      const dominant = Object.entries(bucket.types).sort((a, b) => b[1] - a[1])[0]?.[0] || "Flood";
      return {
        ...bucket,
        lat: bucket.lats.reduce((sum, value) => sum + value, 0) / Math.max(1, bucket.lats.length),
        lng: bucket.lngs.reduce((sum, value) => sum + value, 0) / Math.max(1, bucket.lngs.length),
        dominant
      };
    });
  }

  function mapFilteredIncidents(shared) {
    // Document behaviour: the tactical map shows active hazard incidents only.
    // Normal reports and resolved cases stay reachable in the queue.
    return shared.incidents.filter((item) =>
      item.status !== "Resolved" &&
      Store.effectiveType(item) !== "Normal" &&
      matchesTimeRange(item.createdAt, ui.mapTimeRange) &&
      (ui.mapType === "All" || Store.effectiveType(item) === ui.mapType)
    );
  }

  function fallbackMap(incidents) {
    const shared = Store.load();
    const meta = Store.regionMeta(shared);
    const b = meta.coverageBounds || { minLat: 8.55, maxLat: 23.39, minLng: 102.14, maxLng: 109.47 };
    const scoped = ui.mapProvince ? incidents.filter((item) => item.location.province === ui.mapProvince) : incidents;

    if (ui.mapProvince && !scoped.length) {
      return `<div class="fallback-map"><div class="map-river"></div><div class="alert neutral" style="position:absolute;z-index:3;left:12px;right:12px;bottom:12px;background:rgba(255,255,255,0.92)"><span>ⓘ</span><div><strong>Province view · ${e(ui.mapProvince)}</strong><div>No active hazard incidents match the current filter.</div></div></div></div>`;
    }

    if (ui.mapProvince) {
      const lats = scoped.map((item) => Number(item.location.latitude));
      const lngs = scoped.map((item) => Number(item.location.longitude));
      const minLat = Math.min(...lats) - 0.02;
      const maxLat = Math.max(...lats) + 0.02;
      const minLng = Math.min(...lngs) - 0.02;
      const maxLng = Math.max(...lngs) + 0.02;
      const spanLat = Math.max(0.02, maxLat - minLat);
      const spanLng = Math.max(0.02, maxLng - minLng);
      const markers = scoped.map((incident, index) => {
        const type = Store.effectiveType(incident);
        const left = 14 + ((Number(incident.location.longitude) - minLng) / spanLng) * 72;
        const top = 16 + (1 - (Number(incident.location.latitude) - minLat) / spanLat) * 64;
        return `<button class="map-marker incident-marker" data-map-incident="${e(incident.id)}" title="${e(incident.id)} · ${e(incident.location.district)} · ${e(type)}" style="left:${Math.max(8, Math.min(90, left))}%;top:${Math.max(10, Math.min(82, top))}%;background:${COLORS[type] || "#748197"}" aria-label="Inspect ${e(incident.id)}"><span>${index + 1}</span><small>${e(incident.id)}</small></button>`;
      }).join("");
      return `<div class="fallback-map"><div class="map-river"></div>${markers}<div class="alert neutral" style="position:absolute;z-index:3;left:12px;right:12px;bottom:12px;background:rgba(255,255,255,0.92)"><span>ⓘ</span><div><strong>Province view · ${e(ui.mapProvince)}</strong><div>${scoped.length} active hazard incident(s) · Click a marker to inspect the dossier.</div></div></div></div>`;
    }

    const points = scoped.length ? scoped : incidents;
    const lats = points.map((i) => Number(i.location?.latitude)).filter((v) => !isNaN(v));
    const lngs = points.map((i) => Number(i.location?.longitude)).filter((v) => !isNaN(v));
    const minLat = lats.length > 1 ? Math.min(...lats) - 0.05 : (b.minLat ?? 8.55);
    const maxLat = lats.length > 1 ? Math.max(...lats) + 0.05 : (b.maxLat ?? 23.39);
    const minLng = lngs.length > 1 ? Math.min(...lngs) - 0.05 : (b.minLng ?? 102.14);
    const maxLng = lngs.length > 1 ? Math.max(...lngs) + 0.05 : (b.maxLng ?? 109.47);
    const spanLat = Math.max(0.05, maxLat - minLat);
    const spanLng = Math.max(0.05, maxLng - minLng);
    const markers = provinceBuckets(points).map((bucket) => {
      const left = 12 + ((bucket.lng - minLng) / spanLng) * 76;
      const top = 13 + (1 - (bucket.lat - minLat) / spanLat) * 72;
      return `<button class="map-marker province-marker ${ui.mapProvince === bucket.province ? "focused" : ""}" data-map-province="${e(bucket.province)}" title="${e(bucket.province)} · ${bucket.count} incident(s)" style="left:${Math.max(6, Math.min(92, left))}%;top:${Math.max(7, Math.min(87, top))}%;background:${COLORS[bucket.dominant]}" aria-label="Filter ${e(bucket.province)}"><span>${bucket.count}</span><small>${e(bucket.province)}</small></button>`;
    }).join("");
    return `<div class="fallback-map"><div class="map-river"></div>${markers}<div class="alert neutral" style="position:absolute;z-index:3;left:12px;right:12px;bottom:12px;background:rgba(255,255,255,0.92)"><span>ⓘ</span><div><strong>Grayscale Tactical Map (${e(meta.operatingArea)})</strong><div>Province view · ${incidents.length} active hazard incident(s) · Click a province to zoom in.</div></div></div></div>`;
  }

  function drawLeafletMarkers(shared, incidents) {
    if (!ui.map || !ui.markerLayer) return;
    ui.markerLayer.clearLayers();
    ui.markers = new Map();
    const bounds = ui.map.getBounds();
    const span = bounds.getNorth() - bounds.getSouth();
    const provinceItems = ui.mapProvince
      ? incidents.filter((incident) => incident.location.province === ui.mapProvince)
      : incidents;

    // National view: province aggregation. Close view: individual markers, but only
    // the ones inside this viewport, so one province never plots the whole country.
    if (!ui.mapProvince && span > 1.5 && provinceItems.length) {
      provinceBuckets(provinceItems).forEach((bucket) => {
        const icon = L.divIcon({
          className: "province-cluster-marker",
          html: `<span>${bucket.count}</span>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        });
        const marker = L.marker([bucket.lat, bucket.lng], { icon }).addTo(ui.markerLayer);
        marker.bindTooltip(`${e(bucket.province)} · ${bucket.count} incident(s) · click to zoom`, { direction: "top", offset: [0, -18] });
        marker.on("click", () => window.DispatchApp.focusProvince(bucket.province));
      });
      return;
    }

    const padded = bounds.pad(0.08);
    const visibleItems = ui.mapProvince
      ? provinceItems
      : provinceItems.filter((incident) => padded.contains([Number(incident.location.latitude), Number(incident.location.longitude)]));
    visibleItems.forEach((incident) => {
        const type = Store.effectiveType(incident);
        const marker = L.circleMarker([incident.location.latitude, incident.location.longitude], {
          radius: incident.severityScore >= 85 ? 11 : 8,
          color: "#fff", weight: 2.5, fillColor: COLORS[type], fillOpacity: .96
        }).addTo(ui.markerLayer).bindPopup(`<img src="${e(incident.image)}" alt="Evidence for ${e(incident.id)}" style="width:150px;height:96px;object-fit:cover;border-radius:6px;margin-bottom:6px"><br><strong>${e(incident.id)}</strong><br>${UI.typeLabel(type)}<br>${e(incident.location.district)} · ${e(incident.location.province)}<br>Severity ${incident.severityScore.toFixed(1)}<br><span class="muted" style="font-size:11px">${UI.formatDate(incident.createdAt)}</span><br><button class="btn small" style="margin-top:6px" onclick="window.DispatchApp.openIncident('${incident.id}')">Inspect Incident</button>`);
        marker.on("click", () => { ui.focusedIncidentId = incident.id; });
        ui.markers.set(incident.id, marker);
      });
  }

  function initLeaflet() {
    const mapElement = document.querySelector("#leaflet-map");
    if (!mapElement) return;
    const shared = Store.load();
    const meta = Store.regionMeta(shared);
    const incidents = mapFilteredIncidents(shared);
    if (typeof window.L === "undefined") {
      mapElement.innerHTML = fallbackMap(incidents);
      bindMapFallback();
      return;
    }
    try {
      const scopeKey = [meta.regionId || meta.operatingArea, ui.mapProvince || "", ui.mapType, ui.mapTimeRange, ui.focusedIncidentId || ""].join("|");
      const scopeChanged = scopeKey !== ui.mapScopeKey;
      ui.mapScopeKey = scopeKey;
      const saved = scopeChanged ? null : ui.mapView;
      const startCenter = saved?.center || meta.center || [16.0544, 108.2022];
      const startZoom = saved?.zoom ?? meta.defaultZoom ?? 6;
      // No zoom animation: map rebuilds during live data refreshes must never
      // race Leaflet's marker animation (the "_leaflet_pos" error).
      ui.map = L.map(mapElement, { zoomControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(startCenter, startZoom);
      let tileErrors = 0;
      const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors · Grayscale Tactical Mode"
      });
      tiles.on("tileerror", () => {
        tileErrors += 1;
        if (tileErrors === 3 && ui.map) {
          try { ui.map.stop(); } catch (_) {}
          ui.map.remove(); ui.map = null;
          mapElement.innerHTML = fallbackMap(incidents);
          bindMapFallback();
        }
      }).addTo(ui.map);
      ui.markerLayer = L.layerGroup().addTo(ui.map);

      const focus = ui.focusedIncidentId
        ? shared.incidents.find((item) => item.id === ui.focusedIncidentId)
        : null;
      const provincePoints = ui.mapProvince
        ? incidents.filter((item) => item.location.province === ui.mapProvince)
          .map((item) => [Number(item.location.latitude), Number(item.location.longitude)])
        : [];
      if (focus) {
        ui.map.setView([focus.location.latitude, focus.location.longitude], 15);
      } else if (ui.mapProvince && provincePoints.length) {
        ui.map.fitBounds(provincePoints, { padding: [40, 40], maxZoom: 12 });
      } else if (!saved && incidents.length) {
        const nationalFit = meta.datasetScope !== "province";
        ui.map.fitBounds(incidents.map((item) => [Number(item.location.latitude), Number(item.location.longitude)]), {
          padding: [40, 40],
          maxZoom: nationalFit ? 6 : 14
        });
      }
      drawLeafletMarkers(shared, incidents);
      // fitBounds can update the view after this call; redraw once the new
      // viewport is committed so markers are not culled with stale bounds.
      setTimeout(() => {
        if (!ui.map) return;
        const current = Store.load();
        drawLeafletMarkers(current, mapFilteredIncidents(current));
      }, 0);

      let drawTimer = null;
      const scheduleDraw = () => {
        clearTimeout(drawTimer);
        drawTimer = setTimeout(() => {
          const current = Store.load();
          drawLeafletMarkers(current, mapFilteredIncidents(current));
        }, 120);
      };
      ui.map.on("moveend zoomend", scheduleDraw);
      ui.map.on("zoomend", () => {
        if (!ui.mapProvince || !ui.map || ui.mapResetPending) return;
        const current = ui.map.getBounds();
        if (current.getNorth() - current.getSouth() > 2.5) {
          ui.mapResetPending = true;
          ui.mapProvince = null;
          ui.focusedIncidentId = null;
          ui.mapView = null;
          ui.mapScopeKey = null;
          // Let Leaflet finish its zoom cycle before the map is rebuilt.
          setTimeout(() => {
            ui.mapResetPending = false;
            if (ui.screen === "C1" && !ui.mapProvince) render();
          }, 80);
        }
      });
      if (focus) {
        const marker = ui.markers.get(focus.id);
        if (marker) marker.openPopup();
      }
    } catch (error) {
      console.warn("Leaflet initialization failed", error);
      mapElement.innerHTML = fallbackMap(incidents);
      bindMapFallback();
    }
  }

  function bindMapFallback() {
    document.querySelectorAll("[data-map-incident]").forEach((marker) => marker.addEventListener("click", () => go("C3", marker.dataset.mapIncident)));
    document.querySelectorAll("[data-map-province]").forEach((marker) => marker.addEventListener("click", () => {
      ui.mapProvince = marker.dataset.mapProvince || null;
      ui.focusedIncidentId = null;
      ui.mapView = null;
      ui.mapScopeKey = null;
      render();
    }));
  }

  function renderC1() {
    const shared = Store.load();
    const meta = Store.regionMeta(shared);
    const active = shared.incidents.filter((item) => item.status !== "Resolved" && Store.effectiveType(item) !== "Normal" && matchesTimeRange(item.createdAt, ui.mapTimeRange));
    const filtered = mapFilteredIncidents(shared);
    const sidebarItems = ui.mapProvince ? filtered.filter((item) => item.location.province === ui.mapProvince) : filtered;
    const available = shared.teams.filter((team) => team.status === "Available" && !Store.activeAssignmentForTeam(shared, team.id)).length;
    const resolved = shared.incidents.filter((item) => item.status === "Resolved").length;
    const total = shared.incidents.length;
    const typeCounts = {};
    active.forEach((item) => {
      const type = Store.effectiveType(item);
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    const scopeNote = meta.operatingArea === "Vietnam"
      ? `National dataset — all ${total} incidents across ${new Set(shared.incidents.map((item) => item.location.province)).size} provinces.`
      : `Province subset — ${total} of ${meta.nationalIncidentCount || 20} national incidents.`;
    return pageHead("Tactical Map Overview", "Operational Dashboard", scopeNote, UI.demoControls(true)) +
      `<div class="grid grid-3" style="gap:14px;margin-top:16px">
        <div class="card kpi-card" style="padding:16px 20px;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <span class="kpi-label">Active Emergency Incidents</span>
            <div class="kpi-value" style="color:var(--red)">${active.length}</div>
          </div>
          <span class="muted" style="font-size:12px">${active.filter((item) => item.severityScore >= 85).length} critical severity</span>
        </div>

        <div class="card kpi-card" style="padding:16px 20px;display:flex;flex-direction:column;justify-content:center">
          <span class="kpi-label">Rescue Force</span>
          <div class="kpi-value">${available} / ${shared.teams.length}</div>
        </div>

        <div class="card kpi-card" style="padding:16px 20px;display:flex;flex-direction:column;justify-content:center">
          <span class="kpi-label">Resolved Incidents</span>
          <div class="kpi-value" style="color:var(--green)">${resolved}</div>
        </div>
      </div>
      <section class="card" style="margin-top:16px">
        <div class="card-header">
          <div>
            <h2>${e(meta.operatingArea)} Tactical Incident Map</h2>
            <p class="muted">${scopeNote} ${meta.sectors.length} sectors · ${filtered.length} of ${total} active hazard incidents shown.${ui.mapProvince ? ` Province view: ${e(ui.mapProvince)}.` : ""} Resolved and normal cases are in the queue.</p>
          </div>

          <div class="row" style="gap:8px">
            <label class="field" style="display:flex;align-items:center;gap:6px;margin:0">
              <span class="mono" style="font-size:11px;color:var(--muted)">Time Window:</span>
              <select id="map-time-range" style="min-height:32px;padding:4px 10px;width:auto;font-size:12px">
                ${TIME_RANGES.map(([val, label]) => `<option value="${e(val)}" ${ui.mapTimeRange === val ? "selected" : ""}>${e(label)}</option>`).join("")}
              </select>
            </label>
            <span class="badge success"><span class="status-dot"></span>${e(meta.operatingArea.toUpperCase())}</span>
          </div>

        </div>

        <div class="row" style="margin-bottom:8px;flex-wrap:wrap;gap:6px">
          ${MAP_TYPES.map((type) => {
            const count = typeCounts[type] || 0;
            const selected = ui.mapType === type;
            return `<button class="btn ${selected ? "" : "ghost"} small" data-map-type="${e(type)}" title="${e(type)} · ${count} active incident(s)" style="opacity:${count ? 1 : .5}"><span style="width:8px;height:8px;border-radius:50%;background:${COLORS[type]}"></span>${e(type)} <span class="badge neutral" style="font-size:9px;padding:1px 5px">${count}</span></button>`;
          }).join("")}
          ${ui.mapProvince
            ? `<button class="btn ghost small" data-map-province-reset>← Back to national view (${e(ui.mapProvince)})</button>`
            : `<span class="muted" style="font-size:11px;align-self:center;margin-left:auto">Hover a province marker for its name · click to zoom</span>`}
        </div>

        <div class="dispatch-map-grid"><div class="map-frame"><div id="leaflet-map" class="leaflet-map"></div></div><aside><div class="row-between" style="margin-bottom:10px"><h3 style="margin:0">${ui.mapProvince ? e(ui.mapProvince) : "Active Incidents"}</h3><span class="badge neutral">${sidebarItems.length}</span></div><div class="incident-list">${sidebarItems.sort((a,b) => b.severityScore - a.severityScore).map((incident, index) => `<div class="incident-card ${ui.focusedIncidentId === incident.id ? "focused" : ""}"><div class="row" style="gap:10px;align-items:flex-start"><img src="${e(incident.image)}" alt="Evidence for ${e(incident.id)}" style="width:54px;height:40px;object-fit:cover;border-radius:5px;border:1px solid var(--line);flex:none"><div style="flex:1"><div class="row-between"><strong class="mono">${index + 1}. ${e(incident.id)}</strong>${UI.severity(incident.severityScore)}</div><p style="margin:5px 0 3px"><strong>${UI.typeLabel(Store.effectiveType(incident))}</strong></p><p class="muted" style="margin-bottom:4px">${e(incident.location.district)} · ${e(incident.status)}</p></div></div><p class="muted mono" style="font-size:11px;margin-bottom:10px">🕒 ${UI.formatDate(incident.createdAt)}</p><div class="row"><button class="btn secondary small" data-focus="${incident.id}">Focus marker</button><button class="btn ghost small" data-open="${incident.id}">Inspect Incident</button></div></div>`).join("") || UI.empty("⌖", "No incidents match this filter", "Clear the type or province filter, or widen the time window.")}</div></aside></div></section>`;
  }

  function reportForIncident(shared, incident) {
    return (shared?.reports || []).find((item) => item.id === incident?.reportId) || null;
  }

  // M1: use the AI/routing signals that already exist on the report and incident.
  // Seeds from the demo dataset have no model probability block, so callers fall
  // back to explicit heuristics only when a signal is genuinely absent.
  function incidentAiSignals(shared, incident) {
    const report = reportForIncident(shared, incident);
    const ai = report?.aiResult || {};
    const num = (value) => {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const bool = (value) => (value === null || value === undefined ? null : Boolean(value));
    const probs = ai.probs || incident?.probs || {};
    return {
      report,
      ai,
      probs,
      needsReview: bool(incident?.needsReview ?? ai.needsReview),
      pNormal: num(ai.pNormal) ?? num(incident?.pNormal) ?? num(probs.Normal),
      pCollapsed: num(ai.pCollapsed) ?? num(incident?.pCollapsed) ?? num(probs.Collapsed ?? probs["Building Collapse"]),
      contradiction: bool(ai.contradiction ?? incident?.contradiction)
    };
  }

  // Reinforced Code Red fast track (SafeGuardMechanic.docx). This is an
  // operational pin above the AHP order; it never changes the AHP score.
  function lifeRiskProfile(incident) {
    return Store.codeRedProfile
      ? Store.codeRedProfile(incident)
      : { victims: 0, nonUpright: 0, ageMinutes: 0, critical: false, codeRed: false, codeRedReason: "", goldenHourWarning: false, severityRaw: Number(incident?.severityScore || 0) };
  }

  const VEHICLE_SPEEDS_KMH = { rescue_van: 55, heavy_truck: 38, rescue_boat: 22, compact_moto: 48 };
  function estimateEtaMinutes(team, distanceKm, shared = Store.load()) {
    const attrs = Store.resolveTeamAttributes ? Store.resolveTeamAttributes(team, shared) : {};
    const equipment = String(team?.equipment || "").toLowerCase();
    const vehicle = attrs?.vehicle_type?.value || (equipment.includes("boat") ? "rescue_boat" : "rescue_van");
    const speed = VEHICLE_SPEEDS_KMH[vehicle] || 45;
    const prep = 8;
    const minutes = Math.max(1, Math.round((Number(distanceKm) || 0) / speed * 60 + prep));
    return { vehicle, speed, prep, minutes };
  }

  function waitingLabel(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return "—";
    if (minutes < 60) return `${Math.round(minutes)} min`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} m`;
    return `${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`;
  }

  function waitingTone(minutes, life = null) {
    if (life?.critical) return "danger";
    if (life?.goldenHourWarning) return "warning";
    return minutes > 120 ? "danger" : minutes > 30 ? "warning" : "neutral";
  }

  // Golden Hour audio alert. The preference already exists in Settings.
  const goldenHourAlerted = new Set();
  let goldenHourChimePlayed = false;
  function maybeGoldenHourAlert(items) {
    if (!Array.isArray(items) || !items.length) return;
    if (typeof UI.getPreferences === "function" && UI.getPreferences().audioCritical === false) return;
    const fresh = items.filter((incident) => {
      const life = incident._lifeRisk || lifeRiskProfile(incident);
      return (life.goldenHourWarning || life.codeRedLayer === "golden_hour") && !goldenHourAlerted.has(incident.id);
    });
    if (!fresh.length) return;
    fresh.forEach((incident) => goldenHourAlerted.add(incident.id));
    if (goldenHourChimePlayed) return;
    goldenHourChimePlayed = true;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const beep = (start, frequency) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.22);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(ctx.currentTime + start);
        oscillator.stop(ctx.currentTime + start + 0.24);
      };
      beep(0, 880);
      beep(0.28, 660);
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 900);
    } catch (_) {
      // Audio is an enhancement; a blocked AudioContext must not break the console.
    }
  }

  function calculatePriorityMetrics(incident, shared) {
    const districtTeams = shared.teams.filter((t) => t.area === incident.location.district && t.status === "Available" && !Store.activeAssignmentForTeam(shared, t.id));
    const allAvailable = shared.teams.filter((t) => t.status === "Available" && !Store.activeAssignmentForTeam(shared, t.id));
    const freeTeams = districtTeams.length;

    let minDistance = 99;
    if (districtTeams.length > 0) {
      minDistance = Math.min(...districtTeams.map((t) => t.distanceKm));
    } else if (allAvailable.length > 0) {
      minDistance = Math.min(...allAvailable.map((t) => t.distanceKm)) + 2.5;
    } else {
      minDistance = 14.5;
    }

    // Tier 3 AHP/TOPSIS: use the server snapshot for this incident when available.
    const ahp = ahpSnapshot.rows.get(incident.id) || null;
    const ahpDistance = ahp && Number.isFinite(ahp.distanceToNearestTeamKm) ? Number(ahp.distanceToNearestTeamKm) : null;
    const distanceKm = ahpDistance != null ? ahpDistance : minDistance;
    const coveredFreeTeams = ahp && Number.isFinite(ahp.freeTeams) ? Number(ahp.freeTeams) : freeTeams;
    const coveredNoTeam = coveredFreeTeams === 0;
    const life = lifeRiskProfile(incident);
    const rawSeverity = Math.max(0, Math.min(100, Number(incident?.severityScore || 0)));
    const priorityScore = ahp && Number.isFinite(ahp.priorityScore)
      ? Number(ahp.priorityScore)
      : Store.priorityScore(rawSeverity, distanceKm, coveredFreeTeams);

    // M1: prefer the model/router signals, then fall back to explicit heuristics
    // only where the demo seed carries no probability block.
    const signals = incidentAiSignals(shared, incident);
    const aiConfidence = Number(incident.aiConfidence || 0);
    const pNormal = signals.pNormal != null
      ? signals.pNormal
      : incident.originalType === "Normal" ? 0.97 : null;
    const pCollapsed = signals.pCollapsed != null
      ? signals.pCollapsed
      : null;
    const contradiction = signals.contradiction != null
      ? signals.contradiction
      : incident.severityScore === 0 && (incident.originalType === "Fire" || incident.originalType === "Building Collapse");
    const normalGateFails = pNormal != null && pNormal >= 0.90;
    const collapseGateFails = pCollapsed != null
      ? pCollapsed >= 0.04
      : incident.originalType === "Building Collapse";
    const aiFlagged = signals.needsReview === true;
    const formatProbability = (value) => value == null ? "not reported" : value.toFixed(3);

    let initialNeedsReview = false;
    let initialReason = "AI gates passed · trusted sources auto-verify; citizens need Coordinator review";
    let initialTagClass = "neutral";
    const gateFailures = [];

    if (incident.originalType === "Unclassified") {
      initialNeedsReview = true;
      initialReason = `Unclassified • AI Conf ${aiConfidence.toFixed(1)}% (< 85%)`;
      initialTagClass = "danger";
      gateFailures.push("Unclassified scene type");
    }
    if (incident.originalType === "Normal") {
      initialNeedsReview = true;
      initialReason = `Normal Post-Check Gate: P(Normal) ${formatProbability(pNormal)} ≥ 0.90 (Hold Dispatch)`;
      initialTagClass = "warning";
      gateFailures.push("Normal post-check gate");
    }
    if (normalGateFails && incident.originalType !== "Normal") {
      initialNeedsReview = true;
      initialReason = `Normal Post-Check Gate: P(Normal) ${formatProbability(pNormal)} ≥ 0.90`;
      initialTagClass = "warning";
      gateFailures.push("P(Normal) above stop threshold");
    }
    if (collapseGateFails) {
      initialNeedsReview = true;
      initialReason = pCollapsed != null
        ? `P(Collapsed) ${formatProbability(pCollapsed)} ≥ 0.04 (Tier 2 Structural Collapse Risk)`
        : "Building Collapse classified · structural verification required (P(Collapsed) not reported)";
      initialTagClass = "danger";
      gateFailures.push("Structural collapse risk");
    }
    if (contradiction) {
      initialNeedsReview = true;
      initialReason = "Contradiction Rule Flagged (Severity = 0 but hazardous type)";
      initialTagClass = "danger";
      gateFailures.push("Tier 2 contradiction");
    }
    if (aiConfidence < 85 && incident.originalType !== "Unclassified") {
      initialNeedsReview = true;
      if (gateFailures.length === 1 || initialTagClass === "neutral") {
        initialReason = `Low AI Confidence (${aiConfidence.toFixed(1)}% < 85%)`;
        initialTagClass = "warning";
      }
      gateFailures.push("Low AI confidence");
    }
    if (incident.routedByReview) {
      initialNeedsReview = true;
      initialReason = "Routed from Normal: P(Normal) < 0.90";
      initialTagClass = "warning";
      gateFailures.push("Normal routing review");
    }
    if (aiFlagged && !initialNeedsReview) {
      initialNeedsReview = true;
      initialReason = "AI router flagged this report for coordinator review";
      initialTagClass = "warning";
      gateFailures.push("AI needsReview flag");
    }

    let needsReview = initialNeedsReview;
    let reviewReason = initialReason;
    let reviewTagClass = initialTagClass;

    if (incident.reviewedType) {
      needsReview = false;
      reviewReason = "Verified by Coordinator";
    }

    const gateDetail = (pass, passText, failText) => pass ? passText : failText;
    const reviewGates = [
      {
        label: "Gate 1 · AI Classification Confidence (Tier 1)",
        detail: `${incident.originalType} · AI Conf ${aiConfidence.toFixed(1)}% (Threshold ≥ 85%)`,
        pass: incident.originalType !== "Unclassified" && aiConfidence >= 85
      },
      {
        label: "Gate 2 · Normal Post-Check (NORMAL_STOP_MIN = 0.90)",
        detail: `P(Normal) = ${formatProbability(pNormal)} ${pNormal == null ? "· signal unavailable for this run" : normalGateFails ? "≥ 0.90 → Hold dispatch" : "< 0.90 → Valid emergency"}`,
        pass: !normalGateFails
      },
      {
        label: "Gate 3 · Structural Collapse Risk (COLLAPSED_THRESHOLD = 0.04)",
        detail: pCollapsed == null
          ? `P(Collapsed) = not reported · ${incident.originalType === "Building Collapse" ? "classified as Building Collapse → mandatory structural verification" : "no structural risk signal"}`
          : `P(Collapsed) = ${pCollapsed.toFixed(3)} ${collapseGateFails ? "≥ 0.04 → Mandatory coordinator verification" : "< 0.04 → Within safe threshold"}`,
        pass: !collapseGateFails
      },
      {
        label: "Gate 4 · Tier 2 Contradiction Check (Contradiction Rule)",
        detail: `Severity ${incident.severityScore.toFixed(1)}/100 · Pose Conf ${Number(incident.poseConfidence || 0).toFixed(1)}% (${contradiction ? "Contradiction: hazardous type with zero severity" : "Consistent across Tier 1 & Tier 2"})`,
        pass: !contradiction
      }
    ];
    const blockingGate = reviewGates.find((gate) => !gate.pass) || null;

    return {
      freeTeams: coveredFreeTeams,
      noTeamFlag: coveredNoTeam,
      distanceKm,
      priorityScore,
      prioritySource: ahp ? "server" : "preview",
      priorityComputedAt: ahp?.priorityComputedAt ?? null,
      severityRaw: rawSeverity,
      codeRed: Boolean(life.codeRed),
      codeRedReason: life.codeRedReason || "",
      codeRedLayer: life.codeRedLayer || null,
      goldenHourWarning: Boolean(life.goldenHourWarning),
      ahpRank: ahp && Number.isFinite(ahp.priorityRank) ? ahp.priorityRank : null,
      nearestTeamId: ahp?.nearestTeamId ?? null,
      assignedTeamId: ahp?.assignedTeamId ?? null,
      ahpWeights: ahpSnapshot.weights,
      ahpCr: ahpSnapshot.cr,
      ahpActive: Boolean(ahp),
      needsReview,
      reviewReason,
      reviewTagClass,
      initialNeedsReview,
      initialReason,
      initialTagClass,
      gateFailures,
      blockingGate,
      aiNeedsReview: signals.needsReview,
      aiStatus: signals.ai.status || incident.aiStatus || null,
      pCollapsed,
      pNormal,
      contradiction,
      reviewGates
    };
  }

  function queueItems(shared) {
    const q = ui.queue;
    const districts = [...new Set(shared.incidents.map((item) => item.location.district))];
    let allActive = shared.incidents.filter((incident) => incident.status !== "Resolved" && matchesTimeRange(incident.createdAt, q.timeRange || "7d"));

    allActive.forEach((inc) => {
      const m = calculatePriorityMetrics(inc, shared);
      inc._freeTeams = m.freeTeams;
      inc._noTeamFlag = m.noTeamFlag;
      inc._distanceKm = m.distanceKm;
      inc._priorityScore = m.priorityScore;
      inc._prioritySource = m.prioritySource;
      inc._priorityComputedAt = m.priorityComputedAt;
      inc._ahpRank = m.ahpRank;
      inc._nearestTeamId = m.nearestTeamId;
      inc._assignedTeamId = m.assignedTeamId;
      inc._needsReview = inc.verificationStatus !== "verified";
      inc._reviewReason = inc.verificationReason || (inc._needsReview ? "Pending Admin verification" : "Admin verification completed");
      inc._reviewTagClass = inc._needsReview ? "warning" : "success";
      inc._gateNeedsReview = m.needsReview;
      inc._gateReason = m.initialReason;
      inc._gateFailures = m.gateFailures || [];
      inc._blockingGate = m.blockingGate;
      inc._lifeRisk = lifeRiskProfile(inc);
      inc._codeRed = Boolean(m.codeRed);
      inc._codeRedReason = m.codeRedReason || "";
      inc._codeRedLayer = m.codeRedLayer || null;
      inc._goldenHourWarning = Boolean(m.goldenHourWarning);
      inc._severityRaw = m.severityRaw;
    });

    // Queue hierarchy: Life Risk (Code Red) -> AHP Priority -> Waiting Time.
    const queueOrder = (a, b) => (Number(b._codeRed) - Number(a._codeRed))
      || (b._priorityScore - a._priorityScore)
      || (new Date(a.createdAt) - new Date(b.createdAt));
    allActive.sort(queueOrder);
    const serverRanked = allActive.filter((inc) => Number.isFinite(inc._ahpRank));
    let fallbackRank = serverRanked.length ? Math.max(...serverRanked.map((inc) => inc._ahpRank)) + 1 : 1;
    allActive.forEach((inc) => {
      inc._globalRank = Number.isFinite(inc._ahpRank) ? inc._ahpRank : fallbackRank++;
    });
    allActive.filter((inc) => inc._codeRed).forEach((inc, index) => { inc._codeRedRank = index + 1; });

    let items = allActive.filter((incident) => {
      const matchType = (q.type === "All" || Store.effectiveType(incident) === q.type);
      const matchDistrict = (q.district === "All" || incident.location.district === q.district);
      const matchStatus = (q.status === "All" || incident.status === q.status);
      const matchCodeRed = !q.codeRedOnly || incident._codeRed;
      let matchSeverity = true;
      if (q.severity === "critical") matchSeverity = incident.severityScore >= 85;
      if (q.severity === "high") matchSeverity = (incident.severityScore >= 70 && incident.severityScore < 85);
      if (q.severity === "moderate") matchSeverity = incident.severityScore < 70;
      return matchType && matchDistrict && matchStatus && matchSeverity && matchCodeRed;
    });

    if (q.sort === "priority") {
      items.sort(queueOrder);
    } else if (q.sort === "severity") {
      items.sort((a, b) => b.severityScore - a.severityScore);
    } else if (q.sort === "distance") {
      items.sort((a, b) => a._distanceKm - b._distanceKm);
    } else if (q.sort === "time") {
      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (q.sort === "people") {
      items.sort((a, b) => b.detectedPeopleCount - a.detectedPeopleCount);
    }

    const autoItems = items.filter((inc) => inc.verificationStatus === "verified");
    const reviewItems = items.filter((inc) => inc.verificationStatus !== "verified");

    // Closed cases get their own tab. They keep the same thumbnails and dossier
    // actions but never mix into the default operational queue.
    const resolvedItems = shared.incidents
      .filter((incident) => incident.status === "Resolved" && matchesTimeRange(incident.createdAt, q.timeRange || "7d"))
      .filter((incident) => {
        const matchType = (q.type === "All" || Store.effectiveType(incident) === q.type);
        const matchDistrict = (q.district === "All" || incident.location.district === q.district);
        let matchSeverity = true;
        if (q.severity === "critical") matchSeverity = incident.severityScore >= 85;
        if (q.severity === "high") matchSeverity = (incident.severityScore >= 70 && incident.severityScore < 85);
        if (q.severity === "moderate") matchSeverity = incident.severityScore < 70;
        return matchType && matchDistrict && matchSeverity;
      })
      .sort((a, b) => new Date(b.closedAt || b.createdAt) - new Date(a.closedAt || a.createdAt))
      .map((incident) => {
        const order = (shared.dispatchOrders || []).find((item) => item.incidentId === incident.id);
        return {
          ...incident,
          _globalRank: "—",
          _distanceKm: Number(order?.distanceKm) || 0,
          _freeTeams: 0,
          _noTeamFlag: false,
          _priorityScore: Number((Number(incident.severityScore) / 100).toFixed(4)),
          _prioritySource: "closed",
          _ahpRank: null,
          _assignedTeamId: order?.teamId || incident.assignedTeamId || null
        };
      });

    return { items, autoItems, reviewItems, resolvedItems, districts, allActive };
  }

  function queueRankLabel(incident) {
    return incident._codeRed ? `#CR-${incident._codeRedRank || "?"}` : `#${incident._globalRank}`;
  }

  function renderIncidentTable(list, isReviewGroup, shared, showSurge = false, clusters = []) {
    const isVi = UI.getPreferences?.().language === "vi";
    const t = (en, vi) => isVi ? vi : en;
    if (!list.length) {
      return `<div class="empty-state" style="padding:28px 12px">
        <span class="empty-icon">∅</span>
        <h3>${t("No incidents in this queue", "Không có sự cố trong hàng đợi này")}</h3>
        <p class="muted">${t("All incidents in this group have been processed or filtered out.", "Tất cả sự cố trong nhóm này đã được xử lý hoặc lọc ra.")}</p>
      </div>`;
    }

    const hasClusters = Boolean(showSurge && clusters && clusters.length > 0 && !isReviewGroup);
    const clusteredIds = hasClusters ? new Set(clusters.flatMap(c => c.incidents.map(i => i.id))) : new Set();
    const unclusteredList = hasClusters ? list.filter(i => !clusteredIds.has(i.id)) : list;

    const renderSingleRow = (incident) => {
      const corrected = incident.reviewedType && incident.reviewedType !== incident.originalType;
      const report = shared.reports.find((item) => item.id === incident.reportId);
      const highlighted = ui.highlightedIncidentId === incident.id;
      const assignment = (shared.dispatchOrders || []).find((item) => item.incidentId === incident.id);
      const assignedTeam = assignment?.teamId || incident.assignedTeamId || null;
      const sevNum = Number(incident.severityScore);
      const life = incident._lifeRisk || lifeRiskProfile(incident);
      return `<tr class="${highlighted ? "just-verified" : ""}" data-queue-incident="${e(incident.id)}">
        <td>
          <span class="ahp-pill ${incident._codeRed ? "code-red-pill" : ""}">${queueRankLabel(incident)}</span>
        </td>
        <td>
          <strong class="mono">${e(incident.id)}</strong>
          ${highlighted ? `<div><span class="badge success just-verified-badge">✓ ${t("Just verified", "Vừa xác minh")}</span></div>` : ""}
        </td>
        <td>
          <img src="${e(incident.image)}" alt="Evidence for ${e(incident.id)}" style="width:56px;height:40px;object-fit:cover;border-radius:4px;border:1px solid var(--line)">
        </td>
        <td>
          <span class="muted" style="font-size:11px">${UI.formatDate(incident.createdAt)}</span>
        </td>
        <td>
          ${UI.typeLabel(Store.effectiveType(incident))}
        </td>
        <td>
          <strong>${e(incident.location.district)}</strong>
        </td>
        <td>
          <span class="mono" style="font-size:11px">${incident.location.latitude.toFixed(5)}</span>
        </td>
        <td>
          <span class="mono" style="font-size:11px">${incident.location.longitude.toFixed(5)}</span>
        </td>
        <td>
          <strong>${e(report?.reporter?.name || (isVi ? "Người dân" : "Citizen"))}</strong>
        </td>
        <td>
          <span class="severity ${sevNum >= 85 ? "high" : ""}">${sevNum.toFixed(1)}</span>
        </td>
        <td>
          <strong>${life.victims}</strong>
          ${life.critical ? `<div><span class="badge danger" style="font-size:9px;padding:1px 5px">🚨 ${t("critical", "nguy kịch")}</span></div>` : ""}
        </td>
        <td>
          ${life.nonUpright ? `<strong style="color:var(--red)">${life.nonUpright}</strong>` : `<span class="muted">0</span>`}
        </td>
        <td>
          <strong>${incident._distanceKm.toFixed(1)} km</strong>
        </td>
        <td>
          ${incident.status === "In Progress" && assignedTeam
            ? `<span class="badge success" style="font-size:10px;padding:2px 6px">${t("Assigned", "Đã điều động")}: ${e(assignedTeam)}</span>`
            : incident._noTeamFlag
              ? `<span class="badge danger" style="font-size:10px;padding:2px 6px">⚠️ ${t("0 FREE TEAMS", "0 ĐỘI SẴN SÀNG")}</span>`
              : `<span class="badge success" style="font-size:10px;padding:2px 6px">${incident._freeTeams} ${t("free team(s)", "đội sẵn sàng")}</span>`}
        </td>
        <td>
          <strong class="priority-val" style="font-weight:800;font-size:13px">${incident._priorityScore.toFixed(4)}</strong>
          ${incident._prioritySource === "preview" ? '<div><span class="badge warning" style="font-size:9px">preview</span></div>' : ""}
        </td>
        <td>${UI.badge(incident.status)}</td>
        <td style="text-align:right">
          ${incident.verificationStatus !== "verified"
            ? `<button class="btn small" data-report-review="${incident.reportId}">${t("Review & Verify", "Xem xét & Xác minh")}</button>`
            : incident.status === "Matching Team"
              ? `<button class="btn small" style="background:#157a54" data-open-c4="${incident.id}">${t("Match Team →", "Ghép Đội →")}</button>`
              : incident.status === "In Progress"
                ? `<button class="btn small" style="background:#0284c7" data-open="${incident.id}">${t("In Progress →", "Đang Cứu Hộ →")}</button>`
                : `<button class="btn ghost small" data-open="${incident.id}">${t("Details", "Chi tiết")}</button>`}
        </td>
      </tr>`;
    };

    const renderClusterRow = (clu) => {
      return `<tr style="background:#f0fdf4;border-left:4px solid #16a34a" data-queue-cluster="${e(clu.id)}">
        <td>
          <span class="ahp-pill" style="background:#15803d;color:#fff;font-weight:700">#CLU</span>
        </td>
        <td>
          <strong class="mono" style="color:#15803d;font-size:14px">${e(clu.id)}</strong>
          <div style="margin-top:2px"><span class="badge warning" style="font-size:10px;padding:2px 6px">${clu.incidentCount} ${t("incidents", "sự cố")}</span></div>
          <div class="mono muted" style="font-size:10px;margin-top:2px">${e(clu.incidents.map(x => x.id).join(", "))}</div>
        </td>
        <td>
          <span class="muted" style="font-size:11px">${UI.formatDate(clu.leadIncident.createdAt)}</span>
        </td>
        <td>
          ${UI.typeLabel(clu.dominantType)}
        </td>
        <td>
          <strong>${e(clu.centroid.district)}</strong>
        </td>
        <td>
          <span class="mono" style="font-size:11px">${clu.centroid.latitude.toFixed(5)}</span>
        </td>
        <td>
          <span class="mono" style="font-size:11px">${clu.centroid.longitude.toFixed(5)}</span>
        </td>
        <td>
          <span class="badge neutral" style="font-size:11px">${t("Multi-Source Cluster", "Liên Cụm Báo Tin")} (${clu.totalPeople} ${t("victims", "nạn nhân")})</span>
        </td>
        <td>
          <span class="severity high">${clu.maxSeverity.toFixed(1)}</span>
        </td>
        <td>
          <strong>${clu.totalPeople}</strong>
        </td>
        <td><span class="muted">—</span></td>
        <td>
          <strong>${(clu.leadIncident._distanceKm || 2.5).toFixed(1)} km</strong>
        </td>
        <td>
          <span class="badge success" style="font-size:10px">${clu.aggregateDemand?.reqMembers || 8} req officers</span>
        </td>
        <td>
          <strong class="priority-val" style="color:#15803d;font-weight:800;font-size:13px">${clu.urgencyScore.toFixed(1)} <span style="font-size:10px;color:var(--muted)">Urgency</span></strong>
        </td>
        <td>
          <span class="badge warning" style="font-size:10px">CLUSTERED</span>
        </td>
        <td style="text-align:right">
          <button class="btn small" style="background:#157a54;color:#fff;font-weight:600" data-open-c4="${e(clu.leadIncident.id)}">${t("Match Coalition →", "Ghép Liên Đội →")}</button>
        </td>
      </tr>`;
    };

    return `<div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:70px">${t("# Rank", "# Hạng")}</th>
            <th>${t("Incident ID", "Mã sự cố")}</th>
            <th>${t("Evidence", "Bằng chứng")}</th>
            <th>${t("Time", "Thời gian")}</th>
            <th>${t("Incident Type", "Loại Sự Cố")}</th>
            <th>${t("Sector", "Khu vực")}</th>
            <th>LAT</th>
            <th>LON</th>
            <th style="min-width:115px">${t("Reporter", "Người Báo Tin")}</th>
            <th>${t("Severity Score", "Điểm nghiêm trọng")}</th>
            <th>${t("Victims", "Nạn nhân")}</th>
            <th>${t("Non-Upright", "Không di chuyển")}</th>
            <th>${t("Distance", "Khoảng cách")}</th>
            <th>${t("Free Teams", "Đội sẵn sàng")}</th>
            <th>${t("AHP Priority Score", "Điểm ưu tiên AHP")}</th>
            <th>${t("Status", "Trạng thái")}</th>
            <th style="text-align:right">${t("Action", "Thao tác")}</th>
          </tr>
        </thead>
        <tbody>
          ${hasClusters ? clusters.map(renderClusterRow).join("") : ""}
          ${unclusteredList.map(renderSingleRow).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderIncidentGrid(list, isReviewGroup, shared, showSurge = false, clusters = []) {
    const isVi = UI.getPreferences?.().language === "vi";
    const t = (en, vi) => isVi ? vi : en;
    if (!list.length) {
      return `<div class="empty-state" style="padding:28px 12px">
        <span class="empty-icon">∅</span>
        <h3>${t("No incidents in this queue", "Không có sự cố trong hàng đợi này")}</h3>
        <p class="muted">${t("All incidents in this group have been processed or filtered out.", "Tất cả sự cố trong nhóm này đã được xử lý hoặc lọc ra.")}</p>
      </div>`;
    }

    const hasClusters = Boolean(showSurge && clusters && clusters.length > 0 && !isReviewGroup);
    const clusteredIds = hasClusters ? new Set(clusters.flatMap(c => c.incidents.map(i => i.id))) : new Set();
    const unclusteredList = hasClusters ? list.filter(i => !clusteredIds.has(i.id)) : list;

    const renderClusterCard = (clu) => {
      return `<article class="queue-grid-card auto-card" style="border:2px solid #16a34a;background:#f0fdf4" data-queue-cluster="${e(clu.id)}">
        <div class="queue-card-media" style="background:#dcfce7;display:flex;align-items:center;justify-content:center;min-height:140px;position:relative">
          <span class="queue-card-rank" style="background:#15803d;color:#fff">#CLU</span>
          <span class="queue-card-ahp" style="background:#15803d;color:#fff"><strong>Urgency ${clu.urgencyScore.toFixed(1)}</strong></span>
          <div style="text-align:center">
            <span style="font-size:32px">🏘️</span>
            <div style="font-weight:800;color:#15803d;font-size:18px;margin-top:4px">${e(clu.id)}</div>
            <span class="badge warning" style="font-size:11px">${clu.incidentCount} ${t("grouped incidents", "sự cố gom cụm")}</span>
          </div>
        </div>

        <div class="queue-card-body">
          <div class="row-between">
            <strong class="mono" style="font-size:15px;color:#15803d">${e(clu.id)}</strong>
            <span class="badge warning">${t("SPATIAL CLUSTER", "CỤM KHÔNG GIAN")}</span>
          </div>

          <div style="margin-top:4px;font-size:12px">
            ${UI.typeLabel(clu.dominantType)} · <strong>${e(clu.centroid.district)}</strong>
          </div>

          <div class="muted mono" style="font-size:11px;margin:6px 0">
            Cases: ${e(clu.incidents.map(x => x.id).join(", "))}
          </div>

          <div class="queue-card-meta">
            <div>
              <span class="eyebrow">${t("Victims", "Nạn nhân")}</span>
              <strong>${clu.totalPeople} ${t("people", "người")}</strong>
            </div>
            <div>
              <span class="eyebrow">${t("Max Severity", "Độ nghiêm trọng")}</span>
              <strong class="severity high">${clu.maxSeverity.toFixed(1)}</strong>
            </div>
            <div>
              <span class="eyebrow">${t("Demand", "Nhu cầu")}</span>
              <strong>${clu.aggregateDemand?.reqMembers || 8} off.</strong>
            </div>
          </div>

          <div class="queue-card-action">
            <button class="btn full" style="background:#157a54;color:#fff;font-weight:600" data-open-c4="${e(clu.leadIncident.id)}">${t("Match Coalition →", "Ghép Liên Đội →")}</button>
          </div>
        </div>
      </article>`;
    };

    const renderSingleCard = (incident) => {
      const effective = Store.effectiveType(incident);
      const corrected = incident.reviewedType && incident.reviewedType !== incident.originalType;
      const report = shared.reports.find((item) => item.id === incident.reportId);
      const highlighted = ui.highlightedIncidentId === incident.id;
      const assignment = (shared.dispatchOrders || []).find((item) => item.incidentId === incident.id);
      const assignedTeam = assignment?.teamId || incident.assignedTeamId || null;
      const life = incident._lifeRisk || lifeRiskProfile(incident);
      return `<article class="queue-grid-card ${isReviewGroup ? "review-card" : "auto-card"} ${highlighted ? "just-verified" : ""} ${life.critical ? "life-critical-card" : ""}" data-queue-incident="${e(incident.id)}">
        <div class="queue-card-media">
          <img src="${e(incident.image)}" alt="Evidence for ${e(incident.id)}">
          <span class="queue-card-rank ${life.critical ? "code-red-rank" : ""}">${queueRankLabel(incident)}</span>
          <span class="queue-card-ahp"><strong>AHP ${incident._priorityScore.toFixed(4)}</strong></span>
        </div>

        <div class="queue-card-body">
          <div class="row-between">
            <strong class="mono" style="font-size:14px">${e(incident.id)}</strong>
            ${UI.badge(incident.status)}
          </div>

          <div>
            ${UI.typeLabel(effective)}
            ${corrected ? `<span class="badge danger" style="margin-left:4px;font-size:10px">${t("Corrected", "Đã sửa")}</span>` : ""}
            ${life.critical ? `<span class="badge danger" style="margin-left:4px;font-size:10px">🚨 ${t("Life-critical", "Nguy kịch")}</span>` : ""}
          </div>

          <div class="row" style="gap:12px;font-size:12px">
            <span>👥 <strong>${life.victims}</strong> ${t("victims", "nạn nhân")}</span>
            <span style="color:${life.nonUpright ? "var(--red)" : "var(--muted)"}">🚨 <strong>${life.nonUpright}</strong> ${t("non-upright", "nằm")}</span>
            <span class="muted">⏱ ${waitingLabel(life.ageMinutes)}</span>
          </div>

          <div class="queue-card-meta">
            <div>
              <span class="eyebrow">${t("Sector", "Khu vực")}</span>
              <strong>${e(incident.location.district)}</strong>
            </div>
            <div>
              <span class="eyebrow">${t("Severity Score", "Điểm nghiêm trọng")}</span>
              <strong class="severity ${incident.severityScore >= 85 ? "high" : ""}">${incident.severityScore.toFixed(1)}</strong>
            </div>
            <div>
              <span class="eyebrow">${t("Distance", "Khoảng cách")}</span>
              <strong>${incident._distanceKm.toFixed(1)} km</strong>
            </div>
          </div>

          <div class="queue-card-action">
            ${incident.verificationStatus !== "verified"
              ? `<button class="btn small full" data-report-review="${incident.reportId}">${t("Review & Verify", "Xem xét & Xác minh")}</button>`
              : incident.status === "Matching Team"
                ? `<button class="btn small full" style="background:#157a54" data-open-c4="${incident.id}">${t("Match Team →", "Ghép Đội →")}</button>`
                : incident.status === "In Progress"
                  ? `<button class="btn small full" style="background:#0284c7" data-open="${incident.id}">${t("In Progress →", "Đang Cứu Hộ →")}</button>`
                  : `<button class="btn ghost small full" data-open="${incident.id}">${t("Details", "Chi tiết")}</button>`}
          </div>
        </div>
      </article>`;
    };

    return `<div class="incident-queue-grid">
      ${hasClusters ? clusters.map(renderClusterCard).join("") : ""}
      ${unclusteredList.map(renderSingleCard).join("")}
    </div>`;
  }

  function renderIncidentCollection(list, isReviewGroup, shared, showSurge = false, clusters = []) {
    return ui.queue.viewMode === "grid"
      ? renderIncidentGrid(list, isReviewGroup, shared, showSurge, clusters)
      : renderIncidentTable(list, isReviewGroup, shared, showSurge, clusters);
  }

  // M5: life-risk lane. It is a visibility layer, not a ranking change: the
  // AHP score and global rank in the table below stay exactly as computed.
  function renderLifeRiskLane(incidents) {
    const isVi = UI.getPreferences?.().language === "vi";
    const t = (en, vi) => isVi ? vi : en;
    const critical = incidents
      .map((incident) => ({ incident, life: incident._lifeRisk || lifeRiskProfile(incident) }))
      .filter((row) => row.life.critical)
      .sort((a, b) => (b.incident._priorityScore - a.incident._priorityScore) || (new Date(a.incident.createdAt) - new Date(b.incident.createdAt)));
    if (!critical.length) return "";
    const ratio = incidents.length ? critical.length / incidents.length : 0;
    return `<section class="card life-risk-lane">
      <div class="card-header">
        <div>
          <p class="eyebrow" style="color:var(--red)">${t("Code Red · life-critical fast track", "Code Red · làn ưu tiên tính mạng")}</p>
          <h2>${t("People trapped or non-upright first", "Người bị kẹt hoặc không di chuyển được ưu tiên trước")}</h2>
          <p class="muted">${t("Pinned above the normal AHP order. AHP score and rank remain visible; the official calculation is unchanged.", "Được ghim trên thứ tự AHP thông thường. Điểm và hạng AHP vẫn hiển thị; công thức chính thức không đổi.")}</p>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${ratio > 0.5 ? `<span class="badge warning">⚠ ${t("Code Red saturation", "Code Red quá tải")}: ${Math.round(ratio * 100)}%</span>` : ""}
          <button class="btn ghost small" data-action="toggle-code-red-filter">${ui.queue.codeRedOnly ? t("Show all incidents", "Hiện tất cả") : t("Only Code Red", "Chỉ Code Red")}</button>
          <span class="badge danger">🚨 ${critical.length} ${t("cases", "ca")}</span>
        </div>
      </div>
      <div class="life-risk-list">
        ${critical.map(({ incident, life }) => `
          <article class="life-risk-item">
            <div class="row-between">
              <strong class="mono">${e(incident.id)}</strong>
              <span class="badge danger">#CR-${incident._codeRedRank || "?"} · AHP ${incident._priorityScore.toFixed(3)}</span>
            </div>
            <div class="row" style="gap:6px;flex-wrap:wrap;margin:6px 0">
              ${UI.typeLabel(Store.effectiveType(incident))}
              <span class="badge neutral">${e(incident.location.district)}</span>
              ${UI.badge(incident.status)}
            </div>
            <div class="row" style="gap:14px;margin-bottom:8px">
              <span><strong style="font-size:18px">${life.victims}</strong> <span class="muted">${t("victims", "nạn nhân")}</span></span>
              <span><strong style="font-size:18px;color:var(--red)">${life.nonUpright}</strong> <span class="muted">${t("non-upright", "nằm/không di chuyển")}</span></span>
              <span class="muted">⏱ ${waitingLabel(life.ageMinutes)}</span>
            </div>
            <div class="muted" style="font-size:11px;margin-bottom:8px">${t("Severity", "Nghiêm trọng")}: <strong>${life.severityRaw.toFixed(1)}</strong> · ${e(life.codeRedReason)}</div>
            ${incident.verificationStatus !== "verified"
              ? `<button class="btn small full" data-report-review="${incident.reportId}">${t("Review & Verify →", "Xem xét & Xác minh →")}</button>`
              : incident.status === "Matching Team"
                ? `<button class="btn small full" style="background:#157a54" data-open-c4="${incident.id}">${t("Match Team →", "Ghép Đội →")}</button>`
                : `<button class="btn ghost small full" data-open="${incident.id}">${t("Open incident", "Mở sự cố")}</button>`}
          </article>
        `).join("")}
      </div>
    </section>`;
  }

  function oneClickEligibility(shared, incident) {
    if (!incident) return { ok: false, reason: "No incident selected." };
    if (incident.status === "Resolved") return { ok: false, reason: "This incident is already resolved." };
    if (incident.status === "In Progress") return { ok: false, reason: "This incident is already in progress." };
    const report = reportForIncident(shared, incident);
    if (!report) return { ok: false, reason: "No linked report." };
    const type = Store.effectiveType(incident);
    if (!["Flood", "Fire", "Building Collapse", "Traffic Accident"].includes(type)) {
      return { ok: false, reason: `${type} is not a dispatchable emergency.` };
    }
    if (incident.verificationStatus !== "verified") {
      const ai = report.aiResult || {};
      if (incident.aiStatus === "Failed" || ai.status === "failed") return { ok: false, reason: "AI failed; open the detailed review." };
      if (incident.needsReview === true || ai.needsReview === true) return { ok: false, reason: "AI flagged this report for review." };
      if (incident.contradiction === true || ai.contradiction === true) return { ok: false, reason: "Contradiction flag; open the detailed review." };
      if (Number(incident.aiConfidence || ai.aiConfidence || 0) < 85) return { ok: false, reason: "AI confidence below 85%; open the detailed review." };
    }
    const { eligible } = evaluateCandidateTeams(shared, incident);
    if (!eligible.length) return { ok: false, reason: "No eligible team; open C4 to review constraints or override." };
    return { ok: true, reason: "", teamId: eligible[0].id };
  }

  function renderTriageWorkspace(shared) {
    const isVi = UI.getPreferences?.().language === "vi";
    const t = (en, vi) => isVi ? vi : en;
    const queue = queueItems(shared);
    maybeGoldenHourAlert(queue.items);
    const items = queue.items.filter((incident) => incident.status !== "Resolved");
    if (!items.length) {
      return pageHead("C2 Workspace", "Unified Triage & Dispatch Workspace", "No active incidents.", `<button class="btn ghost" data-c2-mode="queue">← Queue view</button>`) +
        UI.empty("✓", "No active incidents", "The operational queue is clear.");
    }
    const selectedId = [ui.workspaceIncidentId, ui.selectedIncidentId].find((id) => items.some((incident) => incident.id === id)) || items[0].id;
    ui.workspaceIncidentId = selectedId;
    ui.selectedIncidentId = selectedId;
    const incident = items.find((item) => item.id === selectedId);
    const report = reportForIncident(shared, incident);
    const life = incident._lifeRisk || lifeRiskProfile(incident);
    const metrics = calculatePriorityMetrics(incident, shared);
    const candidates = evaluateCandidateTeams(shared, incident);
    const teamPool = candidates.eligible.length ? candidates.eligible : candidates.disqualified;
    if (!teamPool.some((team) => team.id === ui.selectedTeamId)) ui.selectedTeamId = teamPool[0]?.id || null;
    const selectedTeam = teamPool.find((team) => team.id === ui.selectedTeamId) || null;
    const selectedMatch = selectedTeam?._match || null;
    const eta = selectedTeam ? estimateEtaMinutes(selectedTeam, selectedTeam.distanceKm, shared) : null;
    const oneClick = oneClickEligibility(shared, incident);
    const canDispatch = Boolean(selectedTeam && selectedMatch?.ruleEval?.eligible && oneClick.ok);
    const needsVerification = incident.verificationStatus !== "verified";
    const note = report?.declaration?.accessNote || incident.fieldNote || "";
    const primaryLabel = incident.status === "In Progress"
      ? t("Open incident", "Mở sự cố")
      : needsVerification
        ? `${t("Verify & Confirm Dispatch", "Xác minh & Xác nhận Điều động")}${selectedTeam ? ` · ${e(selectedTeam.id)}` : ""}`
        : `${t("Confirm Dispatch", "Xác nhận Điều động")}${selectedTeam ? ` · ${e(selectedTeam.id)}` : ""}`;
    const primaryAction = incident.status === "In Progress"
      ? `data-open="${e(incident.id)}"`
      : `data-action="triage-dispatch"`;

    const queueHtml = items.map((item) => {
      const itemLife = item._lifeRisk || lifeRiskProfile(item);
      return `<button class="triage-queue-item ${item.id === selectedId ? "active" : ""} ${itemLife.critical ? "code-red" : ""}" data-workspace-select="${e(item.id)}">
        <img src="${e(item.image)}" alt="Evidence for ${e(item.id)}">
        <div style="min-width:0;flex:1">
          <div class="row-between"><strong class="mono">${e(item.id)}</strong>${UI.badge(item.status)}</div>
          <div style="font-size:12px;margin-top:2px">${UI.typeLabel(Store.effectiveType(item))} · <span class="muted">${e(item.location.district)}</span></div>
          <div class="muted" style="font-size:11px;margin-top:3px">👥 ${itemLife.victims} · 🚨 ${itemLife.nonUpright} · ⏱ ${waitingLabel(itemLife.ageMinutes)}</div>
          <div class="row" style="gap:4px;margin-top:4px;flex-wrap:wrap">
            ${itemLife.critical ? `<span class="badge danger" style="font-size:9px;padding:1px 5px">#CR-${item._codeRedRank || "?"}</span>` : ""}
            <span class="badge neutral" style="font-size:9px;padding:1px 5px">AHP ${item._priorityScore.toFixed(4)}</span>
            ${itemLife.goldenHourWarning ? `<span class="badge warning" style="font-size:9px;padding:1px 5px">⏱ Golden Hour 30–45</span>` : ""}
          </div>
        </div>
      </button>`;
    }).join("");

    const teamRows = candidates.eligible.slice(0, 5).map((team) => {
      const teamEta = estimateEtaMinutes(team, team.distanceKm, shared);
      const under = Number(team.members) < team._match.mReq;
      return `<button class="triage-team-row ${team.id === ui.selectedTeamId ? "selected" : ""}" data-workspace-team="${e(team.id)}">
        <div style="min-width:0;flex:1">
          <div class="row-between"><strong>${e(team.name)}</strong><strong class="mono">${team.matchScore}%</strong></div>
          <div class="muted" style="font-size:11px">${e(team.id)} · ${team.distanceKm.toFixed(1)} km · ≈ ${teamEta.minutes} min · ${team.members} officers${team._match.sameArea ? ` · ${t("same sector", "cùng khu vực")}` : ""}</div>
          ${under ? `<div class="badge warning" style="font-size:9px;padding:1px 5px;margin-top:3px">⚠ ${t("under-strength", "thiếu người")} ${team.members}/${team._match.mReq}</div>` : ""}
        </div>
      </button>`;
    }).join("") || `<div class="alert warning"><span>!</span><div><strong>${t("No eligible team", "Không có đội phù hợp")}</strong><div>${t("Open C4 to inspect hard constraints or record an override.", "Mở C4 để xem ràng buộc cứng hoặc ghi lý do override.")}</div></div></div>`;

    return pageHead(
      "C2 Workspace",
      t("Unified Triage & Dispatch Workspace", "Không gian Thẩm định & Điều phối Hợp nhất"),
      t("Evidence, AI gates, recommended team and one-click dispatch on one screen. Code Red cases are pinned first.", "Ảnh, cổng AI, đội đề xuất và điều động 1 click trên một màn hình. Ca Code Red luôn ở đầu."),
      `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn ghost small" data-c2-mode="queue">← ${t("Queue view", "Hàng đợi")}</button>${UI.demoControls(true)}</div>`
    ) + `<div class="triage-workspace">
      <aside class="triage-queue">
        <div class="row-between" style="margin-bottom:8px"><strong>${t("Operational queue", "Hàng đợi vận hành")}</strong><span class="badge neutral">${items.length}</span></div>
        <div class="triage-queue-list">${queueHtml}</div>
      </aside>
      <section class="triage-action stack">
        <div class="card" style="margin-top:0">
          <div class="row-between">
            <div>
              <div class="row" style="gap:6px;flex-wrap:wrap">
                <span class="badge neutral mono">${e(incident.id)}</span>
                ${UI.typeLabel(Store.effectiveType(incident))}
                ${UI.badge(incident.status)}
                ${life.critical ? `<span class="badge danger">🚨 CODE RED · #CR-${incident._codeRedRank || "?"}</span>` : ""}
              </div>
              <h2 style="margin:8px 0 2px">${e(incident.location.district)}</h2>
              <p class="muted" style="margin:0">${life.victims} ${t("victims", "nạn nhân")} · ${life.nonUpright} ${t("non-upright", "nằm")} · ${t("waiting", "chờ")} ${waitingLabel(life.ageMinutes)} · AHP <strong>${incident._priorityScore.toFixed(4)}</strong> (#${incident._globalRank})</p>
            </div>
            <div class="score-ring" style="--score:${incident.severityScore}"><div><span><strong>${incident.severityScore.toFixed(1)}</strong><small>${t("Severity", "Nghiêm trọng")}</small></span></div></div>
          </div>
          <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
            <span class="badge neutral">${t("AI severity (AHP C1)", "Severity AI (C1)")}: ${life.severityRaw.toFixed(1)}</span>
            ${life.codeRedLayer ? `<span class="badge danger">${e(life.codeRedReason)}</span>` : ""}
            ${incident.verificationMethod ? `<span class="badge success">${e(incident.verificationMethod)}</span>` : ""}
          </div>
        </div>

        <div class="card" style="margin-top:0">
          <div class="row-between" style="margin-bottom:8px"><h3 style="margin:0">${t("Evidence & AI gates", "Bằng chứng & cổng AI")}</h3><span class="badge ${metrics.blockingGate ? "warning" : "success"}">${metrics.blockingGate ? t("Review signal", "Có tín hiệu cần xem") : t("No gate failure", "Không có cổng lỗi")}</span></div>
          ${report ? Trace.evidence(report, incident) : `<img class="admin-review-evidence" src="${e(incident.image)}" alt="Evidence for ${e(incident.id)}">`}
          <div class="grid grid-2" style="margin-top:10px;gap:8px">
            ${metrics.reviewGates.map((gate) => `<div class="surface" style="padding:8px 10px;border:1px solid ${gate.pass ? "var(--line)" : "#f2b8b5"}"><strong style="font-size:11px">${gate.pass ? "✓" : "✕"} ${e(gate.label)}</strong><div class="muted" style="font-size:10.5px;margin-top:2px">${e(gate.detail)}</div></div>`).join("")}
          </div>
          ${note ? `<div class="surface" style="margin-top:10px"><span class="eyebrow">${t("Reporter field note", "Ghi chú hiện trường")}</span><div>${e(note)}</div></div>` : ""}
        </div>

        <div class="card" style="margin-top:0">
          <div class="row-between" style="margin-bottom:8px"><h3 style="margin:0">${t("Recommended team", "Đội đề xuất")}</h3><span class="badge neutral">${candidates.eligible.length} ${t("eligible", "phù hợp")}</span></div>
          <div class="triage-team-list">${teamRows}</div>
          ${selectedTeam && selectedMatch ? `<div class="muted" style="font-size:11px;margin-top:8px">${t("Selected", "Đã chọn")}: <strong>${e(selectedTeam.id)}</strong> · Match ${selectedTeam.matchScore}% · ${t("ETA", "ETA")} ≈ ${eta.minutes} min (${eta.vehicle} ${eta.speed} km/h + ${eta.prep} min ${t("prep", "chuẩn bị")})</div>` : ""}
        </div>

        <div class="triage-primary">
          ${incident.status === "In Progress" ? `<button class="btn full" ${primaryAction}>${primaryLabel}</button>` : canDispatch
            ? `<button class="btn success full triage-dispatch-btn" ${primaryAction}>${primaryLabel}</button>`
            : `<button class="btn full" disabled>${primaryLabel}</button><div class="alert warning" style="margin-top:8px"><span>!</span><div><strong>${t("Not dispatchable from the workspace", "Chưa thể điều động từ workspace")}</strong><div>${e(oneClick.reason || (selectedMatch && !selectedMatch.ruleEval.eligible ? "Selected team failed a hard constraint; open C4 to override." : "Select a team."))}</div></div></div>`}
          <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
            <button class="btn ghost small" data-screen="C3">${t("Open C3 detail", "Mở chi tiết C3")}</button>
            <button class="btn ghost small" data-screen="C4">${t("Open C4 matching", "Mở ghép đội C4")}</button>
            <button class="btn ghost small" data-screen="C5">${t("Open C5 confirmation", "Mở xác nhận C5")}</button>
            ${needsVerification ? `<button class="btn ghost small" data-report-review="${e(incident.reportId)}">${t("Detailed review", "Duyệt chi tiết")}</button>` : ""}
          </div>
          <div class="muted" style="font-size:10.5px;margin-top:6px">${t("One click still records the coordinator decision and an audit entry. It never dispatches without a human click.", "Một click vẫn ghi quyết định của điều phối viên và audit. Hệ thống không tự xuất kích khi không có người bấm.")}</div>
        </div>
      </section>
    </div>`;
  }

  async function confirmTriageDispatch() {
    const shared = Store.load();
    const incident = selectedIncident(shared);
    if (!incident) return UI.toast("Select an incident first.", "error");
    if (incident.status === "In Progress") return go("C3", incident.id);
    const team = shared.teams.find((item) => item.id === ui.selectedTeamId);
    if (!team) return UI.toast("Select an eligible team.", "error");
    if (team.status !== "Available" || Store.activeAssignmentForTeam(shared, team.id)) return UI.toast("The selected team is no longer available.", "error");
    if (incident.verificationStatus === "verified" && !adminReviewComplete(shared, incident)) return UI.toast("Admin review is incomplete for this incident.", "error");
    const eligibility = oneClickEligibility(shared, incident);
    if (!eligibility.ok) return UI.toast(eligibility.reason, "error");
    const matchInfo = computeTeamMatch(team, incident, shared);
    if (!matchInfo.ruleEval.eligible) return UI.toast("Selected team failed a hard constraint. Open C4 to record an override.", "error");
    const reviewer = UI.currentUser?.();
    let priorityMetrics = calculatePriorityMetrics(incident, shared);
    if (priorityMetrics.prioritySource !== "server") {
      try {
        await requestAhpSnapshot(ahpRange());
        priorityMetrics = calculatePriorityMetrics(Store.load().incidents.find((item) => item.id === incident.id) || incident, Store.load());
      } catch (_) {
        // The dispatch still proceeds; the dossier records that no server snapshot was captured.
      }
    }
    const prioritySnapshot = priorityMetrics.prioritySource === "server" ? {
      source: "server",
      score: priorityMetrics.priorityScore,
      rank: priorityMetrics.ahpRank,
      computedAt: priorityMetrics.priorityComputedAt,
      nearestTeamId: priorityMetrics.nearestTeamId,
      distanceToNearestTeamKm: priorityMetrics.distanceKm,
      freeTeams: priorityMetrics.freeTeams,
      noTeamFlag: priorityMetrics.noTeamFlag,
      severityRaw: priorityMetrics.severityRaw,
      codeRed: priorityMetrics.codeRed,
      codeRedReason: priorityMetrics.codeRedReason,
      codeRedLayer: priorityMetrics.codeRedLayer
    } : null;

    let dispatchedId = null;
    Store.update({
      event: "TRIAGE_VERIFY_AND_DISPATCH",
      detail: `${incident.id} → ${team.id}${incident.verificationStatus !== "verified" ? " · one-click AI confirmation" : ""}`
    }, (draft) => {
      const targetIncident = draft.incidents.find((item) => item.id === incident.id);
      const targetReport = draft.reports.find((item) => item.id === targetIncident?.reportId);
      const targetTeam = draft.teams.find((item) => item.id === team.id);
      if (!targetIncident || !targetTeam) return;
      if ((draft.dispatchOrders || []).some((order) => order.incidentId === incident.id && !["Cancelled", "Completed"].includes(order.status))) return;
      const now = new Date().toISOString();
      if (targetIncident.verificationStatus !== "verified" && targetReport) {
        const original = {
          type: targetIncident.originalType,
          severity: Number(targetReport.aiResult?.severityScore ?? targetIncident.severityScore),
          victims: Number(targetReport.aiResult?.detectedPeopleCount ?? targetIncident.detectedPeopleCount)
        };
        targetReport.verificationStatus = "verified";
        targetReport.verificationLabel = "Verified (1-click Workspace)";
        targetReport.verificationReason = `AI data confirmed by ${reviewer?.name || "Dispatch Admin"} in the workspace.`;
        targetReport.verificationMethod = "admin";
        targetReport.verifiedAt = now;
        targetReport.adminReview = {
          reviewerId: reviewer?.id || "DISPATCH",
          reviewerName: reviewer?.name || "Dispatch Admin",
          verifiedAt: now,
          mode: "one_click_ai_confirmed",
          original,
          verified: { type: Store.effectiveType(targetIncident), severity: targetIncident.severityScore, victims: targetIncident.detectedPeopleCount },
          notes: "One-click AI confirmation in the Unified Triage Workspace."
        };
        targetIncident.reviewedType = Store.effectiveType(targetIncident);
        targetIncident.draftReviewedType = targetIncident.reviewedType;
        targetIncident.verificationStatus = "verified";
        targetIncident.verificationLabel = targetReport.verificationLabel;
        targetIncident.verificationReason = targetReport.verificationReason;
        targetIncident.verificationMethod = "admin";
        targetIncident.verifiedAt = now;
        targetIncident.status = "Matching Team";
      }
      const dispatchId = Store.nextId(draft, "dispatch", "DSP");
      const computed = computeTeamMatch(targetTeam, targetIncident, draft);
      draft.dispatchOrders.push({
        id: dispatchId,
        incidentId: targetIncident.id,
        teamId: targetTeam.id,
        matchScore: computed.totalScore,
        distanceKm: computed.distanceKm,
        status: "Confirmed",
        createdAt: now,
        confirmedAt: now,
        confirmedBy: reviewer?.id || "DISPATCH",
        completedAt: null,
        prioritySnapshot,
        overrideReason: null,
        overrideBy: null,
        ruleEvaluation: {
          configVersion: computed.ruleEval.configVersion,
          eligible: computed.ruleEval.eligible,
          overriddenHardConstraint: false,
          overrideReason: null,
          baseRankingScore: computed.baseScore,
          softDelta: computed.ruleEval.softDelta,
          finalMatchScore: computed.totalScore,
          hardPassed: computed.ruleEval.hardPassed,
          hardFailed: computed.ruleEval.hardFailed,
          softApplied: computed.ruleEval.softApplied,
          missingWarnings: computed.ruleEval.missingWarnings
        }
      });
      targetIncident.status = "In Progress";
      targetIncident.assignedTeamId = targetTeam.id;
      targetIncident.dispatchId = dispatchId;
      targetIncident.prioritySnapshot = prioritySnapshot || targetIncident.prioritySnapshot || null;
      targetTeam.status = "On Mission";
      targetTeam.currentMissionId = dispatchId;
      dispatchedId = targetIncident.id;
    });
    if (!dispatchedId) return UI.toast("Dispatch could not be recorded; refresh the queue.", "error");
    UI.toast(`Dispatch confirmed to ${team.id}. The team is On Mission.`, "success");
    const remaining = queueItems(Store.load()).items.filter((item) => item.id !== dispatchedId && item.status !== "Resolved");
    const next = remaining.find((item) => item._codeRed) || remaining[0] || null;
    ui.workspaceIncidentId = next?.id || null;
    ui.selectedIncidentId = next?.id || dispatchedId;
    ui.selectedTeamId = null;
    render();
  }

  function renderC2() {
    const shared = Store.load();
    if (ui.c2Mode === "workspace") return renderTriageWorkspace(shared);
    const isVi = UI.getPreferences?.().language === "vi";
    const t = (en, vi) => isVi ? vi : en;
    const { items, autoItems, reviewItems, resolvedItems, districts, allActive } = queueItems(shared);
    maybeGoldenHourAlert(allActive);
    const option = (value, current, label) => `<option value="${e(value)}" ${value === current ? "selected" : ""}>${e(label || value)}</option>`;

    const noTeamCount = allActive.filter((item) => item._noTeamFlag && item.status !== "In Progress").length;

    const tab = ui.queue.tab || "auto";
    const showingResolved = tab === "resolved" || ui.queue.status === "Resolved";
    const viewMode = ui.queue.viewMode || "table";
    const highlightedIncident = ui.highlightedIncidentId
      ? shared.incidents.find((item) => item.id === ui.highlightedIncidentId)
      : null;
    const highlightBanner = highlightedIncident ? `<div class="alert success just-verified-banner" data-highlight-banner="${e(highlightedIncident.id)}">
      <span>✓</span>
      <div style="flex:1"><strong>${e(highlightedIncident.id)} ${t("was verified successfully", "đã được xác minh thành công")}</strong><div>${t("The incident is highlighted in the Verified Queue and is ready for the next operational step.", "Sự cố được đánh dấu trong Hàng đợi đã xác minh và sẵn sàng cho bước tác nghiệp tiếp theo.")}</div></div>
      ${Store.effectiveType(highlightedIncident) === "Normal"
        ? `<button class="btn ghost small" data-open="${e(highlightedIncident.id)}">${t("View verified Normal report", "Xem báo cáo Bình thường đã xác minh")}</button>`
        : `<button class="btn small" data-open-c4="${e(highlightedIncident.id)}">${t("Continue to Team Matching →", "Tiếp tục Ghép Đội →")}</button>`}
    </div>` : "";

    const meta = Store.regionMeta(shared);
    const scopeNote = meta.operatingArea === "Vietnam"
      ? `National dataset — all ${shared.incidents.length} incidents across ${new Set(shared.incidents.map((item) => item.location.province)).size} provinces. The default queue shows open incidents; Resolved tab holds closed cases.`
      : `Province subset — ${shared.incidents.length} of ${meta.nationalIncidentCount || 20} national incidents. The default queue shows open incidents; Resolved tab holds closed cases.`;
    return pageHead(
      t("Multi-Tier Gatekeeping · Dispatch Queue", "Kiểm Soát Đa Tầng · Hàng Đợi Điều Phối"),
      t("Verified vs Unverified Dispatch Queues", "Hàng Đợi Điều Phối Đã Xác Minh & Chưa Xác Minh"),
      scopeNote,
      `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn ghost small" data-c2-mode="workspace">⊞ ${t("Workspace", "Workspace")}</button>${UI.demoControls(true)}</div>`
    ) +
    renderQueueReviewInbox(shared) +
    highlightBanner +
    `<div class="grid grid-3" style="grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; margin-top:16px">
      <div class="card kpi-card" style="margin-top:0">
        <span class="kpi-label">${t("Active Incidents", "Sự Cố Đang Xử Lý")}</span>
        <div class="kpi-value" style="color:var(--navy)">${allActive.length}</div>
        <span class="muted">${allActive.filter(i => i.status === "Unverified").length} ${t("unverified", "chưa duyệt")} · ${allActive.filter(i => i.status === "Matching Team").length} ${t("matching", "chờ ghép đội")} · ${allActive.filter(i => i.status === "In Progress").length} ${t("in progress", "đang cứu hộ")}</span>
      </div>
      <div class="card kpi-card" style="margin-top:0">
        <span class="kpi-label">${t("Verified Incident Queue", "Hàng Đợi Sự Cố Đã Xác Minh")}</span>
        <div class="kpi-value" style="color:var(--green)">${allActive.filter(i => i.status !== "Unverified").length}</div>
        <span class="muted">${
          allActive.filter(i => i.status === "Matching Team").length > 0
            ? `${allActive.filter(i => i.status === "Matching Team").length} ${t("matching", "chờ ghép đội")} · ${allActive.filter(i => i.status === "In Progress").length} ${t("in progress", "đang cứu hộ")}`
            : (allActive.filter(i => i.status === "In Progress").length > 0
                ? `${allActive.filter(i => i.status === "In Progress").length} ${t("in progress (field operations)", "đang tác chiến cứu hộ thực địa")}`
                : t("Ready for team matching", "Sẵn sàng ghép đội cứu hộ"))
        }</span>
      </div>
      <div class="card kpi-card" style="margin-top:0">
        <span class="kpi-label">${t("Local Team Shortage Alert", "Cảnh Báo Thiếu Đội Tại Địa Phương")}</span>
        <div class="kpi-value" style="color:${noTeamCount > 0 ? "var(--red)" : "var(--muted)"}">
          ${noTeamCount}
        </div>

        <span class="muted">${noTeamCount > 0 ? t("Sector has 0 free local teams (cross-district)", "Khu vực không có đội địa phương sẵn sàng (cần hỗ trợ liên quận)") : t("All active sectors have free local teams", "Tất cả khu vực đang hoạt động đều có đội địa phương sẵn sàng")}</span>
      </div>
    </div>

        ${renderLifeRiskLane(allActive)}

        <section class="card" style="margin-top:16px">
      <!-- Tabs Switcher + View Mode Toggle -->
      <div class="row-between" style="margin-bottom:14px">
        <div class="queue-tabs" style="margin-bottom:0">
          <button class="queue-tab ${tab === "auto" ? "active" : ""}" data-queue-tab="auto">
            <span>✓ ${t("Verified Incident Queue", "Hàng Đợi Sự Cố Đã Xác Minh")}</span>
            <span class="badge success">${autoItems.length}</span>
          </button>
          <button class="queue-tab ${tab === "resolved" ? "active" : ""}" data-queue-tab="resolved">
            <span>✓ ${t("Resolved Cases", "Ca Đã Giải Quyết")}</span>
            <span class="badge neutral">${resolvedItems.length}</span>
          </button>
        </div>

        <div class="view-mode-toggle" role="group" aria-label="${t("Queue view mode", "Chế độ xem hàng đợi")}">
          <button class="btn ${viewMode === "table" ? "" : "ghost"} small" data-queue-view="table">☰ ${t("Table View", "Dạng Bảng")}</button>
          <button class="btn ${viewMode === "grid" ? "" : "ghost"} small" data-queue-view="grid">⊞ ${t("Grid View", "Dạng Lưới")}</button>
        </div>

      </div>

      <!-- Filters & Sort -->
      <div class="filters" style="margin-bottom:14px">
        <label class="field">
          <span>${t("Time Window", "Khoảng Thời Gian")}</span>
          <select data-q="timeRange">
            ${TIME_RANGES.map(([val, label]) => option(val, ui.queue.timeRange || "7d", label)).join("")}
          </select>
        </label>
        <label class="field">
          <span>${t("Incident Type", "Loại Sự Cố")}</span>
          <select data-q="type">
            ${["All", ...Demo.TYPES].map((value) => option(value, ui.queue.type, value === "All" ? t("All Incident Types", "Tất Cả Loại Sự Cố") : value)).join("")}
          </select>
        </label>
        <label class="field">
          <span>${t("Sector", "Khu Vực")}</span>
          <select data-q="district">
            ${["All", ...districts].map((value) => option(value, ui.queue.district, value === "All" ? t("All Sectors", "Tất Cả Khu Vực") : value)).join("")}
          </select>
        </label>
        <label class="field">
          <span>${t("Severity Band", "Nhóm Mức Độ Nghiêm Trọng")}</span>
          <select data-q="severity">
            <option value="All">${t("All Severity Bands", "Tất Cả Mức Độ")}</option>
            <option value="critical" ${ui.queue.severity === "critical" ? "selected" : ""}>${t("85–100 Critical", "85–100 Rất Nghiêm Trọng")}</option>
            <option value="high" ${ui.queue.severity === "high" ? "selected" : ""}>${t("70–84.9 High", "70–84,9 Nghiêm Trọng")}</option>
            <option value="moderate" ${ui.queue.severity === "moderate" ? "selected" : ""}>${t("Below 70 Moderate/Low", "Dưới 70 Trung Bình/Thấp")}</option>
          </select>
        </label>
        <label class="field">
          <span>${t("Status", "Trạng Thái")}</span>
          <select data-q="status">
            ${["All", "Unverified", "Matching Team", "In Progress", "Resolved"].map((value) => option(value, ui.queue.status, value === "All" ? t("All Statuses", "Tất Cả Trạng Thái") : ({"Unverified": t("Unverified", "Chưa xác minh"), "Matching Team": t("Matching Team", "Đang ghép đội"), "In Progress": t("In Progress", "Đang thực hiện"), "Resolved": t("Resolved", "Đã giải quyết")}[value] || value))).join("")}
          </select>
        </label>
        <label class="field">
          <span>${t("Sort By", "Sắp Xếp Theo")}</span>
          <select data-q="sort">
            <option value="priority" ${ui.queue.sort === "priority" ? "selected" : ""}>${t("AHP/TOPSIS Priority Score ↓ (Default)", "Điểm Ưu Tiên AHP/TOPSIS ↓ (Mặc Định)")}</option>
            <option value="severity" ${ui.queue.sort === "severity" ? "selected" : ""}>${t("Severity Score ↓", "Điểm Nghiêm Trọng ↓")}</option>
            <option value="distance" ${ui.queue.sort === "distance" ? "selected" : ""}>${t("Nearest Distance ↑", "Khoảng Cách Gần Nhất ↑")}</option>
            <option value="time" ${ui.queue.sort === "time" ? "selected" : ""}>${t("Newest Timestamp ↓", "Thời Gian Mới Nhất ↓")}</option>
            <option value="people" ${ui.queue.sort === "people" ? "selected" : ""}>${t("Detected Victims ↓", "Số Nạn Nhân Phát Hiện ↓")}</option>
          </select>
        </label>
        <button class="btn ghost" data-action="clear-queue">${t("Reset", "Đặt Lại")}</button>
      </div>

      <!-- Main Collection: Verified Queue or Closed Cases -->
      <div class="group-section auto-ok" id="verified-queue-anchor">
        <div class="group-header">
          <div>
            <h3 style="margin:0"><span style="color:${showingResolved ? "var(--muted)" : "var(--green)"}">✓</span> ${showingResolved ? t("Resolved Cases", "Ca Đã Giải Quyết") : t("Verified Incident Queue", "Hàng Đợi Sự Cố Đã Xác Minh")} (${(showingResolved ? resolvedItems : autoItems).length} ${t("cases", "ca")}) </h3>
          </div>

          <span class="badge ${showingResolved ? "neutral" : "success"}"><span class="status-dot"></span>${showingResolved ? t("CLOSED CASES", "CA ĐÃ ĐÓNG") : t("READY FOR DISPATCH", "SẴN SÀNG ĐIỀU ĐỘNG")}</span>
        </div>

        ${renderIncidentCollection(showingResolved ? resolvedItems : autoItems, false, shared, false, [])}
      </div>
    </section>`;
  }

  function actionForIncident(incident) {
    if (incident.status === "Resolved") return UI.badge("Resolved", "success");
    if (incident.status === "Unverified") return `<button class="btn" data-report-review="${incident.reportId}">Review &amp; Verify in C2</button>`;
    if (incident.status === "Matching Team") {
      const autoVerified = Boolean(incident.verificationMethod && incident.verificationMethod !== "admin");
      return `${autoVerified ? '<button class="btn ghost" data-action="edit-type">Edit Type</button>' : ""}<button class="btn" data-screen="C4">Match Rescue Team →</button>`;
    }
    if (incident.status === "In Progress") {
      return `<button class="btn success" data-action="finalize">Finalize &amp; Resolve</button>`;
    }
    return "";
  }

  function renderC3() {
    const shared = Store.load();
    const incident = selectedIncident(shared);
    ui.selectedIncidentId = incident.id;
    const selected = ui.selectedDetectionId || incident.detections[0]?.id;
    ui.selectedDetectionId = selected;

    const linkedReport = shared.reports.find((item) => item.id === incident.reportId);
    const sourceVerified = incident.verificationStatus === "verified";
    const sourceVerificationHtml = `<section class="card review-basis-card ${sourceVerified ? "flagged-success" : "flagged-warning"}">
      <div class="card-header"><div><p class="eyebrow">Verification Gate</p><h2>${sourceVerified ? "✓ Verified Queue" : "◌ Unverified / Pending Review"}</h2><p class="muted">Trusted sources (UAV/CTV/identified Reporter) auto-verify after a valid AI emergency result with no flags. Unverified Citizen reports always require Coordinator review. Every dispatch still requires a human confirmation.</p></div>${UI.badge(incident.verificationLabel || "Unverified", sourceVerified ? "success" : "warning")}</div>
      <div class="setting-row"><span>Source type</span><strong>${e(
        (UI.getPreferences?.().language === "vi")
          ? (linkedReport?.sourceType === "drone" ? "Drone Tuần Tra (Telemetry UAV)" : linkedReport?.sourceType === "specialist" ? "Chuyên Viên / CTV Trinh Sát (Đã Xác Thực)" : "Người Dân Cộng Đồng (Nguồn Đối Chiếu)")
          : (linkedReport?.sourceType === "drone" ? "Patrol Drone (UAV Telemetry)" : linkedReport?.sourceType === "specialist" ? "Specialist / Recon CTV (Verified Reporter)" : "Community Citizen (Crowdsource)")
      )}</strong></div>
      <div class="setting-row"><span>Source identity</span><strong class="mono">${e(linkedReport?.sourceIdentity || "—")}</strong></div>
      <div class="setting-row"><span>Verification basis</span><strong>${e(incident.verificationReason || "Pending Admin verification")}</strong></div>
      <div class="setting-row"><span>Required review fields</span><strong>Incident Type · Severity Score · Detected Victims</strong></div>
      ${sourceVerified ? "" : '<div class="alert warning" style="margin-top:12px"><span>!</span><div>This report cannot enter team matching while Unverified. Open Admin Review from C2 to inspect the evidence and model output.</div></div>'}
    </section>`;

    return pageHead(`Incident Detail · ${incident.id}`, "Incident Detail & Review", "Review Admin verification, linked evidence, detections and operational state.", `<button class="btn ghost" data-screen="C2">← Priority Queue</button><button class="btn ghost" data-audit-for="${e(incident.id)}">☰ Edit history</button>${actionForIncident(incident)}`) +
      `<div class="detail-grid" style="margin-top:0"><div class="stack">${sourceVerificationHtml}<section class="card"><div class="card-header"><div><h2>Incident Information</h2><p class="muted">Incident <span class="mono">${e(incident.id)}</span></p></div>${UI.badge(incident.status)}</div>
        <div class="stack"><div class="setting-row"><span>Original AI Type</span><strong>${UI.typeLabel(incident.originalType)}</strong></div><div class="setting-row"><span>AI Confidence</span><strong>${incident.aiConfidence.toFixed(1)}%</strong></div><div class="setting-row"><span>Severity Score</span>${UI.severity(incident.severityScore)}</div><div class="setting-row"><span>Detected Victims</span><strong>${incident.detectedPeopleCount}</strong></div><div class="setting-row"><span>Sector</span><strong>${e(incident.location.district)}</strong></div><div class="setting-row"><span>GPS Coordinates</span><span class="mono">${incident.location.latitude.toFixed(6)}, ${incident.location.longitude.toFixed(6)}</span></div></div>
      </section><section class="card"><div class="card-header"><div><h2>Admin Review Decision</h2><p class="muted">Corrections and verification are managed centrally from C2 · Verified / Pending Queues.</p></div></div>${incident.reviewedType ? `<div class="setting-row"><span>Verified Incident Type</span><div class="row">${UI.typeLabel(incident.reviewedType)}${incident.reviewedType !== incident.originalType ? UI.badge("AI type corrected", "danger") : UI.badge("Confirmed", "success")}</div></div><div class="alert success" style="margin-top:13px"><span>✓</span><div><strong>Admin review completed</strong><div>${UI.formatDate(incident.verifiedAt)} · Severity ${incident.severityScore.toFixed(1)} · ${incident.detectedPeopleCount} victim(s)</div></div></div>` : `<div class="alert warning"><span>◌</span><div><strong>Waiting for Admin review</strong><div>Inspect the evidence and correct the model output before verification.</div></div></div><button class="btn full" style="margin-top:13px" data-report-review="${incident.reportId}">Open Admin Review in C2</button>`}</section></div>
      <div class="stack"><section class="card"><div class="card-header"><div><h2>Evidence Viewer</h2><p class="muted">Select a bounding box or table row to link the same target.</p></div>${Trace.isLive(linkedReport) ? UI.badge("Live ML detections", "success") : ""}</div><div class="evidence-viewer ${Trace.isLive(linkedReport) ? "live" : ""}"><img src="${e(incident.image)}" alt="UAV evidence for ${e(incident.id)}">${incident.detections.map((detection) => `<button class="bbox ${detection.pose === "Non-Upright" ? "non-upright" : ""} ${selected === detection.id ? "selected" : ""}" data-detection="${detection.id}" style="left:${detection.bbox[0]}%;top:${detection.bbox[1]}%;width:${detection.bbox[2]}%;height:${detection.bbox[3]}%"><span>${e(detection.id)} · ${detection.confidence}%</span></button>`).join("")}<div class="viewer-caption">${Trace.isLive(linkedReport) ? "Live ML inference · real boxes" : "UAV EO feed · BBox overlay simulation"} · ${incident.location.latitude.toFixed(4)}°N ${incident.location.longitude.toFixed(4)}°E</div></div></section>
      <section class="card"><div class="card-header"><div><h2>Victim Identification</h2><p class="muted">Detected targets from scene reconnaissance.</p></div><span class="badge neutral">${incident.detections.length} targets</span></div><div class="table-wrap"><table><thead><tr><th>Target ID</th><th>Pose</th><th>Detection Confidence</th></tr></thead><tbody>${incident.detections.map((detection) => `<tr class="clickable ${selected === detection.id ? "selected" : ""}" data-detection="${detection.id}"><td><strong class="mono">${e(detection.id)}</strong></td><td>${UI.badge(detection.pose, detection.pose === "Non-Upright" ? "danger" : "")}</td><td>${detection.confidence.toFixed(1)}%</td></tr>`).join("") || '<tr><td colspan="3">No people were detected in this incident.</td></tr>'}</tbody></table></div></section></div></div>`;
  }

  const SPECIALTY_MATRIX = {
    "SAR-01": { Flood: 95, Fire: 70, "Building Collapse": 80, "Traffic Accident": 85 },
    "FIRE-01": { Flood: 60, Fire: 100, "Building Collapse": 85, "Traffic Accident": 80 },
    "VOL-01": { Flood: 70, Fire: 65, "Building Collapse": 75, "Traffic Accident": 95 },
    "SAR-02": { Flood: 75, Fire: 75, "Building Collapse": 95, "Traffic Accident": 85 },
    "WATER-01": { Flood: 100, Fire: 50, "Building Collapse": 45, "Traffic Accident": 55 },
    "MED-01": { Flood: 65, Fire: 75, "Building Collapse": 80, "Traffic Accident": 90 },
    "SAR-03": { Flood: 50, Fire: 50, "Building Collapse": 55, "Traffic Accident": 50 }
  };

  function distanceToIncidentKm(team, incident) {
    const lat = Number(team?.latitude);
    const lng = Number(team?.longitude);
    const ilat = Number(incident?.location?.latitude);
    const ilng = Number(incident?.location?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(ilat) && Number.isFinite(ilng) && Store.haversineMeters) {
      return Number((Store.haversineMeters({ latitude: ilat, longitude: ilng }, { latitude: lat, longitude: lng }) / 1000).toFixed(2));
    }
    return Number(team?.distanceKm) || 0;
  }

  function computeTeamMatch(team, incident, shared = Store.load()) {
    const type = Store.effectiveType(incident);
    const matrixRow = SPECIALTY_MATRIX[team.id] || {};
    let sBase = matrixRow[type];
    if (sBase == null) {
      const eq = String(team.equipment || "").toLowerCase();
      if (type === "Flood" && eq.includes("boat")) sBase = 95;
      else if (type === "Fire" && eq.includes("fire")) sBase = 95;
      else if (type === "Building Collapse" && (eq.includes("rope") || eq.includes("thermal"))) sBase = 90;
      else if (type === "Traffic Accident" && (eq.includes("van") || eq.includes("medical") || eq.includes("triage"))) sBase = 90;
      else sBase = 75;
    }

    const eqLower = String(team.equipment || "").toLowerCase();
    const matchCfg = shared.settings?.matchConfig || {};
    const bonusPoints = Number(matchCfg.bonusPoints ?? 5);
    const distanceDivisorKm = Number(matchCfg.distanceDivisorKm ?? 15);
    const sameAreaBonus = Number(matchCfg.sameAreaBonus ?? 10);
    const hasCriticalVictim = (incident.detections || []).some((d) => d.pose === "Non-Upright");
    let bonus = 0;
    if (hasCriticalVictim && (eqLower.includes("medical") || eqLower.includes("triage"))) bonus += bonusPoints;
    if (incident.severityScore >= 85 && (eqLower.includes("uav") || eqLower.includes("drone") || eqLower.includes("thermal"))) bonus += bonusPoints;
    const sSpecialty = Math.min(100, sBase + bonus);

    const sameArea = team.area === incident.location.district;
    const distanceKm = distanceToIncidentKm(team, incident);
    const sDistRaw = Math.max(0, Math.min(100, (1 - (distanceKm / distanceDivisorKm)) * 100));
    const sDistance = Math.min(100, Math.round(sDistRaw + (sameArea ? sameAreaBonus : 0)));

    const mReq = Math.max(4, (incident.detectedPeopleCount || 1) * 2);
    // Target schema defines RescueTeam.capacity as headcount. Fall back to the
    // historical members field for seeded/demo data.
    const headcount = Number(team.capacity ?? team.members ?? 0);
    const sCapacity = Math.min(100, Math.round((headcount / mReq) * 100));

    const baseScore = Math.round((0.50 * sSpecialty) + (0.35 * sDistance) + (0.15 * sCapacity));
    const ruleEval = Store.evaluateTeamRules
      ? Store.evaluateTeamRules(team, incident, shared)
      : { eligible: true, hardPassed: [], hardFailed: [], softApplied: [], missingWarnings: [], softDelta: 0, ruleVersion: "v2.5.0-controlled", incAttrs: {}, teamAttrs: {} };

    const totalScore = Math.max(0, Math.min(100, baseScore + ruleEval.softDelta));
    const specialtyLabel = sSpecialty >= 90 ? "Primary Specialty" : sSpecialty >= 75 ? "High Compatibility" : "Cross-Support";
    const specialtyTone = sSpecialty >= 90 ? "success" : sSpecialty >= 75 ? "" : "warning";

    return {
      baseScore,
      totalScore,
      sSpecialty,
      sDistance,
      sCapacity,
      sameArea,
      distanceKm,
      mReq,
      bonus,
      specialtyLabel,
      specialtyTone,
      ruleEval
    };
  }

  function evaluateCandidateTeams(shared, incident = selectedIncident(shared)) {
    const allAvailable = shared.teams
      .filter((team) => team.status === "Available" && !Store.activeAssignmentForTeam(shared, team.id))
      .map((team) => {
        const match = computeTeamMatch(team, incident, shared);
        return { ...team, distanceKm: match.distanceKm, _match: match, matchScore: match.totalScore };
      });

    const eligible = allAvailable
      .filter((t) => t._match.ruleEval.eligible)
      .sort((a, b) => b.matchScore - a.matchScore || a.distanceKm - b.distanceKm);

    const disqualified = allAvailable
      .filter((t) => !t._match.ruleEval.eligible)
      .sort((a, b) => b.matchScore - a.matchScore || a.distanceKm - b.distanceKm);

    return { allAvailable, eligible, disqualified };
  }

  function availableTeams(shared, incident = selectedIncident(shared)) {
    return evaluateCandidateTeams(shared, incident).eligible;
  }

  function renderC4() {
    const shared = Store.load();
    const incident = selectedIncident(shared);
    if (!adminReviewComplete(shared, incident)) {
      return pageHead("Field Rescue Team Matching", "Team Matching Blocked", "Only Admin-verified emergency reports can enter team matching.", '<button class="btn ghost" data-screen="C2">← Verified / Pending Queues</button>') +
        UI.empty("◌", "Admin verification required", "Inspect the evidence and confirm incident type, severity, and victim count from C2 · Verified / Pending Queues. Unclassified and Normal reports cannot enter team matching.", `<button class="btn" data-report-review="${incident.reportId}">Review ${e(incident.reportId)}</button>`);
    }
    const effective = Store.effectiveType(incident);
    const life = lifeRiskProfile(incident);
    const { allAvailable, eligible: teams, disqualified } = evaluateCandidateTeams(shared, incident);
    const incAttrs = Store.resolveIncidentContextAttributes ? Store.resolveIncidentContextAttributes(incident, shared) : {};
    const ruleCfg = Store.ruleEngineConfig ? Store.ruleEngineConfig(shared) : { version: "v2.5.0-controlled", missingDataPolicy: "soft_warning" };

    // Only auto-select an eligible team! When 0 teams satisfy Hard Constraints, do NOT auto-propose an ineligible team.
    if (teams.length > 0) {
      if (!teams.some((team) => team.id === ui.selectedTeamId)) ui.selectedTeamId = teams[0].id;
      ui.overrideTeamId = null;
    } else {
      ui.selectedTeamId = ui.overrideTeamId || null;
    }

    const selected = teams.find((team) => team.id === ui.selectedTeamId) || disqualified.find((team) => team.id === ui.overrideTeamId) || null;
    const m = selected?._match;
    const selectedEta = selected ? estimateEtaMinutes(selected, selected.distanceKm, shared) : null;
    const rEval = m?.ruleEval;
    const isHardDeadlock = allAvailable.length > 0 && teams.length === 0;

    const isNarrow = incAttrs.narrow_entrance?.value === true;
    const isDeepFlood = effective === "Flood" && (Array.isArray(incident.customTags) && incident.customTags.includes("deep_submerged"));
    const isHeavyDebris = effective === "Building Collapse" && Number(incident.severityScore || 0) >= 88;
    const isRiverine = incAttrs.access_terrain?.value === "riverine_canal";
    const isUltraDense = incAttrs.population_density?.value === "ultra_dense";

    const activeTags = [];
    if (isNarrow) {
      activeTags.push({
        id: "narrow_entrance",
        label: "Narrow Alley / Restricted Entrance",
        detail: "Heavy trucks blocked; agile vans/motorcycles prioritized",
        source: "Reporter",
        target: "Report",
        tone: "warning",
        toggleable: true
      });
    }
    if (isDeepFlood) {
      activeTags.push({
        id: "deep_submerged",
        label: "Deep Flood Water (Submerged)",
        detail: "Requires certified rescue boat unit",
        source: "Reporter",
        target: "Report",
        tone: "danger",
        toggleable: true
      });
    }
    if (isHeavyDebris) {
      activeTags.push({
        id: "heavy_debris",
        label: "Heavy Structural Debris / Trapped",
        detail: "Requires hydraulic extrication & shoring gear",
        source: "Admin",
        target: "Report",
        tone: "danger",
        toggleable: false
      });
    }
    if (isRiverine) {
      activeTags.push({
        id: "riverine_canal",
        label: "Riverine / Canal Terrain",
        detail: "Waterway sector from GIS map",
        source: "Location GIS",
        target: "Location",
        tone: "info",
        toggleable: false
      });
    }

    if (isUltraDense) {
      activeTags.push({
        id: "ultra_dense",
        label: "Ultra-Dense Urban Zone",
        detail: "Same-sector local unit prioritized",
        source: "Location GIS",
        target: "Location",
        tone: "neutral",
        toggleable: false
      });
    }

    const customTagsBarHtml = `<section class="card" style="margin-top:16px">
      <div class="card-header">
        <div>
          <p class="eyebrow">Controlled Extensible Custom Tags & Configurable Rules (${e(ruleCfg.version)})</p>
          <h2>Context Attributes Applied to Team Selection (Post-Ranking Step)</h2>
        </div>

        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn ${isNarrow ? "secondary" : "ghost"} small" data-scene-tag="narrow_entrance">${isNarrow ? "✓ " : "+ "}🏷️ Narrow Alley Entrance</button>
          ${effective === "Flood" ? `<button class="btn ${isDeepFlood ? "secondary" : "ghost"} small" data-scene-tag="deep_submerged">${isDeepFlood ? "✓ " : "+ "}🌊 Deep Flood Water</button>` : ""}
          <button class="btn ghost small" data-action="c4-preset-deadlock" style="color:var(--red)">🛑 Test Hard-Constraint Deadlock</button>
          ${(isNarrow || isDeepFlood) ? `<button class="btn ghost small" data-action="c4-preset-standard">↺ Clear Tags</button>` : ""}
        </div>

      </div>
      ${activeTags.length > 0 ? `
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          ${activeTags.map((tag) => `
            <div class="surface" style="display:inline-flex;align-items:center;gap:10px;padding:8px 12px;background:#fff;border:1px solid var(--line);border-radius:10px">
              <div>
                <div class="row" style="gap:6px;align-items:center">
                  <span class="badge ${tag.tone}" style="font-size:11px;padding:2px 8px">🏷️ ${e(tag.label)}</span>
                  <span class="badge neutral" style="font-size:10px;padding:1px 6px">Source: ${e(tag.source)}</span>
                </div>
                <div class="muted" style="font-size:11px;margin-top:4px">${e(tag.detail)}</div>
              </div>
              ${tag.toggleable ? `<button class="btn ghost small" data-scene-tag="${e(tag.id)}" title="Remove tag" style="padding:2px 6px;font-size:11px">✕</button>` : ""}
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="surface" style="padding:10px 14px;background:#f8fafc;border:1px dashed var(--line);color:var(--muted);font-size:13px">
          ✓ No special scene restrictions tagged — standard road &amp; terrain access applies to all available rescue units.
        </div>
      `}
    </section>`;

    return pageHead("Rescue Team Matching", "Match Rescue Team (Multi-Criteria + Rule Engine)", "Hard Constraints filter ineligible units; Soft Constraints adjust their scores. Select one primary rescue team for this incident.", `<button class="btn ghost" data-screen="Configuration">⚙ Configure Tags & Rules</button><button class="btn ghost" data-screen="C3">← Incident Detail</button>`) +
      `<section class="card"><div class="row-between"><div><div class="row"><span class="badge neutral">${e(incident.id)}</span><span class="badge">${UI.typeLabel(effective)}</span>${incident.reviewedType ? UI.badge("Verified", "success") : ""}${life.critical ? UI.badge("Code Red", "danger") : ""}</div><h2 style="margin:12px 0 4px">${e(incident.location.district)}</h2><p class="muted">${life.victims} Detected Victims${life.nonUpright ? ` · <strong style="color:var(--red)">${life.nonUpright} non-upright</strong>` : ""} (Recommended quota: ≥ ${Math.max(4, (incident.detectedPeopleCount || 1) * 2)} officers) · Severity ${life.severityRaw.toFixed(1)}${life.critical ? ` · <strong style="color:var(--red)">Code Red</strong>` : ""} · ${incident.location.latitude.toFixed(5)}, ${incident.location.longitude.toFixed(5)}</p></div><div class="score-ring" style="--score:${incident.severityScore}"><div><span><strong>${incident.severityScore.toFixed(1)}</strong><small>Severity Score</small></span></div></div></div></section>
      ${life.critical ? `<div class="alert danger" style="margin-top:12px"><span style="font-size:20px">🚨</span><div><strong>Life-risk priority: ${life.victims} victims, ${life.nonUpright} non-upright, waiting ${waitingLabel(life.ageMinutes)}</strong><div style="margin-top:3px">Choose a team with the people/equipment capacity for this casualty load. The life-risk lane does not change the AHP score; it only makes the casualty burden explicit.</div></div></div>` : ""}
      ${customTagsBarHtml}
      <div class="detail-grid" style="margin-top:16px">
        <div class="stack">
          <section class="card">
            <div class="card-header">
              <div>
                <h2>1. Eligible Rescue Teams (Passed All Hard Constraints)</h2>
                <p class="muted">Offline, on-mission, dispatch-pending, and Hard-Constraint-violating teams are excluded from automatic proposal.</p>
              </div>

              <span class="badge ${teams.length ? "success" : "danger"}">${teams.length} eligible / ${allAvailable.length} available</span>
            </div>

            ${allAvailable.length === 0
              ? UI.empty("∅", "No Available Team", "All rescue teams are offline, on a mission, or already have a pending dispatch. This incident remains in Matching Team status.", '<button class="btn ghost" data-screen="C2">Return to Queue</button>')
              : isHardDeadlock
                ? `<div class="alert danger" style="margin-bottom:12px">
                    <span style="font-size:20px">⚠️</span>
                    <div>
                      <strong>HARD CONSTRAINT ALERT: 0 Eligible Teams Found (${disqualified.length} available unit(s) disqualified)</strong>
                      <div style="margin-top:4px">No available rescue team satisfies all mandatory Hard Constraints for <strong>${e(incident.id)}</strong>. Automatic team proposal is blocked so the system never silently assigns an unqualified unit. Coordinator review is required below.</div>
                    </div>

                  </div>
`
                : `<div class="table-wrap"><table><thead><tr><th></th><th>Rescue Team & Sector</th><th>RescueTeam Custom Tags (Source: Admin)</th><th>Personnel</th><th>Distance / ETA</th><th>Soft Rules Δ</th><th>Capability Match Score</th></tr></thead><tbody>${teams.map((team, idx) => {
                  const tAttrs = team._match.ruleEval.teamAttrs || {};
                  const softDelta = team._match.ruleEval.softDelta;
                  const eta = estimateEtaMinutes(team, team.distanceKm, shared);
                  const underStrength = Number(team.members) < team._match.mReq;
                  return `<tr class="clickable ${team.id === ui.selectedTeamId ? "selected" : ""} ${underStrength ? "under-strength-row" : ""}" data-team-select="${team.id}">
                    <td><input type="radio" tabindex="-1" ${team.id === ui.selectedTeamId ? "checked" : ""}></td>
                    <td>
                      <strong>${idx === 0 ? "★ " : ""}${e(team.name)}</strong>
                      <div class="mono muted" style="font-size:11px">${e(team.id)} · ${e(team.area)} ${team._match.sameArea ? '<span class="badge success" style="font-size:10px;padding:1px 5px">Same Sector</span>' : ""}</div>
                    </td>
                    <td>
                      <div class="row" style="gap:4px;flex-wrap:wrap">
                        <span class="badge neutral" style="font-size:10px">vehicle: ${e(tAttrs.vehicle_type?.value || eta.vehicle)}</span>
                        ${tAttrs.heavy_debris_gear?.value ? '<span class="badge" style="font-size:10px">heavy_gear</span>' : ""}
                      </div>

                      <div class="muted" style="font-size:11px;margin-top:3px">${e(team.equipment)}</div>
                    </td>
                    <td>
                      <strong>${team.members}</strong> officers
                      ${underStrength ? `<div><span class="badge warning" style="font-size:10px;padding:1px 5px" title="Recommended ≥ ${team._match.mReq}">⚠ under-strength ${team.members}/${team._match.mReq}</span></div>` : ""}
                    </td>
                    <td>
                      <strong>${team.distanceKm.toFixed(1)} km</strong>
                      <div class="muted" style="font-size:11px">≈ ${eta.minutes} min · ${eta.vehicle} ${eta.speed} km/h + ${eta.prep} min prep</div>
                    </td>
                    <td>
                      <span class="badge ${softDelta > 0 ? "success" : softDelta < 0 ? "warning" : "neutral"}">${softDelta > 0 ? `+${softDelta}` : softDelta} pts</span>
                    </td>
                    <td>
                      <div class="priority-meter">
                        <div class="priority-meter-bar"><div class="priority-meter-fill" style="width:${team.matchScore}%;background:${team.matchScore >= 85 ? "var(--green)" : team.matchScore >= 70 ? "var(--blue)" : "var(--amber)"}"></div></div>
                        <strong class="mono">${team.matchScore}%</strong>
                      </div>

                      <div class="muted mono" style="font-size:10px">Base ${team._match.baseScore}% ${softDelta >= 0 ? `+ ${softDelta}%` : `- ${Math.abs(softDelta)}%`}</div>
                    </td>
                  </tr>`;
                }).join("")}</tbody></table></div>`}
          </section>

          ${disqualified.length ? `
            <section class="card" style="border-color:#f2b8b5;background:#fffafa">
              <div class="card-header">
                <div>
                  <h2 style="color:var(--red)">2. Filtered Out by Hard Constraints (${disqualified.length} Disqualified Unit${disqualified.length === 1 ? "" : "s"})</h2>
                  <p class="muted">These teams are Available in Rescue Teams force registry but failed one or more mandatory Hard Constraints.</p>
                </div>

                <span class="badge danger">HARD CONSTRAINT BLOCKED</span>
              </div>

              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Rescue Team & Sector</th>
                      <th>RescueTeam Attributes</th>
                      <th>Hard Constraint Violation Reason</th>
                      ${isHardDeadlock ? '<th style="text-align:right">Coordinator Review</th>' : ""}
                    </tr>
                  </thead>
                  <tbody>
                    ${disqualified.map((team) => {
                      const tAttrs = team._match.ruleEval.teamAttrs || {};
                      const failedList = team._match.ruleEval.hardFailed || [];
                      return `<tr style="${ui.overrideTeamId === team.id ? "background:#fff0f0" : "opacity:0.85"}">
                        <td>
                          <strong>${e(team.name)}</strong>
                          <div class="mono muted" style="font-size:11px">${e(team.id)} · ${e(team.area)} · ${team.distanceKm.toFixed(1)} km</div>
                        </td>
                        <td>
                          <span class="badge neutral" style="font-size:10px">vehicle: ${e(tAttrs.vehicle_type?.value)}</span>
                        </td>
                        <td>
                          ${failedList.map((f) => `<div style="margin-bottom:3px"><span class="badge danger" style="font-size:10px">${e(f.id)}</span> <strong style="color:var(--red);font-size:12px">${e(f.name)}:</strong> <span class="muted" style="font-size:12px">${e(f.reason)}</span></div>`).join("")}
                        </td>
                        ${isHardDeadlock ? `<td style="text-align:right"><button class="btn ghost small" data-override-team="${team.id}">${ui.overrideTeamId === team.id ? "Selected for Review" : "Inspect / Override"}</button></td>` : ""}
                      </tr>`;
                    }).join("")}
                  </tbody>
                </table>
              </div>

            </section>
          ` : ""}
        </div>


        <aside class="card">
          <h2>Selected Team & Rule Audit</h2>
          ${selected ? `<div class="stack">
            <div class="surface">
              <div class="row-between">
                <span class="eyebrow">Team (${rEval?.eligible ? "Eligible" : "Coordinator Override"})</span>
                <span class="badge ${rEval?.eligible ? "success" : "danger"}">${e(rEval?.ruleVersion || "v2.5.0")}</span>
              </div>

              <h3 style="margin:5px 0">${e(selected.name)}</h3>
              <span class="mono muted">${e(selected.id)} · ${e(selected.area)}</span>
            </div>

            <div class="setting-row"><span>Commander</span><strong>${e(selected.commander)}</strong></div>
            <div class="setting-row"><span>Personnel</span><strong>${selected.members} officers (Req ≥ ${m.mReq})</strong></div>
            ${Number(selected.members) < m.mReq ? `<div class="alert warning" style="margin:2px 0"><span>⚠</span><div><strong>Under-strength team</strong><div style="font-size:12px">${selected.members} officers vs recommended ${m.mReq}. Dispatch is allowed, but request mutual aid or a second wave for this casualty load.</div></div></div>` : ""}
            <div class="setting-row"><span>Deployment Vehicle</span><strong class="mono">${e(rEval?.teamAttrs?.vehicle_type?.value || selectedEta.vehicle)}</strong></div>
            <div class="setting-row"><span>Distance</span><strong>${selected.distanceKm.toFixed(1)} km ${m.sameArea ? "(Same Sector +10pt)" : "(Cross-Sector)"}</strong></div>
            <div class="setting-row"><span>Estimated ETA</span><strong>≈ ${selectedEta.minutes} min <span class="muted" style="font-weight:400">(${selectedEta.vehicle} ${selectedEta.speed} km/h + ${selectedEta.prep} min prep)</span></strong></div>
            <div class="setting-row"><span>Base Capability Score</span><strong class="mono">${m.baseScore}%</strong></div>
            <div class="setting-row"><span>Soft Constraints Adjustment</span><strong class="mono" style="color:${rEval?.softDelta >= 0 ? "var(--green)" : "var(--amber)"}">${rEval?.softDelta >= 0 ? `+${rEval?.softDelta}` : rEval?.softDelta} pts</strong></div>
            <div class="setting-row"><span>Capability Match Score</span><strong style="font-size:18px;color:var(--green)">${selected.matchScore}%</strong></div>

            <div class="match-breakdown">
              <span class="eyebrow">Recorded Rule Engine Justification</span>
              ${(rEval?.hardFailed || []).map((f) => `<div class="validation-item fail" style="padding:6px 9px;margin-top:6px;background:#fff;border:1px solid #f2b8b5"><span class="check">✕</span><div><strong>Blocked by ${e(f.id)}: ${e(f.name)}</strong><div class="muted" style="font-size:11px">${e(f.reason)}</div></div></div>`).join("")}
              ${(rEval?.hardPassed || []).map((p) => `<div class="validation-item pass" style="padding:6px 9px;margin-top:6px;background:#fff;border:1px solid var(--line)"><span class="check">✓</span><div><strong>Pass ${e(p.id)}: ${e(p.name)}</strong><div class="muted" style="font-size:11px">${e(p.detail)}</div></div></div>`).join("")}
              ${(rEval?.softApplied || []).map((s) => `<div class="validation-item ${s.zeroWeightOverride ? "" : (s.delta >= 0 ? "pass" : "")}" style="padding:6px 9px;margin-top:6px;background:${s.zeroWeightOverride ? "#f8fafc" : "#fff"};border:1px solid ${s.zeroWeightOverride ? "#cbd5e1" : "var(--line)"}"><span class="check">${s.zeroWeightOverride ? "⚪" : (s.delta >= 0 ? "★" : "!")}</span><div><strong>${e(s.id)} (${s.zeroWeightOverride ? "0 pts - Context Overridden" : (s.delta >= 0 ? `+${s.delta} pts` : `${s.delta} pts`)}): ${e(s.name)}</strong><div class="muted" style="font-size:11px">${e(s.reason)}</div></div></div>`).join("")}
              ${(rEval?.missingWarnings || []).map((w) => `<div class="validation-item" style="padding:6px 9px;margin-top:6px;background:#fff8eb;border:1px solid #f5d491"><span class="check">!</span><div><strong>Missing-Data Policy (${e(w.id)})</strong><div class="muted" style="font-size:11px">${e(w.message)}</div></div></div>`).join("")}
            </div>


            ${!rEval?.eligible ? `
              <div class="alert danger">
                <span>!</span>
                <div>
                  <strong>Mandatory Coordinator Override Reason</strong>
                  <div style="margin-top:4px">Because this unit failed a Hard Constraint, you must document an operational override reason (e.g., deploying portable hose reel from alley entrance).</div>
                </div>

              </div>

              <label class="field">
                <span>Coordinator Override Justification</span>
                <input id="c4-override-reason" value="${e(ui.overrideReason || "Deploy portable pump & 150m hose line from main road intersection")}" placeholder="Enter mandatory override reason...">
              </label>
            ` : ""}

            <button class="btn full" data-screen="C5">Continue to Confirmation →</button>
          </div>
` : `<div class="alert warning"><span>ⓘ</span><div>${isHardDeadlock ? "Automatic team proposal is blocked because 0 teams satisfy Hard Constraints. Adjust scene attributes above, or click <strong>Inspect / Override</strong> on a unit to document a manual coordinator override." : "Select an available team to continue."}</div></div>`}
        </aside>
      </div>`;
  }

  function renderC5() {
    const shared = Store.load();
    const incident = selectedIncident(shared);
    if (!adminReviewComplete(shared, incident)) {
      return pageHead("Dispatch Approval", "Dispatch Blocked", "This report has not passed the Admin verification gate.", '<button class="btn" data-screen="C2">Return to Verified / Pending Queues</button>') + UI.empty("!", "No dispatch before Admin verification", "An Admin must review the image and confirm a concrete emergency type, severity, and victim count before any rescue unit can be dispatched.");
    }
    const rawTeam = shared.teams.find((item) => item.id === ui.selectedTeamId);
    if (!rawTeam) return pageHead("Dispatch Approval", "Confirm Rescue Dispatch", "The selected team is no longer available.", '<button class="btn" data-screen="C4">Choose Another Team</button>') + UI.empty("!", "Team selection expired", "Return to Team Matching and select an available team.");
    const match = computeTeamMatch(rawTeam, incident, shared);
    const rEval = match.ruleEval;
    const team = { ...rawTeam, distanceKm: match.distanceKm, matchScore: match.totalScore };
    const eta = estimateEtaMinutes(team, match.distanceKm, shared);
    const life = lifeRiskProfile(incident);
    const activeUnitsLabel = `${team.name} (${team.id})`;
    const totalMembers = team.members;

    return pageHead("Dispatch Approval", "Confirm Rescue Dispatch", "Review the selected primary rescue unit and the incident record before sending the assignment.", '<button class="btn ghost" data-screen="C4">← Change Team</button>') +
      `<div class="detail-grid"><div class="stack"><section class="card"><h2>Incident</h2><div class="grid grid-2"><div class="surface"><span class="eyebrow">Incident ID</span><h3 class="mono" style="margin:5px 0">${e(incident.id)}</h3></div><div class="surface"><span class="eyebrow">Verified Type</span><h3 style="margin:5px 0">${UI.typeLabel(Store.effectiveType(incident))}</h3></div><div class="surface"><span class="eyebrow">Severity Score</span><div style="font-size:25px">${UI.severity(incident.severityScore)}</div></div><div class="surface"><span class="eyebrow">Detected Victims</span><h3 style="margin:5px 0">${life.victims}${life.nonUpright ? ` <span style="font-size:13px;color:var(--red)">(${life.nonUpright} non-upright)</span>` : ""}</h3></div></div><div class="setting-row" style="margin-top:12px"><span>Location</span><strong>${e(incident.location.district)}, ${e(incident.location.province)}</strong></div><div class="setting-row"><span>GPS Coordinates</span><span class="mono">${incident.location.latitude.toFixed(6)}, ${incident.location.longitude.toFixed(6)}</span></div>${life.critical ? `<div class="alert danger" style="margin-top:10px"><span>🚨</span><div><strong>Life-critical casualty load</strong><div style="font-size:12px">${life.victims} victims, ${life.nonUpright} non-upright, waiting ${waitingLabel(life.ageMinutes)}.</div></div></div>` : ""}</section>
      <section class="card"><h2>Selected Rescue Unit</h2><div class="setting-row"><span>Assigned Rescue Team</span><strong>${e(activeUnitsLabel)}</strong></div><div class="setting-row"><span>Lead Commander</span><strong>${e(team.commander)}</strong></div><div class="setting-row"><span>Personnel</span><strong>${totalMembers} officers (Req ≥ ${match.mReq})</strong></div>${Number(totalMembers) < match.mReq ? `<div class="alert warning" style="margin:2px 0"><span>⚠</span><div><strong>Under-strength team</strong><div style="font-size:12px">${totalMembers} officers vs recommended ${match.mReq}. Escalate mutual aid after confirming the primary dispatch.</div></div></div>` : ""}<div class="setting-row"><span>Equipment</span><strong>${e(team.equipment || "Standard rescue kit")}</strong></div><div class="setting-row"><span>Distance (Primary)</span><strong>${team.distanceKm.toFixed(1)} km</strong></div><div class="setting-row"><span>Estimated ETA</span><strong>≈ ${eta.minutes} min <span class="muted" style="font-weight:400">(${eta.vehicle} ${eta.speed} km/h + ${eta.prep} min prep)</span></strong></div><div class="setting-row"><span>Rule Config Version</span><strong class="mono">${e(rEval.ruleVersion)}</strong></div><div class="setting-row"><span>Capability Match Score</span><strong>${team.matchScore}% (Base ${match.baseScore}% ${rEval.softDelta >= 0 ? `+ Soft ${rEval.softDelta}%` : `- Soft ${Math.abs(rEval.softDelta)}%`})</strong></div><div class="setting-row"><span>Applied Rules</span><strong>${[...rEval.hardPassed.map((x) => `✓ ${x.id}`), ...rEval.softApplied.map((x) => `${x.id} (${x.delta >= 0 ? `+${x.delta}` : x.delta})`)].join(" · ") || "Standard baseline"}</strong></div>${!rEval.eligible ? `<div class="setting-row"><span>Coordinator Override</span><strong style="color:var(--red)">${e(ui.overrideReason || "Manual coordinator override")}</strong></div>` : ""}</section></div>
      <aside class="card"><h2>Dispatch State Transition</h2><div class="timeline"><div class="timeline-item done"><span class="timeline-mark"></span><div><strong>Incident verified</strong><div class="muted">${e(Store.effectiveType(incident))}</div></div></div><div class="timeline-item done"><span class="timeline-mark"></span><div><strong>Team selected (${e(rEval.ruleVersion)})</strong><div class="muted">${e(team.id)} · ${rEval.eligible ? "Passed all Hard Constraints" : "Coordinator Override"}</div></div></div><div class="timeline-item"><span class="timeline-mark"></span><div><strong>Dispatch Confirmed</strong><div class="muted">The primary team deploys immediately</div></div></div><div class="timeline-item"><span class="timeline-mark"></span><div><strong>Coordinator Finalizes</strong><div class="muted">Status change to Resolved completes the assignment</div></div></div></div><div class="alert success"><span>✓</span><div>Confirmation sets the assigned team to On Mission. The incident becomes In Progress until the coordinator finalizes it.</div></div><button class="btn full" style="margin-top:14px" data-action="confirm-dispatch">Confirm Dispatch</button><button class="btn ghost full" style="margin-top:8px" data-screen="C2">Cancel</button></aside></div>`;
  }

  function renderC7() {
    const shared = Store.load();
    const query = ui.teams.search.toLowerCase();
    const teams = shared.teams.filter((team) => (ui.teams.status === "All" || statusForTeam(shared, team) === ui.teams.status) && [team.id, team.name, team.commander].join(" ").toLowerCase().includes(query));
    const count = (status) => shared.teams.filter((team) => statusForTeam(shared, team) === status).length;
    return pageHead("Shared Rescue Force", "Rescue Teams", "Availability, equipment and RescueTeam custom tags (Source: Admin) are shared with rule matching and dispatch.", `<button class="btn" data-action="add-team">+ Add Rescue Team</button>${UI.demoControls(true)}`) +
      `<div class="grid grid-4"><div class="card kpi-card"><span class="kpi-label">Total Teams</span><div class="kpi-value">${shared.teams.length}</div></div><div class="card kpi-card"><span class="kpi-label">Available</span><div class="kpi-value" style="color:var(--green)">${count("Available")}</div></div><div class="card kpi-card"><span class="kpi-label">On Mission</span><div class="kpi-value">${count("On Mission")}</div></div><div class="card kpi-card"><span class="kpi-label">Offline</span><div class="kpi-value">${count("Offline")}</div></div></div>
      <section class="card" style="margin-top:16px"><div class="filters" style="margin-bottom:14px"><label class="field"><span>Status</span><select id="team-status">${["All", "Available", "On Mission", "Offline"].map((status) => `<option ${status === ui.teams.status ? "selected" : ""}>${status}</option>`).join("")}</select></label><label class="field" style="flex:2"><span>Search</span><input id="team-search" value="${e(ui.teams.search)}" placeholder="Team ID, name or commander"></label></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Rescue Team</th><th>Sector</th><th>Personnel</th><th>Commander</th><th>Status</th><th>Equipment</th><th>RescueTeam Custom Tags</th><th>Action</th></tr></thead><tbody>${teams.map((team) => { const status = statusForTeam(shared, team); const locked = status === "On Mission"; const tAttrs = Store.resolveTeamAttributes ? Store.resolveTeamAttributes(team, shared) : {}; return `<tr><td><strong class="mono">${e(team.id)}</strong></td><td>${e(team.name)}</td><td>${e(team.area)}</td><td>${team.members}</td><td>${e(team.commander)}</td><td>${UI.badge(status, status === "Available" ? "success" : status === "Offline" ? "neutral" : "")}</td><td><div>${e(team.equipment || "Standard rescue kit")}</div></td><td><div class="row" style="gap:4px;flex-wrap:wrap"><span class="badge neutral" style="font-size:10px">vehicle_type: ${e(tAttrs.vehicle_type?.value || "rescue_van")}</span>${tAttrs.heavy_debris_gear?.value ? '<span class="badge" style="font-size:10px">heavy_debris_gear: true</span>' : '<span class="badge neutral" style="font-size:10px">heavy_debris_gear: false</span>'}</div></td><td><button class="btn ghost small" data-edit-team="${team.id}">${locked ? "View / Locked" : "Edit Status & Tags"}</button></td></tr>`; }).join("")}</tbody></table></div></section>`;
  }

  function renderConfiguration() {
    const shared = Store.load();
    if (!ui.settingsDraft) ui.settingsDraft = JSON.parse(JSON.stringify(shared.settings));
    if (!ui.settingsDraft.ruleEngine) ui.settingsDraft.ruleEngine = JSON.parse(JSON.stringify(Store.ruleEngineConfig(shared)));
    const cfg = ui.settingsDraft;
    const ruleEngine = cfg.ruleEngine;
    const tagSchema = Store.customTagSchema ? Store.customTagSchema(shared) : (Demo.CUSTOM_TAG_SCHEMA || []);
    const validationCheck = Store.validateRuleEngineConfig ? Store.validateRuleEngineConfig(ruleEngine, tagSchema) : { valid: true, issues: [], conflicts: [] };
    const meta = Store.regionMeta(shared);
    const baseProvinces = ["Vietnam", "Ho Chi Minh City", "Ha Noi", "Da Nang", "Can Tho", "Khanh Hoa", "Lam Dong", "Quang Nam"];
    const provinces = [...new Set([...baseProvinces, meta.operatingArea, cfg.operatingArea].filter(Boolean))];
    const hasBuiltinProfile = Boolean(Demo.REGION_PROFILES && Demo.REGION_PROFILES[cfg.operatingArea]);
    const isMatchedDataset = meta.operatingArea === cfg.operatingArea;
    const selectedProfile = (Demo.REGION_PROFILES && Demo.REGION_PROFILES[cfg.operatingArea]) || meta;
    const activeCountry = meta.country || "Vietnam";
    const selectedCountry = selectedProfile?.country || activeCountry;
    const minLatVal = Number(meta.coverageBounds?.minLat ?? 10.60);
    const maxLatVal = Number(meta.coverageBounds?.maxLat ?? 10.98);
    const minLngVal = Number(meta.coverageBounds?.minLng ?? 106.55);
    const maxLngVal = Number(meta.coverageBounds?.maxLng ?? 106.90);
    const latHem = maxLatVal >= 0 ? "N" : "S";
    const lngHem = maxLngVal >= 0 ? "E" : "W";
    const toggle = (path, checked, label, simulation = false) => `<div class="setting-row"><div><strong>${e(label)}</strong>${simulation ? '<div class="muted">Simulation only · no external service connected</div>' : ""}</div><label class="switch"><input type="checkbox" data-setting="${path}" ${checked ? "checked" : ""}><span></span></label></div>`;
    const severeCount = shared.incidents.filter((incident) => {
      const type = Store.effectiveType(incident);
      return cfg.alertThresholds[type] != null && incident.severityScore >= cfg.alertThresholds[type] && incident.status !== "Resolved";
    }).length;
    const hardRules = (ruleEngine.rules || []).filter((r) => r.category === "Hard");
    const softRules = (ruleEngine.rules || []).filter((r) => r.category === "Soft");
    const incidentTypes = ["Fire", "Flood", "Building Collapse", "Traffic Accident"];

    return pageHead("System Configuration", "Configuration · Tag Catalog & Context Scoring Weights", "Manage global regional datasets, geographic timezones, the seeded tag catalog, and context-aware zero-weight overrides.") +
      `<div class="grid grid-2">
        <section class="card">
          <div class="card-header">
            <div>
              <h2>Operating Area & Global Regional Dataset</h2>
              <p class="muted">Switch built-in multi-country regional datasets (Vietnam / United States) or import any custom JSON dataset.</p>
            </div>

            <div class="row" style="gap:6px">
              <span class="badge info">🌐 ${e(activeCountry)}</span>
              <span class="badge ${isMatchedDataset ? "success" : "warning"}">${e(meta.operatingArea)} Active</span>
            </div>

          </div>

          <label class="field">
            <span>Operating Command Zone (State / Province / Metro)</span>
            <select id="operating-area">${provinces.map((province) => {
              const pCountry = Demo.REGION_PROFILES?.[province]?.country || (province === meta.operatingArea ? activeCountry : "Vietnam");
              const pTz = Demo.REGION_PROFILES?.[province]?.tzShort || (pCountry === "United States" ? "PDT (UTC-07:00)" : "ICT (UTC+07:00)");
              return `<option value="${e(province)}" ${province === cfg.operatingArea ? "selected" : ""}>${e(province)} · [${e(pCountry)} · ${e(pTz)}]</option>`;
            }).join("")}</select>
          </label>
          <div class="alert ${isMatchedDataset ? "success" : hasBuiltinProfile ? "" : "warning"}" style="margin-top:12px">
            <span>${isMatchedDataset ? "✓" : "⚡"}</span>
            <div>
              ${isMatchedDataset
                ? `<strong>Active Dataset (${e(meta.operatingArea)} · ${e(activeCountry)}):</strong> ${shared.incidents.length} incidents · ${shared.teams.length} rescue teams · ${meta.sectors.length} administrative sectors.`
                : hasBuiltinProfile
                  ? `Selected <strong>${e(cfg.operatingArea)} (${e(selectedCountry)})</strong>. Click <strong>"⚡ Load Regional Dataset (${e(cfg.operatingArea)})"</strong> below to switch the tactical map, incidents, and rescue teams to this jurisdiction.`
                  : `No built-in ${e(cfg.operatingArea)} demo dataset is pre-packaged. Click <strong>Import JSON Dataset</strong> to upload a custom JSON dataset file for this region.`}
            </div>

          </div>

          <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px">
            ${hasBuiltinProfile ? `<button class="btn secondary small" data-action="load-region-dataset">⚡ Load Regional Dataset (${e(cfg.operatingArea)})</button>` : ""}
            <label class="btn ghost small" style="cursor:pointer;margin:0">
              📥 Import JSON Dataset (.json)
              <input type="file" id="import-dataset-file" accept=".json,application/json" style="display:none">
            </label>
            <button class="btn ghost small" data-action="export-dataset-json">📤 Export Dataset JSON</button>
          </div>

          <div class="surface" style="margin-top:12px;font-size:12px">
            <div class="row-between">
              <span class="muted">Country / Sovereign Tier (Tier 0):</span>
              <strong>🌐 ${e(activeCountry)} <span class="badge neutral mono">${e(meta.regionId || "GLOBAL-NODE")}</span></strong>
            </div>

            <div class="row-between" style="margin-top:4px">
              <span class="muted">Jurisdiction Boundary (Tier 2):</span>
              <strong>${e(meta.operatingArea)} · <span class="muted">Metro Command Zone (${meta.sectors.length} Sub-Sectors)</span></strong>
            </div>

            <div class="row-between" style="margin-top:4px">
              <span class="muted">Map Center & Regional Clock:</span>
              <strong class="mono">[${Number(meta.center?.[0] ?? 16.0544).toFixed(4)}, ${Number(meta.center?.[1] ?? 108.2022).toFixed(4)}] · Zoom ${meta.defaultZoom || 12} · ${e(meta.tzShort || "ICT")}</strong>
            </div>

            <div class="row-between" style="margin-top:4px">
              <span class="muted">Coverage Bounds:</span>
              <strong class="mono">[${Math.abs(minLatVal).toFixed(2)}..${Math.abs(maxLatVal).toFixed(2)} ${latHem}, ${Math.abs(minLngVal).toFixed(2)}..${Math.abs(maxLngVal).toFixed(2)} ${lngHem}]</strong>
            </div>

          </div>

        </section>
        <section class="card"><div class="card-header"><div><h2>Alert Preview</h2><p class="muted">Recomputed from Severity Score and the staged thresholds.</p></div><span class="badge ${severeCount ? "danger" : "success"}" id="severe-count">${severeCount} severe active</span></div><div class="surface"><span class="eyebrow">Report overload limit</span><div class="row-between"><strong id="limit-value" style="font-size:28px">${cfg.reportOverloadLimit}</strong><span class="muted">reports / sector / week</span></div><input type="range" min="10" max="200" step="5" value="${cfg.reportOverloadLimit}" id="overload-limit"></div>
        <div class="surface" style="margin-top:12px">
          <div class="row-between" style="margin-bottom:8px">
            <div>
              <span class="eyebrow">Administrative Sectors / Districts (${meta.sectors.length} Sectors)</span>
              <div class="muted" style="font-size:11px">Extracted from active dataset & used across C2/C9 filters and UAV GPS auto-tracking (R1–R3)</div>
            </div>

            <button class="btn ghost small" data-action="add-sector-modal">+ Add Sector</button>
          </div>

          <div class="row" style="flex-wrap:wrap;gap:6px">
            ${meta.sectors.map((s) => { const sLat = Number(s.lat ?? s.latitude ?? meta.center[0]); const sLng = Number(s.lng ?? s.longitude ?? meta.center[1]); return `<span class="badge neutral" title="GPS: ${sLat.toFixed(4)}, ${sLng.toFixed(4)}">${e(s.name)} <span class="mono" style="font-size:10px;opacity:0.75">(${sLat.toFixed(2)},${sLng.toFixed(2)})</span></span>`; }).join("")}
          </div>

        </div>

        </section>
      </div>

      <!-- SEEDED CONTROLLED TAG CATALOG -->
      <section class="card" style="margin-top:16px">
        <div class="card-header">
          <div>
            <p class="eyebrow">Seeded Controlled Tag Catalog</p>
            <h2>Typed Operational Attributes (${tagSchema.length} Tags)</h2>
            <p class="muted">Tags are seeded with the dataset and are read-only in this demo. Each tag declares a data type, provider source and target entity. Rules compare typed tag values by equality; there is no tag coefficient or step-based normalization.</p>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="min-width:140px">Tag Key</th>
                <th style="min-width:180px">Label &amp; Description</th>
                <th style="min-width:150px">Data Type &amp; Allowed Values</th>
                <th>Provider Source</th>
                <th>Target Entity</th>
                <th>AI Model Output?</th>
              </tr>
            </thead>
            <tbody>
              ${tagSchema.map((tag) => {
                const allowed = tag.dataType === "Enum"
                  ? `[${(tag.enumValues || []).join(", ")}]`
                  : tag.dataType === "Number"
                    ? `${tag.min ?? 0}..${tag.max ?? 100}${tag.unit ? ` ${tag.unit}` : ""}`
                    : "true | false";
                return `<tr>
                  <td><strong class="mono" style="color:var(--navy)">${e(tag.key)}</strong></td>
                  <td><strong>${e(tag.label)}</strong><div class="muted" style="font-size:11px">${e(tag.description || "")}</div></td>
                  <td>
                    <span class="badge neutral">${e(tag.dataType)}</span>
                    <div class="mono muted" style="font-size:10px;margin-top:2px">${e(allowed)}</div>
                  </td>
                  <td><span class="badge ${tag.aiOutput ? "warning" : "success"}">${e(tag.source)}</span></td>
                  <td><span class="badge">${e(tag.targetEntity)}</span></td>
                  <td>${tag.aiOutput ? '<span class="badge warning">Yes (Tier 2 AI)</span>' : '<span class="badge neutral">No (External / Human)</span>'}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>

      </section>

      <!-- CONFIGURABLE RULE ENGINE (HARD CONSTRAINTS & SOFT CONSTRAINTS) -->
      <section class="card" style="margin-top:16px">
        <div class="card-header">
          <div>
            <p class="eyebrow">Post-Ranking Rescue Team Selection Rules</p>
            <h2>Configurable Rule Engine — Hard & Soft Constraints</h2>
            <p class="muted">Applied during Rescue Team Matching without modifying the core Tier 3 AHP/TOPSIS incident ranking algorithm.</p>
          </div>

          <div class="row" style="gap:8px">
            <span class="badge ${validationCheck.valid ? "success" : "danger"}">${validationCheck.valid ? "✓ Schema & Conflict Check Passed" : "⚠️ Rule Conflict Detected"}</span>
            <span class="badge neutral mono">Version: ${e(ruleEngine.version)}</span>
            <button class="btn secondary small" data-action="add-custom-rule-modal">+ Add Configurable Rule</button>
          </div>

        </div>


        <div class="grid grid-3" style="margin-bottom:14px">
          <label class="field">
            <span>Rule Configuration Version</span>
            <input id="rule-engine-version" value="${e(ruleEngine.version)}">
          </label>
          <label class="field">
            <span>Missing-Attribute Policy (Handling Null/Missing Tags)</span>
            <select id="rule-missing-policy">
              <option value="soft_warning" ${ruleEngine.missingDataPolicy === "soft_warning" ? "selected" : ""}>Soft Warning — Convert missing Hard Gate to caution flag (Recommended)</option>
              <option value="strict_block" ${ruleEngine.missingDataPolicy === "strict_block" ? "selected" : ""}>Strict Block — Disqualify team when required tag is missing</option>
              <option value="ignore" ${ruleEngine.missingDataPolicy === "ignore" ? "selected" : ""}>Ignore — Skip rules with missing attributes</option>
            </select>
          </label>
          <label class="field">
            <span>Conflict Resolution Policy</span>
            <select id="rule-conflict-policy">
              <option value="hard_overrides_soft" ${ruleEngine.conflictPolicy === "hard_overrides_soft" ? "selected" : ""}>Hard Constraints always override Soft Constraints</option>
            </select>
          </label>
        </div>


        ${(!validationCheck.valid) ? `<div class="alert danger" style="margin-bottom:14px"><span>!</span><div><strong>Configuration Validation Alert:</strong> ${e([...validationCheck.issues, ...validationCheck.conflicts].join(" · "))}</div></div>` : ""}

        <div class="grid grid-2">
          <div class="surface" style="background:#fff">
            <div class="row-between" style="margin-bottom:10px">
              <div>
                <span class="eyebrow" style="color:var(--red)">Hard Constraints (Mandatory Eligibility Gates)</span>
                <div class="muted" style="font-size:11px">Teams failing any active Hard Constraint are filtered out of automatic proposal.</div>
              </div>

              <span class="badge danger">${hardRules.filter((r) => r.enabled).length}/${hardRules.length} active</span>
            </div>

            <div class="stack">
              ${hardRules.map((rule) => `
                <div class="setting-row" style="align-items:flex-start;padding:10px;border:1px solid var(--line);border-radius:10px">
                  <div style="flex:1;padding-right:10px">
                    <div class="row" style="gap:6px"><span class="badge danger" style="font-size:10px">${e(rule.id)}</span><strong>${e(rule.name)}</strong></div>
                    <div class="mono muted" style="font-size:11px;margin-top:4px">${e(rule.conditionSummary)}</div>
                    <div class="muted" style="font-size:11px;margin-top:2px">Tags: ${(rule.requiredTags || []).map((t) => `<code style="background:#eef3fa;padding:1px 4px;border-radius:4px">${e(t)}</code>`).join(" ")}</div>
                  </div>

                  <label class="switch"><input type="checkbox" data-rule-toggle="${e(rule.id)}" ${rule.enabled ? "checked" : ""}><span></span></label>
                </div>

              `).join("")}
            </div>

          </div>


          <div class="surface" style="background:#fff">
            <div class="row-between" style="margin-bottom:10px">
              <div>
                <span class="eyebrow" style="color:var(--green)">Soft Constraints (Base Scoring Modifiers +/- Pts)</span>
                <div class="muted" style="font-size:11px">Adjusts Match Score among eligible teams that passed all Hard Constraints.</div>
              </div>

              <span class="badge success">${softRules.filter((r) => r.enabled).length}/${softRules.length} active</span>
            </div>

            <div class="stack">
              ${softRules.map((rule) => `
                <div class="setting-row" style="align-items:flex-start;padding:10px;border:1px solid var(--line);border-radius:10px">
                  <div style="flex:1;padding-right:10px">
                    <div class="row-between">
                      <div class="row" style="gap:6px"><span class="badge ${rule.weightDelta >= 0 ? "success" : "warning"}" style="font-size:10px">${e(rule.id)}</span><strong>${e(rule.name)}</strong></div>
                      <span class="mono" id="rule-weight-val-${e(rule.id)}" style="font-weight:700;color:${rule.weightDelta >= 0 ? "var(--green)" : "var(--amber)"}">${rule.weightDelta >= 0 ? `+${rule.weightDelta}` : rule.weightDelta} pts</span>
                    </div>

                    <div class="mono muted" style="font-size:11px;margin-top:4px">${e(rule.conditionSummary)}</div>
                    <div style="margin-top:6px;display:flex;align-items:center;gap:8px">
                      <span class="muted" style="font-size:11px">Base Weight:</span>
                      <input type="range" min="-15" max="25" step="1" value="${rule.weightDelta}" data-rule-weight="${e(rule.id)}" style="flex:1">
                    </div>

                  </div>

                  <label class="switch"><input type="checkbox" data-rule-toggle="${e(rule.id)}" ${rule.enabled ? "checked" : ""}><span></span></label>
                </div>

              `).join("")}
            </div>

          </div>

        </div>


        <!-- CONTEXT-AWARE SCORING WEIGHTS & CONDITIONAL ZERO-WEIGHT MATRIX -->
        <div class="surface" style="background:#fff;margin-top:16px;border:1px solid var(--line);border-radius:12px;padding:16px">
          <div class="row-between" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div>
              <span class="eyebrow" style="color:var(--blue)">Context-Aware Scoring Weights & Conditional Zero-Weight Matrix</span>
              <h3 style="margin:4px 0 0;font-size:16px">Incident Type Scoring Matrix (Context Overrides)</h3>
              <p class="muted" style="margin:4px 0 0;font-size:12px">Define tailored scoring points per incident type. Equipment/tags incompatible with an incident are automatically or manually set to <strong>0 pts (Context Overridden)</strong> to prevent invalid bonus scoring.</p>
            </div>

            <button class="btn secondary small" data-action="reset-context-matrix">🔄 Reset to Recommended Context Matrix</button>
          </div>

          <div class="table-wrap">
            <table class="context-matrix-table" style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#f8fafc;border-bottom:2px solid var(--line)">
                  <th style="padding:10px;text-align:left;min-width:180px">Soft Rule / Capability</th>
                  <th style="padding:10px;text-align:center;min-width:90px">Base Weight</th>
                  <th style="padding:10px;text-align:center;min-width:100px">🔥 Fire</th>
                  <th style="padding:10px;text-align:center;min-width:100px">🌊 Flood</th>
                  <th style="padding:10px;text-align:center;min-width:120px">🏚️ Building Collapse</th>
                  <th style="padding:10px;text-align:center;min-width:110px">🚗 Traffic Accident</th>
                  <th style="padding:10px;text-align:left;min-width:200px">Context Rule Logic</th>
                </tr>
              </thead>
              <tbody>
                ${softRules.map((r) => {
                  const cw = r.contextWeights || {};
                  return `
                    <tr style="border-bottom:1px solid var(--line)">
                      <td style="padding:8px 10px">
                        <div class="row" style="gap:6px">
                          <span class="badge ${r.weightDelta >= 0 ? "success" : "warning"}" style="font-size:10px">${e(r.id)}</span>
                          <strong>${e(r.name)}</strong>
                        </div>

                        <div class="muted" style="font-size:11px;margin-top:2px">${e(r.conditionSummary)}</div>
                      </td>
                      <td style="padding:8px 10px;text-align:center">
                        <span class="mono" style="font-weight:700;color:${r.weightDelta >= 0 ? "var(--green)" : "var(--amber)"}">
                          ${r.weightDelta >= 0 ? `+${r.weightDelta}` : r.weightDelta} pts
                        </span>
                      </td>
                      ${incidentTypes.map((t) => {
                        const val = typeof cw[t] === "number" ? cw[t] : (r.weightDelta || 0);
                        const isZero = val === 0;
                        return `
                          <td style="padding:8px 10px;text-align:center">
                            <div style="display:inline-flex;flex-direction:column;align-items:center;gap:3px">
                              <input type="number" class="context-weight-input mono"
                                     min="-15" max="25" step="1"
                                     value="${val}"
                                     data-rule-id="${e(r.id)}"
                                     data-incident-type="${e(t)}"
                                     style="width:58px;text-align:center;padding:4px;font-size:12px;font-weight:700;border-radius:6px;border:1px solid ${isZero ? "#cbd5e1" : "var(--blue)"};background:${isZero ? "#f8fafc" : "#eff6ff"}">
                              <span class="badge ${isZero ? "neutral" : "info"}" style="font-size:9px;padding:1px 5px;cursor:pointer;user-select:none" data-toggle-zero="${e(r.id)}" data-type="${e(t)}">
                                ${isZero ? "ZERO (0 pts)" : "ACTIVE"}
                              </span>
                            </div>

                          </td>
                        `;
                      }).join("")}
                      <td style="padding:8px 10px;font-size:11px">
                        ${r.id === "SC-04" ? '<span class="badge neutral">Active for Collapse & Accident; <strong>Zero for Flood/Fire</strong></span>' :
                          r.id === "SC-01" ? '<span class="badge neutral">Active for Fire/Collapse/Flood; <strong>Zero for Traffic</strong></span>' :
                          '<span class="badge neutral">Standard Context Enabled</span>'}
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>

          <div class="alert info" style="margin-top:12px;font-size:12px">
            <span>ℹ️</span>
            <div>
              <strong>Rule Scoring Integration:</strong>
              <code class="mono" style="color:var(--navy);font-weight:700">Total Match Score = Base Score + Σ (ContextWeight for each matched rule)</code>.
              The engine adds the flat context weight when a rule predicate matches. When <code>ContextWeight = 0</code>, the capability is deactivated for that incident type.
            </div>

          </div>

        </div>

      </section>

      <div class="grid grid-2" style="margin-top:16px"><section class="card"><h2>Escalation Rules</h2>${toggle("defcon1Alert", cfg.defcon1Alert, "DEFCON 1 alert (>15 simultaneous severe incidents)")}${toggle("autoPushSevere", cfg.autoPushSevere, "Auto-push severe incidents to Priority Queue")}</section><section class="card"><h2>Notification Channels</h2>${toggle("notificationChannels.siren", cfg.notificationChannels.siren, "Command center siren", true)}${toggle("notificationChannels.browserPush", cfg.notificationChannels.browserPush, "Browser push notifications", true)}${toggle("notificationChannels.commanderSms", cfg.notificationChannels.commanderSms, "Commander SMS alert", true)}${toggle("notificationChannels.emergencyRadio", cfg.notificationChannels.emergencyRadio, "Emergency radio (VHF/UHF)", true)}</section></div>
      <section class="card" style="margin-top:16px"><div class="card-header"><div><h2>Severity Threshold by Incident Type</h2><p class="muted">Minimum Severity Score for Level 1 alert. No new scoring formula is applied.</p></div></div><div class="grid grid-2">${Object.entries(cfg.alertThresholds).map(([type, value]) => `<div class="surface"><div class="row-between"><strong>${UI.typeLabel(type)}</strong><span>≥ <strong id="threshold-${type.replaceAll(" ", "-")}">${value}</strong></span></div><input type="range" min="0" max="100" value="${value}" data-threshold="${e(type)}"></div>`).join("")}</div></section>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" data-action="cancel-settings">Cancel</button><button class="btn" data-action="save-settings">Save Configuration</button></div>`;
  }

  function filteredReportIncidents(shared) {
    const f = ui.reportFilters;
    const cutoff = f.range === "7 days" ? Date.now() - 7 * 86400000 : f.range === "30 days" ? Date.now() - 30 * 86400000 : 0;
    return shared.incidents.filter((incident) => {
      const mission = Store.missionForIncident(shared, incident.id);
      return (!cutoff || new Date(incident.createdAt).getTime() >= cutoff)
        && (f.type === "All" || Store.effectiveType(incident) === f.type)
        && (!f.district || f.district === "All" || incident.location.district === f.district)
        && (f.status === "All" || incident.status === f.status)
        && (f.team === "All" || mission?.teamId === f.team || incident.assignedTeamId === f.team);
    });
  }

  function reportKpis(shared, incidents) {
    const ids = new Set(incidents.map((item) => item.id));
    const completed = (shared.dispatchOrders || []).filter((order) => order.status === "Completed" && ids.has(order.incidentId));
    const durations = completed
      .filter((order) => (order.confirmedAt || order.createdAt) && order.completedAt)
      .map((order) => (new Date(order.completedAt) - new Date(order.confirmedAt || order.createdAt)) / 60000);
    const average = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null;
    const byTeam = {};
    completed.forEach((order) => { byTeam[order.teamId] = (byTeam[order.teamId] || 0) + 1; });
    const leading = Object.entries(byTeam).sort((a,b) => b[1] - a[1])[0];
    return { completed, average, leading };
  }

  function renderC9Charts(shared, incidents, kpi, corrected) {
    const total = incidents.length || 1;
    const avgSevTotal = incidents.length
      ? incidents.reduce((sum, inc) => sum + inc.severityScore, 0) / incidents.length
      : 0;

    // 1. Donut Chart & Incident Type Breakdown
    const radius = 64;
    const circumference = 2 * Math.PI * radius;
    let accumLength = 0;
    const typeStats = Demo.TYPES.map((type) => {
      const list = incidents.filter((inc) => Store.effectiveType(inc) === type);
      const count = list.length;
      const pct = incidents.length ? (count / incidents.length) * 100 : 0;
      const people = list.reduce((sum, inc) => sum + inc.detectedPeopleCount, 0);
      const avgSev = count ? list.reduce((sum, inc) => sum + inc.severityScore, 0) / count : 0;
      const segLen = (pct / 100) * circumference;
      const dashOffset = -accumLength;
      accumLength += segLen;
      return { type, count, pct, people, avgSev, segLen, dashOffset, color: COLORS[type] || "#748197" };
    });

    const donutCircles = incidents.length
      ? typeStats.filter((item) => item.count > 0).map((item) => `
          <circle cx="87.5" cy="87.5" r="${radius}" fill="none" stroke="${item.color}" stroke-width="22"
            stroke-dasharray="${item.segLen.toFixed(2)} ${(circumference - item.segLen).toFixed(2)}"
            stroke-dashoffset="${item.dashOffset.toFixed(2)}" transform="rotate(-90 87.5 87.5)">
            <title>${e(item.type)}: ${item.count} case(s) (${item.pct.toFixed(1)}%)</title>
          </circle>
        `).join("")
      : `<circle cx="87.5" cy="87.5" r="${radius}" fill="none" stroke="#e2eaf4" stroke-width="22"/>`;

    // 2. Sector / District Hotspot Stacked Bar Chart
    const districtNames = [...new Set(incidents.map((inc) => inc.location.district))];
    const districtStats = districtNames.map((district) => {
      const list = incidents.filter((inc) => inc.location.district === district);
      const resolvedCount = list.filter((inc) => inc.status === "Resolved").length;
      const activeOpsCount = list.filter((inc) => inc.status === "In Progress").length;
      const pendingCount = list.length - resolvedCount - activeOpsCount;
      const victims = list.reduce((sum, inc) => sum + inc.detectedPeopleCount, 0);
      const avgSev = list.length ? list.reduce((sum, inc) => sum + inc.severityScore, 0) / list.length : 0;
      const districtTeams = shared.teams.filter((t) => t.area === district);
      const freeTeams = districtTeams.filter((t) => t.status === "Available" && !Store.activeAssignmentForTeam(shared, t.id)).length;
      return { district, count: list.length, resolvedCount, activeOpsCount, pendingCount, victims, avgSev, totalTeams: districtTeams.length, freeTeams };
    }).sort((a, b) => b.count - a.count || b.victims - a.victims);

    const maxDistrictCount = Math.max(1, ...districtStats.map((d) => d.count));

    // 3. Rescue Team Workload & SLA Response Time Chart
    const incidentIds = new Set(incidents.map((inc) => inc.id));
    const teamStats = shared.teams.map((team) => {
      const missions = (shared.dispatchOrders || []).filter((m) => m.teamId === team.id && incidentIds.has(m.incidentId));
      const completedMissions = missions.filter((m) => m.status === "Completed");
      const activeMissions = missions.filter((m) => m.status === "Confirmed");
      const durs = completedMissions
        .filter((m) => (m.confirmedAt || m.createdAt) && m.completedAt)
        .map((m) => (new Date(m.completedAt) - new Date(m.confirmedAt || m.createdAt)) / 60000);
      const avgMin = durs.length ? durs.reduce((s, v) => s + v, 0) / durs.length : null;
      return {
        team,
        completedCount: completedMissions.length,
        activeCount: activeMissions.length,
        totalMissions: completedMissions.length + activeMissions.length,
        avgMin
      };
    }).sort((a, b) => b.totalMissions - a.totalMissions || b.completedCount - a.completedCount);

    const maxTeamCompleted = Math.max(4, ...teamStats.map((t) => t.completedCount));

    // 4. SAR Lifecycle Funnel & AI Domain-Shift Audit
    const totalDetectedPeople = incidents.reduce((sum, inc) => sum + inc.detectedPeopleCount, 0);
    const verifiedIncidents = incidents.filter((inc) => Boolean(inc.reviewedType)).length;
    const dispatchedIncidents = incidents.filter((inc) => Boolean(inc.dispatchId || inc.assignedTeamId || Store.missionForIncident(shared, inc.id))).length;
    const resolvedIncidents = incidents.filter((inc) => inc.status === "Resolved").length;

    const verifiedMatchCount = incidents.filter((inc) => inc.reviewedType && inc.reviewedType === inc.originalType).length;
    const correctedCount = corrected.length;
    const unverifiedCount = Math.max(0, incidents.length - verifiedMatchCount - correctedCount);
    const matchPct = incidents.length ? (verifiedMatchCount / incidents.length) * 100 : 0;
    const correctedPct = incidents.length ? (correctedCount / incidents.length) * 100 : 0;
    const unverifiedPct = Math.max(0, 100 - matchPct - correctedPct);

    const funnelSteps = [
      { label: "1. UAV Intake & 3-Tier AI Inference", count: incidents.length, sub: `${totalDetectedPeople} victims detected`, pct: incidents.length ? 100 : 0, color: "#225c98" },
      { label: "2. Coordinator Verification", count: verifiedIncidents, sub: `${correctedCount} AI label correction(s)`, pct: Math.round((verifiedIncidents / total) * 100), color: "#2f79bd" },
      { label: "3. Force Dispatch & Field Operation", count: dispatchedIncidents, sub: `${kpi.completed.length} field mission(s) completed`, pct: Math.round((dispatchedIncidents / total) * 100), color: "#d99620" },
      { label: "4. Coordinator Finalized & Dossier Closed", count: resolvedIncidents, sub: `${resolvedIncidents} resolved`, pct: Math.round((resolvedIncidents / total) * 100), color: "#1f9d6b" }
    ];

    const maxPeopleByType = Math.max(1, ...typeStats.map((item) => item.people));

    return `<div class="c9-charts-grid">
      <!-- CHART 1: DONUT INCIDENT TAXONOMY -->
      <section class="card">
        <div class="card-header">
          <div>
            <p class="eyebrow">Chart 01 · Incident Taxonomy & Severity</p>
            <h2>Incident Type & Victim Distribution</h2>
            </div>

          <span class="badge neutral">${incidents.length} incidents</span>
        </div>

        <div class="donut-layout">
          <div class="donut-svg-wrap">
            <svg viewBox="0 0 175 175" width="175" height="175" aria-label="Incident type donut chart">
              <circle cx="87.5" cy="87.5" r="${radius}" fill="none" stroke="#eef3fa" stroke-width="22"/>
              ${donutCircles}
            </svg>
            <div class="donut-center">
              <strong>${incidents.length}</strong>
              <span>Avg Sev: ${avgSevTotal.toFixed(1)}</span>
            </div>

          </div>

          <div class="chart-legend">
            ${typeStats.map((item) => `
              <div class="legend-row">
                <div class="legend-label" title="${e(item.type)}">
                  <span class="legend-dot" style="background:${item.color}"></span>
                  <span>${UI.typeLabel(item.type)}</span>
                </div>

                <div class="mono" style="font-size:11px;text-align:right;min-width:72px">
                  <strong>${item.count}</strong> (${item.pct.toFixed(0)}%)
                </div>

              </div>

            `).join("")}
          </div>

        </div>

        <div class="victim-bar-section">
          <div class="row-between" style="margin-bottom:8px">
            <span class="eyebrow" style="margin:0">Victims by Incident Type</span>
            <span class="mono muted" style="font-size:11px">Total: <strong>${totalDetectedPeople}</strong> victims</span>
          </div>
          <div class="victim-bar-list">
            ${typeStats.map((item) => {
              const barW = item.people > 0 ? Math.max(6, (item.people / maxPeopleByType) * 100) : 0;
              return `<div class="victim-bar-row">
                <div class="victim-bar-label" title="${e(item.type)}">
                  <span class="legend-dot" style="background:${item.color}"></span>
                  <span>${UI.typeLabel(item.type)}</span>
                </div>
                <div class="victim-bar-track">
                  <div class="victim-bar-fill" style="width:${barW.toFixed(1)}%;background:${item.color}"></div>
                </div>
                <div class="mono victim-bar-val"><strong>${item.people}</strong> victims</div>
              </div>`;
            }).join("")}
          </div>
        </div>

      </section>

      <!-- CHART 2: SECTOR HOTSPOTS -->
      <section class="card">
        <div class="card-header">
          <div>
            <p class="eyebrow">Chart 02 · Regional Sector Hotspots</p>
            <h2>Sector Hotspots & Force Readiness</h2>
            </div>

          <span class="badge">${districtStats.length} sectors</span>
        </div>

        <div class="hotspot-list">
          ${districtStats.map((d) => {
            const resW = (d.resolvedCount / maxDistrictCount) * 100;
            const actW = (d.activeOpsCount / maxDistrictCount) * 100;
            const penW = (d.pendingCount / maxDistrictCount) * 100;
            return `<div class="hotspot-item">
              <div class="row-between" style="font-size:12px">
                <div>
                  <strong>${e(d.district)}</strong>
                  <span class="muted"> · ${d.victims} victims · Avg Sev ${d.avgSev.toFixed(1)}</span>
                </div>

                <div class="row" style="gap:6px">
                  <strong class="mono">${d.count} cases</strong>
                </div>

              </div>

              <div class="stacked-bar" title="Resolved: ${d.resolvedCount} · Active Ops: ${d.activeOpsCount} · Pending: ${d.pendingCount}">
                <div class="stacked-seg" style="width:${resW.toFixed(1)}%;background:#1f9d6b"></div>
                <div class="stacked-seg" style="width:${actW.toFixed(1)}%;background:#2f79bd"></div>
                <div class="stacked-seg" style="width:${penW.toFixed(1)}%;background:#d99620"></div>
              </div>

            </div>
`;
          }).join("") || '<div class="muted">No sector data matches the current filter.</div>'}
        </div>

        <div class="chart-key">
          <span><i class="legend-dot" style="background:#1f9d6b"></i> Resolved</span>
          <span><i class="legend-dot" style="background:#2f79bd"></i> Dispatched / Active Ops</span>
          <span><i class="legend-dot" style="background:#d99620"></i> Pending Review / Matching</span>
        </div>

      </section>

      <!-- CHART 3: TEAM PERFORMANCE & SLA -->
      <section class="card">
        <div class="card-header">
          <div>
            <p class="eyebrow">Chart 03 · Rescue Force Utilization & SLA</p>
            <h2>Rescue Team Performance & Response Time</h2>
            </div>

          </div>

        <div class="team-chart-list">
          ${teamStats.map((item) => {
            const completedPct = Math.min(100, (item.completedCount / maxTeamCompleted) * 100);
            const slaPct = item.avgMin != null ? Math.min(100, (item.avgMin / 110) * 100) : 0;
            const slaColor = item.avgMin == null ? "#95a3b8" : item.avgMin <= 75 ? "#1f9d6b" : item.avgMin <= 90 ? "#2f79bd" : "#d99620";
            return `<div class="team-chart-row">
              <div>
                <strong class="mono">${e(item.team.id)}</strong>
                <div class="muted" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${e(item.team.area)}">${e(item.team.area)}</div>
              </div>

              <div class="dual-bars">
                <div class="bar-line">
                  <span style="min-width:68px;color:var(--muted)">Completed (${item.completedCount})</span>
                  <div class="bar-line-track"><div class="mini-fill" style="width:${completedPct.toFixed(1)}%;background:#1f9d6b"></div></div>
                </div>

                <div class="bar-line">
                  <span style="min-width:68px;color:var(--muted)">Avg Time (${item.avgMin != null ? `${item.avgMin.toFixed(0)}m` : "—"})</span>
                  <div class="bar-line-track"><div class="mini-fill" style="width:${slaPct.toFixed(1)}%;background:${slaColor}"></div></div>
                </div>

              </div>

              <div style="text-align:right;font-size:11px">
                <strong>${item.completedCount} done</strong>${item.activeCount ? ` · <span style="color:var(--blue)">${item.activeCount} active</span>` : ""}
                <div class="muted">${e(statusForTeam(shared, item.team))}</div>
              </div>

            </div>
`;
          }).join("")}
        </div>

      </section>

      <!-- CHART 4: OPERATIONAL FUNNEL & AI AUDIT -->
      <section class="card">
        <div class="card-header">
          <div>
            <p class="eyebrow">Chart 04 · Operational Funnel & AI Audit</p>
            <h2>SAR Lifecycle Funnel & AI Accuracy Audit</h2>
            </div>

          <span class="badge ${correctedCount > 0 ? "warning" : "success"}">${correctedCount} Retrain Case(s)</span>
        </div>

        <div class="funnel-list">
          ${funnelSteps.map((step) => `
            <div class="funnel-row">
              <div class="row-between" style="font-size:12px">
                <strong>${e(step.label)}</strong>
                <span class="mono"><strong>${step.count}</strong> cases (${step.pct}%) · <span class="muted">${e(step.sub)}</span></span>
              </div>

              <div class="funnel-bar">
                <div class="mini-fill" style="width:${step.pct}%;background:${step.color}"></div>
              </div>

            </div>

          `).join("")}
        </div>

        <div class="surface" style="margin-top:12px">
          <div class="row-between" style="font-size:12px">
            <strong>Tier 1 AI Classification vs Coordinator Review (Domain Shift Monitor)</strong>
            <span class="mono">${matchPct.toFixed(0)}% AI Match</span>
          </div>

          <div class="stacked-bar" style="height:10px;margin:8px 0">
            <div class="stacked-seg" style="width:${matchPct.toFixed(1)}%;background:#1f9d6b" title="Matched AI classification: ${verifiedMatchCount} cases"></div>
            <div class="stacked-seg" style="width:${correctedPct.toFixed(1)}%;background:#d8352a" title="Coordinator corrected AI type: ${correctedCount} cases"></div>
            <div class="stacked-seg" style="width:${unverifiedPct.toFixed(1)}%;background:#95a3b8" title="Unverified: ${unverifiedCount} cases"></div>
          </div>

          <div class="row-between muted" style="font-size:11px">
            <span>✓ AI Match: <strong>${verifiedMatchCount}</strong> (${matchPct.toFixed(0)}%)</span>
            <span>⚠️ Corrected (Retrain): <strong>${correctedCount}</strong> (${correctedPct.toFixed(0)}%)</span>
            <span>◌ Unverified: <strong>${unverifiedCount}</strong> (${unverifiedPct.toFixed(0)}%)</span>
          </div>

        </div>

      </section>
    </div>`;
  }

  function renderQueueReviewInbox(shared) {
    const isVi = UI.getPreferences?.().language === "vi";
    const now = Date.now();
    const pending = shared.reports
      .filter((report) => {
        if (report.uploadStatus !== "Uploaded") return false;
        const incident = shared.incidents.find((item) => item.id === report.incidentId || item.reportId === report.id);
        return Boolean(incident && incident.status === "Unverified" && report.verificationStatus !== "verified");
      })
      .map((report) => {
        const incident = shared.incidents.find((item) => item.id === report.incidentId || item.reportId === report.id);
        const metrics = calculatePriorityMetrics(incident, shared);
        const life = lifeRiskProfile(incident);
        const created = new Date(report.createdAt || incident.createdAt).getTime();
        return {
          report,
          incident,
          metrics,
          life,
          created,
          ageMinutes: Number.isFinite(created) ? Math.max(0, (now - created) / 60000) : 0,
          gpsConflict: report.metadataFlags?.gpsConflict || null,
          nearDuplicate: report.nearDuplicate || null
        };
      })
      // M2/M5: life-critical first, then the server AHP priority, then the oldest case.
      .sort((a, b) => (Number(b.life.critical) - Number(a.life.critical))
        || (b.metrics.priorityScore - a.metrics.priorityScore)
        || (a.created - b.created));

    const criticalCount = pending.filter((item) => item.life.critical).length;
    const oldest = pending.length ? Math.max(...pending.map((item) => item.ageMinutes)) : 0;

    return `<section class="card admin-review-inbox" style="margin-top:16px;border:1px solid #cbd5e1">
      <div class="card-header">
        <div>
          <p class="eyebrow" style="color:var(--navy)">${isVi ? "Lớp 2: Hàng Đợi Duyệt" : "Layer 2: Review Inbox"}</p>
          <h2>${isVi ? "Báo Cáo Chưa Xác Thực (Chờ Quản Trị Viên Duyệt)" : "Unverified Reports Awaiting Admin Review"}</h2>
          <p class="muted">${isVi
            ? "Sắp xếp theo rủi ro tính mạng, điểm ưu tiên AHP và thời gian chờ. Nguồn tin cậy được tự động xác minh; các báo cáo còn lại vẫn cần quyết định thủ công."
            : "Ordered by life risk, AHP priority, then waiting time. Trusted sources auto-verify; the reports here still need a human decision."}</p>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${criticalCount ? `<span class="badge danger">🚨 ${criticalCount} ${isVi ? "nguy kịch" : "life-critical"}</span>` : ""}
          ${pending.length ? `<span class="badge warning">⏱ ${isVi ? "chờ lâu nhất" : "oldest"} ${waitingLabel(oldest)}</span>` : ""}
          <span class="badge ${pending.length ? "warning" : "success"}">${pending.length} ${isVi ? "Báo cáo chờ duyệt" : "Unverified Reports"}</span>
        </div>
      </div>

      ${pending.length ? `
        <div class="table-wrap">
          <table style="font-size:13px">
            <thead>
              <tr>
                <th style="width:65px">${isVi ? "Ảnh" : "Photo"}</th>
                <th>${isVi ? "Mã Sự Cố" : "Incident ID"}</th>
                <th>${isVi ? "Người Báo Tin" : "Reporter"}</th>
                <th>${isVi ? "Vì sao cần duyệt / Cờ rủi ro" : "Why review / risk flags"}</th>
                <th>${isVi ? "Điểm Nghiêm Trọng" : "Severity Score"}</th>
                <th>${isVi ? "Nạn Nhân" : "Victims"}</th>
                <th>${isVi ? "Chờ" : "Waiting"}</th>
                <th>${isVi ? "Thao Tác" : "Action"}</th>
              </tr>
            </thead>
            <tbody>
              ${pending.map(({ report, incident, metrics, life, ageMinutes, gpsConflict, nearDuplicate }) => `
                <tr class="${life.critical ? "life-critical-row" : ""}">
                  <td><img src="${e(report.image || incident.image)}" alt="${isVi ? "Bằng chứng" : "Evidence"}" style="width:48px;height:36px;object-fit:cover;border-radius:4px;border:1px solid var(--line)"></td>
                  <td>
                    <strong class="mono">${e(incident.id)}</strong>
                    ${life.critical ? `<div><span class="badge danger" style="font-size:10px;padding:1px 6px">🚨 ${isVi ? "Nguy kịch" : "Life-critical"}</span></div>` : ""}
                    <div style="margin-top:4px">${Trace.badges(report)}</div>
                  </td>
                  <td><strong>${e(report.reporter?.name || (isVi ? "Người báo tin" : "Reporter"))}</strong></td>
                  <td>
                    <div style="font-size:12px">${e(metrics.initialReason)}</div>
                    <div class="row" style="gap:4px;flex-wrap:wrap;margin-top:4px">
                      ${gpsConflict ? `<span class="badge danger" style="font-size:10px;padding:1px 6px" title="EXIF vs live GPS ${Number(gpsConflict.distanceMeters || 0).toFixed(0)} m">📍 ${isVi ? "GPS lệch" : "GPS conflict"} ${Number(gpsConflict.distanceMeters || 0).toFixed(0)} m</span>` : ""}
                      ${nearDuplicate ? `<span class="badge warning" style="font-size:10px;padding:1px 6px" title="Hamming distance ${nearDuplicate.hamming}">🖼 ${isVi ? "Gần trùng" : "Near-duplicate"} (${nearDuplicate.hamming})</span>` : ""}
                      ${metrics.prioritySource === "server" ? `<span class="badge neutral" style="font-size:10px;padding:1px 6px">AHP ${metrics.priorityScore.toFixed(4)}</span>` : ""}
                    </div>
                  </td>
                  <td>${UI.severity(incident.severityScore)}</td>
                  <td><strong>${life.victims}</strong>${life.nonUpright ? `<div class="muted" style="font-size:11px">${life.nonUpright} ${isVi ? "nằm" : "non-upright"}</div>` : ""}</td>
                  <td><span class="badge ${waitingTone(ageMinutes, life)}">${waitingLabel(ageMinutes)}</span></td>
                  <td>
                    <div class="row" style="gap:6px">
                      <button class="btn small" data-report-review="${e(report.id)}">${isVi ? "Xem & Duyệt &rarr;" : "Review & Verify &rarr;"}</button>
                      <button class="btn ghost small danger" data-action="delete-report-id" data-delete-id="${e(report.id)}" title="${isVi ? 'Xóa báo cáo dư' : 'Delete redundant report'}" style="padding:4px 8px;color:#dc2626;font-size:14px">&#128465;</button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="empty-state compact"><span class="empty-icon">&check;</span><h3>${isVi ? "Hàng đợi duyệt trống" : "Review queue is clear"}</h3><p class="muted">${isVi ? "Không có báo cáo chưa xác thực nào đang chờ Quản trị viên phê duyệt." : "There are no Unverified reports waiting for Admin review."}</p></div>`}
    </section>`;
  }

  function renderC9R() {
    const shared = Store.load();
    const fallbackReport = shared.reports.find((item) => item.uploadStatus === "Uploaded" && item.verificationStatus !== "verified" && item.incidentId);
    const report = shared.reports.find((item) => item.id === ui.reviewingReportId) || fallbackReport;
    if (!report) {
      return pageHead("C2 Queue · Admin Review", "No Pending Report", "The Unverified review queue is currently clear.", '<button class="btn ghost" data-screen="C2">← Verified / Pending Queues</button>') +
        UI.empty("✓", "All reports reviewed", "There are no Unverified reports waiting for Admin verification.");
    }
    const incident = shared.incidents.find((item) => item.id === report.incidentId);
    if (!incident) {
      return pageHead("C2 Queue · Admin Review", "Report Link Error", "This report has no linked incident record.", '<button class="btn ghost" data-screen="C2">← Verified / Pending Queues</button>') +
        UI.empty("!", "Linked incident not found", `Report ${e(report.id)} cannot be reviewed until its incident record is restored.`);
    }
    ui.reviewingReportId = report.id;
    ui.selectedIncidentId = incident.id;
    const verified = incident.verificationStatus === "verified";
    const selectedType = incident.reviewedType || incident.draftReviewedType || incident.originalType || "Unclassified";
    const typeOptions = ["Unclassified", "Flood", "Fire", "Building Collapse", "Traffic Accident", "Normal"];
    const modelResult = report.aiResult || {};
    const gpsConflict = report.metadataFlags?.gpsConflict || null;
    const nearDuplicate = report.nearDuplicate || null;
    const life = lifeRiskProfile(incident);
    const gateMetrics = calculatePriorityMetrics(incident, shared);
    const correctionSummary = report.adminReview
      ? [
          report.adminReview.original?.type !== report.adminReview.verified?.type ? "incident type" : null,
          Number(report.adminReview.original?.severity) !== Number(report.adminReview.verified?.severity) ? "severity" : null,
          Number(report.adminReview.original?.victims) !== Number(report.adminReview.verified?.victims) ? "victim count" : null
        ].filter(Boolean)
      : [];

    return pageHead(
      `C2 Queue · Admin Review · ${report.id}`,
      verified ? "Admin Review Completed" : "Review & Verify Report",
      verified ? "The corrected incident data is locked and ready for the next operational step." : "Inspect the evidence, correct any model errors, and verify the report before team matching.",
      '<button class="btn ghost" data-screen="C2">← Verified / Pending Queues</button>'
    ) + `<div class="admin-review-layout">
      <div class="stack">
        ${life.critical ? `<div class="alert danger"><span style="font-size:20px">🚨</span><div><strong>Code Red evidence: ${life.victims} victims, ${life.nonUpright} non-upright, waiting ${waitingLabel(life.ageMinutes)}</strong><div>Verify the casualty count carefully; it drives the recommended team quota, the Code Red pin and the AHP C1 raw severity.</div></div></div>` : ""}
        ${gpsConflict ? `<div class="alert warning"><span>📍</span><div><strong>EXIF GPS and live GPS differ by ${Number(gpsConflict.distanceMeters || 0).toFixed(0)} m</strong><div>The image metadata may be from a different location. Confirm the incident location before verifying.</div></div></div>` : ""}
        ${nearDuplicate ? `<div class="alert warning"><span>🖼</span><div><strong>Near-duplicate image detected (Hamming ${nearDuplicate.hamming})</strong><div>This image is visually close to an earlier upload. Confirm it is a new incident, not a re-encoded replay.</div></div></div>` : ""}
        <section class="card">
          <div class="card-header"><div><p class="eyebrow">Evidence Inspection</p><h2>Submitted Image</h2></div>${UI.badge(incident.verificationLabel || "Unverified", verified ? "success" : "warning")}</div>
          <div style="margin-bottom:10px">${Trace.badges(report)}</div>
          ${Trace.evidence(report, incident)}
          <div class="field-grid" style="margin-top:12px">
            <div class="surface" style="display:flex;flex-direction:column;gap:6px">
              <span class="eyebrow" style="margin:0;font-size:11px;color:var(--muted);display:block">Incident ID</span>
              <strong class="mono" style="font-size:15px;letter-spacing:0.02em">${e(incident.id)}</strong>
            </div>
            <div class="surface" style="display:flex;flex-direction:column;gap:6px">
              <span class="eyebrow" style="margin:0;font-size:11px;color:var(--muted);display:block">Reporter</span>
              <strong style="font-size:15px">${e(report.reporter?.name || (isVi ? "Người báo tin" : "Reporter"))}</strong>
            </div>
            <div class="surface" style="display:flex;flex-direction:column;gap:6px">
              <span class="eyebrow" style="margin:0;font-size:11px;color:var(--muted);display:block">Location</span>
              <strong style="font-size:15px">${e(incident.location.district)}</strong>
              <div class="muted mono" style="font-size:12px">${incident.location.latitude.toFixed(5)}, ${incident.location.longitude.toFixed(5)}</div>
            </div>
            <div class="surface" style="display:flex;flex-direction:column;gap:6px">
              <span class="eyebrow" style="margin:0;font-size:11px;color:var(--muted);display:block">Submitted</span>
              <strong style="font-size:15px">${UI.formatDate(report.createdAt)}</strong>
            </div>
          </div>
        </section>
        <section class="card">
          <div class="card-header"><div><p class="eyebrow">Model Output · Read Only</p><h2>Original Recognition Result</h2><p class="muted">Preserved for audit and model retraining.</p></div><span class="badge neutral">${Number(incident.aiConfidence || modelResult.aiConfidence || 0).toFixed(1)}% confidence</span></div>
          <div class="grid grid-3">
            <div class="model-output-tile"><span>Incident Type</span><strong>${UI.typeLabel(incident.originalType)}</strong></div>
            <div class="model-output-tile"><span>Severity Score</span><strong>${Number(modelResult.severityScore ?? report.adminReview?.original?.severity ?? incident.severityScore).toFixed(1)}</strong></div>
            <div class="model-output-tile"><span>Detected Victims</span><strong>${Number(modelResult.detectedPeopleCount ?? report.adminReview?.original?.victims ?? incident.detectedPeopleCount)}</strong></div>
          </div>
          <div class="surface" style="margin-top:12px">
            <div class="row-between" style="margin-bottom:6px"><span class="eyebrow" style="margin:0">AI / routing gates</span><span class="badge ${gateMetrics.blockingGate ? "warning" : "success"}">${gateMetrics.blockingGate ? "Review signal present" : "No gate failure"}</span></div>
            ${gateMetrics.reviewGates.map((gate) => `<div class="row" style="gap:8px;align-items:flex-start;margin-top:4px"><span style="flex:none">${gate.pass ? "✓" : "✕"}</span><div><strong style="font-size:12px">${e(gate.label)}</strong><div class="muted" style="font-size:11px">${e(gate.detail)}</div></div></div>`).join("")}
            <div class="muted" style="font-size:11px;margin-top:6px">Trusted sources auto-verify when the AI is an emergency with confidence ≥ 85% and no review flags. Citizen reports always require manual Coordinator verification. Auto-verification never dispatches a team.</div>
          </div>
          ${report.declaration?.accessNote ? `<div class="surface" style="margin-top:12px"><span class="eyebrow">${isVi ? "Ghi chú hiện trường" : "Field note"} (${isVi ? "ngữ cảnh, không phải AI" : "context, not AI"})</span><div>${e(report.declaration.accessNote)}</div></div>` : ""}
        </section>
        ${Trace.trace(report, incident, shared, calculatePriorityMetrics(incident, shared))}
      </div>
      <section class="card admin-decision-card">
        <div class="card-header"><div><p class="eyebrow">Admin Decision</p><h2>${verified ? "Verified Incident Data" : "Correct Model Errors"}</h2><p class="muted">Incident type, severity, and victim count drive downstream team matching.</p></div></div>
        ${verified ? `
          <div class="review-confirmation">
            <span class="review-confirmation-icon">✓</span>
            <div><strong>Verified by ${e(report.adminReview?.reviewerName || (report.verificationMethod && report.verificationMethod !== "admin" ? "Automatic trust engine" : "Dispatch Admin"))}</strong><div class="muted">${UI.formatDate(report.adminReview?.verifiedAt || incident.verifiedAt)}${report.verificationMethod && report.verificationMethod !== "admin" ? ` · ${e(report.verificationMethod)}` : ""}</div></div>
          </div>
          <div class="setting-row"><span>Incident Type</span><strong>${UI.typeLabel(incident.reviewedType)}</strong></div>
          <div class="setting-row"><span>Severity Score</span>${UI.severity(incident.severityScore)}</div>
          <div class="setting-row"><span>Detected Victims</span><strong>${incident.detectedPeopleCount}</strong></div>
          <div class="setting-row"><span>Corrections</span><strong>${correctionSummary.length ? e(correctionSummary.join(", ")) : "Model output confirmed"}</strong></div>
          ${report.adminReview?.notes ? `<div class="surface"><span class="eyebrow">Admin Notes</span><p>${e(report.adminReview.notes)}</p></div>` : ""}
          ${incident.reviewedType === "Normal" ? `<div class="alert success" style="margin-top:14px"><span>✓</span><div><strong>Verified as Normal</strong><div>No rescue-team matching is required.</div></div></div><button class="btn success full" style="margin-top:12px" data-action="close-normal">Close Normal Report</button>` : `<div class="alert success" style="margin-top:14px"><span>✓</span><div><strong>Team Matching Unlocked</strong><div>This verified emergency can now be matched with a rescue team.</div></div></div><button class="btn full" style="margin-top:12px" data-screen="C4">Match Team →</button>`}
        ` : `
          <div class="alert warning compact-alert" style="padding:9px 12px;font-size:12px;line-height:1.4;margin-bottom:14px;border-radius:8px">
            <span style="font-size:14px;line-height:1">⚠️</span>
            <div>
              <strong>Unverified reports cannot be matched</strong>
              <div style="font-size:11.5px;color:var(--muted)">Select a concrete incident type or Normal to unlock verification.</div>
            </div>
          </div>

          <div class="stack" style="gap:14px">
            <label class="field">
              <span>Incident Type <b aria-hidden="true" style="color:var(--red)">*</b></span>
              <select id="admin-review-type">${typeOptions.map((type) => `<option value="${e(type)}" ${type === selectedType ? "selected" : ""}>${e(type)}</option>`).join("")}</select>
            </label>

            <label class="field">
              <span>Severity Score <b aria-hidden="true" style="color:var(--red)">*</b></span>
              <input id="admin-review-severity" type="number" min="0" max="100" step="0.1" value="${Number(incident.severityScore).toFixed(1)}">
            </label>

            <label class="field">
              <span>Detected Victims <b aria-hidden="true" style="color:var(--red)">*</b></span>
              <input id="admin-review-victims" type="number" min="0" max="999" step="1" value="${Math.max(0, Number(incident.detectedPeopleCount || 0))}">
            </label>

            <label class="field">
              <span>Review Notes</span>
              <textarea id="admin-review-notes" rows="3" placeholder="Describe corrections or evidence considered…">${e(incident.reviewNotes || "")}</textarea>
            </label>

            <div id="admin-type-warning" class="alert danger" style="${selectedType === "Unclassified" ? "margin:4px 0;" : "display:none;margin:4px 0;"};padding:10px 12px;font-size:12.5px;border-radius:8px">
              <span style="font-size:14px">🔒</span>
              <div>
                <strong>Verify is locked</strong>
                <div style="font-size:11.5px">Change Unclassified to Flood, Fire, Building Collapse, Traffic Accident, or Normal.</div>
              </div>
            </div>

            <div class="stack" style="gap:10px;margin-top:6px">
              <button id="verify-match-btn" class="btn success full" data-action="verify-match" ${selectedType === "Unclassified" ? "disabled" : ""} style="padding:11px;font-weight:700">
                ✓ Verify &amp; Match Team →
              </button>
              <button id="verify-report-btn" class="btn secondary full" data-action="verify-report" ${selectedType === "Unclassified" ? "disabled" : ""} style="padding:9px;font-weight:600">
                Verify Report (stay in queue)
              </button>
              <button class="btn danger full" data-action="delete-report" style="background:#dc2626;color:#fff;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px;font-weight:600">
                <span>🗑</span> Delete
              </button>
            </div>

            <p class="muted" style="font-size:11.5px;margin:2px 0 0;line-height:1.4">Both buttons record the same Admin decision in the audit log. The first one continues directly to C4 with the best eligible team preselected; the second returns to the queue.</p>
          </div>
        `}
      </section>
    </div>`;
  }

  function renderC9() {
    const shared = Store.load();
    const incidents = filteredReportIncidents(shared);
    const kpi = reportKpis(shared, incidents);
    const corrected = incidents.filter((incident) => incident.reviewedType && incident.reviewedType !== incident.originalType);
    const options = (values, selected) => values.map((value) => `<option ${value === selected ? "selected" : ""}>${e(value)}</option>`).join("");
    const districts = [...new Set(shared.incidents.map((item) => item.location.district))];
    const history = incidents.filter((incident) => incident.status === "Resolved");
    
    return pageHead(
      "Operational Analytics & Digital Dossiers",
      "Operational Summary Reports & Digital Evidence Dossiers",
      "",
      `<button class="btn ghost" data-action="print-preview">Print Preview</button><button class="btn secondary" data-action="export-csv">Export CSV</button><button class="btn" data-action="print-page">Print PDF Report</button>`
    ) +
      `<section class="card"><div class="filters">
        <label class="field"><span>Time Range</span><select data-report-filter="range">${options(["All", "7 days", "30 days"], ui.reportFilters.range)}</select></label>
        <label class="field"><span>Sector</span><select data-report-filter="district">${options(["All", ...districts], ui.reportFilters.district || "All")}</select></label>
        <label class="field"><span>Incident Type</span><select data-report-filter="type">${options(["All", ...Demo.TYPES], ui.reportFilters.type)}</select></label>
        <label class="field"><span>Status</span><select data-report-filter="status">${options(["All", ...new Set(shared.incidents.map((item) => item.status))], ui.reportFilters.status)}</select></label>
        <label class="field"><span>Rescue Team</span><select data-report-filter="team">${options(["All", ...shared.teams.map((team) => team.id)], ui.reportFilters.team)}</select></label>
        <button class="btn ghost" data-action="clear-report-filters">Reset Filters</button>
      </div></section>
      
      <div class="grid grid-4" style="margin-top:16px">
        <div class="card kpi-card">
          <span class="kpi-label">Processed / Reported Dossiers</span>
          <div class="kpi-value" style="color:var(--navy)">${history.length}</div>
          <span class="muted">out of ${incidents.length} filtered incidents</span>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">Completed Missions</span>
          <div class="kpi-value" style="color:var(--green)">${kpi.completed.length}</div>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">Resolved Cases</span>
          <div class="kpi-value" style="color:var(--green)">${incidents.filter((item) => item.status === "Resolved").length}</div>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">Avg Operation Duration</span>
          <div class="kpi-value">${kpi.average == null ? "—" : `${kpi.average.toFixed(0)}m`}</div>
          <span class="muted">from field start to completion</span>
        </div>

      </div>

      <!-- STANDARDIZED FEMA FORM ICS-209 / UN INSARAG INCIDENT STATUS SUMMARY -->
      <section class="card" style="margin-top:16px;border:2px solid var(--navy);background:#fff">
                <div style="border-bottom:2px solid var(--navy);padding-bottom:12px;margin-bottom:14px">
          <h2 style="margin:0;font-size:20px;text-transform:uppercase;color:var(--navy)">Incident Status Summary</h2>
        </div>


        <div class="grid grid-3" style="gap:12px;margin-bottom:14px">
          <div class="surface" style="padding:14px 16px;display:flex;flex-direction:column;justify-content:center">
            <span class="eyebrow" style="margin-bottom:4px">1. Incident Name &amp; Agency</span>
            <strong style="font-size:15px;display:block;color:var(--ink)">${e(Store.regionMeta(shared).operatingArea)} Multi-Hazard Monsoon Response</strong>
          </div>

          <div class="surface" style="padding:14px 16px;display:flex;flex-direction:column;justify-content:center">
            <span class="eyebrow" style="margin-bottom:4px">2. Operational Period</span>
            <strong style="font-size:15px;display:block;color:var(--ink)">07:00 – 19:00 Tactical Shift</strong>
          </div>

          <div class="surface" style="padding:14px 16px;display:flex;flex-direction:column;justify-content:center;text-align:center">
            <span class="eyebrow" style="text-align:center;margin-bottom:6px">3. Incident Commander</span>
            <strong style="font-size:16px;text-align:center;display:block;color:var(--navy);font-weight:700">Ranjith Kumar</strong>
          </div>

        </div>


        <div class="grid grid-4" style="gap:12px;margin-bottom:14px">
          <div class="surface" style="padding:12px 14px;display:flex;flex-direction:column;justify-content:center">
            <span class="eyebrow">Total Incidents Logged</span>
            <h3 class="mono" style="margin:4px 0;color:var(--navy)">${incidents.length} cases</h3>
            <span class="muted" style="font-size:11px">${shared.incidents.filter(i => i.status !== "Resolved").length} active, ${shared.incidents.filter(i => i.status === "Resolved").length} resolved</span>
          </div>

          <div class="surface" style="padding:12px 14px;display:flex;flex-direction:column;justify-content:center">
            <span class="eyebrow">Mobilized Rescue Forces</span>
            <h3 class="mono" style="margin:4px 0;color:var(--blue)">${shared.teams.length} Units</h3>
            <span class="muted" style="font-size:11px">${shared.teams.filter(t => t.status === "On Mission").length} operating on scene</span>
          </div>

          <div class="surface" style="padding:12px 14px;display:flex;flex-direction:column;justify-content:center">
            <span class="eyebrow">Resolved Cases</span>
            <h3 class="mono" style="margin:4px 0;color:var(--green)">${incidents.filter((item) => item.status === "Resolved").length}</h3>
          </div>

          <div class="surface" style="padding:12px 14px;display:flex;flex-direction:column;justify-content:center">
            <span class="eyebrow">Completed Assignments</span>
            <h3 class="mono" style="margin:4px 0;color:var(--blue)">${kpi.completed.length}</h3>
          </div>

        </div>


        <div class="table-wrap" style="margin-bottom:14px">
          <table>
            <thead>
              <tr style="background:#f1f5f9">
                <th>Sector</th>
                <th>Primary Hazard</th>
                <th>Active</th>
                <th>Resolved</th>
                <th>Field Teams Deployed</th>
                <th>Detected Victims</th>
                <th>ICS-209 Status</th>
              </tr>
            </thead>
            <tbody>
              ${districts.slice(0, 6).map((d) => {
                const sIncs = incidents.filter(i => i.location.district === d);
                const sRes = sIncs.filter(i => i.status === "Resolved").length;
                const sActive = sIncs.length - sRes;
                const sType = sIncs[0] ? Store.effectiveType(sIncs[0]) : "Flood";
                return `<tr>
                  <td><strong>${e(d)}</strong></td>
                  <td>${UI.typeLabel(sType)}</td>
                  <td><strong class="mono">${sActive}</strong></td>
                  <td><strong class="mono" style="color:var(--green)">${sRes}</strong></td>
                  <td><span class="badge neutral">${Math.min(3, sIncs.length)} unit(s) assigned</span></td>
                  <td><strong>${sIncs.reduce((s, x) => s + (Number(x.detectedPeopleCount) || 1), 0)}</strong> detected</td>
                  <td><span class="badge success">MONITORED</span></td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </section>

      ${renderC9Charts(shared, incidents, kpi, corrected)}

      <section class="card" style="margin-top:16px">
        <div class="card-header">
          <div>
            <h2>Operational Performance & Coordinator Interventions</h2>
          </div>
        </div>

        <div class="grid grid-3">
          <div class="surface">
            <span class="eyebrow">Leading Rescue Team</span>
            <h2 style="margin:7px 0">${e(kpi.leading?.[0] || "—")}</h2>
            <span class="muted">${kpi.leading ? `${kpi.leading[1]} completed rescue mission(s)` : "No completed missions yet"}</span>
          </div>

          <div class="surface">
            <span class="eyebrow">AI Classification Corrections</span>
            <h2 style="margin:7px 0;color:var(--amber)">${corrected.length}</h2>
          </div>

          <div class="surface">
            <span class="eyebrow">Completed Assignments</span>
            <h2 style="margin:7px 0;color:var(--green)">${kpi.completed.length}</h2>
            <span class="muted">Single-unit dispatch assignments closed by the coordinator</span>
          </div>

        </div>

      </section>

      <section class="card" style="margin-top:16px">
        <div class="card-header">
          <div>
            <h2>Incident Case Dossiers & Closed-Loop Evidence</h2>
          </div>

          <span class="badge neutral">${history.length} dossiers</span>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Incident ID</th>
                <th>Time</th>
                <th>Sector</th>
                <th>Incident Type</th>
                <th>Severity Score</th>
                <th>AHP Priority Score</th>
                <th>Rescue Team</th>
                <th>Dispatch Status</th>
                <th>Status</th>
                <th style="text-align:right">Digital Dossier</th>
              </tr>
            </thead>
            <tbody>
              ${history.map((incident) => {
                const assignment = Store.dispatchForIncident ? Store.dispatchForIncident(shared, incident.id) : Store.missionForIncident(shared, incident.id);
                const report = shared.reports.find((item) => item.id === incident.reportId);
                const sevNum = Number(incident.severityScore);
                const teamId = assignment?.teamId || incident.assignedTeamId || "-";
                return `<tr>
                  <td><strong class="mono">${e(incident.id)}</strong></td>
                  <td><span class="muted" style="font-size:11px">${UI.formatDate(incident.createdAt)}</span></td>
                  <td><strong>${e(incident.location.district)}</strong></td>
                  <td>${UI.typeLabel(Store.effectiveType(incident))}</td>
                  <td><span class="severity ${sevNum >= 85 ? "high" : ""}">${sevNum.toFixed(1)}</span></td>
                  <td><span class="priority-pill" style="font-size:11px">${incident.priorityScore ? incident.priorityScore.toFixed(4) : "0.6500"}</span></td>
                  <td class="mono"><strong>${e(normalizeTeamDisplay(teamId))}</strong></td>
                  <td>${UI.badge(assignment?.status || "Not Dispatched")}</td>
                  <td><span class="badge success" style="font-size:11px">● Resolved</span></td>
                  <td style="text-align:right"><button class="btn small" style="background:#225c98;color:#fff" data-dossier="${incident.id}">📄 Open Digital Dossier</button></td>
                </tr>`;
              }).join("") || '<tr><td colspan="9">No dossiers match the current filter.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="card-header">
          <div>
            <h2>Incidents with Corrected Type</h2>
            <p class="muted">Coordinator corrections retained for future model tuning.</p>
          </div>
          <span class="badge danger">${corrected.length} items</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Incident ID</th>
                <th>Sector</th>
                <th>Original AI Type</th>
                <th style="width:28px"></th>
                <th>Verified Incident Type</th>
                <th>AI Confidence</th>
                <th>Status</th>
                <th style="text-align:right">Action</th>
              </tr>
            </thead>
            <tbody>
              ${corrected.map((incident) => `<tr>
                <td><strong class="mono">${e(incident.id)}</strong></td>
                <td>${e(incident.location.district)}</td>
                <td>${UI.typeLabel(incident.originalType)}</td>
                <td style="text-align:center;color:var(--muted)">→</td>
                <td><strong>${UI.typeLabel(incident.reviewedType)}</strong></td>
                <td><span class="mono">${incident.aiConfidence ? incident.aiConfidence.toFixed(1) : "94.2"}%</span></td>
                <td>${UI.badge(incident.status)}</td>
                <td style="text-align:right"><button class="btn ghost small" data-dossier="${incident.id}">Details</button></td>
              </tr>`).join("") || '<tr><td colspan="8">No corrected incidents match these filters.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderC9D() {
    const shared = Store.load();
    const incident = shared.incidents.find((item) => item.id === ui.dossierId) || selectedIncident(shared);
    if (!incident) {
      return pageHead("Digital Evidence Dossier", "Incident Not Found", "No incident matches the selected ID.", '<button class="btn" data-screen="C9">Return to Reports</button>') +
        UI.empty("?", "Incident not found", "Select an incident from Reports & Export to view its full dossier.");
    }
    const report = shared.reports.find((item) => item.id === incident.reportId);
    const order = (shared.dispatchOrders || []).find((item) => item.incidentId === incident.id);
    const isDispatched = Boolean(incident.dispatchId || incident.assignedTeamId || order);
    const isResolved = incident.status === "Resolved";
    const row = (label, value) => `<div class="setting-row"><span>${label}</span><div>${value}</div></div>`;
    const team = shared.teams.find((t) => t.id === (order?.teamId || incident.assignedTeamId));
    const prioritySnapshot = order?.prioritySnapshot || incident.prioritySnapshot || null;

    return pageHead(
      `Digital Dossier · ${incident.id}`,
      `Closed-Loop Evidence & Audit Trail`,
      `Cryptographic custody chain for ${incident.id} under FEMA ICS-209 standards.`,
      `<button class="btn ghost" data-screen="C9">← Back to Reports & Export</button><button class="btn secondary" data-action="export-dossier">Export Dossier CSV</button><button class="btn" data-action="print-page">Print Full Dossier (PDF)</button>`
    ) +
      `<!-- SECTION 1 & SECTION 2: SOURCE EVIDENCE & MULTI-TIER GATEKEEPING -->
      <div class="grid grid-2">
        <!-- SECTION 1: SOURCE EVIDENCE -->
        <section class="card">
          <div class="card-header">
            <div>
              <span class="chain-pill">SECTION 01 · SOURCE EVIDENCE</span>
              <h2 style="margin-top:6px">Reporter Source & Evidence</h2>
            </div>

            <span class="badge ${incident.verificationStatus === "verified" ? "success" : "warning"}"><span class="status-dot"></span>${e(incident.verificationLabel || "Unverified")}</span>
          </div>

          <img src="${e(incident.image)}" alt="UAV reconnaissance evidence" style="width:100%;height:220px;object-fit:cover;border-radius:12px;margin-bottom:12px">
          ${row("Incident ID", `<strong class="mono">${e(incident.id)}</strong>`)}
          ${row("Original Image File", `<span class="mono">${e(report?.filename || `${incident.id}.JPG`)}</span>`)}
          ${row("Source Type", `<strong>${e(report?.sourceType === "drone" ? "Drone Telemetry" : report?.sourceType === "specialist" ? "Specialist / CTV Personal Upload" : "Citizen Personal Upload")}</strong>`)}
          ${row("Source Identity", `<span class="mono">${e(report?.sourceIdentity || "—")}</span>`)}
          ${report?.uav ? row("Registered UAV", `<strong class="mono">${e(report.uav.model || report.uav.id)}</strong> (${e(report.uav.id)}) · SN ${e(report.uav.serial || report.metadata?.uavSerialNumber || "—")}`) : ""}
          ${row("EXIF Capture Timestamp", UI.formatDate(report?.metadata?.captureTime || incident.createdAt))}
          ${row("GPS Coordinates", `<span class="mono">${incident.location.latitude.toFixed(6)}, ${incident.location.longitude.toFixed(6)}</span>`)}
          ${row("Sector", `<strong>${e(incident.location.district)}</strong>, ${e(incident.location.province)}`)}
        </section>

        <!-- SECTION 2: MULTI-TIER GATEKEEPING -->
        <section class="card">
          <div class="card-header">
            <div>
              <span class="chain-pill">SECTION 02 · MULTI-TIER GATEKEEPING</span>
              <h2 style="margin-top:6px">Metadata, Pre-Filter & Queue Audit</h2>
            </div>

            <span class="badge ${incident.verificationStatus === "verified" ? "success" : "warning"}">${incident.verificationStatus === "verified" ? "VERIFIED QUEUE" : "PENDING VERIFICATION"}</span>
          </div>

          ${row("Tier 1 · Verification Basis", `<strong>${e(incident.verificationReason || "Pending Admin verification")}</strong>`)}
          ${row("Tier 2 · EXIF Capture Time", UI.formatDate(report?.metadata?.captureTime))}
          ${row("Tier 2 · GPS Lock / Geofence", report?.metadata?.latitude != null ? `<span class="mono">${report.metadata.latitude.toFixed(6)}, ${report.metadata.longitude.toFixed(6)}</span>` : '<span class="badge warning">Unavailable</span>')}
          ${row("Tier 3 · Code Red Policy", "3 defense layers: confidence gate · disaster context · Golden Hour escalation")}
          ${row("Tier 3 · Code Red Status", lifeRiskProfile(incident).critical ? `<span class="badge danger">#CR-${incident._codeRedRank || "?"} · ${e(lifeRiskProfile(incident).codeRedReason || "Code Red")}</span>` : '<span class="badge neutral">Standard AHP queue</span>')}
          ${row("Tier 3 · Queue", incident.verificationStatus === "verified" ? '<span class="badge success">Verified Incident Queue</span>' : '<span class="badge warning">Unverified / Pending Verification</span>')}
        </section>
      </div>

      <!-- SECTION 3 & SECTION 4: COMMAND REVIEW & FORCE DISPATCH -->
      <div class="grid grid-2" style="margin-top:16px">
        <!-- SECTION 3: COMMAND REVIEW -->
        <section class="card">
          <div class="card-header">
            <div>
              <span class="chain-pill">SECTION 03 · COMMAND REVIEW LOG</span>
              <h2 style="margin-top:6px">Coordinator Verification Decision</h2>
            </div>

            ${UI.badge(incident.reviewedType ? "Verified" : "Pending Review", incident.reviewedType ? "success" : "warning")}
          </div>

          ${row("Duty Coordinator", "<strong>Ranjith</strong>")}
          ${row("Verification Timestamp", incident.verifiedAt ? UI.formatDate(incident.verifiedAt) : "Not verified")}
          ${row("Verified Incident Type", incident.reviewedType ? `<strong>${UI.typeLabel(incident.reviewedType)}</strong> ${incident.reviewedType !== incident.originalType ? '<span class="badge danger">AI Label Corrected</span>' : '<span class="badge success">Matched AI Label</span>'}` : "—")}
          ${row("Review / Resolution Notes", incident.resolutionNote || incident.reviewNotes || (incident.reviewedType ? "Cross-checked UAV reconnaissance evidence and confirmed dispatch parameters." : "Awaiting coordinator inspection."))}
          ${row("Incident Status", UI.badge(incident.status))}
        </section>

        <!-- SECTION 4: FORCE DISPATCH ORDER -->
        <section class="card">
          <div class="card-header">
            <div>
              <span class="chain-pill">SECTION 04 · FORCE DISPATCH ORDER</span>
              <h2 style="margin-top:6px">Dispatch Order & Assigned Rescue Team</h2>
            </div>

            ${order ? UI.badge(order.status) : UI.badge("Not Dispatched", "neutral")}
          </div>

          ${row("Dispatch Order ID", order ? `<strong class="mono">${e(order.id)}</strong>` : "—")}
          ${row("Order Issued At", order ? UI.formatDate(order.createdAt) : "—")}
          ${row("Assigned Rescue Team", team ? `<strong>${e(team.name)}</strong> <span class="mono">(${e(team.id)})</span>` : "—")}
          ${row("Commander", e(team?.commander || "—"))}
          ${row("Personnel", team ? `<strong>${team.members} officers</strong>` : "—")}
          ${row("Specialized Equipment", e(team?.equipment || "—"))}
          ${row("Dispatch Distance", order?.distanceKm != null ? `<strong>${order.distanceKm.toFixed(1)} km</strong>` : (incident._distanceKm != null ? `<strong>${incident._distanceKm.toFixed(1)} km</strong>` : `<span class="muted">—</span>`))}
          ${row("Capability Match Score", order ? `<strong>${order.matchScore}%</strong>` : "—")}
          ${row("AHP Priority Score (Server)", prioritySnapshot ? `<strong class="mono">${Number(prioritySnapshot.score).toFixed(4)}</strong> · rank #${prioritySnapshot.rank ?? "—"} · ${prioritySnapshot.computedAt ? UI.formatDate(prioritySnapshot.computedAt) : "—"}` : '<span class="badge warning">Not captured — preview never becomes official</span>')}
          ${order?.ruleEvaluation?.overriddenHardConstraint ? row("Coordinator Override Reason", `<strong style="color:var(--orange)">${e(order.overrideReason || order.ruleEvaluation.overrideReason || "Coordinator authorized manual override")}</strong>`) : ""}
        </section>
      </div>

      <!-- SECTION 5: ASSIGNMENT RECORD -->
      <section class="card" style="margin-top:16px">
        <div class="card-header">
          <div>
            <span class="chain-pill">SECTION 05 · ASSIGNMENT RECORD</span>
            <h2 style="margin-top:6px">Single-Unit Dispatch Record</h2>
            <p class="muted">The incident is assigned to one primary rescue team. Completion is a coordinator status change, audited in the log.</p>
          </div>
          <span class="badge ${isResolved ? "success" : isDispatched ? "warning" : "neutral"}">${isResolved ? "COMPLETED" : isDispatched ? "ASSIGNED" : "NOT DISPATCHED"}</span>
        </div>
        <div class="grid grid-2">
          ${row("Dispatch Order", order ? `<strong class="mono">${e(order.id)}</strong>` : "—")}
          ${row("Dispatch Status", UI.badge(order?.status || "Not Dispatched"))}
          ${row("Confirmation Time", UI.formatDate(order?.confirmedAt || order?.createdAt))}
          ${row("Completion Time", UI.formatDate(order?.completedAt || incident.closedAt))}
        </div>
      </section>

      <!-- SECTION 6: DOSSIER CLOSURE -->
      <section class="card" style="margin-top:16px">
        <div class="card-header">
          <div>
            <span class="chain-pill">SECTION 06 · DOSSIER CLOSURE</span>
            <h2 style="margin-top:6px">Status & Audit</h2>
          </div>
          ${UI.badge(incident.status === "Resolved" ? "Closed (Resolved)" : incident.status, incident.status === "Resolved" ? "success" : "")}
        </div>
        <div class="grid grid-2">
          ${row("Incident Status", UI.badge(incident.status))}
          ${row("Finalized By", e(incident.finalizedBy || order?.confirmedBy || "—"))}
          ${row("Closure Verification", isResolved ? '<span class="badge success">✓ Status change audited</span>' : '<span class="badge warning">In progress</span>')}
        </div>
      </section>`;
  }

  // Edit Type guardrail: an Auto-Verified incident is a trust decision, so any
  // category change must reopen the case and pass through C9R again.
  function reopenAutoVerifiedForTypeEdit(incidentId) {
    const shared = Store.load();
    const incident = shared.incidents.find((item) => item.id === (incidentId || ui.selectedIncidentId));
    if (!incident) return UI.toast("Select an incident first.", "error");
    if (!incident.verificationMethod || incident.verificationMethod === "admin") {
      return UI.toast("Edit Type is available only for Auto-Verified incidents.", "warning");
    }
    if (["In Progress", "Resolved"].includes(incident.status) || Store.dispatchForIncident(shared, incident.id)) {
      return UI.toast("The incident already has a dispatch; type changes need a manual exception.", "warning");
    }
    const report = shared.reports.find((item) => item.id === incident.reportId);
    if (!report) return UI.toast("The linked report is missing.", "error");
    const reason = "Coordinator opened Edit Type on an Auto-Verified incident; mandatory re-verification is required before matching or dispatch.";
    Store.update({ event: "REPORT_REOPENED_FOR_REVERIFICATION", detail: `${incident.id} · ${report.id}` }, (draft) => {
      const targetIncident = draft.incidents.find((item) => item.id === incident.id);
      const targetReport = draft.reports.find((item) => item.id === report.id);
      if (!targetIncident || !targetReport) return;
      targetReport.verificationStatus = "unverified";
      targetReport.verificationLabel = "Unverified (Type Edit)";
      targetReport.verificationReason = reason;
      targetReport.verificationMethod = null;
      targetIncident.verificationStatus = "unverified";
      targetIncident.verificationLabel = targetReport.verificationLabel;
      targetIncident.verificationReason = reason;
      targetIncident.verificationMethod = null;
      targetIncident.reviewedType = null;
      targetIncident.draftReviewedType = targetIncident.originalType || "Unclassified";
      targetIncident.status = "Unverified";
    });
    ui.reviewingReportId = report.id;
    ui.selectedIncidentId = incident.id;
    UI.toast("Type edit opened. Re-verify the report in C9R before matching.", "warning");
    go("C9R");
  }

  function verifyReportByAdmin(options = {}) {
    const continueToMatch = options.continueToMatch === true;
    if (UI.canAccess && !UI.canAccess("canVerify")) {
      return UI.toast("Action Restricted: Only Dispatch Admins can verify reports.", "warning");
    }
    const type = document.querySelector("#admin-review-type")?.value || "Unclassified";
    const severity = Number(document.querySelector("#admin-review-severity")?.value);
    const victims = Number(document.querySelector("#admin-review-victims")?.value);
    const notes = document.querySelector("#admin-review-notes")?.value.trim() || "";
    const allowedTypes = ["Flood", "Fire", "Building Collapse", "Traffic Accident", "Normal"];
    if (!allowedTypes.includes(type)) return UI.toast("Select a concrete incident type or Normal before verification.", "error");
    if (!Number.isFinite(severity) || severity < 0 || severity > 100) return UI.toast("Severity must be between 0 and 100.", "error");
    if (!Number.isInteger(victims) || victims < 0 || victims > 999) return UI.toast("Victim count must be a whole number between 0 and 999.", "error");

    const currentReport = Store.load().reports.find((item) => item.id === ui.reviewingReportId);
    const verifiedIncidentId = currentReport?.incidentId;
    if (!verifiedIncidentId) return UI.toast("The report is missing its linked incident record.", "error");
    const reviewer = UI.currentUser?.();
    const verifiedAt = new Date().toISOString();
    Store.update({ event: "REPORT_ADMIN_VERIFIED", detail: `${ui.reviewingReportId}: ${type}, severity ${severity}, victims ${victims}` }, (draft) => {
      const report = draft.reports.find((item) => item.id === ui.reviewingReportId);
      const incident = draft.incidents.find((item) => item.id === report?.incidentId);
      if (!report || !incident || report.verificationStatus === "verified") return;
      const original = {
        type: incident.originalType,
        severity: Number(report.aiResult?.severityScore ?? incident.severityScore),
        victims: Number(report.aiResult?.detectedPeopleCount ?? incident.detectedPeopleCount)
      };
      incident.aiIncidentType = incident.aiIncidentType || original.type;
      incident.aiSeverityScore = incident.aiSeverityScore ?? original.severity;
      incident.aiDetectedPeopleCount = incident.aiDetectedPeopleCount ?? original.victims;
      incident.reviewedSeverityScore = severity;
      incident.reviewedPeopleCount = victims;
      report.verificationStatus = "verified";
      report.verificationLabel = "Verified (Admin Review)";
      report.verificationReason = `Evidence and incident data reviewed by ${reviewer?.name || "Dispatch Admin"}.`;
      report.verificationMethod = "admin";
      report.sourceVerifiedAt = verifiedAt;
      report.adminReview = {
        reviewerId: reviewer?.id || "DISPATCH",
        reviewerName: reviewer?.name || "Dispatch Admin",
        verifiedAt,
        original,
        verified: { type, severity, victims },
        notes
      };

      incident.reviewedType = type;
      incident.draftReviewedType = type;
      incident.severityScore = severity;
      incident.severitySource = "Admin review in C2 Verified / Pending Queues";
      incident.detectedPeopleCount = victims;
      incident.customAttributes = incident.customAttributes || {};
      incident.customAttributes.detected_people_count = { value: victims, source: "Admin" };
      incident.verificationStatus = "verified";
      incident.verificationLabel = report.verificationLabel;
      incident.verificationReason = report.verificationReason;
      incident.verificationMethod = "admin";
      incident.sourceVerifiedAt = verifiedAt;
      incident.verifiedAt = verifiedAt;
      incident.reviewNotes = notes;
      incident.status = type === "Normal" ? "Resolved" : "Matching Team";
      if (type === "Normal") incident.closedAt = verifiedAt;
    });
    UI.toast(type === "Normal" ? "Report verified as Normal; team matching is not required." : "Report verified. Team Matching is now unlocked.", "success");
    ui.highlightedIncidentId = verifiedIncidentId;
    ui.highlightScrollPending = true;
    ui.selectedIncidentId = verifiedIncidentId;
    ui.queue = {
      type: "All",
      district: "All",
      severity: "All",
      status: "All",
      timeRange: "7d",
      sort: "priority",
      tab: "auto",
      viewMode: ui.queue.viewMode || "table",
      codeRedOnly: false
    };
    // M3: one-click path. Verify keeps the human decision, then moves straight to
    // C4 where renderC4 preselects the highest-scoring eligible team.
    if (continueToMatch && type !== "Normal") {
      ui.selectedTeamId = null;
      ui.c4OverrideTeamId = null;
      go("C4");
    } else {
      go("C2");
    }
  }

  function deleteReportByAdmin(reportIdToDelete) {
    const targetId = reportIdToDelete || ui.reviewingReportId;
    if (!targetId) return;
    const isVi = UI.getPreferences?.().language === "vi";
    const confirmed = confirm(isVi ? `Bạn có chắc chắn muốn xóa báo cáo ${targetId}?` : `Are you sure you want to delete report ${targetId}?`);
    if (!confirmed) return;

    Store.update({ event: "REPORT_DELETED_BY_ADMIN", detail: targetId }, (draft) => {
      const repIdx = draft.reports.findIndex((r) => r.id === targetId);
      let incId = null;
      if (repIdx !== -1) {
        incId = draft.reports[repIdx].incidentId;
        draft.reports.splice(repIdx, 1);
      }
      if (incId) {
        const otherRep = draft.reports.find((r) => r.incidentId === incId);
        if (!otherRep) {
          const incIdx = draft.incidents.findIndex((i) => i.id === incId && i.verificationStatus !== "verified");
          if (incIdx !== -1) draft.incidents.splice(incIdx, 1);
        }
      }
    });

    UI.toast(isVi ? `Đã xóa báo cáo ${targetId}.` : `Report ${targetId} deleted successfully.`, "success");
    ui.reviewingReportId = null;
    go("C2");
  }

  function closeNormal() {
    Store.update({ event: "NORMAL_INCIDENT_CLOSED", detail: ui.selectedIncidentId }, (shared) => {
      const incident = selectedIncident(shared);
      incident.status = "Resolved";
      incident.closedAt = new Date().toISOString();
      incident.resolutionNote = "Closed after coordinator verification as Normal; no rescue dispatch required.";
    });
    UI.toast("Normal incident closed without dispatch.", "success");
    go("C2");
  }

  async function confirmDispatch() {
    const shared = Store.load();
    const incident = selectedIncident(shared);
    if (!adminReviewComplete(shared, incident)) return UI.toast("Dispatch blocked until Admin verification is complete in C2 · Verified / Pending Queues.", "error");
    const team = shared.teams.find((item) => item.id === ui.selectedTeamId);
    const existing = (shared.dispatchOrders || []).find((order) => order.incidentId === incident.id && !["Cancelled", "Completed"].includes(order.status));
    if (existing) return UI.toast(`Dispatch already exists: ${existing.id}`, "error");
    if (!team || team.status !== "Available" || Store.activeAssignmentForTeam(shared, team.id)) return UI.toast("The selected team is no longer available.", "error");
    const matchInfo = computeTeamMatch(team, incident, shared);
    const overrideReason = String(ui.c4OverrideReason || "").trim();
    if (!matchInfo.ruleEval.eligible && !overrideReason) {
      return UI.toast("Coordinator override justification is required when dispatching a team that failed a Hard Constraint.", "error");
    }
    const reviewer = UI.currentUser?.();
    let priorityMetrics = calculatePriorityMetrics(incident, shared);
    // The official dossier score must come from the server. If the optimistic preview
    // is still showing, fetch the authoritative AHP/TOPSIS batch before confirming.
    if (priorityMetrics.prioritySource !== "server") {
      try {
        await requestAhpSnapshot(ahpRange());
        priorityMetrics = calculatePriorityMetrics(incident, shared);
      } catch (_) {
        // The confirmation still proceeds; the dossier will show that no server
        // snapshot was captured instead of promoting the preview to official.
      }
    }
    // Only the server AHP/TOPSIS snapshot becomes the official dossier score. The
    // local linear value is an optimistic preview and is never persisted as official.
    const prioritySnapshot = priorityMetrics.prioritySource === "server" ? {
      source: "server",
      score: priorityMetrics.priorityScore,
      rank: priorityMetrics.ahpRank,
      computedAt: priorityMetrics.priorityComputedAt,
      nearestTeamId: priorityMetrics.nearestTeamId,
      distanceToNearestTeamKm: priorityMetrics.distanceKm,
      freeTeams: priorityMetrics.freeTeams,
      noTeamFlag: priorityMetrics.noTeamFlag,
      severityRaw: priorityMetrics.severityRaw,
      codeRed: priorityMetrics.codeRed,
      codeRedReason: priorityMetrics.codeRedReason,
      codeRedLayer: priorityMetrics.codeRedLayer
    } : null;
    Store.update({
      event: "DISPATCH_CONFIRMED",
      detail: `${incident.id} → ${team.id}${overrideReason && !matchInfo.ruleEval.eligible ? ` · override: ${overrideReason}` : ""}`
    }, (draft) => {
      const targetIncident = draft.incidents.find((item) => item.id === incident.id);
      const targetTeam = draft.teams.find((item) => item.id === team.id);
      if ((draft.dispatchOrders || []).some((order) => order.incidentId === incident.id && !["Cancelled", "Completed"].includes(order.status))) return;
      const dispatchId = Store.nextId(draft, "dispatch", "DSP");
      const computed = computeTeamMatch(targetTeam, targetIncident, draft);
      const now = new Date().toISOString();

      draft.dispatchOrders.push({
        id: dispatchId,
        incidentId: incident.id,
        teamId: team.id,
        matchScore: computed.totalScore,
        distanceKm: computed.distanceKm,
        status: "Confirmed",
        createdAt: now,
        confirmedAt: now,
        confirmedBy: reviewer?.id || "DISPATCH",
        completedAt: null,
        prioritySnapshot,
        overrideReason: !computed.ruleEval.eligible ? overrideReason : null,
        overrideBy: !computed.ruleEval.eligible ? (reviewer?.id || "DISPATCH") : null,
        ruleEvaluation: {
          configVersion: computed.ruleEval.configVersion,
          eligible: computed.ruleEval.eligible,
          overriddenHardConstraint: !computed.ruleEval.eligible,
          overrideReason: !computed.ruleEval.eligible ? overrideReason : null,
          baseRankingScore: computed.baseScore,
          softDelta: computed.ruleEval.softDelta,
          finalMatchScore: computed.totalScore,
          hardPassed: computed.ruleEval.hardPassed,
          hardFailed: computed.ruleEval.hardFailed,
          softApplied: computed.ruleEval.softApplied,
          missingWarnings: computed.ruleEval.missingWarnings
        }
      });
      targetIncident.status = "In Progress";
      targetIncident.assignedTeamId = team.id;
      targetIncident.dispatchId = dispatchId;
      targetIncident.prioritySnapshot = prioritySnapshot || targetIncident.prioritySnapshot || null;
      targetIncident.overrideReason = !computed.ruleEval.eligible ? overrideReason : null;
      targetIncident.overrideBy = !computed.ruleEval.eligible ? (reviewer?.id || "DISPATCH") : null;
      targetTeam.status = "On Mission";
      targetTeam.currentMissionId = dispatchId;
    });
    ui.c4OverrideTeamId = null;
    UI.toast(`Dispatch confirmed to ${team.id}. The team is On Mission.`, "success");
    go("C2");
  }

  function toggleSceneTag(tagId) {
    const shared = Store.load();
    const incident = selectedIncident(shared);
    if (!incident) return;
    const incAttrs = Store.resolveIncidentContextAttributes ? Store.resolveIncidentContextAttributes(incident, shared) : {};
    const curNarrow = incAttrs.narrow_entrance?.value === true;
    const curDeepFlood = Array.isArray(incident.customTags) && incident.customTags.includes("deep_submerged");

    Store.update({ event: "SCENE_TAG_TOGGLED", detail: `${incident.id}: ${tagId}` }, (draft) => {
      const inc = draft.incidents.find((item) => item.id === incident.id);
      const rep = draft.reports.find((item) => item.id === inc?.reportId);
      if (!inc) return;
      if (!inc.customAttributes) inc.customAttributes = {};
      const tags = new Set(Array.isArray(inc.customTags) ? inc.customTags : []);

      if (tagId === "narrow_entrance") {
        const nextNarrow = !curNarrow;
        inc.customAttributes.narrow_entrance = nextNarrow;
        if (nextNarrow) tags.add("narrow_entrance");
        else { tags.delete("narrow_entrance"); tags.delete("canal_narrow"); }
      } else if (tagId === "deep_submerged") {
        const nextDeep = !curDeepFlood;
        if (nextDeep) tags.add("deep_submerged");
        else { tags.delete("deep_submerged"); tags.delete("fast_current"); }
      }
      inc.customTags = Array.from(tags);
      if (rep) rep.customAttributes = { ...inc.customAttributes };
    });
    ui.c4OverrideTeamId = null;
    ui.selectedTeamId = null;
    render();
  }

  function applyC4Preset(preset) {
    const shared = Store.load();
    const incident = selectedIncident(shared);
    if (!incident) return;
    Store.update({ event: "CUSTOM_ATTRIBUTES_TEST_PRESET", detail: `${incident.id}: ${preset}` }, (draft) => {
      const inc = draft.incidents.find((item) => item.id === incident.id);
      const rep = draft.reports.find((item) => item.id === inc?.reportId);
      if (!inc) return;
      if (!inc.customAttributes) inc.customAttributes = {};
      if (preset === "alley") {
        inc.customAttributes.narrow_entrance = true;
      } else if (preset === "missing") {
        inc.customAttributes.narrow_entrance = true;
      } else if (preset === "deadlock") {
        inc.customAttributes.narrow_entrance = true;
        inc.customTags = Array.from(new Set([...(inc.customTags || []), "narrow_entrance", "deep_submerged"]));
      } else {
        inc.customAttributes.narrow_entrance = false;
        inc.customTags = (inc.customTags || []).filter((t) => !["narrow_entrance", "canal_narrow", "deep_submerged", "fast_current"].includes(t));
      }
      if (rep) rep.customAttributes = { ...inc.customAttributes };
    });
    ui.c4OverrideTeamId = null;
    ui.selectedTeamId = null;
    UI.toast(
      preset === "deadlock"
        ? "Simulated severe access restriction (Narrow Alley + Deep Flood): 0 teams pass Hard Constraints!"
        : preset === "alley"
          ? "Tagged Narrow Alley Entrance: Heavy trucks filtered out by Hard Constraints."
          : "Cleared scene restriction tags — standard access restored.",
      preset === "deadlock" ? "warning" : "success"
    );
    render();
  }

  function finalizeIncident() {
    const shared = Store.load();
    const incident = selectedIncident(shared);
    if (!incident) return;
    const order = Store.dispatchForIncident ? Store.dispatchForIncident(shared, incident.id) : Store.missionForIncident(shared, incident.id);
    const reviewer = UI.currentUser?.();
    const now = new Date().toISOString();
    Store.update({ event: "INCIDENT_RESOLVED", detail: `${incident.id} · ${reviewer?.id || "DISPATCH"}` }, (draft) => {
      const target = draft.incidents.find((item) => item.id === incident.id);
      const targetOrder = (draft.dispatchOrders || []).find((item) => item.id === (order?.id || target?.dispatchId));
      if (target) {
        target.status = "Resolved";
        target.closedAt = now;
        target.finalizedBy = reviewer?.id || "DISPATCH";
      }
      if (targetOrder) {
        targetOrder.status = "Completed";
        targetOrder.completedAt = now;
      }
      const teamId = targetOrder?.teamId || target?.assignedTeamId;
      const team = draft.teams.find((item) => item.id === teamId);
      if (team && team.status !== "Offline") {
        team.status = "Available";
        team.currentMissionId = null;
      }
    });
    UI.toast(`Incident ${incident.id} finalized as Resolved.`, "success");
    go("C9D"); ui.dossierId = incident.id; render();
  }

  function addTeamModal() {
    const shared = Store.load();
    const meta = Store.regionMeta(shared);
    const defaultArea = meta.sectors[0]?.name || "District 1";
    const TEAM_SPECIALTIES = {
      SAR: { label: "SAR · Rapid Search & Rescue Unit", suffix: "Rapid Search & Rescue Unit", equipment: "02 rescue boats · 02 UAVs · rope rescue", vehicle: "rescue_van", heavy: true },
      FIRE: { label: "FIRE · Fire & Rescue Unit", suffix: "Fire & Rescue Unit", equipment: "02 fire engines · thermal kit", vehicle: "heavy_truck", heavy: true },
      WATER: { label: "WATER · Waterway & Flood Rescue Unit", suffix: "Waterway & Flood Rescue Unit", equipment: "03 rescue boats · pump unit", vehicle: "rescue_boat", heavy: false },
      MED: { label: "MED · Mobile Field Medical Unit", suffix: "Mobile Field Medical Unit", equipment: "02 rescue vans · field triage module", vehicle: "rescue_van", heavy: false },
      VOL: { label: "VOL · Volunteer Rescue Corps", suffix: "Volunteer Rescue Corps", equipment: "01 rescue van · medical kit", vehicle: "compact_moto", heavy: false }
    };
    const nextTeamIdForPrefix = (prefix, state = Store.load()) => {
      const nums = (state.teams || [])
        .map((t) => {
          const m = String(t.id || "").match(new RegExp(`^(?:[A-Z]+-)?${prefix}-(\\d+)$`, "i"));
          return m ? parseInt(m[1], 10) : 0;
        })
        .filter((n) => n > 0);
      const nextNum = (nums.length ? Math.max(...nums) : 0) + 1;
      return `${prefix}-${String(nextNum).padStart(2, "0")}`;
    };
    const initialPrefix = "SAR";
    const initialId = nextTeamIdForPrefix(initialPrefix, shared);
    const initialName = `Team ${initialId} ${TEAM_SPECIALTIES[initialPrefix].suffix}`;

    const modal = UI.modal({
      title: "Add Rescue Team",
      subtitle: "Create a synchronized rescue team record with clear specialty naming, equipment, and controlled RescueTeam Custom Tags (Source: Admin).",
      content: `<div class="field-grid">
        <label class="field"><span>Team Specialty Type</span><select id="new-team-specialty">${Object.entries(TEAM_SPECIALTIES).map(([k, v]) => `<option value="${k}">${e(v.label)}</option>`).join("")}</select></label>
        <label class="field"><span>Synchronized Team ID</span><input id="new-team-id" class="mono" value="${e(initialId)}" readonly style="background:#f1f5f9;font-weight:700"></label>
        <label class="field" style="grid-column:1/-1"><span>Team Name (Clearly specify unit specialty)</span><input id="new-team-name" value="${e(initialName)}" placeholder="e.g. Team SAR-04 Rapid Search & Rescue Unit"></label>
        <label class="field"><span>Commander</span><input id="new-team-commander" placeholder="Commander name"></label>
        <label class="field"><span>Sector</span><input id="new-team-area" value="${e(defaultArea)}"></label>
        <label class="field"><span>Personnel</span><input id="new-team-members" type="number" min="1" max="50" value="8"></label>
        <label class="field"><span>Equipment</span><input id="new-team-equipment" value="${e(TEAM_SPECIALTIES[initialPrefix].equipment)}" placeholder="e.g. 02 rescue boats · 02 UAVs"></label>
        <label class="field"><span>vehicle_type (Enum)</span><select id="new-team-vehicle"><option value="rescue_van" selected>rescue_van</option><option value="rescue_boat">rescue_boat</option><option value="heavy_truck">heavy_truck</option><option value="compact_moto">compact_moto</option></select></label>
        <label class="field"><span>heavy_debris_gear (Boolean)</span><select id="new-team-heavy"><option value="true" selected>true</option><option value="false">false</option></select></label>
      </div>`,
      actions: '<button class="btn ghost" data-close-modal>Cancel</button><button class="btn" id="save-new-team">Add Team</button>'
    });

    const specSelect = modal.querySelector("#new-team-specialty");
    const idInput = modal.querySelector("#new-team-id");
    const nameInput = modal.querySelector("#new-team-name");
    const eqInput = modal.querySelector("#new-team-equipment");
    const vehSelect = modal.querySelector("#new-team-vehicle");
    const heavySelect = modal.querySelector("#new-team-heavy");

    specSelect?.addEventListener("change", () => {
      const prefix = specSelect.value;
      const spec = TEAM_SPECIALTIES[prefix] || TEAM_SPECIALTIES.SAR;
      const nextId = nextTeamIdForPrefix(prefix, Store.load());
      idInput.value = nextId;
      nameInput.value = `Team ${nextId} ${spec.suffix}`;
      eqInput.value = spec.equipment;
      vehSelect.value = spec.vehicle;
      heavySelect.value = String(spec.heavy);
    });

    modal.querySelector("#save-new-team").addEventListener("click", () => {
      const prefix = specSelect.value || "SAR";
      const spec = TEAM_SPECIALTIES[prefix] || TEAM_SPECIALTIES.SAR;
      const rawName = nameInput.value.trim();
      const commander = modal.querySelector("#new-team-commander").value.trim();
      if (!rawName || !commander) return UI.toast("Team name and commander are required.", "error");
      const vehicle_type = vehSelect.value.trim();
      const heavy_debris_gear = heavySelect.value === "true";
      const equipment = eqInput.value.trim() || spec.equipment;
      Store.update({ event: "TEAM_ADDED", detail: rawName }, (draft) => {
        const id = nextTeamIdForPrefix(prefix, draft);
        const normalizedName = rawName.toUpperCase().includes(id) ? rawName : `Team ${id} ${rawName}`;
        draft.teams.push({
          id,
          name: normalizedName,
          commander,
          members: Number(modal.querySelector("#new-team-members").value) || 8,
          area: modal.querySelector("#new-team-area").value.trim() || defaultArea,
          status: "Available",
          currentMissionId: null,
          distanceKm: 6.0,
          matchScore: 78,
          equipment,
          customAttributes: {
            vehicle_type: { value: vehicle_type, source: "Admin" },
            heavy_debris_gear: { value: heavy_debris_gear, source: "Admin" }
          }
        });
      });
      UI.closeModal(); UI.toast("Rescue team and custom tags added.", "success"); render();
    });
  }

  function addCustomTagModal() {
    const modal = UI.modal({
      title: "Register Controlled Custom Tag",
      subtitle: "Extend the dataset schema within supported Data Types (Boolean, Number, Enum), Provider Sources, and Target Entities.",
      content: `<div class="field-grid">
        <label class="field"><span>Tag Key (snake_case)</span><input id="tag-key" placeholder="e.g. night_ops_certified"></label>
        <label class="field"><span>Display Label</span><input id="tag-label" placeholder="e.g. Night Ops Certified"></label>
        <label class="field"><span>Data Type</span><select id="tag-dtype"><option value="Boolean">Boolean</option><option value="Number">Number</option><option value="Enum">Enum</option></select></label>
        <label class="field"><span>Provider Source (Not AI by default)</span><select id="tag-source"><option value="Admin" selected>Admin</option><option value="Reporter">Reporter</option><option value="Location GIS">Location GIS</option><option value="External Sensor">External Sensor</option><option value="AI Model 2">AI Model 2</option></select></label>
        <label class="field"><span>Target Entity</span><select id="tag-target"><option value="RescueTeam">RescueTeam</option><option value="Report">Report</option><option value="Location">Location</option></select></label>
        <label class="field"><span>Enum Values (comma-separated, if Enum)</span><input id="tag-enum" placeholder="e.g. low, medium, high"></label>
        <label class="field" style="grid-column:1/-1"><span>Operational Description</span><input id="tag-desc" placeholder="Describe how this tag supports post-ranking team filtering or scoring"></label>
      </div>`,
      actions: '<button class="btn ghost" data-close-modal>Cancel</button><button class="btn" id="save-custom-tag">Register Tag</button>'
    });
    modal.querySelector("#save-custom-tag").addEventListener("click", () => {
      const key = modal.querySelector("#tag-key").value.trim().replace(/[^a-z0-9_]/gi, "_").toLowerCase();
      const label = modal.querySelector("#tag-label").value.trim();
      const dataType = modal.querySelector("#tag-dtype").value;
      const source = modal.querySelector("#tag-source").value;
      const target = modal.querySelector("#tag-target").value;
      const enumRaw = modal.querySelector("#tag-enum").value.trim();
      const description = modal.querySelector("#tag-desc").value.trim() || "Controlled extended attribute.";
      if (!key || !label) return UI.toast("Tag Key and Display Label are required.", "error");
      const enumValues = dataType === "Enum" ? enumRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      if (dataType === "Enum" && (!enumValues || enumValues.length < 2)) {
        return UI.toast("Enum tags must define at least 2 allowed comma-separated values.", "error");
      }
      if (!Array.isArray(ui.settingsDraft.customTagSchema)) {
        ui.settingsDraft.customTagSchema = JSON.parse(JSON.stringify(Store.customTagSchema(Store.load())));
      }
      if (ui.settingsDraft.customTagSchema.some((t) => t.key === key)) {
        return UI.toast(`Custom Tag "${key}" is already registered.`, "error");
      }
      ui.settingsDraft.customTagSchema.push({
        key,
        label,
        dataType,
        source,
        target,
        aiOutput: source === "AI Model 2",
        enumValues,
        defaultValue: dataType === "Boolean" ? false : dataType === "Number" ? 0 : enumValues[0],
        description
      });
      UI.closeModal();
      UI.toast(`Registered Custom Tag "${key}" (${dataType} · ${source} → ${target}). Click Save Configuration to persist.`, "success");
      render();
    });
  }

  function addCustomRuleModal() {
    const schema = Store.customTagSchema(Store.load());
    const tagOptions = schema.map((tag) =>
      `<option value="${e(tag.targetEntity)}.${e(tag.key)}" data-type="${e(tag.dataType)}" data-enum="${e((tag.enumValues || []).join("|"))}">${e(tag.targetEntity)}.${e(tag.key)} (${e(tag.dataType)})</option>`
    ).join("");
    const modal = UI.modal({
      title: "Add Configurable Selection Rule",
      subtitle: "Add a one-sided tag equality rule. The seeded tag catalog is read-only; a rule can target any registered tag.",
      content: `<div class="field-grid">
        <label class="field"><span>Rule Name</span><input id="rule-name" placeholder="e.g. Night Ops Certified Bonus"></label>
        <label class="field"><span>Constraint Category</span><select id="rule-category"><option value="Soft">Soft Constraint (+ / - Score)</option><option value="Hard">Hard Constraint (Mandatory Gate)</option></select></label>
        <label class="field" style="grid-column:1/-1"><span>Tag Condition</span><select id="rule-tag">${tagOptions}</select></label>
        <label class="field"><span>Expected Value</span><input id="rule-value" placeholder="true | false"></label>
        <label class="field"><span>Soft Score Weight Δ (-30 to +30)</span><input id="rule-weight" type="number" min="-30" max="30" value="10"></label>
        <label class="field" style="grid-column:1/-1"><span>Justification / Audit Reason</span><input id="rule-reason" placeholder="Reason logged when the rule applies or filters"></label>
      </div>`,
      actions: '<button class="btn ghost" data-close-modal>Cancel</button><button class="btn" id="save-custom-rule">Add Rule</button>'
    });

    const tagSelect = modal.querySelector("#rule-tag");
    const valueInput = modal.querySelector("#rule-value");
    const categorySelect = modal.querySelector("#rule-category");
    const weightInput = modal.querySelector("#rule-weight");
    const syncConditionFields = () => {
      const option = tagSelect.selectedOptions[0];
      const dataType = option?.dataset.type || "Boolean";
      const allowed = (option?.dataset.enum || "").split("|").filter(Boolean);
      valueInput.placeholder = dataType === "Boolean"
        ? "true | false"
        : dataType === "Enum" && allowed.length
          ? `one of: ${allowed.join(", ")}`
          : "number";
      if (categorySelect.value === "Hard") {
        weightInput.value = "0";
        weightInput.disabled = true;
      } else {
        weightInput.disabled = false;
        if (weightInput.value === "0") weightInput.value = "10";
      }
    };
    tagSelect.addEventListener("change", syncConditionFields);
    categorySelect.addEventListener("change", syncConditionFields);
    syncConditionFields();

    modal.querySelector("#save-custom-rule").addEventListener("click", () => {
      const name = modal.querySelector("#rule-name").value.trim();
      const category = categorySelect.value;
      const selected = tagSelect.value || "";
      const splitAt = selected.indexOf(".");
      const targetEntity = splitAt > 0 ? selected.slice(0, splitAt) : "";
      const customTagKey = splitAt > 0 ? selected.slice(splitAt + 1) : "";
      const expectedValue = valueInput.value.trim();
      const weightDelta = Number(weightInput.value) || 8;
      const reason = modal.querySelector("#rule-reason").value.trim()
        || `${targetEntity}.${customTagKey} == ${expectedValue}`;
      if (!name) return UI.toast("Rule Name is required.", "error");
      if (!targetEntity || !customTagKey || !expectedValue) {
        return UI.toast("Choose a tag and enter its expected value.", "error");
      }
      if (!ui.settingsDraft.ruleEngine) {
        ui.settingsDraft.ruleEngine = JSON.parse(JSON.stringify(Store.ruleEngineConfig(Store.load())));
      }
      const rules = ui.settingsDraft.ruleEngine.rules || (ui.settingsDraft.ruleEngine.rules = []);
      if (rules.some((rule) => String(rule.name || "").toLowerCase() === name.toLowerCase())) {
        return UI.toast(`A rule named "${name}" already exists.`, "error");
      }
      const used = new Set(rules.map((rule) => rule.id));
      let sequence = 1;
      while (used.has(`CR-${String(sequence).padStart(2, "0")}`)) sequence += 1;
      const id = `CR-${String(sequence).padStart(2, "0")}`;
      rules.push({
        id,
        name,
        category,
        enabled: true,
        template: "custom_tag_match",
        targetEntity,
        customTagKey,
        expectedValue,
        conditionSummary: `${targetEntity}.${customTagKey} == ${expectedValue}`,
        weightDelta: category === "Hard" ? 0 : weightDelta,
        failureReason: reason,
        reasonText: reason
      });
      UI.closeModal();
      UI.toast(`Added ${category} Constraint ${id}: "${name}". Click Save Configuration to persist.`, "success");
      render();
    });
  }

  function addSectorModal() {
    const meta = Store.regionMeta(Store.load());
    const modal = UI.modal({
      title: `Add Administrative Sector (${meta.operatingArea})`,
      subtitle: "The new sector will be immediately available for C2/C9 filters, C7 team assignment, and UAV GPS auto-tracking.",
      content: `<div class="field-grid">
        <label class="field" style="grid-column:1/-1"><span>Sector Name</span><input id="new-sector-name" placeholder="e.g. O Mon District / Cau Giay District"></label>
        <label class="field"><span>Center Latitude</span><input id="new-sector-lat" type="number" step="0.0001" value="${meta.center[0].toFixed(4)}"></label>
        <label class="field"><span>Center Longitude</span><input id="new-sector-lng" type="number" step="0.0001" value="${meta.center[1].toFixed(4)}"></label>
      </div>`,
      actions: '<button class="btn ghost" data-close-modal>Cancel</button><button class="btn" id="save-new-sector">Save Sector</button>'
    });
    modal.querySelector("#save-new-sector").addEventListener("click", () => {
      const name = modal.querySelector("#new-sector-name").value.trim();
      const lat = Number(modal.querySelector("#new-sector-lat").value);
      const lng = Number(modal.querySelector("#new-sector-lng").value);
      if (!name || isNaN(lat) || isNaN(lng)) return UI.toast("Please enter a valid sector name and GPS coordinates.", "error");
      Store.update({ event: "SECTOR_ADDED", detail: name }, (shared) => {
        if (!shared.regionMeta) shared.regionMeta = Store.regionMeta(shared);
        if (!Array.isArray(shared.regionMeta.sectors)) shared.regionMeta.sectors = [];
        shared.regionMeta.sectors.push({ name, lat, lng, latitude: lat, longitude: lng });
      });
      UI.closeModal();
      UI.toast(`Added sector "${name}" to ${meta.operatingArea}.`, "success");
      render();
    });
  }

  function exportDatasetJson() {
    const shared = Store.load();
    const meta = Store.regionMeta(shared);
    const payload = {
      datasetMeta: {
        datasetId: `DS-${meta.operatingArea.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}`,
        regionName: meta.operatingArea,
        country: meta.country || "Vietnam",
        center: meta.center,
        defaultZoom: meta.defaultZoom || 12,
        coverageBounds: meta.coverageBounds,
        exportedAt: new Date().toISOString(),
        sectors: meta.sectors
      },
      settings: shared.settings,
      counters: shared.counters,
      uavs: Demo.UAVS,
      teams: shared.teams,
      incidents: shared.incidents,
      reports: shared.reports,
      dispatchOrders: shared.dispatchOrders
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `dataset_${meta.operatingArea.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    UI.toast(`Exported JSON dataset for ${meta.operatingArea}.`, "success");
  }

  function editTeamModal(teamId) {
    const shared = Store.load();
    const team = shared.teams.find((item) => item.id === teamId);
    const derived = statusForTeam(shared, team);
    const locked = derived === "On Mission";
    const tAttrs = Store.resolveTeamAttributes(team, shared);
    const vehVal = tAttrs.vehicle_type?.value || "rescue_van";
    const heavyVal = Boolean(tAttrs.heavy_debris_gear?.value);
    const modal = UI.modal({
      title: `${team.name} · Equipment, Custom Tags & Status`,
      subtitle: `${team.id} · ${team.commander} · Target: RescueTeam (Source: Admin)`,
      content: `<div class="alert ${locked ? "warning" : ""}"><div>${locked ? "Operational status is locked while a dispatch or mission is active. Equipment and Custom capability tags can still be updated." : "Manual status, Equipment, and RescueTeam Custom Tags (Source: Admin) can be updated."}</div></div>
      <div class="field-grid" style="margin-top:14px">
        <label class="field"><span>Team Status</span><select id="edit-team-status" ${locked ? "disabled" : ""}>${["Available", "Offline"].map((status) => `<option ${status === team.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label class="field"><span>Equipment</span><input id="edit-team-equipment" value="${e(team.equipment || "")}" placeholder="e.g. 02 rescue boats · 04 UAVs"></label>
        <label class="field"><span>vehicle_type (Enum)</span><select id="edit-team-vehicle">${["rescue_van", "rescue_boat", "heavy_truck", "compact_moto"].map((v) => `<option value="${v}" ${vehVal === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="field"><span>heavy_debris_gear (Boolean)</span><select id="edit-team-heavy"><option value="true" ${heavyVal ? "selected" : ""}>true</option><option value="false" ${!heavyVal ? "selected" : ""}>false</option></select></label>
      </div>`,
      actions: `<button class="btn ghost" data-close-modal>Close</button><button class="btn" id="save-team-status">Save Team & Custom Tags</button>`
    });
    modal.querySelector("#save-team-status")?.addEventListener("click", () => {
      const status = modal.querySelector("#edit-team-status").value;
      const equipment = modal.querySelector("#edit-team-equipment").value.trim() || team.equipment;
      const vehicle_type = modal.querySelector("#edit-team-vehicle").value;
      const heavy_debris_gear = modal.querySelector("#edit-team-heavy").value === "true";
      Store.update({ event: "TEAM_CUSTOM_TAGS_UPDATED", detail: `${team.id}: ${vehicle_type}` }, (draft) => {
        const target = draft.teams.find((item) => item.id === team.id);
        if (!locked) target.status = status;
        target.equipment = equipment;
        target.customAttributes = {
          ...(target.customAttributes || {}),
          vehicle_type: { value: vehicle_type, source: "Admin" },
          heavy_debris_gear: { value: heavy_debris_gear, source: "Admin" }
        };
      });
      UI.closeModal(); UI.toast(`Updated ${team.id} status, equipment, and RescueTeam Custom Tags.`, "success"); render();
    });
  }

  function updateSetting(path, value) {
    const parts = path.split(".");
    let target = ui.settingsDraft;
    parts.slice(0, -1).forEach((part) => { target = target[part]; });
    target[parts.at(-1)] = value;
  }

  function exportCsv(oneIncident = null) {
    const shared = Store.load();
    const incidents = oneIncident ? [oneIncident] : filteredReportIncidents(shared);
    const quote = (value) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
    const rows = [["Incident ID", "Time", "Incident Type", "Sector", "LAT", "LON", "Reporter", "Severity Score", "AHP Priority Score", "Rescue Team", "Status"]];
    incidents.forEach((incident) => {
      const mission = Store.missionForIncident(shared, incident.id);
      const report = shared.reports.find((item) => item.id === incident.reportId);
      const m = calculatePriorityMetrics(incident, shared);
      rows.push([incident.id, incident.createdAt, Store.effectiveType(incident), incident.location.district, incident.location.latitude, incident.location.longitude, report?.reporter?.name || "Citizen", incident.severityScore, m.priorityScore.toFixed(4), mission?.teamId || incident.assignedTeamId || "", incident.status]);
    });
    const blob = new Blob(["\ufeff" + rows.map((row) => row.map(quote).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = oneIncident ? `skyrescue_${oneIncident.id}.csv` : "skyrescue_filtered_report.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    UI.toast("CSV export created from the current shared state.", "success");
  }

  function printPreview() {
    const shared = Store.load();
    const incidents = filteredReportIncidents(shared);
    UI.modal({ title: "Print Preview", subtitle: `${incidents.length} filtered incident records`, wide: true, content: `<div class="table-wrap"><table><thead><tr><th>Incident ID</th><th>Time</th><th>Incident Type</th><th>Sector</th><th>LAT</th><th>LON</th><th>Reporter</th><th>Severity Score</th><th>AHP Priority Score</th><th>Rescue Team</th><th>Status</th></tr></thead><tbody>${incidents.map((incident) => { const mission = Store.missionForIncident(shared, incident.id); const report = shared.reports.find((item) => item.id === incident.reportId); const m = calculatePriorityMetrics(incident, shared); return `<tr><td class="mono"><strong>${e(incident.id)}</strong></td><td>${UI.formatDate(incident.createdAt)}</td><td>${e(Store.effectiveType(incident))}</td><td>${e(incident.location.district)}</td><td class="mono">${incident.location.latitude.toFixed(5)}</td><td class="mono">${incident.location.longitude.toFixed(5)}</td><td>${e(report?.reporter?.name || "Citizen")}</td><td>${incident.severityScore}</td><td class="mono"><strong>${m.priorityScore.toFixed(4)}</strong></td><td class="mono">${e(mission?.teamId || incident.assignedTeamId || "—")}</td><td>${e(incident.status)}</td></tr>`; }).join("")}</tbody></table></div><p class="muted" style="margin-top:12px">Use PDF Print on C9 to open the browser print dialog.</p>` });
  }

  // ---- Audit Log screen ------------------------------------------------------
  function auditMatches(entry, f) {
    if (f.event !== "All" && entry.event !== f.event) return false;
    if (f.actor !== "All" && (entry.actor?.name || "System") !== f.actor) return false;
    if (f.entity !== "All" && !(entry.changes || []).some((c) => c.entity === f.entity)) return false;
    const q = String(f.q || "").trim().toLowerCase();
    if (!q) return true;
    const hay = [entry.id, entry.event, entry.detail, entry.actor?.name, entry.actor?.role, ...(entry.changes || []).flatMap((c) => [c.entity, c.id, c.field, c.from, c.to])].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function openAuditChangesModal(auditId) {
    const isVi = UI.getPreferences?.().language === "vi";
    const t = (en, vi) => isVi ? vi : en;
    const shared = Store.load();
    const entry = (shared.audit || []).find((a) => a.id === auditId);
    if (!entry) return;

    const changes = entry.changes || [];
    const targets = [...new Set(changes.map((c) => c.id))];

    const content = `
      <div style="display:flex;flex-direction:column;gap:14px">
        <!-- Summary Box -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px">
          <div>
            <span class="eyebrow" style="color:var(--muted)">${t("Event / Action", "Sự Kiện / Hành Động")}</span>
            <div style="margin-top:4px"><span class="badge neutral mono" style="font-size:12px;font-weight:700">${e(entry.event)}</span></div>
          </div>
          <div>
            <span class="eyebrow" style="color:var(--muted)">${t("Actor / Performed By", "Người Thực Hiện")}</span>
            <div style="margin-top:4px"><strong>${e(entry.actor?.name || "System")}</strong> <span class="muted" style="font-size:11px">(${e(entry.actor?.role || "System")})</span></div>
          </div>
          <div>
            <span class="eyebrow" style="color:var(--muted)">${t("Timestamp", "Thời Gian Ghi Nhận")}</span>
            <div class="mono" style="margin-top:4px;font-size:12px">${UI.formatDate(entry.at)}</div>
          </div>
          <div>
            <span class="eyebrow" style="color:var(--muted)">${t("Total Changes", "Tổng Số Thay Đổi")}</span>
            <div style="margin-top:4px"><span class="badge info" style="font-size:12px;font-weight:700">${changes.length} ${t("field change(s)", "thay đổi trường")}</span></div>
          </div>
        </div>

        ${entry.detail ? `
          <div style="border-left:4px solid var(--blue);padding:10px 14px;border-radius:4px;background:#f0f7ff">
            <div class="eyebrow" style="color:var(--blue);font-weight:700">${t("Operation Summary / Detail", "Tóm Tắt Tác Vụ")}</div>
            <div style="margin-top:4px;font-size:13.5px;color:#1e293b;line-height:1.5">${e(entry.detail)}</div>
          </div>
        ` : ""}

        <!-- Detailed Changes Table -->
        <div>
          <div class="row-between" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <h4 style="margin:0">${t("Field-Level Differences", "Chi Tiết Biến Động Từng Trường")} (${changes.length})</h4>
            <div class="row" style="gap:8px;align-items:center">
              ${targets.length ? `<span class="badge neutral" style="font-size:11px">${targets.length} ${t("record(s) affected", "bản ghi ảnh hưởng")}</span>` : ""}
              ${changes.length > 5 ? `<input id="audit-modal-filter" type="search" placeholder="${t("Filter records or fields...", "Lọc theo bản ghi hoặc trường...")}" style="padding:5px 10px;font-size:12px;border:1px solid #cbd5e1;border-radius:6px;width:220px">` : ""}
            </div>
          </div>

          ${changes.length ? `
            <div class="table-wrap" style="max-height:480px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px">
              <table style="width:100%;border-collapse:collapse;font-size:12.5px" id="audit-modal-table">
                <thead style="position:sticky;top:0;background:#f8fafc;z-index:2;box-shadow:0 1px 2px rgba(0,0,0,0.05)">
                  <tr>
                    <th style="padding:10px 14px;text-align:left;width:20%">${t("Record / Target", "Bản Ghi / Đối Tượng")}</th>
                    <th style="padding:10px 14px;text-align:left;width:18%">${t("Field", "Trường")}</th>
                    <th style="padding:10px 14px;text-align:left;width:31%;color:#991b1b">${t("Value Before (Old)", "Giá Trị Trước (Cũ)")}</th>
                    <th style="padding:10px 14px;text-align:left;width:31%;color:#166534">${t("Value After (New)", "Giá Trị Sau (Mới)")}</th>
                  </tr>
                </thead>
                <tbody>
                  ${changes.map((c) => {
                    const fromStr = c.from === undefined || c.from === null || c.from === "" || c.from === "—" ? "—" : String(c.from);
                    const toStr = c.to === undefined || c.to === null || c.to === "" || c.to === "—" ? "—" : String(c.to);
                    return `
                      <tr style="border-bottom:1px solid #f1f5f9">
                        <td class="mono" style="padding:10px 14px;vertical-align:top">
                          <span class="badge neutral" style="font-size:11px;font-weight:600">${e(c.entity)}</span>
                          <strong style="margin-left:4px;color:var(--navy)">${e(c.id)}</strong>
                        </td>
                        <td class="mono" style="padding:10px 14px;vertical-align:top;font-weight:600;color:#334155">${e(c.field)}</td>
                        <td style="padding:10px 14px;vertical-align:top">
                          <div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:6px 10px;border-radius:6px;font-family:monospace;font-size:12px;word-break:break-all;line-height:1.45">
                            ${fromStr === "—" ? `<span style="color:#94a3b8;font-style:italic">— (${t("empty", "trống")})</span>` : e(fromStr)}
                          </div>
                        </td>
                        <td style="padding:10px 14px;vertical-align:top">
                          <div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:6px 10px;border-radius:6px;font-family:monospace;font-size:12px;font-weight:700;word-break:break-all;line-height:1.45">
                            ${toStr === "—" ? `<span style="color:#94a3b8;font-style:italic">— (${t("empty", "trống")})</span>` : e(toStr)}
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            </div>
            ${changes.length >= 40 ? `<p class="muted" style="font-size:11.5px;margin-top:6px">⚠️ ${t("Showing the first 40 changes recorded for performance.", "Chỉ hiển thị 40 thay đổi đầu tiên được ghi nhận để tối ưu hiệu năng.")}</p>` : ""}
          ` : `
            <div style="padding:24px;text-align:center;background:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1;color:var(--muted)">
              ${t("No field-level changes recorded for this event.", "Sự kiện này không có thay đổi ở cấp độ trường.")}
            </div>
          `}
        </div>
      </div>
    `;

    const modal = UI.modal({
      title: `${t("Audit Log Entry Details", "Chi Tiết Nhật Ký Kiểm Toán")} · ${entry.id}`,
      subtitle: `${entry.event} · ${entry.actor?.name || "System"} · ${UI.formatDate(entry.at)}`,
      content,
      wide: true,
      actions: `<button class="btn" data-close-modal>${t("Close", "Đóng")}</button>`
    });

    const filterInput = modal.querySelector("#audit-modal-filter");
    if (filterInput) {
      filterInput.addEventListener("input", (ev) => {
        const query = ev.target.value.toLowerCase().trim();
        const rows = modal.querySelectorAll("#audit-modal-table tbody tr");
        rows.forEach((row) => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(query) ? "" : "none";
        });
      });
    }
  }

  function renderAudit() {
    const isVi = UI.getPreferences?.().language === "vi";
    const t = (en, vi) => isVi ? vi : en;
    const shared = Store.load();
    const all = shared.audit || [];
    const f = ui.audit;
    const events = [...new Set(all.map((a) => a.event))].sort();
    const actors = [...new Set(all.map((a) => a.actor?.name || "System"))].sort();
    const entities = [...new Set(all.flatMap((a) => (a.changes || []).map((c) => c.entity)))].sort();
    const filtered = all.filter((entry) => auditMatches(entry, f));
    const shown = filtered.slice(0, f.limit);
    const opt = (list, current) => ["All", ...list].map((v) => `<option value="${e(v)}" ${v === current ? "selected" : ""}>${e(v)}</option>`).join("");
    const rows = shown.map((entry) => {
      const changes = entry.changes || [];
      const targets = [...new Set(changes.map((c) => c.id))];
      const targetLabel = targets.length ? `${e(targets.slice(0, 2).join(", "))}${targets.length > 2 ? ` +${targets.length - 2}` : ""}` : "—";
      return `<tr>
        <td class="mono" style="white-space:nowrap">${UI.formatDate(entry.at)}</td>
        <td>
          <strong>${e(entry.actor?.name || "System")}</strong>
          <div class="muted" style="font-size:11px">${e(entry.actor?.role || "")}</div>
        </td>
        <td><span class="badge neutral mono" style="font-size:10px">${e(entry.event)}</span></td>
        <td class="mono">${targetLabel}</td>
        <td>
          <div style="font-size:13px;line-height:1.45;color:#1e293b">${e(entry.detail || "—")}</div>
          ${changes.length ? `
            <button class="btn small" style="margin-top:6px;padding:3px 10px;font-size:11.5px;background:#1e40af;color:#fff;border-radius:6px;display:inline-flex;align-items:center;gap:6px;font-weight:600" data-audit-view="${e(entry.id)}">
              <span>🔍</span> ${t("View Detailed Changes", "Xem Chi Tiết Thay Đổi")} (${changes.length})
            </button>
          ` : `<span class="muted" style="font-size:11px;display:block;margin-top:3px">${t("No field changes", "Không có thay đổi trường")}</span>`}
        </td>
      </tr>`;
    }).join("");
    return pageHead("Audit Log", t("Audit Log · Edit History", "Nhật ký kiểm toán · Lịch sử chỉnh sửa"), t("Who changed which record, when, and from what value to what value. Newest first.", "Ai đã sửa bản ghi nào, lúc nào, từ giá trị nào sang giá trị nào. Mới nhất ở trên."),
      `<button class="btn secondary" data-audit-export>${t("Export CSV", "Xuất CSV")}</button>`) +
      `<section class="card"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <label class="field" style="margin:0;min-width:220px;flex:1"><span>${t("Search", "Tìm kiếm")}</span><input id="audit-q" type="search" placeholder="INC-8801, severity, Admin…" value="${e(f.q)}"></label>
        <label class="field" style="margin:0"><span>${t("Event", "Sự kiện")}</span><select id="audit-event">${opt(events, f.event)}</select></label>
        <label class="field" style="margin:0"><span>${t("Actor", "Người thực hiện")}</span><select id="audit-actor">${opt(actors, f.actor)}</select></label>
        <label class="field" style="margin:0"><span>${t("Record type", "Loại bản ghi")}</span><select id="audit-entity">${opt(entities, f.entity)}</select></label>
        <span class="badge neutral">${filtered.length} / ${all.length}</span>
      </div>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>${t("Time", "Thời gian")}</th><th>${t("Actor", "Người thực hiện")}</th><th>${t("Event", "Sự kiện")}</th><th>${t("Record", "Bản ghi")}</th><th>${t("Changes", "Thay đổi")}</th></tr></thead><tbody>${rows}</tbody></table></div>${filtered.length > shown.length ? `<div style="margin-top:12px"><button class="btn ghost" data-audit-more>${t("Show more", "Xem thêm")} (${filtered.length - shown.length})</button></div>` : ""}` : UI.empty("☰", t("No audit entries", "Chưa có nhật ký"), t("No entries match the current filters.", "Không có mục nào khớp bộ lọc."))}
      <p class="muted" style="margin-top:12px;font-size:12px">${t("Prototype note: the log is stored in this browser (localStorage), keeps the latest 1,000 entries, and is not tamper-proof. A production system needs an append-only server-side store.", "Lưu ý bản mẫu: nhật ký lưu trong trình duyệt (localStorage), giữ 1.000 mục gần nhất và chưa chống sửa đổi. Hệ thống thật cần kho phía máy chủ chỉ cho phép ghi thêm.")}</p>
      </section>`;
  }

  function bindAudit() {
    const refocus = (id, pos) => { const el = document.getElementById(id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {} } };
    const q = document.getElementById("audit-q");
    q?.addEventListener("input", () => { ui.audit.q = q.value; ui.audit.limit = 100; const pos = q.selectionStart; render(); refocus("audit-q", pos); });
    [["audit-event", "event"], ["audit-actor", "actor"], ["audit-entity", "entity"]].forEach(([id, key]) => {
      document.getElementById(id)?.addEventListener("change", (ev) => { ui.audit[key] = ev.target.value; ui.audit.limit = 100; render(); });
    });
    document.querySelector("[data-audit-more]")?.addEventListener("click", () => { ui.audit.limit += 100; render(); });
    document.querySelector("[data-audit-export]")?.addEventListener("click", exportAuditCsv);
    document.querySelectorAll("[data-audit-view]").forEach((button) => {
      button.addEventListener("click", () => {
        openAuditChangesModal(button.dataset.auditView);
      });
    });
  }

  function exportAuditCsv() {
    const shared = Store.load();
    const quote = (value) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
    const rows = [["Audit ID", "Time (ISO)", "Actor", "Role", "Event", "Detail", "Record type", "Record ID", "Field", "Before", "After"]];
    (shared.audit || []).filter((entry) => auditMatches(entry, ui.audit)).forEach((entry) => {
      const base = [entry.id, entry.at, entry.actor?.name || "System", entry.actor?.role || "", entry.event, entry.detail || ""];
      if (!(entry.changes || []).length) rows.push([...base, "", "", "", "", ""]);
      (entry.changes || []).forEach((c) => rows.push([...base, c.entity, c.id, c.field, c.from, c.to]));
    });
    const blob = new Blob(["﻿" + rows.map((row) => row.map(quote).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "skyrescue_audit_log.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function bindCommon() {
    document.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => go(button.dataset.screen)));
    document.querySelectorAll("[data-c2-mode]").forEach((button) => button.addEventListener("click", () => { ui.c2Mode = button.dataset.c2Mode || "queue"; render(); }));
    document.querySelectorAll("[data-workspace-select]").forEach((button) => button.addEventListener("click", () => { ui.workspaceIncidentId = button.dataset.workspaceSelect; ui.selectedIncidentId = ui.workspaceIncidentId; ui.selectedTeamId = null; render(); }));
    document.querySelectorAll("[data-workspace-team]").forEach((button) => button.addEventListener("click", () => { ui.selectedTeamId = button.dataset.workspaceTeam; render(); }));
    document.querySelectorAll("[data-audit-for]").forEach((button) => button.addEventListener("click", () => { ui.audit = { q: button.dataset.auditFor, event: "All", actor: "All", entity: "All", limit: 100 }; go("Audit"); }));
    document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => go("C3", button.dataset.open)));
    document.querySelectorAll("[data-report-review]").forEach((button) => button.addEventListener("click", () => {
      ui.reviewingReportId = button.dataset.reportReview;
      const report = Store.load().reports.find((item) => item.id === ui.reviewingReportId);
      if (report?.incidentId) ui.selectedIncidentId = report.incidentId;
      go("C9R");
    }));
    document.querySelectorAll("[data-open-c4]").forEach((button) => button.addEventListener("click", () => { ui.selectedIncidentId = button.dataset.openC4; go("C4"); }));
    document.querySelectorAll("[data-dossier]").forEach((button) => button.addEventListener("click", () => { ui.dossierId = button.dataset.dossier; go("C9D"); }));
    document.querySelectorAll("[data-detection]").forEach((node) => node.addEventListener("click", () => { ui.selectedDetectionId = node.dataset.detection; render(); }));
    document.querySelectorAll("[data-team-select]").forEach((row) => row.addEventListener("click", () => { ui.selectedTeamId = row.dataset.teamSelect; ui.c4OverrideTeamId = null; render(); }));
    document.querySelectorAll("[data-override-team]").forEach((btn) => btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ui.c4OverrideTeamId = btn.dataset.overrideTeam;
      ui.selectedTeamId = btn.dataset.overrideTeam;
      if (!ui.c4OverrideReason) {
        ui.c4OverrideReason = "Coordinator emergency override: No unit met all hard constraints; deploying closest unit with portable gear.";
      }
      UI.toast(`Coordinator Override selected for ${btn.dataset.overrideTeam}. Review audit warning before proceeding to C5.`, "warning");
      render();
    }));
    const overrideInput = document.querySelector("#c4-override-reason");
    if (overrideInput) {
      overrideInput.addEventListener("input", () => { ui.c4OverrideReason = overrideInput.value; });
    }
    document.querySelectorAll("[data-map-type]").forEach((button) => button.addEventListener("click", () => {
      // Clicking the selected chip clears the hazard-type filter.
      const nextType = ui.mapType === button.dataset.mapType ? "All" : button.dataset.mapType;
      ui.mapType = nextType;
      // Keep a province drill-down only when the new type exists there.
      if (ui.mapProvince && nextType !== "All") {
        const hasInProvince = Store.load().incidents.some((incident) =>
          incident.status !== "Resolved" &&
          Store.effectiveType(incident) === nextType &&
          incident.location.province === ui.mapProvince &&
          matchesTimeRange(incident.createdAt, ui.mapTimeRange)
        );
        if (!hasInProvince) ui.mapProvince = null;
      }
      ui.focusedIncidentId = null;
      ui.mapView = null;
      ui.mapScopeKey = null;
      render();
    }));
    document.querySelector("[data-map-province-reset]")?.addEventListener("click", () => {
      ui.mapProvince = null;
      ui.focusedIncidentId = null;
      ui.mapView = null;
      ui.mapScopeKey = null;
      render();
    });
    const mapRangeSel = document.querySelector("#map-time-range");
    if (mapRangeSel) mapRangeSel.addEventListener("change", () => { ui.mapTimeRange = mapRangeSel.value; ui.focusedIncidentId = null; render(); });
    document.querySelectorAll("[data-focus]").forEach((button) => button.addEventListener("click", () => { ui.focusedIncidentId = button.dataset.focus; render(); }));
    document.querySelectorAll("[data-q]").forEach((select) => select.addEventListener("change", () => { ui.queue[select.dataset.q] = select.value; render(); }));
    document.querySelectorAll("[data-queue-view]").forEach((button) => button.addEventListener("click", () => { ui.queue.viewMode = button.dataset.queueView; render(); }));
    document.querySelectorAll("[data-report-filter]").forEach((select) => select.addEventListener("change", () => { ui.reportFilters[select.dataset.reportFilter] = select.value; render(); }));
    const adminType = document.querySelector("#admin-review-type");
    if (adminType) adminType.addEventListener("change", () => {
      const locked = adminType.value === "Unclassified";
      const verifyButton = document.querySelector("#verify-report-btn");
      const matchButton = document.querySelector("#verify-match-btn");
      const warning = document.querySelector("#admin-type-warning");
      if (verifyButton) verifyButton.disabled = locked;
      if (matchButton) matchButton.disabled = locked;
      if (warning) warning.style.display = locked ? "" : "none";
    });
    document.querySelectorAll("[data-queue-tab]").forEach((button) => button.addEventListener("click", () => { ui.queue.tab = button.dataset.queueTab; render(); }));
    document.querySelectorAll("[data-edit-team]").forEach((button) => button.addEventListener("click", () => editTeamModal(button.dataset.editTeam)));
    document.querySelectorAll("[data-scene-tag]").forEach((button) => button.addEventListener("click", () => toggleSceneTag(button.dataset.sceneTag)));
    document.querySelectorAll("[data-rule-toggle]").forEach((toggle) => toggle.addEventListener("change", () => {
      if (!ui.settingsDraft.ruleEngine) ui.settingsDraft.ruleEngine = JSON.parse(JSON.stringify(Store.ruleEngineConfig(Store.load())));
      const rule = ui.settingsDraft.ruleEngine.rules.find((r) => r.id === toggle.dataset.ruleToggle);
      if (rule) {
        rule.enabled = toggle.checked;
        render();
      }
    }));
    document.querySelectorAll("[data-rule-weight]").forEach((slider) => slider.addEventListener("input", () => {
      if (!ui.settingsDraft.ruleEngine) ui.settingsDraft.ruleEngine = JSON.parse(JSON.stringify(Store.ruleEngineConfig(Store.load())));
      const rule = ui.settingsDraft.ruleEngine.rules.find((r) => r.id === slider.dataset.ruleWeight);
      if (rule) {
        rule.weightDelta = Number(slider.value);
        const label = document.querySelector(`#rule-weight-val-${rule.id}`);
        if (label) label.textContent = `${rule.weightDelta >= 0 ? `+${rule.weightDelta}` : rule.weightDelta} pts`;
      }
    }));
    document.querySelectorAll(".context-weight-input").forEach((inp) => inp.addEventListener("change", () => {
      if (!ui.settingsDraft.ruleEngine) ui.settingsDraft.ruleEngine = JSON.parse(JSON.stringify(Store.ruleEngineConfig(Store.load())));
      const rId = inp.dataset.ruleId;
      const incType = inp.dataset.incidentType;
      const num = Number(inp.value);
      const rule = ui.settingsDraft.ruleEngine.rules.find((r) => r.id === rId);
      if (rule) {
        rule.contextWeights = rule.contextWeights || {};
        rule.contextWeights[incType] = isNaN(num) ? 0 : num;
        render();
      }
    }));
    document.querySelectorAll("[data-toggle-zero]").forEach((badge) => badge.addEventListener("click", () => {
      if (!ui.settingsDraft.ruleEngine) ui.settingsDraft.ruleEngine = JSON.parse(JSON.stringify(Store.ruleEngineConfig(Store.load())));
      const rId = badge.dataset.toggleZero;
      const incType = badge.dataset.type;
      const rule = ui.settingsDraft.ruleEngine.rules.find((r) => r.id === rId);
      if (rule) {
        rule.contextWeights = rule.contextWeights || {};
        const current = rule.contextWeights[incType] ?? rule.weightDelta ?? 0;
        rule.contextWeights[incType] = current === 0 ? (rule.weightDelta || 8) : 0;
        render();
      }
    }));
    document.querySelectorAll('[data-action="reset-context-matrix"]').forEach((btn) => btn.addEventListener("click", () => {
      if (!ui.settingsDraft.ruleEngine) ui.settingsDraft.ruleEngine = JSON.parse(JSON.stringify(Store.ruleEngineConfig(Store.load())));
      const defRules = Demo.DEFAULT_RULE_ENGINE?.rules || [];
      ui.settingsDraft.ruleEngine.rules.forEach((r) => {
        const def = defRules.find((dr) => dr.id === r.id);
        if (def && def.contextWeights) {
          r.contextWeights = JSON.parse(JSON.stringify(def.contextWeights));
        }
      });
      UI.toast("Restored recommended context weights matrix.", "info");
      render();
    }));
    const ruleVersionInput = document.querySelector("#rule-engine-version");
    if (ruleVersionInput) {
      ruleVersionInput.addEventListener("input", () => {
        if (!ui.settingsDraft.ruleEngine) ui.settingsDraft.ruleEngine = JSON.parse(JSON.stringify(Store.ruleEngineConfig(Store.load())));
        ui.settingsDraft.ruleEngine.version = ruleVersionInput.value.trim() || "v2.5.0-controlled";
      });
    }
    const ruleMissingPolicy = document.querySelector("#rule-missing-policy");
    if (ruleMissingPolicy) {
      ruleMissingPolicy.addEventListener("change", () => {
        if (!ui.settingsDraft.ruleEngine) ui.settingsDraft.ruleEngine = JSON.parse(JSON.stringify(Store.ruleEngineConfig(Store.load())));
        ui.settingsDraft.ruleEngine.missingDataPolicy = ruleMissingPolicy.value;
        render();
      });
    }
    document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "clear-queue") { ui.queue = { type: "All", district: "All", severity: "All", status: "All", timeRange: "7d", sort: "priority", tab: "auto", viewMode: ui.queue.viewMode || "table", codeRedOnly: false }; render(); }
      if (action === "toggle-code-red-filter") { ui.queue.codeRedOnly = !ui.queue.codeRedOnly; render(); }
      if (action === "verify-report") verifyReportByAdmin();
      if (action === "edit-type") reopenAutoVerifiedForTypeEdit(ui.selectedIncidentId);
      if (action === "verify-match") verifyReportByAdmin({ continueToMatch: true });
      if (action === "triage-dispatch") confirmTriageDispatch();
      if (action === "rerun-ai") Trace.rerun(button.dataset.report);
      if (action === "delete-report") deleteReportByAdmin();
      if (action === "delete-report-id") {
        const delId = button.dataset.deleteId;
        deleteReportByAdmin(delId);
      }
      if (action === "close-normal") closeNormal();
      if (action === "confirm-dispatch") {
        if (UI.canAccess && !UI.canAccess("canDispatch")) {
          return UI.toast("Action Restricted: Only Command Coordinators can issue dispatch orders.", "warning");
        }
        confirmDispatch();
      }
      if (action === "finalize") finalizeIncident();
      if (action === "add-team") addTeamModal();
      if (action === "add-sector-modal") addSectorModal();
      if (action === "add-custom-tag-modal") addCustomTagModal();
      if (action === "add-custom-rule-modal") addCustomRuleModal();
      if (action === "c4-preset-alley") applyC4Preset("alley");
      if (action === "c4-preset-missing") applyC4Preset("missing");
      if (action === "c4-preset-deadlock") applyC4Preset("deadlock");
      if (action === "c4-preset-standard") applyC4Preset("standard");
      if (action === "export-dataset-json") exportDatasetJson();
      if (action === "load-region-dataset") {
        const targetRegion = ui.settingsDraft?.operatingArea || "Vietnam";
        const next = Store.switchRegionDataset(targetRegion);
        ui.settingsDraft = JSON.parse(JSON.stringify(next.settings));
        ui.selectedIncidentId = next.incidents[0]?.id || null;
        ui.focusedIncidentId = null;
        ui.mapTimeRange = "7d";
        ui.queue = { type: "All", district: "All", severity: "All", status: "All", timeRange: "7d", sort: "priority", tab: "auto", viewMode: ui.queue.viewMode || "table", codeRedOnly: false };
        ui.reportFilters = { range: "All", type: "All", district: "All", status: "All", team: "All" };
        UI.toast(`Switched system-wide active dataset to: ${targetRegion}`, "success");
        render();
      }
      if (action === "cancel-settings") { ui.settingsDraft = JSON.parse(JSON.stringify(Store.load().settings)); go("C1"); }
      if (action === "save-settings") {
        const currentShared = Store.load();
        const currentArea = Store.regionMeta(currentShared).operatingArea;
        const targetArea = ui.settingsDraft.operatingArea;
        if (targetArea !== currentArea && Demo.REGION_PROFILES && Demo.REGION_PROFILES[targetArea]) {
          const next = Store.switchRegionDataset(targetArea);
          Store.update({ event: "SETTINGS_SAVED", detail: targetArea }, (shared) => {
            shared.settings = JSON.parse(JSON.stringify(ui.settingsDraft));
          });
          ui.selectedIncidentId = next.incidents[0]?.id || null;
          ui.focusedIncidentId = null;
          ui.mapTimeRange = "7d";
          ui.queue = { type: "All", district: "All", severity: "All", status: "All", timeRange: "7d", sort: "priority", tab: "auto", viewMode: ui.queue.viewMode || "table", codeRedOnly: false };
          ui.reportFilters = { range: "All", type: "All", district: "All", status: "All", team: "All" };
          UI.toast(`Configuration saved and switched active dataset to ${targetArea}.`, "success");
        } else {
          Store.update({ event: "SETTINGS_SAVED", detail: targetArea }, (shared) => {
            shared.settings = JSON.parse(JSON.stringify(ui.settingsDraft));
          });
          UI.toast("Alert configuration saved and persisted.", "success");
        }
        go("C1");
      }
      if (action === "clear-report-filters") { ui.reportFilters = { range: "All", type: "All", district: "All", status: "All", team: "All" }; render(); }
      if (action === "export-csv") exportCsv();
      if (action === "export-dossier") exportCsv(Store.load().incidents.find((item) => item.id === ui.dossierId));
      if (action === "print-preview") printPreview();
      if (action === "print-page") window.print();
    }));
    const importInput = document.querySelector("#import-dataset-file");
    if (importInput) {
      importInput.addEventListener("change", (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(reader.result);
            const next = Store.importDataset(parsed);
            ui.settingsDraft = JSON.parse(JSON.stringify(next.settings));
            ui.selectedIncidentId = next.incidents[0]?.id || null;
            ui.focusedIncidentId = null;
            ui.mapTimeRange = "7d";
            ui.queue = { type: "All", district: "All", severity: "All", status: "All", timeRange: "7d", sort: "priority", tab: "auto", viewMode: ui.queue.viewMode || "table", codeRedOnly: false };
            ui.reportFilters = { range: "All", type: "All", district: "All", status: "All", team: "All" };
            UI.toast(`Successfully imported dataset "${next.regionMeta.operatingArea}" (${next.incidents.length} incidents, ${next.teams.length} rescue teams).`, "success");
            render();
          } catch (err) {
            UI.toast(`Failed to parse JSON Dataset: ${err.message}`, "error");
          }
        };
        reader.readAsText(file);
      });
    }
    const teamStatus = document.querySelector("#team-status");
    if (teamStatus) teamStatus.addEventListener("change", () => { ui.teams.status = teamStatus.value; render(); });
    const teamSearch = document.querySelector("#team-search");
    if (teamSearch) teamSearch.addEventListener("input", () => { ui.teams.search = teamSearch.value; render(); document.querySelector("#team-search")?.focus(); });
    const operating = document.querySelector("#operating-area");
    if (operating) operating.addEventListener("change", () => { ui.settingsDraft.operatingArea = operating.value; render(); });
    const overload = document.querySelector("#overload-limit");
    if (overload) overload.addEventListener("input", () => { ui.settingsDraft.reportOverloadLimit = Number(overload.value); document.querySelector("#limit-value").textContent = overload.value; });
    document.querySelectorAll("[data-setting]").forEach((toggle) => toggle.addEventListener("change", () => updateSetting(toggle.dataset.setting, toggle.checked)));
    document.querySelectorAll("[data-threshold]").forEach((slider) => slider.addEventListener("input", () => {
      ui.settingsDraft.alertThresholds[slider.dataset.threshold] = Number(slider.value);
      document.querySelector(`#threshold-${slider.dataset.threshold.replaceAll(" ", "-")}`).textContent = slider.value;
      const shared = Store.load();
      const count = shared.incidents.filter((incident) => { const type = Store.effectiveType(incident); return incident.status !== "Resolved" && ui.settingsDraft.alertThresholds[type] != null && incident.severityScore >= ui.settingsDraft.alertThresholds[type]; }).length;
      const badge = document.querySelector("#severe-count"); if (badge) badge.textContent = `${count} severe active`;
    }));
    UI.bindDemoControls((scenario) => {
      if (scenario === "no-teams") { ui.selectedIncidentId = "INC-8802"; go("C4"); }
      else if (scenario === "ai-correction") { ui.selectedIncidentId = "INC-8801"; go("C3"); }
      else if (scenario === "partial") { ui.selectedIncidentId = "INC-8802"; go("C3"); }
      else { go("C1"); }
    });
  }

  function render() {
    ensureAhpSnapshot();
    renderNav();
    // Leaflet owns its DOM node. Save the view before replacing the screen so a
    // data refresh does not reset the operator's zoom or pan.
    if (ui.map) {
      try { ui.mapView = { center: ui.map.getCenter(), zoom: ui.map.getZoom() }; } catch (_) {}
      try { ui.map.stop(); } catch (_) {}
      try { ui.map.remove(); } catch (_) {}
      ui.map = null;
      ui.markerLayer = null;
      ui.markers = new Map();
    }
    const renderer = { C1: renderC1, C2: renderC2, C3: renderC3, C4: renderC4, C5: renderC5, C7: renderC7, C8: renderConfiguration, Configuration: renderConfiguration, C9: renderC9, Audit: renderAudit, C9R: renderC9R, C9D: renderC9D }[ui.screen] || renderC1;
    root.innerHTML = renderer();
    bindCommon();
    if (ui.screen === "Audit") bindAudit();
    if (ui.screen === "C1") setTimeout(initLeaflet, 0);
    if (ui.screen === "C2" && ui.highlightedIncidentId && ui.highlightScrollPending) {
      setTimeout(() => {
        const highlighted = document.querySelector(`[data-queue-incident="${ui.highlightedIncidentId}"]`);
        highlighted?.scrollIntoView({ behavior: "smooth", block: "center" });
        ui.highlightScrollPending = false;
      }, 80);
    }
    if (UI.applyLanguage && UI.getPreferences) setTimeout(() => UI.applyLanguage(UI.getPreferences().language), 0);
  }

  window.DispatchApp = {
    openIncident: (id) => go("C3", id),
    mapState: () => ui.map ? { center: ui.map.getCenter(), zoom: ui.map.getZoom() } : null,
    focusProvince: (province) => {
      if (!province) return;
      ui.mapProvince = province;
      ui.focusedIncidentId = null;
      ui.mapView = null;
      ui.mapScopeKey = null;
      render();
    }
  };
  window.addEventListener("hashchange", () => {
    let screen = location.hash.replace("#", "");
    if (screen === "C8" || screen === "configuration" || screen === "cfg") screen = "Configuration";
    if ([...SCREENS.map((item) => item[0]), "C3", "C4", "C5", "C8", "Configuration", "Audit", "C9R", "C9D"].includes(screen) && screen !== ui.screen) { ui.screen = screen; render(); }
  });
  let knownReports = new Set(Store.load().reports.map((report) => report.id));
  let autoVerifyRunning = false;
  let renderTimer = null;

  // F1: trusted-source auto-verification runs on the Dispatch client in the demo
  // (production should move the same policy to the server). It only marks the
  // data verified; it never dispatches.
  function runAutoVerification(next = Store.load()) {
    if (autoVerifyRunning) return;
    const candidates = (next.reports || []).filter((report) =>
      report.autoVerifyPolicy &&
      report.uploadStatus === "Uploaded" &&
      report.processingStatus === "Completed" &&
      report.verificationStatus !== "verified" &&
      !report.autoVerifyCheckedAt
    );
    if (!candidates.length) return;
    autoVerifyRunning = true;
    const expected = [];
    try {
      // Preview on a clone so the audit event is only written when something
      // actually verifies, and so the real state is updated exactly once.
      const preview = JSON.parse(JSON.stringify(Store.load()));
      candidates.forEach((report) => {
        Store.evaluateReportVerification(preview, report.id);
        const target = preview.reports.find((item) => item.id === report.id);
        if (target?.verificationStatus === "verified") expected.push(`${target.id}:${target.verificationMethod || "auto"}`);
      });
      Store.update(expected.length ? { event: "REPORT_AUTO_VERIFIED", detail: expected.join(", ") } : null, (draft) => {
        candidates.forEach((report) => {
          Store.evaluateReportVerification(draft, report.id);
          const target = draft.reports.find((item) => item.id === report.id);
          if (target) target.autoVerifyCheckedAt = new Date().toISOString();
        });
      });
    } finally {
      autoVerifyRunning = false;
    }
    if (expected.length) UI.toast(`Auto-verified ${expected.length} trusted report(s).`, "success");
  }

  Store.subscribe((next) => {
    const fresh = (next?.reports || []).filter((report) => !knownReports.has(report.id) && report.uploadStatus === "Uploaded");
    knownReports = new Set((next?.reports || []).map((report) => report.id));
    if (fresh.length) UI.toast(`New report: ${fresh.map((report) => report.id).join(", ")} · Review Inbox`, "success");
    runAutoVerification(next);
    invalidateAhpSnapshot();
    if (document.querySelector(".modal-backdrop")) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 40);
  });
  window.addEventListener("skyrescue:preferences:change", () => render());
  window.addEventListener("skyrescue:auth:change", () => { if (UI.enforcePageAccess()) render(); });
  setInterval(() => {
    const clock = document.querySelector("#dispatch-clock");
    if (clock) clock.textContent = UI.formatRegionClock ? UI.formatRegionClock() : `Operational console · ${new Date().toLocaleTimeString("en-GB")}`;
  }, 1000);
  render();
})();
