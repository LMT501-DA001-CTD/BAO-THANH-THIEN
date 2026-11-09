(function () {
  "use strict";

  window.SkyRescueRegionRegistry = window.SkyRescueRegionRegistry || {};
  const national = window.SkyRescueRegionRegistry["Vietnam"];

  const profile = {
    regionId: "VN-QUANGNAM",
    operatingArea: "Quang Nam",
    country: "Vietnam",
    timeZone: "Asia/Ho_Chi_Minh",
    tzShort: "ICT (UTC+07:00)",
    center: [15.8800, 108.3300],
    demoAnchor: [15.87281, 108.32954],
    defaultZoom: 10,
    datasetScope: "province",
    nationalIncidentCount: 20,
    coverageBounds: { minLat: 15.80, maxLat: 16.00, minLng: 107.70, maxLng: 108.40 },
    sectors: national.profile.sectors.filter((sector) => sector.province === "Quang Nam")
  };

  function buildDataset(helpers) {
    return national.buildProvinceDataset("Quang Nam", helpers, profile);
  }

  window.SkyRescueRegionRegistry["Quang Nam"] = { profile, buildDataset };
})();
