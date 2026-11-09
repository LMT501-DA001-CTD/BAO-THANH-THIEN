(function () {
  "use strict";

  // National demo dataset: one incident per image in the external UAV set.
  // Coordinates, provinces and capture times come from the image EXIF metadata.
  // Queue timestamps stay relative so the demo never goes stale.
  window.SkyRescueRegionRegistry = window.SkyRescueRegionRegistry || {};

  const SECTORS = [
    { name: "District 1", province: "Ho Chi Minh City", latitude: 10.7769, longitude: 106.7009 },
    { name: "District 3", province: "Ho Chi Minh City", latitude: 10.7844, longitude: 106.6844 },
    { name: "District 6", province: "Ho Chi Minh City", latitude: 10.7748, longitude: 106.6692 },
    { name: "Binh Thanh District", province: "Ho Chi Minh City", latitude: 10.8015, longitude: 106.7124 },
    { name: "District 4", province: "Ho Chi Minh City", latitude: 10.7578, longitude: 106.7032 },
    { name: "District 7", province: "Ho Chi Minh City", latitude: 10.7324, longitude: 106.7219 },
    { name: "Thu Duc City", province: "Ho Chi Minh City", latitude: 10.8494, longitude: 106.7582 },
    { name: "Hoan Kiem District", province: "Ha Noi", latitude: 21.0285, longitude: 105.8542 },
    { name: "Ba Dinh District", province: "Ha Noi", latitude: 21.0341, longitude: 105.8216 },
    { name: "Tay Ho District", province: "Ha Noi", latitude: 21.0467, longitude: 105.8662 },
    { name: "Dong Da District", province: "Ha Noi", latitude: 21.0301, longitude: 105.8389 },
    { name: "Hai Chau District", province: "Da Nang", latitude: 16.0678, longitude: 108.2208 },
    { name: "Son Tra District", province: "Da Nang", latitude: 16.0714, longitude: 108.1926 },
    { name: "Binh Thuy District", province: "Can Tho", latitude: 10.1313, longitude: 105.6672 },
    { name: "Thot Not District", province: "Can Tho", latitude: 10.2946, longitude: 105.5486 },
    { name: "Nha Trang", province: "Khanh Hoa", latitude: 12.2450, longitude: 109.1800 },
    { name: "Ninh Hoa", province: "Khanh Hoa", latitude: 12.5894, longitude: 109.1386 },
    { name: "Da Lat", province: "Lam Dong", latitude: 11.9404, longitude: 108.4583 },
    { name: "Lac Duong District", province: "Lam Dong", latitude: 12.0298, longitude: 108.4562 },
    { name: "Hoi An", province: "Quang Nam", latitude: 15.8790, longitude: 108.3350 },
    { name: "Dong Giang District", province: "Quang Nam", latitude: 15.9209, longitude: 107.7876 }
  ];

  const PROFILE = {
    regionId: "VN-NATIONAL",
    operatingArea: "Vietnam",
    country: "Vietnam",
    timeZone: "Asia/Ho_Chi_Minh",
    tzShort: "ICT (UTC+07:00)",
    center: [16.0544, 108.2022],
    demoAnchor: [16.0544, 108.2022],
    defaultZoom: 6,
    datasetScope: "national",
    nationalIncidentCount: 20,
    // SRS bounding-box geofence. This is a coarse national envelope and also
    // contains parts of neighbouring countries; it is not a precise border.
    coverageBounds: { minLat: 8.55, maxLat: 23.39, minLng: 102.14, maxLng: 109.47 },
    sectors: SECTORS
  };

  // file, scene, province, district, lat, lng, capture time (UTC+07), severity,
  // detected people, status, assigned team, dispatch code, relative age (minutes)
  const ROWS = [
    { file: "EXT01.jpg", type: "Fire", province: "Lam Dong", district: "Lac Duong District", lat: 12.029810, lng: 108.456220, capturedAt: "2026-11-03T10:17:43+07:00", severity: 88.0, count: 2, status: "Unverified", minutesAgo: 8, confidence: 96.2, poseConfidence: 91.4, tags: ["narrow_entrance"] },
    { file: "EXT02.jpeg", type: "Fire", province: "Quang Nam", district: "Hoi An", lat: 15.886219, lng: 108.326411, capturedAt: "2026-11-03T15:24:08+07:00", severity: 91.5, count: 3, status: "Matching Team", minutesAgo: 46, confidence: 97.1, poseConfidence: 93.0, tags: ["narrow_entrance"] },
    { file: "EXT03.jpg", type: "Fire", province: "Quang Nam", district: "Dong Giang District", lat: 15.920880, lng: 107.787620, capturedAt: "2026-11-04T09:42:25+07:00", severity: 84.0, count: 2, status: "Resolved", teamId: "QN-FIRE-01", minutesAgo: 660, confidence: 95.0, poseConfidence: 89.8, tags: ["narrow_entrance"] },
    { file: "EXT04.jpg", type: "Building Collapse", province: "Ha Noi", district: "Hoan Kiem District", lat: 21.023760, lng: 105.841230, capturedAt: "2026-11-03T11:36:12+07:00", severity: 93.0, count: 6, status: "In Progress", teamId: "HN-USAR-01", minutesAgo: 128, confidence: 97.6, poseConfidence: 94.1, tags: ["narrow_entrance", "heavy_debris"] },
    { file: "EXT05.jpg", type: "Building Collapse", province: "Da Nang", district: "Hai Chau District", lat: 16.055620, lng: 108.218410, capturedAt: "2026-11-03T14:19:51+07:00", severity: 87.0, count: 4, status: "In Progress", teamId: "DN-USAR-01", minutesAgo: 156, confidence: 96.4, poseConfidence: 92.0, tags: ["heavy_debris"] },
    { file: "EXT06.jpeg", type: "Building Collapse", province: "Ho Chi Minh City", district: "District 6", lat: 10.774831, lng: 106.669219, capturedAt: "2026-11-04T08:26:14+07:00", severity: 89.5, count: 5, status: "Matching Team", minutesAgo: 58, confidence: 96.8, poseConfidence: 92.6, tags: ["heavy_debris"] },
    { file: "EXT07.jpeg", type: "Building Collapse", province: "Khanh Hoa", district: "Nha Trang", lat: 12.251119, lng: 109.173719, capturedAt: "2026-11-04T10:57:33+07:00", severity: 82.0, count: 3, status: "Resolved", teamId: "KH-USAR-01", minutesAgo: 720, confidence: 95.3, poseConfidence: 90.2, tags: ["heavy_debris"] },
    { file: "EXT08.jpeg", type: "Building Collapse", province: "Khanh Hoa", district: "Ninh Hoa", lat: 12.589419, lng: 109.138611, capturedAt: "2026-11-03T12:48:56+07:00", severity: 85.0, count: 4, status: "Unverified", minutesAgo: 22, confidence: 95.9, poseConfidence: 91.0, tags: ["heavy_debris"] },
    { file: "EXT09.jpeg", type: "Traffic Accident", province: "Can Tho", district: "Binh Thuy District", lat: 10.131311, lng: 105.667219, capturedAt: "2026-11-03T09:13:28+07:00", severity: 72.0, count: 2, status: "Matching Team", minutesAgo: 72, confidence: 93.8, poseConfidence: 88.5, tags: ["critical_trauma"] },
    { file: "EXT10.jpeg", type: "Traffic Accident", province: "Can Tho", district: "Thot Not District", lat: 10.294620, lng: 105.548640, capturedAt: "2026-11-03T13:41:09+07:00", severity: 68.0, count: 1, status: "Resolved", teamId: "CT-TRAFFIC-01", minutesAgo: 880, confidence: 92.8, poseConfidence: 87.2, tags: ["critical_trauma"] },
    { file: "EXT11.jpeg", type: "Traffic Accident", province: "Lam Dong", district: "Da Lat", lat: 11.900639, lng: 108.451811, capturedAt: "2026-11-03T07:52:35+07:00", severity: 74.5, count: 2, status: "In Progress", teamId: "LD-TRAFFIC-01", minutesAgo: 176, confidence: 94.5, poseConfidence: 89.1, tags: ["critical_trauma"] },
    { file: "EXT12.jpg", type: "Flood", province: "Quang Nam", district: "Hoi An", lat: 15.872810, lng: 108.329540, capturedAt: "2026-11-04T08:58:17+07:00", severity: 78.5, count: 4, status: "Unverified", minutesAgo: 15, confidence: 95.4, poseConfidence: 90.8, tags: ["deep_submerged", "fast_current"] },
    { file: "EXT13.jpg", type: "Flood", province: "Ho Chi Minh City", district: "Binh Thanh District", lat: 10.788020, lng: 106.716320, capturedAt: "2026-11-04T10:11:26+07:00", severity: 81.0, count: 3, status: "In Progress", teamId: "WATER-01", minutesAgo: 238, confidence: 96.0, poseConfidence: 91.7, tags: ["deep_submerged"] },
    { file: "EXT14.jpeg", type: "Flood", province: "Ha Noi", district: "Tay Ho District", lat: 21.046710, lng: 105.866240, capturedAt: "2026-11-04T11:29:42+07:00", severity: 76.0, count: 2, status: "Matching Team", minutesAgo: 96, confidence: 94.9, poseConfidence: 89.9, tags: ["deep_submerged"] },
    { file: "EXT15.jpeg", type: "Normal", province: "Da Nang", district: "Hai Chau District", lat: 16.062570, lng: 108.219640, capturedAt: "2026-11-03T09:47:03+07:00", severity: 9.0, count: 0, status: "Resolved", minutesAgo: 1440, confidence: 97.2, poseConfidence: 0, tags: [] },
    { file: "EXT16.jpeg", type: "Normal", province: "Khanh Hoa", district: "Nha Trang", lat: 12.240130, lng: 109.194820, capturedAt: "2026-11-03T23:42:18+07:00", severity: 12.0, count: 0, status: "Unverified", minutesAgo: 36, confidence: 96.7, poseConfidence: 0, tags: [] },
    { file: "EXT17.jpeg", type: "Normal", province: "Ha Noi", district: "Dong Da District", lat: 21.030120, lng: 105.838930, capturedAt: "2026-11-04T12:07:36+07:00", severity: 7.5, count: 0, status: "Resolved", minutesAgo: 1800, confidence: 97.8, poseConfidence: 0, tags: [] },
    { file: "EXT18.jpeg", type: "Fire", province: "Da Nang", district: "Son Tra District", lat: 16.071369, lng: 108.192611, capturedAt: "2026-11-04T01:16:45+07:00", severity: 86.5, count: 3, status: "In Progress", teamId: "DN-FIRE-01", minutesAgo: 300, confidence: 96.6, poseConfidence: 92.3, tags: ["narrow_entrance"] },
    { file: "EXT19.jpeg", type: "Flood", province: "Ha Noi", district: "Ba Dinh District", lat: 21.007190, lng: 105.821560, capturedAt: "2026-11-04T09:23:41+07:00", severity: 79.0, count: 3, status: "In Progress", teamId: "HN-WATER-01", minutesAgo: 360, confidence: 95.7, poseConfidence: 91.2, tags: ["deep_submerged", "fast_current"] },
    { file: "EXT20.jpeg", type: "Traffic Accident", province: "Ho Chi Minh City", district: "District 1", lat: 10.781830, lng: 106.694210, capturedAt: "2026-11-04T03:37:09+07:00", severity: 70.0, count: 2, status: "In Progress", teamId: "VOL-01", minutesAgo: 420, confidence: 93.2, poseConfidence: 88.0, tags: ["critical_trauma"] }
  ];

  const TEAMS = [
    { id: "SAR-01", name: "HCMC Rapid Urban Search & Rescue Unit", commander: "Tran Van Phong", members: 8, capacity: 8, area: "Binh Thanh District", province: "Ho Chi Minh City", status: "Available", currentMissionId: null, distanceKm: 2.1, matchScore: 98, equipment: "02 rescue boats · 04 UAVs · medical kit", coverage: ["Binh Thanh District"] },
    { id: "FIRE-01", name: "HCMC Fire & Rescue Unit", commander: "Le Quoc Hung", members: 10, capacity: 10, area: "Binh Thanh District", province: "Ho Chi Minh City", status: "Available", currentMissionId: null, distanceKm: 3.8, matchScore: 91, equipment: "03 fire engines · thermal kit", coverage: ["Binh Thanh District"] },
    { id: "VOL-01", name: "HCMC Traffic & Volunteer Rescue Unit", commander: "Nguyen Minh Hoang", members: 12, capacity: 12, area: "District 1", province: "Ho Chi Minh City", status: "On Mission", currentMissionId: "DSP-2207", distanceKm: 1.0, matchScore: 95, equipment: "traffic rescue van · hydraulic extrication · medical kit", coverage: ["District 1", "District 3"] },
    { id: "SAR-02", name: "HCMC Heavy Urban Search & Rescue Unit", commander: "Vo Minh Tri", members: 10, capacity: 10, area: "Thu Duc City", province: "Ho Chi Minh City", status: "Available", currentMissionId: null, distanceKm: 7.2, matchScore: 96, equipment: "rope rescue · hydraulic cutter · thermal drone", coverage: ["Binh Thanh District", "District 6", "Thu Duc City"] },
    { id: "WATER-01", name: "HCMC Waterway & Flood Rescue Unit", commander: "Dang Quoc Khanh", members: 8, capacity: 8, area: "District 4", province: "Ho Chi Minh City", status: "On Mission", currentMissionId: "DSP-2204", distanceKm: 8.0, matchScore: 66, equipment: "03 rescue boats · flood lights", coverage: ["Binh Thanh District", "District 4"] },
    { id: "MED-01", name: "HCMC Mobile Field Medical Unit", commander: "Pham Thu Trang", members: 6, capacity: 6, area: "District 7", province: "Ho Chi Minh City", status: "Available", currentMissionId: null, distanceKm: 9.5, matchScore: 60, equipment: "field triage module · 02 rescue vans", coverage: ["District 6", "District 7"] },
    { id: "SAR-03", name: "HCMC UAV Technical Support Unit", commander: "Vu Dinh Trong", members: 5, capacity: 5, area: "Thu Duc City", province: "Ho Chi Minh City", status: "Offline", currentMissionId: null, distanceKm: 11.0, matchScore: 40, equipment: "UAV repair module", coverage: ["Thu Duc City"] },
    { id: "HN-USAR-01", name: "Hanoi Urban Search & Rescue Unit", commander: "Le Minh Quang", members: 10, capacity: 10, area: "Hoan Kiem District", province: "Ha Noi", status: "On Mission", currentMissionId: "DSP-2201", distanceKm: 1.4, matchScore: 97, equipment: "heavy hydraulic extrication · rope rescue · thermal drone", coverage: ["Hoan Kiem District", "Dong Da District"] },
    { id: "HN-WATER-01", name: "Hanoi Red River Flood Rescue Unit", commander: "Pham Chanh Phong", members: 8, capacity: 8, area: "Ba Dinh District", province: "Ha Noi", status: "On Mission", currentMissionId: "DSP-2206", distanceKm: 3.1, matchScore: 94, equipment: "02 rescue boats · flood lights · medical kit", coverage: ["Ba Dinh District"] },
    { id: "HN-WATER-02", name: "Hanoi West Lake Flood & Rescue Unit", commander: "Phung Thanh Do", members: 8, capacity: 8, area: "Tay Ho District", province: "Ha Noi", status: "Available", currentMissionId: null, distanceKm: 4.6, matchScore: 92, equipment: "02 rescue boats · pump unit · medical kit", coverage: ["Tay Ho District", "Dong Da District", "Ba Dinh District"] },
    { id: "DN-FIRE-01", name: "Da Nang Fire & Rescue Unit", commander: "Nguyen Dang Khoi", members: 10, capacity: 10, area: "Son Tra District", province: "Da Nang", status: "On Mission", currentMissionId: "DSP-2205", distanceKm: 0.1, matchScore: 98, equipment: "03 fire engines · thermal kit", coverage: ["Son Tra District"] },
    { id: "DN-USAR-01", name: "Da Nang Urban Search & Rescue Unit", commander: "Bui Huu Toan", members: 9, capacity: 9, area: "Hai Chau District", province: "Da Nang", status: "On Mission", currentMissionId: "DSP-2202", distanceKm: 1.4, matchScore: 96, equipment: "rope rescue · hydraulic cutter · thermal drone", coverage: ["Hai Chau District"] },
    { id: "CT-TRAFFIC-01", name: "Can Tho Road Traffic Rescue Unit", commander: "Nguyen Huu Lam", members: 8, capacity: 8, area: "Binh Thuy District", province: "Can Tho", status: "Available", currentMissionId: null, distanceKm: 10.5, matchScore: 88, equipment: "traffic rescue van · hydraulic extrication · medical kit", coverage: ["Binh Thuy District", "Thot Not District"] },
    { id: "KH-USAR-01", name: "Nha Trang Urban Search & Rescue Unit", commander: "Pham Cong Vinh", members: 9, capacity: 9, area: "Nha Trang", province: "Khanh Hoa", status: "Available", currentMissionId: null, distanceKm: 0.9, matchScore: 97, equipment: "rope rescue · hydraulic cutter · thermal drone", coverage: ["Nha Trang", "Ninh Hoa"] },
    { id: "LD-FIRE-01", name: "Da Lat Wildfire Response Unit", commander: "Phan Bao Long", members: 8, capacity: 8, area: "Lac Duong District", province: "Lam Dong", status: "Available", currentMissionId: null, distanceKm: 0.1, matchScore: 96, equipment: "wildfire engine · water tanker · thermal drone", coverage: ["Lac Duong District"] },
    { id: "LD-TRAFFIC-01", name: "Lam Dong Mountain Road Rescue Unit", commander: "Do Tan Tai", members: 7, capacity: 7, area: "Da Lat", province: "Lam Dong", status: "On Mission", currentMissionId: "DSP-2203", distanceKm: 4.5, matchScore: 91, equipment: "traffic rescue van · hydraulic extrication · rope kit", coverage: ["Da Lat"] },
    { id: "QN-FIRE-01", name: "Hoi An Fire & Rescue Unit", commander: "Nguyen Tai Loc", members: 9, capacity: 9, area: "Hoi An", province: "Quang Nam", status: "Available", currentMissionId: null, distanceKm: 0.9, matchScore: 96, equipment: "02 fire engines · thermal kit", coverage: ["Hoi An", "Dong Giang District"] },
    { id: "QN-WATER-01", name: "Hoi An Flood Rescue Unit", commander: "Tran Tuan Phat", members: 8, capacity: 8, area: "Hoi An", province: "Quang Nam", status: "Available", currentMissionId: null, distanceKm: 0.8, matchScore: 95, equipment: "02 rescue boats · pump unit · medical kit", coverage: ["Hoi An"] }
  ];

  // Dispatch records for incidents that are already assigned or closed.
  const ASSIGNMENTS = {
    "INC-8803": { code: "DSP-2208", teamId: "QN-FIRE-01", status: "Completed", distanceKm: 60.2, matchScore: 71, minutesAgo: 660 },
    "INC-8804": { code: "DSP-2201", teamId: "HN-USAR-01", status: "Confirmed", distanceKm: 1.4, matchScore: 97, minutesAgo: 128 },
    "INC-8805": { code: "DSP-2202", teamId: "DN-USAR-01", status: "Confirmed", distanceKm: 1.4, matchScore: 96, minutesAgo: 156 },
    "INC-8807": { code: "DSP-2209", teamId: "KH-USAR-01", status: "Completed", distanceKm: 0.9, matchScore: 97, minutesAgo: 720 },
    "INC-8810": { code: "DSP-2210", teamId: "CT-TRAFFIC-01", status: "Completed", distanceKm: 0.1, matchScore: 94, minutesAgo: 880 },
    "INC-8811": { code: "DSP-2203", teamId: "LD-TRAFFIC-01", status: "Confirmed", distanceKm: 4.5, matchScore: 91, minutesAgo: 176 },
    "INC-8813": { code: "DSP-2204", teamId: "WATER-01", status: "Confirmed", distanceKm: 1.7, matchScore: 92, minutesAgo: 238 },
    "INC-8818": { code: "DSP-2205", teamId: "DN-FIRE-01", status: "Confirmed", distanceKm: 0.1, matchScore: 98, minutesAgo: 300 },
    "INC-8819": { code: "DSP-2206", teamId: "HN-WATER-01", status: "Confirmed", distanceKm: 3.1, matchScore: 94, minutesAgo: 360 },
    "INC-8820": { code: "DSP-2207", teamId: "VOL-01", status: "Confirmed", distanceKm: 1.0, matchScore: 95, minutesAgo: 420 }
  };

  function buildNationalDataset(helpers) {
    const { incident, report, relativeIso, UAVS } = helpers;
    const incidents = [];
    const reports = [];
    const dispatchOrders = [];

    ROWS.forEach((row, index) => {
      const id = `INC-${8801 + index}`;
      const assignment = ASSIGNMENTS[id] || null;
      const record = incident({
        id,
        reportId: id,
        type: row.type,
        reviewedType: row.status === "Unverified" ? null : row.type,
        district: row.district,
        province: row.province,
        lat: row.lat,
        lng: row.lng,
        severity: row.severity,
        confidence: row.confidence,
        poseConfidence: row.poseConfidence,
        count: row.count,
        status: row.status,
        teamId: assignment?.teamId || null,
        dispatchId: assignment?.code || null,
        minutesAgo: row.minutesAgo,
        image: `/samples/${row.file}`,
        customTags: row.tags
      });
      record.severitySource = "Visual reference label (demo dataset)";
      record.sourceType = "drone";
      incidents.push(record);

      const rep = report({
        id,
        incidentId: id,
        type: row.type,
        minutesAgo: row.minutesAgo,
        filename: row.file,
        image: `/samples/${row.file}`,
        lat: row.lat,
        lng: row.lng
      });
      rep.dataOrigin = "Seeded sample";
      rep.verificationStatus = record.verificationStatus;
      rep.verificationLabel = record.verificationLabel;
      rep.verificationReason = record.verificationReason;
      if (rep.metadata) rep.metadata.captureTime = row.capturedAt;
      reports.push(rep);

      if (assignment) {
        const isDone = assignment.status === "Completed";
        dispatchOrders.push({
          id: assignment.code,
          incidentId: id,
          teamId: assignment.teamId,
          matchScore: assignment.matchScore,
          distanceKm: assignment.distanceKm,
          status: assignment.status,
          createdAt: relativeIso(assignment.minutesAgo - 5),
          confirmedAt: relativeIso(assignment.minutesAgo - 4),
          completedAt: isDone ? relativeIso(Math.max(1, assignment.minutesAgo - 90)) : null,
          confirmedBy: "DISPATCH",
          prioritySnapshot: null,
          ruleEvaluation: {
            configVersion: "v2.5.0-controlled",
            eligible: true,
            overriddenHardConstraint: false,
            overrideReason: null,
            finalMatchScore: assignment.matchScore,
            hardPassed: [],
            hardFailed: [],
            softApplied: [],
            missingWarnings: []
          }
        });
      }
    });

    return {
      schemaVersion: 2,
      regionMeta: JSON.parse(JSON.stringify(PROFILE)),
      uavs: JSON.parse(JSON.stringify(UAVS)),
      updatedAt: new Date().toISOString(),
      reports,
      incidents,
      teams: JSON.parse(JSON.stringify(TEAMS)),
      dispatchOrders,
      settings: {
        operatingArea: "Vietnam",
        reportOverloadLimit: 50,
        defcon1Alert: true,
        autoPushSevere: true,
        notificationChannels: { siren: true, browserPush: true, commanderSms: true, emergencyRadio: false },
        alertThresholds: { Fire: 85, Flood: 75, "Building Collapse": 90, "Traffic Accident": 70 },
        matchConfig: { bonusPoints: 5, distanceDivisorKm: 15, sameAreaBonus: 10 }
      },
      counters: { report: 9000, attempt: 5000, incident: 9000, dispatch: 3000, mission: 3000, team: 20 },
      audit: [{
        id: "AUD-0001",
        event: "DEMO_INITIALIZED",
        at: relativeIso(5),
        detail: "National SkyRescue dataset: 20 incidents across 7 provinces"
      }]
    };
  }

  function buildProvinceDataset(provinceName, helpers, profile) {
    const national = buildNationalDataset(helpers);
    const incidents = national.incidents.filter((item) => item.location.province === provinceName);
    const incidentIds = new Set(incidents.map((item) => item.id));
    const reports = national.reports.filter((item) => incidentIds.has(item.incidentId) || incidentIds.has(item.id));
    const dispatchOrders = national.dispatchOrders.filter((item) => incidentIds.has(item.incidentId));
    const teams = national.teams.filter((item) => item.province === provinceName);
    const sectors = national.regionMeta.sectors.filter((sector) => sector.province === provinceName);
    return {
      schemaVersion: 2,
      regionMeta: { ...JSON.parse(JSON.stringify(profile)), sectors },
      uavs: national.uavs,
      updatedAt: new Date().toISOString(),
      reports,
      incidents,
      teams,
      dispatchOrders,
      settings: { ...national.settings, operatingArea: provinceName },
      counters: national.counters,
      audit: [{
        id: "AUD-0001",
        event: "DEMO_INITIALIZED",
        at: new Date().toISOString(),
        detail: `${provinceName} view: ${incidents.length} of 20 national incidents`
      }]
    };
  }

  const registry = window.SkyRescueRegionRegistry;
  registry["Vietnam"] = {
    profile: PROFILE,
    buildDataset: buildNationalDataset,
    buildProvinceDataset
  };
})();
