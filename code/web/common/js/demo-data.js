(function () {
  "use strict";

  const TYPES = ["Fire", "Flood", "Building Collapse", "Traffic Accident", "Unclassified", "Normal"];
  const ICONS = {
    Fire: "🔥",
    Flood: "🌊",
    "Building Collapse": "🏚️",
    "Traffic Accident": "🚗",
    Unclassified: "❓",
    Normal: "✓"
  };

  const UAVS = [
    { id: "AEGIS-UAV-07", model: "DJI Mavic 3 Enterprise", make: "DJI", serial: "1581F5FJD22A0007", battery: 82, registered: true },
    { id: "AEGIS-UAV-12", model: "DJI Matrice 30T", make: "DJI", serial: "1581F4SKB23C0012", battery: 64, registered: true },
    { id: "UNKNOWN-4F2A", model: "Unregistered drone", make: "", serial: "", battery: 0, registered: false }
  ];

  // Controlled Extensible Custom Tags Schema
  // Explicitly defines DataType (Boolean | Number | Enum), Source, and TargetEntity (Report | Location | RescueTeam)
  const CUSTOM_TAG_SCHEMA = [
    {
      key: "narrow_entrance",
      label: "Narrow Alley Entrance",
      dataType: "Boolean",
      source: "Reporter",
      targetEntity: "Report",
      aiOutput: false,
      description: "Indicates whether the incident scene is inside a narrow alley or restricted corridor.",
      normalization: {
        type: "Boolean",
        trueCoeff: 1.0,
        falseCoeff: 0.0,
        formula: "true => 1.0 (100% weight), false => 0.0 (0 pts)"
      }
    },
    {
      key: "detected_people_count",
      label: "Detected People Count",
      dataType: "Number",
      unit: "persons",
      min: 0,
      max: 100,
      source: "Admin",
      targetEntity: "Report",
      aiOutput: true,
      description: "Number of victims detected by Tier 2 YOLO human/pose model.",
      normalization: {
        type: "Number",
        scaling: "Linear Cap",
        formula: "x_norm = clamp(count / 10, 0, 1)",
        stepThresholds: [
          { threshold: "1 - 2 persons", coeff: 0.3, label: "Small squad" },
          { threshold: "3 - 5 persons", coeff: 0.7, label: "Medium dispatch" },
          { threshold: "> 5 persons", coeff: 1.0, label: "Mass casualty protocol" }
        ]
      }
    },
    {
      key: "access_terrain",
      label: "Sector Access Terrain",
      dataType: "Enum",
      enumValues: ["urban_arterial", "narrow_alley", "riverine_canal", "mountain_pass"],
      source: "Location GIS",
      targetEntity: "Location",
      aiOutput: false,
      description: "Primary geographic terrain classification of the administrative sector.",
      normalization: {
        type: "Enum",
        mapping: {
          urban_arterial: 0.25,
          narrow_alley: 0.75,
          mountain_pass: 0.85,
          riverine_canal: 1.00
        },
        formula: "Categorical scale to severity coefficient [0..1]"
      }
    },
    {
      key: "population_density",
      label: "Population Density Tier",
      dataType: "Enum",
      enumValues: ["low", "medium", "high", "ultra_dense"],
      source: "Location GIS",
      targetEntity: "Location",
      aiOutput: false,
      description: "Census-based population density tier maintained by GIS administrators.",
      normalization: {
        type: "Enum",
        mapping: {
          low: 0.25,
          medium: 0.50,
          high: 0.75,
          ultra_dense: 1.00
        },
        formula: "Ordinal density rank => linear coefficient [0.25, 0.50, 0.75, 1.00]"
      }
    },
    {
      key: "vehicle_type",
      label: "Primary Deployment Vehicle",
      dataType: "Enum",
      enumValues: ["compact_moto", "rescue_van", "heavy_truck", "rescue_boat"],
      source: "Admin",
      targetEntity: "RescueTeam",
      aiOutput: false,
      description: "Primary response vehicle class updated by fleet administrators.",
      normalization: {
        type: "Enum",
        mapping: {
          compact_moto: 0.30,
          rescue_van: 0.60,
          rescue_boat: 0.85,
          heavy_truck: 1.00
        },
        formula: "Fleet vehicle classification scale"
      }
    },
    {
      key: "heavy_debris_gear",
      label: "Heavy Extrication & Shoring Gear",
      dataType: "Boolean",
      source: "Admin",
      targetEntity: "RescueTeam",
      aiOutput: false,
      description: "Hydraulic cutters, airbags, and structural shoring equipment for building collapse.",
      normalization: {
        type: "Boolean",
        trueCoeff: 1.0,
        falseCoeff: 0.0,
        formula: "true => 1.0 (100% weight), false => 0.0 (0 pts)"
      }
    }
  ];

  // Configurable Rule Engine (Hard Constraints + Soft Constraints)
  const DEFAULT_RULE_ENGINE = {
    version: "v2.5.0-controlled",
    updatedAt: "2026-10-26T04:00:00.000Z",
    missingDataPolicy: "soft_warning", // "soft_warning" | "strict_block" | "ignore"
    conflictPolicy: "hard_overrides_soft",
    rules: [
      {
        id: "HC-02",
        name: "Narrow Entrance Heavy Truck Restriction",
        category: "Hard",
        enabled: true,
        targetEntities: ["Report", "RescueTeam"],
        requiredTags: ["narrow_entrance", "vehicle_type"],
        conditionSummary: "!(Report.narrow_entrance == true && RescueTeam.vehicle_type == 'heavy_truck')",
        failureReason: "Heavy fire/rescue trucks cannot enter narrow alley entrances."
      },
      {
        id: "HC-03",
        name: "Deep Flood & Riverine Water Capability Gate",
        category: "Hard",
        enabled: true,
        targetEntities: ["Location", "RescueTeam"],
        requiredTags: ["access_terrain", "vehicle_type"],
        conditionSummary: "If Flood & access_terrain == 'riverine_canal' => RescueTeam.vehicle_type == 'rescue_boat'",
        failureReason: "Team lacks rescue boat deployment capability for deep or riverine flooding."
      },
      {
        id: "HC-04",
        name: "Critical Structural Collapse Extrication Gate",
        category: "Hard",
        enabled: true,
        targetEntities: ["Report", "RescueTeam"],
        requiredTags: ["heavy_debris_gear"],
        conditionSummary: "If Building Collapse & Severity >= 88 => RescueTeam.heavy_debris_gear == true",
        failureReason: "Critical structural collapse requires heavy hydraulic extrication & shoring gear."
      },
      {
        id: "SC-01",
        name: "Agile Vehicle Bonus for Narrow Alley",
        category: "Soft",
        enabled: true,
        weightDelta: 12,
        contextWeights: {
          "Fire": 12,
          "Building Collapse": 10,
          "Flood": 4,
          "Traffic Accident": 0
        },
        targetEntities: ["Report", "RescueTeam"],
        requiredTags: ["narrow_entrance", "vehicle_type"],
        conditionSummary: "Report.narrow_entrance == true && vehicle_type in ['compact_moto', 'rescue_van']",
        reasonText: "Agile vehicle (+12 pts) prioritized for narrow alley access."
      },
      {
        id: "SC-03",
        name: "Ultra-Dense Sector Local Unit Priority",
        category: "Soft",
        enabled: true,
        weightDelta: 8,
        contextWeights: {
          "Fire": 8,
          "Building Collapse": 8,
          "Flood": 8,
          "Traffic Accident": 8
        },
        targetEntities: ["Location", "RescueTeam"],
        requiredTags: ["population_density"],
        conditionSummary: "Location.population_density == 'ultra_dense' && sameArea == true",
        reasonText: "Local sector unit (+8 pts) prioritized in ultra-dense population zone."
      },
      {
        id: "SC-04",
        name: "Heavy Extrication Gear Readiness Bonus",
        category: "Soft",
        enabled: true,
        weightDelta: 8,
        contextWeights: {
          "Fire": 0,
          "Building Collapse": 10,
          "Flood": 0,
          "Traffic Accident": 8
        },
        targetEntities: ["RescueTeam"],
        requiredTags: ["heavy_debris_gear"],
        conditionSummary: "Incident.type in ['Building Collapse', 'Traffic Accident'] && RescueTeam.heavy_debris_gear == true",
        reasonText: "Heavy hydraulic extrication gear (+8 pts) available for trapped victims."
      }
    ]
  };

  const relativeIso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();

  function detections(lat, lng, count) {
    const poses = ["Non-Upright", "Upright", "Upright", "Non-Upright", "Upright", "Non-Upright"];
    const boxes = [
      [13, 20, 14, 34], [37, 43, 13, 31], [61, 18, 15, 35],
      [73, 51, 17, 26], [27, 55, 13, 28], [51, 48, 14, 29]
    ];
    return Array.from({ length: count }, (_, index) => ({
      id: `P${index + 1}`,
      bbox: boxes[index],
      pose: poses[index],
      confidence: Number((99 - index * 1.3).toFixed(1)),
      latitude: Number((lat - index * 0.0003).toFixed(6)),
      longitude: Number((lng + index * 0.0004).toFixed(6)),
      locationSource: "Simulated GPS"
    }));
  }

  function defaultReportAttributes({ type, district = "", customTags = [], count = 0, customAttributes = null }) {
    const tags = Array.isArray(customTags) ? customTags : [];
    const d = String(district).toLowerCase();
    const isNarrow = tags.includes("narrow_entrance") || tags.includes("canal_narrow") || d.includes("dong da") || d.includes("hoan kiem") || d.includes("binh thanh");

    return {
      narrow_entrance: { value: customAttributes?.narrow_entrance?.value !== undefined ? customAttributes.narrow_entrance.value : (customAttributes?.narrow_entrance !== undefined ? customAttributes.narrow_entrance : isNarrow), source: customAttributes?.narrow_entrance?.source || "Reporter" },
      detected_people_count: { value: count, source: "Admin" }
    };
  }

  function enrichSectorAttributes(sector) {
    if (sector.customAttributes) return sector;
    const n = String(sector.name || "").toLowerCase();
    let access_terrain = "urban_arterial";
    let population_density = "high";

    if (n.includes("dong da") || n.includes("hoan kiem") || n.includes("binh thanh") || n.includes("district 4")) {
      access_terrain = "narrow_alley";
      population_density = "ultra_dense";
    } else if (n.includes("cai rang") || n.includes("ninh kieu") || n.includes("phong dien") || n.includes("chuong my") || n.includes("hai chau")) {
      access_terrain = "riverine_canal";
    } else if (n.includes("lien chieu") || n.includes("son tra")) {
      access_terrain = "mountain_pass";
      population_density = "medium";
    }

    return {
      ...sector,
      customAttributes: {
        access_terrain: { value: access_terrain, source: "Location GIS" },
        population_density: { value: population_density, source: "Location GIS" }
      }
    };
  }

  const EQUIPMENT_CATALOG = {
    rescue_boats: { key: "rescue_boats", label: "Rescue Boats", unit: "boats", relevantFor: ["Flood"] },
    pump_units: { key: "pump_units", label: "High-Capacity Pumps", unit: "pumps", relevantFor: ["Flood"] },
    heavy_debris_gear: { key: "heavy_debris_gear", label: "Hydraulic Cutters & Debris Gear", unit: "sets", relevantFor: ["Building Collapse", "Traffic Accident"] },
    rope_sets: { key: "rope_sets", label: "High-Angle Rope Rescue Sets", unit: "sets", relevantFor: ["Building Collapse", "Traffic Accident", "Fire"] },
    thermal_drones: { key: "thermal_drones", label: "Thermal EO/IR UAVs", unit: "UAVs", relevantFor: ["Fire", "Building Collapse", "Flood"] },
    medical_kits: { key: "medical_kits", label: "Trauma & Triage Medical Kits", unit: "kits", relevantFor: ["Flood", "Fire", "Building Collapse", "Traffic Accident"] },
    stretchers: { key: "stretchers", label: "Evacuation Stretchers", unit: "units", relevantFor: ["Flood", "Fire", "Building Collapse", "Traffic Accident"] }
  };

  function buildEquipmentInventory(team, waterCapable, heavyGear) {
    if (team.equipment_inventory) return team.equipment_inventory;
    const eq = String(team.equipment || "").toLowerCase();
    const id = String(team.id || "").toUpperCase();
    const numMatch = (pattern, fallback) => {
      const m = eq.match(pattern);
      return m ? parseInt(m[1], 10) : fallback;
    };
    const isMed = id.includes("MED") || eq.includes("triage") || eq.includes("medical");
    const isWater = waterCapable || id.includes("WATER") || eq.includes("boat");
    const isFire = id.includes("PCCC") || id.includes("FIRE") || eq.includes("fire engine");
    const isCollapse = id.includes("SAR-02") || id.includes("ENG") || eq.includes("rope") || eq.includes("hydraulic");

    return {
      rescue_boats: isWater ? numMatch(/(\d+)\s*(?:rescue\s*)?boat/i, id.includes("WATER") ? 3 : 2) : 0,
      pump_units: isWater || isFire ? (id.includes("WATER") || isFire ? 2 : 1) : 0,
      heavy_debris_gear: isCollapse ? 2 : (heavyGear ? 1 : 0),
      rope_sets: isCollapse ? 3 : (heavyGear ? 2 : 1),
      thermal_drones: numMatch(/(\d+)\s*uav/i, (eq.includes("drone") || eq.includes("uav") || eq.includes("thermal")) ? 2 : (id.includes("SAR-01") ? 2 : 0)),
      medical_kits: isMed ? 5 : (id.includes("SAR") || id.includes("TN") ? 2 : 1),
      stretchers: isMed ? 4 : (id.includes("SAR") || id.includes("TN") ? 2 : 1)
    };
  }

  function enrichTeamAttributes(team) {
    const eq = String(team.equipment || "").toLowerCase();
    const id = String(team.id || "").toUpperCase();
    let vehicle_type = "rescue_van";
    if (eq.includes("motorcycle") || id.includes("MOTO")) {
      vehicle_type = "compact_moto";
    } else if (eq.includes("fire engine") || id.includes("PCCC")) {
      vehicle_type = "heavy_truck";
    } else if (eq.includes("boat") || id.includes("WATER") || id === "SAR-01" || id === "DN-SAR-01") {
      vehicle_type = "rescue_boat";
    }

    const isWaterUnit = eq.includes("boat") || id.includes("WATER") || id.includes("SAR-01") || id.includes("DN-SAR");
    const heavy_debris_gear = eq.includes("rope") || eq.includes("hydraulic") || eq.includes("thermal") || id.includes("SAR") || id.includes("ENG") || id.includes("EROSION") || id.includes("PCCC");
    const equipment_inventory = buildEquipmentInventory(team, isWaterUnit, heavy_debris_gear);

    if (team.customAttributes) {
      return { ...team, equipment_inventory };
    }

    return {
      ...team,
      equipment_inventory,
      customAttributes: {
        vehicle_type: { value: vehicle_type, source: "Admin" },
        heavy_debris_gear: { value: heavy_debris_gear, source: "Admin" }
      }
    };
  }

  function incident({ id, reportId, type, reviewedType = null, district, province = "Ho Chi Minh City", lat, lng, severity, confidence, poseConfidence, count, status, teamId = null, dispatchId = null, minutesAgo, image, customTags = [], customAttributes = null }) {
    const attrs = defaultReportAttributes({ type, district, customTags, count, customAttributes });
    return {
      id,
      reportId: reportId || id,
      originalType: type,
      reviewedType,
      draftReviewedType: reviewedType || type,
      aiConfidence: confidence,
      poseConfidence,
      severityScore: severity,
      severitySource: "Demo dataset (source prototype values)",
      detectedPeopleCount: count,
      customTags,
      customAttributes: attrs,
      detections: detections(lat, lng, count),
      location: { district, province, latitude: lat, longitude: lng },
      status,
      verificationStatus: status === "Unverified" ? "unverified" : "verified",
      verificationLabel: "Verified (Drone Telemetry)",
      verificationReason: "Registered AEGIS-UAV demo telemetry source.",
      corroboratedBy: [],
      assignedTeamId: teamId,
      dispatchId,
      createdAt: relativeIso(minutesAgo),
      verifiedAt: reviewedType ? relativeIso(Math.max(1, minutesAgo - 8)) : null,
      closedAt: status === "Resolved" ? relativeIso(Math.max(1, minutesAgo - 35)) : null,
      image: image || TYPE_IMAGES[type] || "/samples/EXT13.jpg",
      reviewNotes: "",
      resolutionNote: ""
    };
  }

  function report({ id, incidentId = null, type = null, minutesAgo, uav = "AEGIS-UAV-07", failed = null, filename, image, lat = 10.8015, lng = 106.7124, customAttributes = null }) {
    const ok = !failed;
    const device = UAVS.find((item) => item.id === uav);
    return {
      id,
      incidentId,
      filename: filename || `${id.replace("REP", "DJI")}.JPG`,
      reporter: { id: "USR-UAV-07", name: "Nguyen Van A", role: "Reporter", verified: true },
      sourceType: device ? "drone" : "citizen",
      sourceIdentity: device?.serial || "USR-UAV-07",
      sourceAssurance: device ? { deviceRegistered: true, metadataMatched: true, simulation: true } : { deviceRegistered: false, metadataMatched: false, simulation: true },
      verificationStatus: (incidentId === "INC-8895" || incidentId === "INC-8893") ? "unverified" : (ok && device ? "verified" : "unverified"),
      verificationLabel: ok && device ? "Verified (Drone Telemetry)" : "Unverified",
      verificationReason: ok && device ? "Registered AEGIS-UAV demo telemetry source." : "Upload was not accepted as verified telemetry.",
      corroboratedBy: [],
      uav: device ? { id: device.id, model: device.model, serial: device.serial } : null,
      metadata: ok ? {
        latitude: lat,
        longitude: lng,
        captureTime: relativeIso(minutesAgo + 6),
        cameraMake: "DJI",
        cameraModel: device?.model || "Unknown camera",
        uavSerialNumber: device?.serial || "",
        altitude: device ? 96 : null
      } : null,
      customAttributes: customAttributes || null,
      uploadStatus: ok ? "Uploaded" : "Failed",
      processingStatus: ok ? "Completed" : "Not Started",
      processingTier: ok ? 3 : 0,
      aiResult: ok && type ? { incidentType: type } : null,
      validationErrors: failed || [],
      fingerprint: ok ? `seed-${id}` : null,
      image: image || TYPE_IMAGES[type] || null,
      createdAt: relativeIso(minutesAgo)
    };
  }

  const TYPE_IMAGES = {
    Fire: "/samples/EXT18.jpeg",
    Flood: "/samples/EXT13.jpg",
    "Building Collapse": "/samples/EXT06.jpeg",
    "Traffic Accident": "/samples/EXT09.jpeg",
    Normal: "/samples/EXT15.jpeg",
    Unclassified: "/samples/EXT16.jpeg"
  };

  const helpers = { incident, report, relativeIso, detections, UAVS, CUSTOM_TAG_SCHEMA, DEFAULT_RULE_ENGINE };
  const Registry = window.SkyRescueRegionRegistry || {};

  const REGION_PROFILES = {};
  Object.entries(Registry).forEach(([regionName, entry]) => {
    if (entry && entry.profile) {
      const enrichedProfile = JSON.parse(JSON.stringify(entry.profile));
      enrichedProfile.sectors = (enrichedProfile.sectors || []).map(enrichSectorAttributes);
      REGION_PROFILES[regionName] = enrichedProfile;
    }
  });

  function postProcessDataset(ds) {
    if (ds.regionMeta && Array.isArray(ds.regionMeta.sectors)) {
      ds.regionMeta.sectors = ds.regionMeta.sectors.map(enrichSectorAttributes);
    }
    if (Array.isArray(ds.teams)) {
      ds.teams = ds.teams.map(enrichTeamAttributes);
    }
    if (!ds.customTagSchema) {
      ds.customTagSchema = JSON.parse(JSON.stringify(CUSTOM_TAG_SCHEMA));
    }
    if (Array.isArray(ds.reports) && Array.isArray(ds.incidents)) {
      ds.reports.forEach((rep) => {
        const inc = ds.incidents.find((i) => i.id === rep.incidentId || i.reportId === rep.id);
        if (inc && inc.location && rep.metadata) {
          rep.metadata.latitude = inc.location.latitude;
          rep.metadata.longitude = inc.location.longitude;
        }
        if (rep.reporter) {
          rep.reporter.role = "Reporter";
          delete rep.reporter.phone;
        }
      });
    }
    if (ds.settings && !ds.settings.ruleEngine) {
      ds.settings.ruleEngine = JSON.parse(JSON.stringify(DEFAULT_RULE_ENGINE));
    }
    return ds;
  }

  function buildInitialState() {
    if (Registry["Vietnam"]?.buildDataset) {
      return postProcessDataset(Registry["Vietnam"].buildDataset(helpers));
    }
    if (Registry["Ho Chi Minh City"]?.buildDataset) {
      return postProcessDataset(Registry["Ho Chi Minh City"].buildDataset(helpers));
    }
    throw new Error("Missing national or HCMC region dataset module.");
  }

  function buildRegionDataset(regionName) {
    const target = regionName || "Ho Chi Minh City";
    if (Registry[target]?.buildDataset) {
      return postProcessDataset(Registry[target].buildDataset(helpers));
    }
    return buildInitialState();
  }

  const DEMO_CASES = {
    valid: {
      label: "Valid UAV Photo",
      filename: "DJI_VALID_FLOOD_001.JPG",
      fingerprint: "demo-valid-flood-001",
      image: "/samples/EXT13.jpg",
      metadata: { latitude: 10.80172, longitude: 106.71212, cameraMake: "DJI", cameraModel: "DJI Mavic 3 Enterprise", uavSerialNumber: "1581F5FJD22A0007" },
      aiResult: { incidentType: "Flood", description: "Severe urban flooding, water above 1m", detectedPeopleCount: 4, severityScore: 91.6, aiConfidence: 98.4, poseConfidence: 95.1 }
    },
    noGps: { label: "No GPS", filename: "DJI_NO_GPS_002.JPG", fingerprint: "demo-no-gps-002", image: "/samples/EXT13.jpg", error: "gps" },
    phone: { label: "Phone Photo", filename: "IMG_PHONE_003.JPG", fingerprint: "demo-phone-003", image: "/samples/EXT09.jpeg", error: "source" },
    old: { label: "Old Photo", filename: "DJI_OLD_004.JPG", fingerprint: "demo-old-004", image: "/samples/EXT06.jpeg", error: "time" },
    duplicate: { label: "Duplicate Photo", filename: "DJI_DUPLICATE_8892.JPG", fingerprint: "seed-REP-8892", image: "/samples/EXT18.jpeg", error: "duplicate" }
  };

  const PERSONAL_DEMO_CASES = {
    groundFlood: {
      label: "\u2713 Valid Citizen Flood Scene",
      filename: "CITIZEN_FLOOD_ROOFTOP_01.JPG",
      fingerprint: "demo-personal-flood-001",
      image: "/samples/EXT13.jpg",
      metadata: { latitude: 10.80172, longitude: 106.71212, cameraMake: "Apple", cameraModel: "iPhone 15 Pro", gpsSource: "Simulated Mobile AML Lock" },
      preFilterSim: {
        blurVariance: 318.4,
        isMemeOrJunk: false,
        hasIncidentEvidence: true,
        incidentType: "Flood",
        severityScore: 89.5,
        detectedPeopleCount: 5,
        nonUprightCount: 2,
        aiConfidence: 94.8,
        poseConfidence: 92.1,
        suggestedEquipment: ["rescue_boats", "pump_units", "medical_kits", "stretchers"]
      }
    },
    groundCollapse: {
      label: "\u2713 Major Collapse (7 Victims)",
      filename: "CTV_COLLAPSE_HEAVY_03.JPG",
      fingerprint: "demo-personal-collapse-003",
      image: "/samples/EXT06.jpeg",
      metadata: { latitude: 10.7765, longitude: 106.7012, cameraMake: "Sony", cameraModel: "Xperia 1 V", gpsSource: "Simulated Mobile AML Lock" },
      preFilterSim: {
        blurVariance: 412.0,
        isMemeOrJunk: false,
        hasIncidentEvidence: true,
        incidentType: "Building Collapse",
        severityScore: 95.4,
        detectedPeopleCount: 7,
        nonUprightCount: 3,
        aiConfidence: 97.2,
        poseConfidence: 94.5,
        suggestedEquipment: ["heavy_debris_gear", "rope_sets", "medical_kits", "stretchers", "thermal_drones"]
      }
    },
    groundBlur: {
      label: "\u2715 Blurry / Smoke Occluded",
      filename: "IMG_BLURRY_MOTION_04.JPG",
      fingerprint: "demo-personal-blur-004",
      image: "/samples/EXT18.jpeg",
      metadata: { latitude: 10.7892, longitude: 106.6951, cameraMake: "Apple", cameraModel: "iPhone 13", gpsSource: "Simulated Mobile AML Lock" },
      preFilterSim: {
        blurVariance: 34.2,
        isMemeOrJunk: false,
        hasIncidentEvidence: true,
        incidentType: "Fire",
        severityScore: 62.0,
        detectedPeopleCount: 1,
        nonUprightCount: 0,
        aiConfidence: 54.0,
        poseConfidence: 48.0,
        suggestedEquipment: ["medical_kits"]
      }
    },
    groundMeme: {
      label: "\u2715 Meme / Social Screenshot",
      filename: "SCREENSHOT_MEME_SPAM_05.JPG",
      fingerprint: "demo-personal-meme-005",
      image: "/samples/EXT16.jpeg",
      metadata: { latitude: 10.7721, longitude: 106.6983, cameraMake: "", cameraModel: "Social Media Reupload", gpsSource: "Simulated Mobile AML Lock" },
      preFilterSim: {
        blurVariance: 185.0,
        isMemeOrJunk: true,
        hasIncidentEvidence: false,
        incidentType: "Normal",
        severityScore: 0,
        detectedPeopleCount: 0,
        nonUprightCount: 0,
        aiConfidence: 98.1,
        poseConfidence: 0,
        suggestedEquipment: []
      }
    },
    groundNormal: {
      label: "\u2715 Normal Street (No Hazard)",
      filename: "IMG_CLEAR_STREET_06.JPG",
      fingerprint: "demo-personal-normal-006",
      image: "/samples/EXT15.jpeg",
      metadata: { latitude: 10.7805, longitude: 106.7051, cameraMake: "Samsung", cameraModel: "Galaxy A54", gpsSource: "Simulated Mobile AML Lock" },
      preFilterSim: {
        blurVariance: 294.6,
        isMemeOrJunk: false,
        hasIncidentEvidence: false,
        incidentType: "Normal",
        severityScore: 8.5,
        detectedPeopleCount: 0,
        nonUprightCount: 0,
        aiConfidence: 96.4,
        poseConfidence: 0,
        suggestedEquipment: []
      }
    }
  };

  window.SkyRescueDemo = {
    TYPES,
    ICONS,
    UAVS,
    DEMO_CASES,
    PERSONAL_DEMO_CASES,
    EQUIPMENT_CATALOG,
    REGION_PROFILES,
    CUSTOM_TAG_SCHEMA,
    DEFAULT_RULE_ENGINE,
    enrichSectorAttributes,
    enrichTeamAttributes,
    buildEquipmentInventory,
    defaultReportAttributes,
    buildInitialState,
    buildRegionDataset,
    detections
  };
})();
