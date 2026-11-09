(function () {
  "use strict";

  window.SkyRescueRegionRegistry = window.SkyRescueRegionRegistry || {};
  const national = window.SkyRescueRegionRegistry["Vietnam"];

  const profile = {
    regionId: "VN-HANOI",
    operatingArea: "Ha Noi",
    country: "Vietnam",
    timeZone: "Asia/Ho_Chi_Minh",
    tzShort: "ICT (UTC+07:00)",
    center: [21.0285, 105.8342],
    demoAnchor: [21.0285, 105.8542],
    defaultZoom: 12,
    datasetScope: "province",
    nationalIncidentCount: 20,
    coverageBounds: { minLat: 20.80, maxLat: 21.22, minLng: 105.60, maxLng: 106.02 },
    sectors: national.profile.sectors.filter((sector) => sector.province === "Ha Noi")
  };

  function buildDataset(helpers) {
    return national.buildProvinceDataset("Ha Noi", helpers, profile);
  }

  window.SkyRescueRegionRegistry["Ha Noi"] = { profile, buildDataset };
})();
