(function () {
  "use strict";

  window.SkyRescueRegionRegistry = window.SkyRescueRegionRegistry || {};
  const national = window.SkyRescueRegionRegistry["Vietnam"];

  const profile = {
    regionId: "VN-DANANG",
    operatingArea: "Da Nang",
    country: "Vietnam",
    timeZone: "Asia/Ho_Chi_Minh",
    tzShort: "ICT (UTC+07:00)",
    center: [16.0544, 108.2022],
    demoAnchor: [16.06257, 108.21964],
    defaultZoom: 12,
    datasetScope: "province",
    nationalIncidentCount: 20,
    coverageBounds: { minLat: 15.92, maxLat: 16.18, minLng: 108.05, maxLng: 108.32 },
    sectors: national.profile.sectors.filter((sector) => sector.province === "Da Nang")
  };

  function buildDataset(helpers) {
    return national.buildProvinceDataset("Da Nang", helpers, profile);
  }

  window.SkyRescueRegionRegistry["Da Nang"] = { profile, buildDataset };
})();
