(function () {
  "use strict";

  window.SkyRescueRegionRegistry = window.SkyRescueRegionRegistry || {};
  const national = window.SkyRescueRegionRegistry["Vietnam"];

  const profile = {
    regionId: "VN-HCMC",
    operatingArea: "Ho Chi Minh City",
    country: "Vietnam",
    timeZone: "Asia/Ho_Chi_Minh",
    tzShort: "ICT (UTC+07:00)",
    center: [10.7900, 106.7200],
    demoAnchor: [10.80172, 106.71212],
    defaultZoom: 12,
    datasetScope: "province",
    nationalIncidentCount: 20,
    coverageBounds: { minLat: 10.35, maxLat: 11.16, minLng: 106.35, maxLng: 107.05 },
    sectors: national.profile.sectors.filter((sector) => sector.province === "Ho Chi Minh City")
  };

  function buildDataset(helpers) {
    return national.buildProvinceDataset("Ho Chi Minh City", helpers, profile);
  }

  window.SkyRescueRegionRegistry["Ho Chi Minh City"] = { profile, buildDataset };
})();
