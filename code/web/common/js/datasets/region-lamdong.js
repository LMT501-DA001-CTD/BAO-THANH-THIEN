(function () {
  "use strict";

  window.SkyRescueRegionRegistry = window.SkyRescueRegionRegistry || {};
  const national = window.SkyRescueRegionRegistry["Vietnam"];

  const profile = {
    regionId: "VN-LAMDONG",
    operatingArea: "Lam Dong",
    country: "Vietnam",
    timeZone: "Asia/Ho_Chi_Minh",
    tzShort: "ICT (UTC+07:00)",
    center: [11.9404, 108.4583],
    demoAnchor: [11.90064, 108.45181],
    defaultZoom: 11,
    datasetScope: "province",
    nationalIncidentCount: 20,
    coverageBounds: { minLat: 11.85, maxLat: 12.10, minLng: 108.40, maxLng: 108.50 },
    sectors: national.profile.sectors.filter((sector) => sector.province === "Lam Dong")
  };

  function buildDataset(helpers) {
    return national.buildProvinceDataset("Lam Dong", helpers, profile);
  }

  window.SkyRescueRegionRegistry["Lam Dong"] = { profile, buildDataset };
})();
