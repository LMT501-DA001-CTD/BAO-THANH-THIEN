(function () {
  "use strict";

  window.SkyRescueRegionRegistry = window.SkyRescueRegionRegistry || {};
  const national = window.SkyRescueRegionRegistry["Vietnam"];

  const profile = {
    regionId: "VN-CANTHO",
    operatingArea: "Can Tho",
    country: "Vietnam",
    timeZone: "Asia/Ho_Chi_Minh",
    tzShort: "ICT (UTC+07:00)",
    center: [10.0365, 105.7680],
    demoAnchor: [10.13131, 105.66722],
    defaultZoom: 11,
    datasetScope: "province",
    nationalIncidentCount: 20,
    coverageBounds: { minLat: 9.88, maxLat: 10.40, minLng: 105.45, maxLng: 105.92 },
    sectors: national.profile.sectors.filter((sector) => sector.province === "Can Tho")
  };

  function buildDataset(helpers) {
    return national.buildProvinceDataset("Can Tho", helpers, profile);
  }

  window.SkyRescueRegionRegistry["Can Tho"] = { profile, buildDataset };
})();
