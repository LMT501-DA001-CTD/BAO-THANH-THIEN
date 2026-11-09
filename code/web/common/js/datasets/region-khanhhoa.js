(function () {
  "use strict";

  window.SkyRescueRegionRegistry = window.SkyRescueRegionRegistry || {};
  const national = window.SkyRescueRegionRegistry["Vietnam"];

  const profile = {
    regionId: "VN-KHANHHOA",
    operatingArea: "Khanh Hoa",
    country: "Vietnam",
    timeZone: "Asia/Ho_Chi_Minh",
    tzShort: "ICT (UTC+07:00)",
    center: [12.2500, 109.1800],
    demoAnchor: [12.25112, 109.17372],
    defaultZoom: 10,
    datasetScope: "province",
    nationalIncidentCount: 20,
    coverageBounds: { minLat: 12.15, maxLat: 12.66, minLng: 109.05, maxLng: 109.25 },
    sectors: national.profile.sectors.filter((sector) => sector.province === "Khanh Hoa")
  };

  function buildDataset(helpers) {
    return national.buildProvinceDataset("Khanh Hoa", helpers, profile);
  }

  window.SkyRescueRegionRegistry["Khanh Hoa"] = { profile, buildDataset };
})();
