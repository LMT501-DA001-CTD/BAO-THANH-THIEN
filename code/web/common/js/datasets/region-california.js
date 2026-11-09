(function () {
  "use strict";

  window.SkyRescueRegionRegistry = window.SkyRescueRegionRegistry || {};

  const profile = {
    regionId: "US-CA-LA",
    operatingArea: "Los Angeles County, CA",
    country: "United States",
    timeZone: "America/Los_Angeles",
    tzShort: "PDT (UTC-07:00)",
    center: [34.0522, -118.2437],
    defaultZoom: 11,
    coverageBounds: { minLat: 33.72, maxLat: 34.34, minLng: -118.68, maxLng: -118.08 },
    sectors: [
      { name: "Downtown Los Angeles", latitude: 34.0407, longitude: -118.2468 },
      { name: "Hollywood Hills", latitude: 34.1177, longitude: -118.3520 },
      { name: "Santa Monica", latitude: 34.0195, longitude: -118.4912 },
      { name: "Pasadena Sector", latitude: 34.1478, longitude: -118.1445 },
      { name: "Long Beach Harbor", latitude: 33.7701, longitude: -118.1937 }
    ]
  };

  function buildDataset(helpers) {
    const { incident, report, relativeIso, UAVS } = helpers;
    const p = "Los Angeles County, CA";

    const incidents = [
      incident({ id: "INC-US01", reportId: "REP-US01", type: "Fire", district: "Hollywood Hills", province: p, lat: 34.1177, lng: -118.3520, severity: 92.8, confidence: 97.4, poseConfidence: 93.6, count: 4, status: "Not Reviewed", minutesAgo: 12 }),
      incident({ id: "INC-US02", reportId: "REP-US02", type: "Flood", reviewedType: "Flood", district: "Downtown Los Angeles", province: p, lat: 34.0407, lng: -118.2468, severity: 84.6, confidence: 95.2, poseConfidence: 91.0, count: 5, status: "Matching Team", minutesAgo: 42, customTags: ["narrow_alley", "fast_current"] }),
      incident({ id: "INC-US03", reportId: "REP-US03", type: "Building Collapse", reviewedType: "Building Collapse", district: "Pasadena Sector", province: p, lat: 34.1478, lng: -118.1445, severity: 88.2, confidence: 96.1, poseConfidence: 92.4, count: 3, status: "Team Matched", teamId: "USAR-CA1", dispatchId: "DSP-US03", minutesAgo: 55 }),
      incident({ id: "INC-US04", reportId: "REP-US04", type: "Traffic Accident", reviewedType: "Traffic Accident", district: "Long Beach Harbor", province: p, lat: 33.7701, lng: -118.1937, severity: 74.0, confidence: 92.8, poseConfidence: 89.5, count: 2, status: "In Progress", teamId: "LAFD-02", dispatchId: "DSP-US04", minutesAgo: 110 }),
      incident({ id: "INC-US05", reportId: "REP-US05", type: "Normal", reviewedType: "Normal", district: "Santa Monica", province: p, lat: 34.0195, lng: -118.4912, severity: 18.5, confidence: 98.1, poseConfidence: 95.0, count: 1, status: "Resolved", minutesAgo: 720, note: "Routine coastal UAV overflight; no emergency hazard detected." })
    ];

    const reports = [
      report({ id: "REP-US01", incidentId: "INC-US01", type: "Fire", minutesAgo: 12, filename: "UAV_LAFD_HILLS_FIRE_01.JPG", lat: 34.1177, lng: -118.3520 }),
      report({ id: "REP-US02", incidentId: "INC-US02", type: "Flood", minutesAgo: 42, filename: "UAV_LA_RIVER_FLOOD_02.JPG", lat: 34.0407, lng: -118.2468 }),
      report({ id: "REP-US03", incidentId: "INC-US03", type: "Building Collapse", minutesAgo: 55, uav: "AEGIS-UAV-12", filename: "UAV_PASADENA_SEISMIC_03.JPG", lat: 34.1478, lng: -118.1445 }),
      report({ id: "REP-US04", incidentId: "INC-US04", type: "Traffic Accident", minutesAgo: 110, filename: "UAV_I710_HARBOR_04.JPG", lat: 33.7701, lng: -118.1937 }),
      report({ id: "REP-US05", incidentId: "INC-US05", type: "Normal", minutesAgo: 720, filename: "UAV_SM_PIER_PATROL_05.JPG", lat: 34.0195, lng: -118.4912 })
    ];

    const teams = [
      { id: "US-SAR-01", name: "Team US-SAR-01 Urban Search & Collapse Unit", commander: "Capt. Marcus Vance", members: 14, area: "Downtown Los Angeles", status: "Available", currentMissionId: null, distanceKm: 2.1, matchScore: 96, equipment: "Heavy hydraulic extrication · seismic acoustic sensors · 02 UAVs" },
      { id: "US-WATER-01", name: "Team US-WATER-01 Swiftwater & Flood Rescue Unit", commander: "Lt. Elena Rostova", members: 10, area: "Hollywood Hills", status: "On Mission", currentMissionId: "MIS-US04", distanceKm: 3.4, matchScore: 93, equipment: "03 inflatable rescue boats · high-water amphibious rig · trauma kit" },
      { id: "US-MED-01", name: "Team US-MED-01 Rapid Medical & Coastal Unit", commander: "Cmdr. David Miller", members: 8, area: "Santa Monica", status: "Available", currentMissionId: null, distanceKm: 4.6, matchScore: 89, equipment: "02 light rapid-response vans · water rescue boards · medical triage" },
      { id: "US-FIRE-01", name: "Team US-FIRE-01 Heavy Fire & Suppression Unit", commander: "Chief Robert Chen", members: 12, area: "Pasadena Sector", status: "Available", currentMissionId: null, distanceKm: 5.2, matchScore: 87, equipment: "03 heavy fire trucks · thermal drone · brush suppression gear" },
      { id: "US-WATER-02", name: "Team US-WATER-02 Marine & Harbor Rescue Unit", commander: "Capt. Sarah Jenkins", members: 9, area: "Long Beach Harbor", status: "Available", currentMissionId: null, distanceKm: 6.0, matchScore: 85, equipment: "02 high-power rescue boats · dive gear · portable generator" }
    ];
    teams.forEach((team) => {
      const sector = profile.sectors.find((item) => item.name === team.area);
      if (sector) { team.latitude = sector.latitude; team.longitude = sector.longitude; }
    });

    const dispatchOrders = [
      { id: "DSP-US03", incidentId: "INC-US03", teamId: "USAR-CA1", matchScore: 96, distanceKm: 2.1, status: "Sent", createdAt: relativeIso(18), acceptedAt: null, completedAt: null },
      { id: "DSP-US04", incidentId: "INC-US04", teamId: "LAFD-02", matchScore: 93, distanceKm: 3.4, status: "Accepted", createdAt: relativeIso(95), acceptedAt: relativeIso(90), completedAt: null }
    ];

    const missions = [
      { id: "MIS-US03", dispatchId: "DSP-US03", incidentId: "INC-US03", teamId: "USAR-CA1", status: "New Assignment", startedAt: null, completedAt: null, result: null, rescuedCount: null, notes: "", createdAt: relativeIso(18) },
      { id: "MIS-US04", dispatchId: "DSP-US04", incidentId: "INC-US04", teamId: "LAFD-02", status: "In Progress", startedAt: relativeIso(85), completedAt: null, result: null, rescuedCount: null, notes: "LAFD unit on scene; extracting priority non-upright victims.", createdAt: relativeIso(95) }
    ];

    return {
      schemaVersion: 2,
      regionMeta: JSON.parse(JSON.stringify(profile)),
      uavs: JSON.parse(JSON.stringify(UAVS)),
      updatedAt: new Date().toISOString(),
      reports,
      incidents,
      teams,
      dispatchOrders,
      missions,
      settings: {
        operatingArea: "Los Angeles County, CA",
        reportOverloadLimit: 60,
        defcon1Alert: true,
        autoPushSevere: true,
        notificationChannels: { siren: true, browserPush: true, commanderSms: true, emergencyRadio: true },
        alertThresholds: { Fire: 80, Flood: 75, "Building Collapse": 80, "Traffic Accident": 70 }
      },
      counters: { report: 9600, attempt: 5600, incident: 9600, dispatch: 3600, mission: 3600, team: 60 },
      audit: [{ id: "AUD-US01", event: "REGION_DATASET_LOADED", at: new Date().toISOString(), detail: "Loaded Los Angeles County, CA (United States) global dataset" }]
    };
  }

  window.SkyRescueRegionRegistry["Los Angeles County, CA"] = {
    profile,
    buildDataset
  };
})();
