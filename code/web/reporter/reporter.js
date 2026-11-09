(function () {
  "use strict";

  const Demo = window.SkyRescueDemo;
  const Store = window.SkyRescueStore;
  const UI = window.SkyUI;
  const root = document.querySelector("#reporter-app");

  const ERRORS = {
    img: { code: "ERR_IMAGE_INVALID_OR_MISSING", title: "Invalid Image", reason: "No image is attached, the file is not a JPEG/PNG image, or it exceeds 35 MB.", remedy: "Choose the original JPEG created by the camera. Do not export it through a messaging app." },
    uav: { code: "ERR_UAV_NOT_CONNECTED", title: "UAV Not Connected", reason: "No registered UAV is linked to the Reporter Portal.", remedy: "Scan for devices and connect a registered UAV before submitting." },
    source: { code: "ERR_SOURCE_NOT_UAV", title: "Wrong Image Source", reason: "EXIF camera make or body serial does not match the connected UAV.", remedy: "Use a photo captured by the currently connected UAV." },
    account: { code: "ERR_REPORTER_ACCOUNT", title: "Reporter Account Required", reason: "Personal Upload requires an active Reporter account.", remedy: "Sign in through the Reporter portal." },
    liveGps: { code: "ERR_REALTIME_GPS_REQUIRED", title: "Real-time GPS Required", reason: "Personal Upload does not have a live browser geolocation lock for this session.", remedy: "Use Get Live GPS and allow location access before submitting." },
    gps: { code: "ERR_GEO_METADATA_UNREADABLE", title: "GPS Coordinates Error", reason: "A usable GPS position is missing or outside the active operating-area geofence.", remedy: "Acquire a fresh GPS lock and capture a geotagged image." },
    time: { code: "ERR_CAPTURE_TIME_INVALID", title: "Capture Time Invalid", reason: "Capture time is missing, in the future, or older than 30 minutes.", remedy: "Capture a fresh image and submit it within 30 minutes." },
    blur: { code: "ERR_IMAGE_BLURRED", title: "Blurred / Smoke-Occluded Image", reason: "The ML Pre-Filter sharpness check found severe motion blur or heavy occlusion (Laplacian variance < 100).", remedy: "Capture a new, steady image with the hazard scene in focus." },
    memeJunk: { code: "ERR_ML_MEME_OR_SCREENSHOT", title: "Meme / Screenshot / Reupload Blocked", reason: "The ML Noise & Spam Gate detected a social media screenshot, meme, or stripped-metadata graphic.", remedy: "Upload an authentic camera photo captured directly at the incident scene." },
    incidentEvidence: { code: "ERR_ML_NO_DISASTER_EVIDENCE", title: "Normal Scene — No Active Hazard Detected", reason: "The ML Pre-Filter classified this image as Normal (P(Normal) > 90%) with no flood, fire, collapse, or accident evidence.", remedy: "Only submit photos showing an active emergency requiring rescue dispatch." },
    duplicate: { code: "ERR_DUPLICATE_PHOTO", title: "Duplicate Photo", reason: "This exact photo fingerprint has already been submitted successfully.", remedy: "Open the existing report in My Reports, or capture a new scene image." }
  };

  const state = {
    screen: location.hash.replace("#", "") || "R1",
    uavStatus: "idle",
    devices: [],
    connectedUav: null,
    mode: "drone",
    liveGps: null,
    liveGpsStatus: "idle",
    upload: null,
    lastErrors: [],
    activeReportId: null,
    filter: "All",
    rescueFilter: "All",
    search: "",
    page: 1,
    pipelineTimer: null,
    samples: null,
    sampleFile: "",
    submitting: false,
    declaration: { sceneTag: "Unclassified", victims: "", hints: [], accessNote: "", phone: "" },
    reportTags: {
      narrow_entrance: false
    }
  };

  if (!["R1", "R2", "R3", "R4"].includes(state.screen)) state.screen = "R1";
  const byId = (id) => document.getElementById(id);
  const e = UI.escape;

  function setScreen(screen) {
    if (["RT1", "RT2", "RT3"].includes(screen)) screen = "R1";
    clearInterval(state.pipelineTimer);
    state.pipelineTimer = null;
    state.screen = screen;
    location.hash = screen;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (screen === "R3") startPipeline();
  }

  function reporterAccount() {
    return UI.currentUser ? UI.currentUser() : null;
  }

  function reporterAccountType(user = reporterAccount()) {
    const role = String(user?.role || "").toLowerCase();
    const tier = String(user?.trustTier || "").toLowerCase();
    if (user?.verified && (role.includes("reporter") || role.includes("ctv") || role.includes("specialist") || role.includes("chuyên môn") || role.includes("coordinator") || role.includes("commander") || tier.includes("reporter account") || tier.includes("verified specialist") || tier.includes("verified command") || tier.includes("verified responder"))) return "specialist";
    if (!user?.verified && (role.includes("citizen") || tier.includes("unverified citizen"))) return "citizen";
    return "citizen";
  }

  function sourceDescriptor() {
    const user = reporterAccount();
    if (state.mode === "drone") {
      const metadataMatched = Boolean(
        state.connectedUav?.registered &&
        state.upload?.metadata?.uavSerialNumber === state.connectedUav.serial &&
        String(state.upload?.metadata?.cameraMake || "").toUpperCase() === String(state.connectedUav.make || "").toUpperCase()
      );
      return {
        type: "drone",
        identity: state.connectedUav?.serial || state.connectedUav?.id || "unlinked-uav",
        assurance: { deviceRegistered: Boolean(state.connectedUav?.registered), metadataMatched, simulation: true },
        initialStatus: "Unverified",
        label: "Unverified · Admin review required"
      };
    }
    const accountType = reporterAccountType(user);
    const credentialVerified = accountType === "specialist";
    const identity = user?.id || "anonymous-citizen";
    return {
      type: accountType === "specialist" ? "specialist" : "citizen",
      identity,
      assurance: { credentialVerified },
      initialStatus: "Unverified",
      label: "Unverified · Admin review required"
    };
  }

  function requestLiveGps() {
    if (!navigator.geolocation) {
      state.liveGpsStatus = "error";
      UI.toast("This browser does not provide geolocation.", "error");
      render();
      return;
    }
    state.liveGpsStatus = "loading";
    render();
    navigator.geolocation.getCurrentPosition((position) => {
      state.liveGps = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        source: "Browser Geolocation API"
      };
      state.liveGpsStatus = "locked";
      if (state.mode === "personal" && state.upload) {
        state.upload.metadata = {
          ...(state.upload.metadata || {}),
          latitude: state.liveGps.latitude,
          longitude: state.liveGps.longitude,
          gpsSource: state.liveGps.source
        };
        state.upload.autoGeo = resolveAutoGeo(state.liveGps.latitude, state.liveGps.longitude);
      }
      tryReverseGeocodeOnline(state.liveGps.latitude, state.liveGps.longitude);
      UI.toast("Live GPS lock acquired for this Personal Upload.", "success");
      render();
    }, () => {
      state.liveGps = null;
      state.liveGpsStatus = "error";
      UI.toast("Live GPS could not be acquired. Personal Upload remains blocked.", "error");
      render();
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
  }

  async function sha256Hex(buffer, fallback) {
    if (!window.crypto?.subtle) return fallback;
    const digest = await window.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function inspectImage(file) {
    const checks = {
      blur: { status: "unavailable", detail: "Browser bitmap analysis is unavailable." },
      memeJunk: { status: "unavailable", detail: "No meme/junk ML model or API is present in this source package." },
      incidentEvidence: { status: "unavailable", detail: "No disaster-scene ML model or API is present in this source package." },
      provider: null
    };
    try {
      const imageUrl = URL.createObjectURL(file);
      const bitmap = await new Promise((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(() => reject(new Error("Image decode timeout")), 2500);
        image.onload = () => { clearTimeout(timer); resolve(image); };
        image.onerror = () => { clearTimeout(timer); reject(new Error("Image decode failed")); };
        image.src = imageUrl;
      });
      const maxSide = 256;
      const scale = Math.min(1, maxSide / Math.max(bitmap.naturalWidth, bitmap.naturalHeight));
      const width = Math.max(3, Math.round(bitmap.naturalWidth * scale));
      const height = Math.max(3, Math.round(bitmap.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, width, height);
      URL.revokeObjectURL(imageUrl);
      const pixels = context.getImageData(0, 0, width, height).data;
      const gray = new Float32Array(width * height);
      for (let index = 0; index < gray.length; index += 1) {
        const offset = index * 4;
        gray[index] = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
      }
      let sum = 0;
      let squared = 0;
      let count = 0;
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          const laplacian = gray[index - width] + gray[index + width] + gray[index - 1] + gray[index + 1] - 4 * gray[index];
          sum += laplacian;
          squared += laplacian * laplacian;
          count += 1;
        }
      }
      const mean = count ? sum / count : 0;
      const variance = count ? squared / count - mean * mean : 0;
      checks.blur = {
        status: variance >= 100 ? "passed" : "failed",
        variance: Number(variance.toFixed(1)),
        detail: `Local Laplacian variance ${variance.toFixed(1)} (technical threshold: 100).`
      };
    } catch (_) {}

    return checks;
  }

  function parseExif(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset);
      if (marker === 0xffda || (marker & 0xff00) !== 0xff00) break;
      const length = view.getUint16(offset + 2);
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) return readTiff(view, offset + 10);
      offset += 2 + length;
    }
    return null;
  }

  function readTiff(view, start) {
    const little = view.getUint16(start) === 0x4949;
    const u16 = (position) => view.getUint16(position, little);
    const u32 = (position) => view.getUint32(position, little);
    const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
    const ifd = (position) => {
      const result = {};
      const count = u16(position);
      for (let index = 0; index < count; index += 1) {
        const entry = position + 2 + index * 12;
        const tag = u16(entry);
        const type = u16(entry + 2);
        const amount = u32(entry + 4);
        const size = (sizes[type] || 1) * amount;
        const pointer = size <= 4 ? entry + 8 : start + u32(entry + 8);
        let value;
        if (type === 2) {
          value = "";
          for (let part = 0; part < amount - 1; part += 1) value += String.fromCharCode(view.getUint8(pointer + part));
        } else {
          value = [];
          for (let part = 0; part < amount; part += 1) {
            value.push(type === 5 ? u32(pointer + part * 8) / (u32(pointer + part * 8 + 4) || 1) : type === 3 ? u16(pointer + part * 2) : type === 4 ? u32(pointer + part * 4) : view.getUint8(pointer + part));
          }
        }
        result[tag] = value;
      }
      return result;
    };
    const base = ifd(start + u32(start + 4));
    const exif = base[0x8769] ? ifd(start + base[0x8769][0]) : {};
    const gps = base[0x8825] ? ifd(start + base[0x8825][0]) : {};
    const dms = (value) => value && value.length >= 3 ? value[0] + value[1] / 60 + value[2] / 3600 : null;
    let latitude = dms(gps[2]);
    let longitude = dms(gps[4]);
    if (latitude != null && gps[1] === "S") latitude *= -1;
    if (longitude != null && gps[3] === "W") longitude *= -1;
    return {
      cameraMake: String(base[0x010f] || "").trim(),
      cameraModel: String(base[0x0110] || "").trim(),
      uavSerialNumber: String(exif[0xa431] || "").trim(),
      captureTime: Store.exifCaptureTime(exif[0x9003] || base[0x0132], exif[0x9011]),
      latitude,
      longitude,
      altitude: gps[6] ? gps[6][0] : null
    };
  }

  const GEO_PRESETS = {
    hcmc: {
      label: "📍 UAV Photo · Ho Chi Minh City (Binh Thanh)",
      filename: "EXT13.jpg",
      latitude: 10.788020,
      longitude: 106.716320,
      image: "/samples/EXT13.jpg"
    },
    cantho: {
      label: "📍 UAV Photo · Can Tho (Binh Thuy)",
      filename: "EXT09.jpeg",
      latitude: 10.131311,
      longitude: 105.667219,
      image: "/samples/EXT09.jpeg"
    },
    hanoi: {
      label: "📍 UAV Photo · Ha Noi (Ba Dinh)",
      filename: "EXT19.jpeg",
      latitude: 21.007190,
      longitude: 105.821560,
      image: "/samples/EXT19.jpeg"
    },
    danang: {
      label: "📍 UAV Photo · Da Nang (Son Tra)",
      filename: "EXT18.jpeg",
      latitude: 16.071369,
      longitude: 108.192611,
      image: "/samples/EXT18.jpeg"
    },
    hoiAn: {
      label: "📍 UAV Photo · Quang Nam (Hoi An)",
      filename: "EXT12.jpg",
      latitude: 15.872810,
      longitude: 108.329540,
      image: "/samples/EXT12.jpg"
    },
    nhaTrang: {
      label: "📍 UAV Photo · Khanh Hoa (Nha Trang)",
      filename: "EXT07.jpeg",
      latitude: 12.251119,
      longitude: 109.173719,
      image: "/samples/EXT07.jpeg"
    },
    dalat: {
      label: "📍 UAV Photo · Lam Dong (Da Lat)",
      filename: "EXT11.jpeg",
      latitude: 11.900639,
      longitude: 108.451811,
      image: "/samples/EXT11.jpeg"
    }
  };

  function resolveAutoGeo(latitude, longitude) {
    if (latitude == null || longitude == null || isNaN(latitude) || isNaN(longitude)) return null;
    if (Store.detectLocationFromGps) {
      return Store.detectLocationFromGps(latitude, longitude, Store.load());
    }
    return {
      district: "Binh Thanh District",
      province: Store.regionMeta(Store.load()).operatingArea,
      matchedProfile: "Ho Chi Minh City",
      isCrossRegion: false,
      source: "EXIF GPS Auto-Track"
    };
  }

  function normalizeReverseDistrictName(value) {
    const name = String(value || "").trim();
    if (!name) return "";
    const numbered = name.match(/^(?:District|Quận|Quan)\s*(\d+)$/i);
    if (numbered) return `District ${Number(numbered[1])}`;
    const folded = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const namedDistricts = {
      "quan binh thanh": "Binh Thanh District",
      "binh thanh district": "Binh Thanh District",
      "quan go vap": "Go Vap District",
      "go vap district": "Go Vap District",
      "quan phu nhuan": "Phu Nhuan District",
      "phu nhuan district": "Phu Nhuan District",
      "quan tan binh": "Tan Binh District",
      "tan binh district": "Tan Binh District",
      "quan tan phu": "Tan Phu District",
      "tan phu district": "Tan Phu District",
      "quan binh tan": "Binh Tan District",
      "binh tan district": "Binh Tan District",
      "huyen binh chanh": "Binh Chanh District",
      "huyen hoc mon": "Hoc Mon District",
      "huyen cu chi": "Cu Chi District",
      "huyen nha be": "Nha Be District",
      "huyen can gio": "Can Gio District",
      "thanh pho thu duc": "Thu Duc City",
      "thu duc city": "Thu Duc City"
    };
    return namedDistricts[folded] || name;
  }

  function normalizeReverseProvinceName(value) {
    const name = String(value || "").trim();
    const folded = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return folded.includes("ho chi minh") ? "Ho Chi Minh City" : name;
  }

  function tryReverseGeocodeOnline(latitude, longitude) {
    if (latitude == null || longitude == null || typeof window.fetch !== "function") return;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), 2400);
    fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=14&accept-language=en`, {
      signal: controller?.signal,
      headers: { Accept: "application/json" }
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        clearTimeout(timer);
        if (!data || !state.upload || !state.upload.metadata) return;
        if (Math.abs(state.upload.metadata.latitude - latitude) > 0.0001) return;
        const addr = data.address || {};
        const revDistrict = addr.city_district || addr.county || addr.municipality || addr.town || addr.suburb;
        const revProvince = addr.city || addr.state || addr.province;
        if (!state.upload.autoGeo) state.upload.autoGeo = resolveAutoGeo(latitude, longitude);
        if (state.upload.autoGeo) {
          state.upload.autoGeo.nominatimAddress = data.display_name || null;
          // Reverse geocoding is more precise than the offline centroid fallback,
          // including inside preset regions such as Ho Chi Minh City.
          const normalizedDistrict = normalizeReverseDistrictName(revDistrict);
          const isAdministrativeArea = /district|quận|quan|huyện|huyen|city|thành phố|thanh pho/i.test(String(revDistrict || ""));
          if (normalizedDistrict && (!state.upload.autoGeo.matchedProfile || isAdministrativeArea)) {
            state.upload.autoGeo.district = normalizedDistrict;
            if (revProvince) state.upload.autoGeo.province = normalizeReverseProvinceName(revProvince);
            state.upload.autoGeo.source = `${state.mode === "personal" ? "Browser GPS" : "EXIF GPS"} + OpenStreetMap Reverse Geocoding`;
          }
          render();
        }
      })
      .catch(() => {
        clearTimeout(timer);
      });
  }

  function nearestDistrict(latitude, longitude) {
    const geo = resolveAutoGeo(latitude, longitude);
    return geo ? geo.district : "Other area";
  }

  function scanUavs() {
    state.uavStatus = "scanning";
    state.devices = [];
    render();
    setTimeout(() => {
      if (state.uavStatus !== "scanning") return;
      state.uavStatus = "found";
      state.devices = Demo.UAVS;
      render();
    }, 900);
  }

  function connectUav(id) {
    const uav = Demo.UAVS.find((item) => item.id === id);
    if (!uav?.registered) {
      UI.toast("This UAV is not registered and cannot be connected.", "error");
      return;
    }
    state.uavStatus = "connecting";
    state.connectedUav = uav;
    render();
    setTimeout(() => {
      if (state.uavStatus !== "connecting" || state.connectedUav?.id !== id) return;
      state.uavStatus = "connected";
      UI.toast(`${id} connected`, "success");
      render();
    }, 750);
  }

  function disconnectUav() {
    state.uavStatus = "idle";
    state.connectedUav = null;
    if (state.mode === "drone") state.upload = null;
    render();
  }

  // DEMO_MODE only: a preset gives the metadata for a real photo that has no fresh EXIF.
  // The server labels the report "Simulated metadata (demo)". The image and the AI result stay real.
  function applyDemoMetadata(metadata, label) {
    if (!state.upload?.file) {
      UI.toast("Choose a real JPEG/PNG photo (or a sample image) first. A preset sets only the metadata.", "error");
      return false;
    }
    state.upload.metadata = metadata;
    state.upload.demoMetadata = { ...metadata };
    state.upload.demoLabel = label;
    state.upload.autoGeo = resolveAutoGeo(metadata.latitude, metadata.longitude);
    render();
    return true;
  }

  function demoAnchor() {
    const meta = Store.regionMeta(Store.load());
    if (Array.isArray(meta.demoAnchor) && meta.demoAnchor.length === 2) {
      return [Number(meta.demoAnchor[0]), Number(meta.demoAnchor[1])];
    }
    const primarySector = meta.sectors?.[0];
    return [
      Number(primarySector?.latitude ?? primarySector?.lat ?? meta.center?.[0] ?? 16.0544),
      Number(primarySector?.longitude ?? primarySector?.lng ?? meta.center?.[1] ?? 108.2022)
    ];
  }

  function demoUpload(key) {
    if (state.uavStatus !== "connected") return UI.toast("Connect a registered UAV first.", "error");
    const demo = Demo.DEMO_CASES[key];
    const uav = state.connectedUav;
    const anchor = demoAnchor();
    const metadata = {
      ...(demo.metadata || {}),
      latitude: Number((anchor[0] + 0.0012).toFixed(6)),
      longitude: Number((anchor[1] - 0.0011).toFixed(6)),
      captureTime: new Date(Date.now() - 6 * 60000).toISOString(),
      cameraMake: uav.make,
      cameraModel: uav.model,
      uavSerialNumber: uav.serial,
      altitude: 96
    };
    if (demo.error === "gps") { metadata.latitude = null; metadata.longitude = null; }
    if (demo.error === "source") { metadata.cameraMake = "Apple"; metadata.cameraModel = "iPhone 14"; metadata.uavSerialNumber = "F2LXK9Q1N0"; }
    if (demo.error === "time") metadata.captureTime = new Date(Date.now() - 2 * 86400000).toISOString();
    applyDemoMetadata(metadata, demo.label);
  }

  function simulateInRegionGpsLock(offsetLat = 0.0012, offsetLng = -0.0011) {
    const meta = Store.regionMeta(Store.load());
    const anchor = demoAnchor();
    const lat = Number((anchor[0] + offsetLat).toFixed(6));
    const lng = Number((anchor[1] + offsetLng).toFixed(6));
    state.liveGps = {
      latitude: lat,
      longitude: lng,
      accuracy: 6,
      capturedAt: new Date().toISOString(),
      source: "Mobile AML Hardware Lock (Simulated)"
    };
    state.liveGpsStatus = "locked";
    if (state.mode === "personal" && state.upload) {
      state.upload.metadata = {
        ...(state.upload.metadata || {}),
        latitude: lat,
        longitude: lng,
        gpsSource: state.liveGps.source
      };
      state.upload.autoGeo = resolveAutoGeo(lat, lng);
    }
    UI.toast(`Simulated Mobile AML GPS locked in ${meta.operatingArea}.`, "success");
    render();
    return state.liveGps;
  }

  function demoPersonalUpload(key) {
    const preset = Demo.PERSONAL_DEMO_CASES?.[key];
    if (!preset) return;
    const anchor = demoAnchor();
    const lat = Number((anchor[0] + 0.0010).toFixed(6));
    const lng = Number((anchor[1] - 0.0011).toFixed(6));
    const metadata = {
      latitude: lat,
      longitude: lng,
      captureTime: new Date(Date.now() - 3 * 60000).toISOString(),
      cameraMake: preset.metadata.cameraMake,
      cameraModel: preset.metadata.cameraModel,
      uavSerialNumber: "",
      altitude: null,
      gpsSource: preset.metadata.gpsSource || "Mobile AML Hardware Lock (Simulated)"
    };
    if (!applyDemoMetadata(metadata, preset.label)) return;
    state.liveGps = { latitude: lat, longitude: lng, accuracy: 5, capturedAt: new Date().toISOString(), source: metadata.gpsSource };
    state.liveGpsStatus = "locked";
    render();
  }

  function demoGeoPreset(presetKey) {
    if (state.uavStatus !== "connected") return UI.toast("Connect a registered UAV first.", "error");
    const preset = GEO_PRESETS[presetKey];
    if (!preset) return;
    const uav = state.connectedUav;
    const metadata = {
      latitude: preset.latitude,
      longitude: preset.longitude,
      captureTime: new Date(Date.now() - 4 * 60000).toISOString(),
      cameraMake: uav.make,
      cameraModel: uav.model,
      uavSerialNumber: uav.serial,
      altitude: 92
    };
    if (applyDemoMetadata(metadata, preset.label)) tryReverseGeocodeOnline(metadata.latitude, metadata.longitude);
  }

  // Load a demo image from demo_samples/ as a real file.
  async function useSampleImage(entryOrFile) {
    const entry = typeof entryOrFile === "string"
      ? (state.samples || []).find((item) => item.file === entryOrFile) || { file: entryOrFile, label: entryOrFile }
      : entryOrFile;
    const file = entry?.file || entryOrFile;
    state.sampleFile = file;
    try {
      const res = await fetch(`/samples/${encodeURIComponent(file)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      loadFile(new File([blob], file, { type: blob.type || "image/jpeg", lastModified: Date.now() }), entry);
    } catch (error) {
      UI.toast(`Sample image not loaded (${error.message}).`, "error");
    }
  }

  function samplePreset(entry, baseMetadata = null) {
    const anchor = demoAnchor();
    const hasGps = Number.isFinite(Number(baseMetadata?.latitude)) && Number.isFinite(Number(baseMetadata?.longitude));
    return {
      latitude: hasGps ? Number(baseMetadata.latitude) : Number((anchor[0] + 0.0015).toFixed(6)),
      longitude: hasGps ? Number(baseMetadata.longitude) : Number((anchor[1] + 0.0015).toFixed(6)),
      captureTime: new Date().toISOString(),
      cameraMake: baseMetadata?.cameraMake || "DJI",
      cameraModel: baseMetadata?.cameraModel || "DJI Mavic 3 Enterprise",
      uavSerialNumber: baseMetadata?.uavSerialNumber || "1581F5FJD22A0007",
      altitude: baseMetadata?.altitude ?? 12,
      gpsSource: hasGps ? "EXIF GPS · simulated capture time" : "Simulated demo metadata",
      demoLabel: `Sample preset · ${entry?.label || entry?.file || "sample"}`
    };
  }

  function sampleMetadataNeedsPreset(metadata, entry) {
    if (!entry) return false;
    const shared = Store.load();
    const bounds = Store.regionMeta(shared).coverageBounds || {};
    const lat = Number(metadata?.latitude);
    const lng = Number(metadata?.longitude);
    const inBounds = Number.isFinite(lat) && Number.isFinite(lng)
      && (!Object.keys(bounds).length || (
        lat >= Number(bounds.minLat) - 0.5 && lat <= Number(bounds.maxLat) + 0.5
        && lng >= Number(bounds.minLng) - 0.5 && lng <= Number(bounds.maxLng) + 0.5
      ));
    const captured = metadata?.captureTime ? new Date(metadata.captureTime).getTime() : NaN;
    const fresh = Number.isFinite(captured)
      && captured <= Date.now() + 60000
      && Date.now() - captured <= 30 * 60000;
    const droneMetadata = state.mode !== "drone"
      || Boolean(metadata?.uavSerialNumber && metadata?.cameraMake);
    return !(inBounds && fresh && droneMetadata);
  }

  async function loadSamples() {
    if (state.samples) return;
    state.samples = [];
    try {
      const res = await fetch("/api/samples");
      if (res.ok) state.samples = await res.json();
    } catch (_) {}
    render();
  }

  function loadFile(file, sampleEntry = null) {
    if (!file) return;
    if (state.mode === "drone" && state.uavStatus !== "connected") return UI.toast("Connect a registered UAV before choosing a telemetry image.", "error");
    const preview = URL.createObjectURL(file);
    const reader = new FileReader();
    reader.onload = async () => {
      let exifMetadata = null;
      try { exifMetadata = parseExif(reader.result); } catch (error) { console.warn("EXIF parsing failed", error); }
      let metadata = exifMetadata ? { ...exifMetadata } : null;
      let demoMetadata = null;
      let demoLabel = null;
      if (sampleEntry && sampleMetadataNeedsPreset(metadata, sampleEntry)) {
        const preset = samplePreset(sampleEntry, metadata);
        demoMetadata = { ...preset };
        demoLabel = preset.demoLabel;
        metadata = { ...(metadata || {}), ...preset };
        UI.toast("Sample EXIF is stale or missing source fields; capture time/source were simulated. GPS is kept from the image when available.", "warning");
      } else if (!sampleEntry && state.mode === "personal" && state.liveGps) {
        metadata = {
          ...(metadata || {}),
          latitude: state.liveGps.latitude,
          longitude: state.liveGps.longitude,
          gpsSource: state.liveGps.source
        };
      }
      const autoGeo = metadata ? resolveAutoGeo(metadata.latitude, metadata.longitude) : null;
      const fingerprint = await sha256Hex(reader.result, `${file.name}|${file.size}|${file.lastModified}`);
      const selectedUpload = {
        mode: state.mode,
        file,
        filename: file.name,
        fingerprint,
        image: preview,
        preview,
        metadata,
        demoMetadata,
        demoLabel,
        originalExif: exifMetadata ? { ...exifMetadata } : null,
        autoGeo,
        mimeType: file.type,
        size: file.size,
        preFilter: {
          blur: { status: "processing", detail: "Running local sharpness calculation…" },
          memeJunk: { status: "unavailable", detail: "No meme/junk ML model or API is present in this source package." },
          incidentEvidence: { status: "unavailable", detail: "No disaster-scene ML model or API is present in this source package." },
          provider: null
        },
        aiResult: null
      };
      state.upload = selectedUpload;
      render();
      selectedUpload.preFilter = await inspectImage(file);
      if (state.upload === selectedUpload) render();
      if (metadata?.latitude != null && metadata?.longitude != null) {
        tryReverseGeocodeOnline(metadata.latitude, metadata.longitude);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function validation() {
    const upload = state.upload;
    const metadata = upload?.metadata;
    const uav = state.connectedUav;
    const accountType = reporterAccountType();
    const now = Date.now();
    const capture = metadata?.captureTime ? new Date(metadata.captureTime).getTime() : null;
    const shared = Store.load();
    const meta = Store.regionMeta(shared);
    const bounds = meta.coverageBounds;
    const inRegionBounds = Boolean(
      metadata && metadata.latitude != null && metadata.longitude != null &&
      bounds && typeof bounds.minLat === "number" && metadata.latitude >= bounds.minLat - 0.5 && metadata.latitude <= bounds.maxLat + 0.5 && metadata.longitude >= bounds.minLng - 0.5 && metadata.longitude <= bounds.maxLng + 0.5
    );
    const fingerprints = new Set(shared.reports.filter((item) => item.uploadStatus === "Uploaded").map((item) => item.fingerprint).filter(Boolean));
    const autoGeo = upload?.autoGeo || (metadata ? resolveAutoGeo(metadata.latitude, metadata.longitude) : null);
    const gpsLabel = autoGeo
      ? `${state.mode === "personal" ? "Live GPS" : "Telemetry GPS"} · ${autoGeo.district}, ${autoGeo.province}`
      : `${state.mode === "personal" ? "Live GPS" : "Telemetry GPS"} is inside the active operating-area geofence`;
    const common = [
      { key: "img", label: "Original JPEG/PNG image (max 35 MB)", pass: Boolean(upload && ["image/jpeg", "image/png"].includes(upload.mimeType) && upload.size <= 35 * 1024 * 1024) },
      { key: "gps", label: gpsLabel, pass: inRegionBounds },
      { key: "time", label: "Captured within the last 30 minutes", pass: capture != null && capture <= now + 60000 && now - capture <= 30 * 60000 },
      { key: "duplicate", label: "Photo has not been submitted before (SHA-256 deduplication)", pass: Boolean(upload && !fingerprints.has(upload.fingerprint)) }
    ];
    if (state.mode === "drone") {
      return [
        common[0],
        { key: "uav", label: "Registered AEGIS-UAV link is connected (prototype telemetry link)", pass: state.uavStatus === "connected" && Boolean(uav?.registered) },
        { key: "source", label: "Camera make and serial match the connected UAV", pass: Boolean(metadata && uav && metadata.uavSerialNumber && metadata.uavSerialNumber === uav.serial && String(metadata.cameraMake).toUpperCase() === uav.make.toUpperCase()) },
        ...common.slice(1)
      ];
    }
    return [
      common[0],
      { key: "account", label: "Active Reporter account", pass: accountType !== "unsupported" },
      { key: "liveGps", label: "Real-time GPS lock acquired in this session", pass: state.liveGpsStatus === "locked" && Boolean(state.liveGps) },
      ...common.slice(1)
    ];
  }

  // Send the image to the server Layer 1 check. The server reads EXIF itself and decides.
  async function uploadToServer() {
    const upload = state.upload;
    const claims = {
      mode: state.mode,
      uavId: state.mode === "drone" ? state.connectedUav?.id || null : null,
      liveGps: state.mode === "personal" && state.liveGps ? { latitude: state.liveGps.latitude, longitude: state.liveGps.longitude, source: state.liveGps.source } : null,
      demoMetadata: upload?.demoMetadata || null,
      tzOffsetMin: new Date().getTimezoneOffset()
    };
    const form = new FormData();
    if (upload?.file) form.append("image", upload.file, upload.filename);
    else form.append("image", new Blob([]), "missing.jpg");
    form.append("claims", JSON.stringify(claims));
    const res = await fetch("/api/uploads", { method: "POST", body: form, credentials: "same-origin", headers: { "X-Portal": "reporter" } });
    if (res.status === 401) throw new Error("Your session ended. Sign in again.");
    if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status}).`);
    return res.json();
  }

  async function submitReport() {
    if (state.submitting) return;
    const activeUser = UI.currentUser ? UI.currentUser() : null;
    const reporterRecord = activeUser
      ? { id: activeUser.id, name: activeUser.name, phone: state.declaration.phone || activeUser.phone || "", role: activeUser.role || "", trustTier: activeUser.trustTier || "Standard Reporter", verified: Boolean(activeUser.verified) }
      : { id: "ANONYMOUS", name: "Reporter", phone: "", role: "Reporter", trustTier: "Standard Reporter", verified: false };
    const source = sourceDescriptor();
    state.submitting = true;
    render();
    let server;
    try {
      server = await uploadToServer();
    } catch (error) {
      state.submitting = false;
      render();
      return UI.toast(error.message, "error");
    }
    state.submitting = false;
    if (!server.ok) {
      state.lastErrors = server.errors.filter((key) => ERRORS[key]);
      Store.update({ event: "UPLOAD_REJECTED", detail: state.lastErrors.map((key) => ERRORS[key].code).join(", ") }, (shared) => {
        const id = Store.nextId(shared, "attempt", "ATT");
        shared.reports.unshift({
          id, incidentId: null, filename: state.upload?.filename || "No file", reporter: reporterRecord,
          uav: state.connectedUav ? { id: state.connectedUav.id } : null,
          sourceType: source.type, sourceIdentity: source.identity, sourceAssurance: source.assurance,
          verificationStatus: "unverified", verificationLabel: "Unverified", verificationReason: "Server Layer 1 validation failed.", corroboratedBy: [],
          metadata: server.metadata || null, metadataSource: server.metadataSource || null, uploadStatus: "Failed", processingStatus: "Not Started", processingTier: 0, aiResult: null,
          metadataFlags: server.metadataFlags || null, nearDuplicate: server.nearDuplicate || null,
          preFilter: state.upload?.preFilter || null,
          validationErrors: state.lastErrors.map((key) => ERRORS[key].code), fingerprint: null, image: null, createdAt: new Date().toISOString()
        });
      });
      setScreen("R2");
      return;
    }

    let reportId;
    let incidentId;
    const metadata = server.metadata;
    const declaration = {
      sceneTag: "Unclassified",
      victims: null,
      hints: [],
      accessNote: state.declaration.accessNote || "",
      phone: activeUser?.phone || state.declaration.phone || ""
    };
    const autoVerifyTrusted = Boolean(
      (source.type === "drone" && source.assurance?.deviceRegistered && source.assurance?.metadataMatched) ||
      (source.type === "specialist" && source.assurance?.credentialVerified) ||
      (reporterRecord.verified && String(reporterRecord.trustTier || "").toLowerCase() !== "unverified citizen")
    );
    const autoVerifyPolicy = autoVerifyTrusted ? "trusted" : "citizen";
    Store.update({ event: "REPORT_SUBMITTED", detail: state.upload.filename }, (shared) => {
      incidentId = Store.nextId(shared, "incident", "INC");
      // One report per incident: the public report code is the incident code.
      reportId = incidentId;
      const autoGeo = resolveAutoGeo(metadata.latitude, metadata.longitude);
      const customAttributes = {
        narrow_entrance: { value: Boolean(state.reportTags.narrow_entrance), source: "Reporter" }
      };
      shared.reports.unshift({
        id: reportId,
        incidentId,
        uploadToken: server.uploadToken, // the server links the stored image to this report and starts the ML job
        filename: state.upload.filename,
        reporter: reporterRecord,
        sourceType: source.type,
        sourceIdentity: source.identity,
        sourceAssurance: source.assurance,
        verificationStatus: "unverified",
        verificationLabel: "Unverified",
        verificationReason: autoVerifyPolicy === "trusted"
          ? "Trusted source · waiting for the AI result before auto-verification."
          : "Citizen report: manual Coordinator verification is required.",
        requiresAdminReview: autoVerifyPolicy !== "trusted",
        autoVerifyPolicy,
        corroboratedBy: [],
        uav: state.mode === "drone" ? { id: state.connectedUav.id, model: state.connectedUav.model, serial: state.connectedUav.serial } : null,
        metadata,
        metadataSource: server.metadataSource,
        metadataFlags: server.metadataFlags || null,
        nearDuplicate: server.nearDuplicate || null,
        autoGeo,
        customAttributes,
        declaration,
        uploadStatus: "Uploaded",
        processingStatus: "Queued",
        processingTier: 0,
        aiResult: null,
        aiResultSource: null,
        preFilter: state.upload.preFilter || null,
        validationErrors: [],
        fingerprint: server.fingerprint,
        image: server.image,
        createdAt: new Date().toISOString()
      });
      const current = shared.reports.find((item) => item.id === reportId);
      const locationMeta = current.autoGeo || Store.detectLocationFromGps(metadata.latitude, metadata.longitude, shared);
      const region = Store.regionMeta(shared);
      const district = locationMeta?.district || nearestDistrict(metadata.latitude, metadata.longitude);
      const province = locationMeta?.province || region.operatingArea;
      shared.incidents.unshift({
        id: incidentId,
        reportId: current.id,
        originalType: "Unclassified", // the ML job writes the class; Verify stays locked until then
        reviewedType: null,
        draftReviewedType: "Unclassified",
        reporterSceneTag: declaration.sceneTag,
        reporterVictims: declaration.victims,
        aiConfidence: 0,
        poseConfidence: 0,
        severityScore: 0,
        severitySource: "Live ML inference · queued",
        aiStatus: "Queued",
        detectedPeopleCount: 0,
        customTags: [],
        customAttributes: { ...customAttributes },
        detections: [],
        location: { district, province, latitude: metadata.latitude, longitude: metadata.longitude },
        verificationStatus: current.verificationStatus,
        verificationLabel: current.verificationLabel,
        verificationReason: current.verificationReason,
        verificationMethod: null,
        autoVerifyPolicy,
        corroboratedBy: current.corroboratedBy || [],
        sourceVerifiedAt: current.sourceVerifiedAt || null,
        fieldNote: declaration.accessNote || "",
        status: "Unverified",
        assignedTeamId: null,
        dispatchId: null,
        createdAt: new Date().toISOString(),
        verifiedAt: null,
        closedAt: null,
        image: server.image,
        reviewNotes: declaration.accessNote || "",
        resolutionNote: ""
      });
      current.incidentId = incidentId;
    });
    state.activeReportId = reportId;
    state.declaration = { sceneTag: "Unclassified", victims: "", hints: [], accessNote: "", phone: state.declaration.phone };
    UI.toast(`${reportId} submitted at ${new Date().toLocaleTimeString()}. Status: Unverified.`, "success");
    setScreen("R3");
  }

  function startPipeline() {
    clearInterval(state.pipelineTimer);
    state.pipelineTimer = null;
    const shared = Store.load();
    const report = shared.reports.find((item) => item.id === state.activeReportId);
    if (!report) { render(); return; }
    if ((report.processingTier || 0) < 3) {
      Store.update(null, (draft) => {
        const target = draft.reports.find((item) => item.id === report.id);
        if (target) target.processingTier = 3;
      });
    }
    render();
  }

  function reportStatus(report, incident) {
    if (report.uploadStatus === "Failed") return "Upload Failed";
    if (report.processingStatus !== "Completed") return "AI Processing";
    return incident?.status || "Queued";
  }

  function rescueProgressSummary(shared, report, incident) {
    if (report.uploadStatus === "Failed") {
      return { text: "Not Started", group: "Failed" };
    }
    if (report.processingStatus !== "Completed") {
      return { text: "Not Started", group: "Pending" };
    }
    if (!incident) return { text: "Not Started", group: "Pending" };

    if (incident.verificationStatus !== "verified" || ["Unverified", "Pending Verification"].includes(incident.status)) {
      return { text: "Not Started", group: "Pending" };
    }

    const mission = Store.dispatchForIncident ? Store.dispatchForIncident(shared, incident.id) : Store.missionForIncident(shared, incident.id);
    const teamId = mission?.teamId || incident.assignedTeamId;
    const team = teamId ? shared.teams.find((t) => t.id === teamId) : null;

    if (incident.status === "Unverified") {
      return { text: "Awaiting Coordinator verification", group: "Pending" };
    }
    if (incident.status === "Matching Team") {
      return { text: "Verified · Matching available rescue team", group: "Active" };
    }
    if (incident.status === "In Progress") {
      if (mission?.status === "Completed") {
        return { text: `✓ Team ${teamId || ""} completed the assignment · Pending coordinator closure`, group: "Active" };
      }
      return { text: `🚁 ${teamId || "Rescue Team"} deployed and operating on-site`, group: "Active" };
    }
    if (incident.status === "Resolved") {
      return { text: mission ? `✓ Case closed · ${team ? team.id : "SAR"} assignment completed` : "✓ Case closed (Verified Normal / No dispatch needed)", group: "Resolved" };
    }
    return { text: incident.status, group: "Pending" };
  }

  function validationHtml() {
    return `<div class="validation-list">${validation().map((rule) => {
      const pending = !state.upload && rule.key !== "uav";
      const cls = pending ? "" : rule.pass ? "pass" : "fail";
      return `<div class="validation-item ${cls}"><span class="check">${pending ? "•" : rule.pass ? "✓" : "✕"}</span><span>${e(rule.label)}</span></div>`;
    }).join("")}</div>`;
  }

  function renderR1Group1() {
    const connected = state.uavStatus === "connected";
    const personal = state.mode === "personal";
    const canChoose = personal || connected;
    const upload = state.upload;
    const metadata = upload?.metadata;
    const user = reporterAccount();
    const accountType = reporterAccountType(user);
    const source = sourceDescriptor();
    const coordinatesOk = metadata?.latitude != null && metadata?.longitude != null;
    const autoGeo = coordinatesOk ? (upload?.autoGeo || resolveAutoGeo(metadata.latitude, metadata.longitude)) : null;
    const value = (label, text) => `<label class="field"><span>${label}</span><input readonly value="${e(text ?? "—")}"></label>`;
    const checkTone = (status) => status === "passed" ? "success" : status === "failed" ? "danger" : "neutral";
    const checkText = (status) => status === "passed" ? "Passed" : status === "failed" ? "Failed" : "Unavailable";

    let sourcePanel = "";
    if (!personal) {
      if (state.uavStatus === "idle") {
        sourcePanel = `<p class="muted">This prototype discovers registered AEGIS-UAV fixtures; it does not claim a physical aircraft is connected.</p><button class="btn" data-action="scan">⌁ Scan registered UAV links</button>`;
      } else if (state.uavStatus === "scanning") {
        sourcePanel = `<div class="alert"><span>◌</span><div><strong>Scanning registered telemetry fixtures…</strong><div class="muted">Device discovery is simulated; serial/metadata matching is executed by the application.</div></div></div>`;
      } else if (state.uavStatus === "found") {
        sourcePanel = state.devices.map((uav) => `<div class="device"><span class="device-icon">${uav.registered ? "⌁" : "!"}</span><div style="flex:1"><strong class="mono">${e(uav.id)}</strong><div class="muted">${e(uav.model)} · ${uav.registered ? "Registered demo device" : "Unregistered"}</div></div><button class="btn ${uav.registered ? "secondary" : "ghost"} small" data-connect="${e(uav.id)}" ${uav.registered ? "" : "disabled"}>${uav.registered ? "Connect fixture" : "Blocked"}</button></div>`).join("");
      } else if (state.uavStatus === "connecting") {
        sourcePanel = `<div class="alert"><span>◌</span><div><strong>Linking ${e(state.connectedUav.id)}…</strong><div class="muted">Checking local registration record.</div></div></div>`;
      } else {
        sourcePanel = `<div class="device"><span class="device-icon">⌁</span><div style="flex:1"><div class="row"><strong class="mono">${e(state.connectedUav.id)}</strong>${UI.badge("Connected demo telemetry", "success")}</div><div class="muted">${e(state.connectedUav.model)} · ${(UI.getPreferences?.().language === "vi") ? "Số Serial UAV" : "SN"}: ${e(state.connectedUav.serial)}</div><div class="muted">A physical UAV and external signature service are not connected.</div></div><button class="btn ghost small" data-action="disconnect">Disconnect</button></div>`;
      }
    } else {
      const roleLabel = accountType === "specialist" ? "Verified Reporter" : "Reporter";
      sourcePanel = `<div class="surface"><div class="row-between"><div><strong>${e(user?.name || "No active account")}</strong><div class="muted">${e(user?.role || "Signed out")} · ${e(user?.trustTier || "No trust tier")}</div></div>${UI.badge(roleLabel, accountType === "specialist" ? "success" : accountType === "citizen" ? "warning" : "danger")}</div></div>
        <div class="surface" style="margin-top:12px"><div class="row-between" style="flex-wrap:wrap;gap:8px"><div><strong>Real-time AML GPS Lock</strong><div class="muted">${state.liveGps ? `${state.liveGps.latitude.toFixed(6)}, ${state.liveGps.longitude.toFixed(6)} · accuracy ${Math.round(state.liveGps.accuracy || 0)} m (${e(state.liveGps.source || "Locked")})` : "No live position captured in this session."}</div></div><div class="row" style="gap:6px"><button class="btn secondary small" data-action="live-gps" ${state.liveGpsStatus === "loading" ? "disabled" : ""}>${state.liveGpsStatus === "loading" ? "Acquiring…" : "Get Live GPS"}</button><button class="btn ghost small" data-action="sim-live-gps">⚡ Simulate In-Region GPS</button></div></div></div>`;
    }

    const preview = upload
      ? `<img src="${e(upload.preview)}" alt="Selected rescue evidence preview"><div class="upload-actions"><button class="btn ghost small" data-action="choose-file">Change</button><button class="btn danger small" data-action="clear-file">Remove</button></div>`
      : `<div><div style="font-size:42px">${canChoose ? "▧" : "🔒"}</div><h3>${canChoose ? (personal ? "Choose a Personal / Ground JPEG" : "Choose Drone telemetry evidence") : "Drone upload locked"}</h3><p>${canChoose ? "Original JPEG with capture metadata · max 35 MB" : "Connect a registered AEGIS-UAV link first."}</p></div>`;
    const filter = upload?.preFilter || {};

    return `<div class="page-head"><div><p class="eyebrow">${(UI.getPreferences?.().language === "vi") ? "Khối 1 · Cổng Kiểm Soát Đa Cấp" : "Tier 1 · Multi-Tier Gatekeeping"}</p><h1>Submit Rescue Report</h1><p class="muted">Every accepted submission enters the Unverified queue. An Admin must inspect the evidence and confirm the incident data before team matching.</p></div>${UI.demoControls(true)}</div>
      <section class="card" style="margin-bottom:16px">
        <div class="card-header"><div><p class="eyebrow">Upload Method</p><h2>1. Select report source</h2></div>${UI.badge(source.label, source.initialStatus === "verified" ? "success" : "warning")}</div>
        <div class="queue-tabs" style="margin-bottom:14px">
          <button class="queue-tab ${!personal ? "active" : ""}" data-upload-mode="drone">Direct Drone Telemetry Link</button>
          <button class="queue-tab ${personal ? "active" : ""}" data-upload-mode="personal">Personal / Ground Upload</button>
        </div>
        ${sourcePanel}
      </section>
      <div class="split">
        <div class="stack">
          <section class="card"><div class="card-header"><div><p class="eyebrow">Evidence</p><h2>2. Upload Image</h2><p class="muted">Personal Upload never requires a UAV connection.</p></div><span class="badge">JPEG + METADATA</span></div>
            <div class="upload-zone ${canChoose ? "" : "locked"}" id="drop-zone">${preview}</div>
            <input id="file-input" type="file" accept="image/jpeg,image/png" ${personal ? 'capture="environment"' : ""} hidden>
            <div class="row" style="margin-top:12px"><button class="btn secondary" data-action="choose-file" ${canChoose ? "" : "disabled"}>Choose JPEG / PNG</button>${upload ? `<span class="muted mono">${e(upload.filename)} · ${(upload.size / 1048576).toFixed(1)} MB</span>` : ""}</div>
            ${(state.samples || []).length
              ? `<label class="field" style="margin-top:12px"><span>Use sample image (demo_samples/)</span><select id="r1-sample" ${canChoose ? "" : "disabled"}><option value="">— Select a sample image —</option>${state.samples.map((item) => `<option value="${e(item.file)}" ${item.file === state.sampleFile ? "selected" : ""}>${e(item.label || item.file)}</option>`).join("")}</select></label>`
              : `<p class="muted" style="margin-top:12px;font-size:12px">No sample images. Put JPEG/PNG files and manifest.json in demo_samples/ to show them here.</p>`}
            ${upload?.demoLabel ? `<div class="alert warning" style="margin-top:12px"><span>⚠</span><div><strong>Simulated metadata (demo)</strong><div class="muted">Preset: ${e(upload.demoLabel)}. The image and the AI result are real.</div></div></div>` : ""}
            ${!personal
              ? `<p class="eyebrow" style="margin-top:20px">Demo Metadata Simulator (apply to the selected photo)</p><div class="row" style="flex-wrap:wrap;gap:6px">${Object.entries(Demo.DEMO_CASES).map(([key, item]) => `<button class="btn ghost small" data-demo="${key}" ${connected ? "" : "disabled"}>${e(item.label)}</button>`).join("")}</div>`
              : `<p class="eyebrow" style="margin-top:20px">${(UI.getPreferences?.().language === "vi") ? "Mô phỏng siêu dữ liệu demo (áp cho ảnh đã chọn)" : "Demo Metadata Simulator (apply to the selected photo)"}</p><div class="row" style="flex-wrap:wrap;gap:6px">${Object.entries(Demo.PERSONAL_DEMO_CASES || {}).map(([key, item]) => `<button class="btn ghost small" data-personal-demo="${key}">${e(item.label)}</button>`).join("")}</div>`}
          </section>
          <section class="card"><div class="card-header"><div><p class="eyebrow">Metadata Gate</p><h2>3. EXIF / GPS / Geofencing</h2></div>${coordinatesOk ? UI.badge("GPS available", "success") : UI.badge("GPS required", "warning")}</div>
            <div class="field-grid">${value("GPS Latitude", metadata?.latitude?.toFixed(6))}${value("GPS Longitude", metadata?.longitude?.toFixed(6))}${value("Capture Time", UI.formatDate(metadata?.captureTime))}${value("Sector", autoGeo?.district || "Not available")}${value("Camera", metadata ? `${metadata.cameraMake || "Not found"} · ${metadata.cameraModel || "Not found"}` : "—")}${value("UAV Serial", personal ? "Not required for Personal Upload" : metadata?.uavSerialNumber || "Not found")}${value("UAV Altitude", !personal && metadata?.altitude != null ? `${Number(metadata.altitude).toFixed(1)} m` : "—")}${value("GPS Source", metadata?.gpsSource || (personal ? "Waiting for Browser Geolocation API" : "Image/UAV metadata"))}</div>
          </section>
        </div>
        <div class="stack">
          <section class="card"><div class="card-header"><div><p class="eyebrow">Field Note</p><h2>4. Field note (optional)</h2><p class="muted">Add anything the AI cannot see — access route, trapped person, rising water. The AI classifies the scene and counts people; you do not need to.</p></div>${UI.badge("Optional context", "neutral")}</div>
            <label class="field" style="grid-column:1/-1"><span>What should the rescue team know?</span><textarea id="r1-access-note" maxlength="300" rows="4" placeholder="e.g. elderly woman trapped on the mezzanine; enter from the north alley">${e(state.declaration.accessNote)}</textarea></label>
          </section>
          <section class="card"><div class="card-header"><div><p class="eyebrow">Submission Gate</p><h2>5. Requirements</h2></div></div>${validationHtml()}<button class="btn full" style="margin-top:15px" data-action="submit" ${canChoose && upload && !state.submitting ? "" : "disabled"}>${state.submitting ? "Checking on the server…" : "Submit Rescue Report →"}</button></section>
        </div>
      </div>`;
  }

  function renderR2() {
    const errors = state.lastErrors;
    return `<div class="page-head"><div><p class="eyebrow">Upload Validation</p><h1>Upload Rejected</h1><p class="muted">${errors.length} validation requirement${errors.length === 1 ? "" : "s"} failed. Your selected input is preserved.</p></div><button class="btn secondary" data-screen="R1">← Back to Submit</button></div>
      <div class="alert danger" style="margin-bottom:16px"><span style="font-size:24px">!</span><div><strong>The photo was not added to the report verification pipeline.</strong><div class="mono">${errors.map((key) => ERRORS[key].code).join(" · ")}</div></div></div>
      <div class="split"><section class="card"><h2>Rejected Image</h2><p class="muted mono">${e(state.upload?.filename || "No file selected")}</p>${state.upload?.preview ? `<img src="${e(state.upload.preview)}" alt="Rejected upload" style="width:100%;height:360px;object-fit:cover;border-radius:12px">` : UI.empty("▧", "No image", "An image was not attached to this attempt.")}</section>
      <section class="card"><h2>Detected Error Details</h2><div class="stack">${errors.map((key) => { const item = ERRORS[key]; return `<div class="surface"><div class="row-between"><strong>${e(item.title)}</strong><span class="badge danger">${e(item.code)}</span></div><p style="margin:9px 0 5px">${e(item.reason)}</p><p class="muted" style="margin:0"><strong>How to fix:</strong> ${e(item.remedy)}</p></div>`; }).join("")}</div><button class="btn full" style="margin-top:16px" data-screen="R1">Correct Input and Try Again</button></section></div>`;
  }

  function renderR3Group1() {
    const shared = Store.load();
    const isVi = (UI.getPreferences?.().language === "vi");
    const t = (en, vi) => isVi ? vi : en;
    const report = shared.reports.find((item) => item.id === state.activeReportId) || shared.reports.find((item) => item.uploadStatus === "Uploaded");
    if (!report) return UI.empty(
      "⌁",
      t("No submitted report", "Chưa có báo cáo đã gửi"),
      t("Submit a Drone or Personal report first.", "Hãy gửi báo cáo từ Drone hoặc tải ảnh cá nhân trước."),
      `<button class="btn" data-screen="R1">${t("Submit Report", "Gửi Báo Cáo")}</button>`
    );
    const incident = shared.incidents.find((item) => item.id === report.incidentId);
    const verified = report.verificationStatus === "verified";
    const preFilter = report.preFilter || {};
    const statusRow = (label, check) => {
      const status = check?.status || "unavailable";
      const symbol = status === "passed" ? "✓" : status === "failed" ? "✕" : "•";
      const css = status === "passed" ? "pass" : status === "failed" ? "fail" : "";
      return `<div class="validation-item ${css}"><span class="check">${symbol}</span><div><strong>${e(label)}</strong><div class="muted">${e(check?.detail || t("Unavailable", "Không khả dụng"))}</div></div></div>`;
    };
    const sourceName = report.sourceType === "drone"
      ? (isVi ? "Drone Tuần Tra (Telemetry UAV)" : "Patrol Drone (UAV Telemetry)")
      : report.sourceType === "specialist"
      ? (isVi ? "Chuyên Viên / CTV Trinh Sát (Đã Xác Thực)" : "Specialist / Recon CTV (Verified Reporter)")
      : (isVi ? "Người Dân Cộng Đồng (Nguồn Đối Chiếu)" : "Community Citizen (Crowdsource)");
    const localizeVerificationReason = (reason) => {
      const value = String(reason || "");
      if (!isVi) return value;
      const exact = {
        "Every new report requires Admin review in C2 · Verified / Pending Queues before team matching.": "Mọi báo cáo mới đều cần Quản trị viên duyệt tại C2 · Hàng đợi Đã xác minh / Chờ xác minh trước khi ghép đội.",
        "Registered AEGIS-UAV device information and serial metadata matched.": "Thông tin thiết bị AEGIS-UAV đã đăng ký khớp với metadata số serial.",
        "Registered UAV device information matched the submitted telemetry metadata.": "Thông tin thiết bị UAV đã đăng ký khớp với metadata telemetry đã gửi.",
        "Verified Specialist/CTV account credentials were present at submission.": "Thông tin xác thực tài khoản Chuyên viên/CTV hợp lệ khi gửi báo cáo.",
        "The submitting account is marked as a verified Specialist/CTV.": "Tài khoản gửi báo cáo được xác nhận là Chuyên viên/CTV đã xác thực.",
        "Citizen report: manual Coordinator verification is required.": "Báo cáo từ người dân: cần Quản trị viên xác minh thủ công.",
        "Multi-sensor disaster surge telemetry confirmed.": "Telemetry quá tải thảm họa đa cảm biến đã được xác nhận.",
        "No linked source-verification record is available.": "Không có hồ sơ xác minh nguồn tin được liên kết."
      };
      if (exact[value]) return exact[value];
      if (/^Evidence and incident data reviewed by .+\.$/.test(value)) {
        return value.replace(/^Evidence and incident data reviewed by /, "Bằng chứng và dữ liệu sự cố đã được duyệt bởi ");
      }
      return value;
    };
    const localizeGoldenHourStatus = (status) => {
      if (!isVi) return status;
      return ({
        "Golden Window Peak (<= 20m)": "Đỉnh Khung Giờ Vàng (≤ 20 phút)",
        "Golden Window Peak (≤20m)": "Đỉnh Khung Giờ Vàng (≤ 20 phút)",
        "Rapid Survival Decay (21-45m)": "Khả Năng Sống Suy Giảm Nhanh (21–45 phút)",
        "Critical Late Window (>45m)": "Khung Giờ Muộn Nguy Kịch (> 45 phút)",
        "Unknown": "Chưa xác định"
      })[status] || status;
    };
    const localizeDemandTag = (tag) => {
      if (!isVi) return tag;
      return String(tag)
        .replace(" Officers", " cứu hộ viên")
        .replace(" Rescue Boats", " thuyền cứu hộ")
        .replace(" High-Capacity Pumps", " máy bơm công suất lớn")
        .replace(" Hydraulic Cutters & Debris Gear", " bộ kìm thủy lực & thiết bị xử lý đổ nát")
        .replace(" High-Angle Rope Rescue Sets", " bộ cứu hộ dây góc cao")
        .replace(" Thermal EO/IR UAVs", " UAV ảnh nhiệt EO/IR")
        .replace(" Trauma & Triage Medical Kits", " bộ y tế chấn thương & phân loại")
        .replace(" Evacuation Stretchers", " cáng sơ tán");
    };
    const localizedVerificationReason = localizeVerificationReason(report.verificationReason);
    return `<div class="page-head"><div><p class="eyebrow">${t("Submission Result", "Kết Quả Gửi Báo Cáo")} · ${e(report.id)}</p><h1>${verified ? t("Report Verified", "Báo Cáo Đã Được Xác Minh") : t("Pending Admin Review", "Đang Chờ Quản Trị Viên Duyệt")}</h1><p class="muted">${t("Trusted sources auto-verify after a valid high-confidence AI emergency; citizen reports always wait for Coordinator verification. Every dispatch is still confirmed by a human.", "Nguồn tin cậy được tự động xác minh sau khi AI xác nhận sự cố khẩn cấp với độ tin cậy cao; báo cáo từ người dân luôn chờ Quản trị viên xác minh. Mọi lệnh điều động vẫn do con người xác nhận.")}</p></div><button class="btn secondary" data-screen="R4">${t("View My Reports", "Xem Báo Cáo Của Tôi")}</button></div>
      <div class="detail-grid">
        <div class="stack">
          <section class="card"><div class="card-header"><div><h2>${t("Tier 1 · Source & Identity", "Tầng 1 · Nguồn Tin & Danh Tính")}</h2><p class="muted">${e(sourceName)}</p></div></div>
            <div class="setting-row"><span>${t("Source identity", "Danh tính nguồn tin")}</span><strong class="mono">${e(report.sourceIdentity)}</strong></div>
            <div class="setting-row"><span>${t("Verification basis", "Cơ sở xác minh")}</span><strong>${e(localizedVerificationReason)}</strong></div>
            ${report.uav ? `<div class="setting-row"><span>AEGIS-UAV</span><strong class="mono">${e(report.uav.id)} · ${t("UAV Serial Number", "Số Serial UAV")}: ${e(report.uav.serial || report.metadata?.uavSerialNumber || "—")}</strong></div><div class="setting-row"><span>${t("Telemetry altitude", "Độ cao telemetry")}</span><strong>${report.metadata?.altitude != null ? `${Number(report.metadata.altitude).toFixed(1)} m` : t("Not available", "Không có thông tin")}</strong></div>` : `<div class="setting-row"><span>${t("Reporter account", "Tài khoản người báo tin")}</span><strong>${e(report.reporter?.role || "—")} · ${e(report.reporter?.trustTier || "—")}</strong></div>`}
          </section>
          <section class="card"><div class="card-header"><div><h2>${t("Tier 2 · Metadata & Image Pre-Filter", "Tầng 2 · Siêu Dữ Liệu & Tiền Lọc Ảnh")}</h2><p class="muted">${t("Real checks are shown separately from unavailable ML integrations.", "Kết quả kiểm tra thực tế được hiển thị tách biệt với các tích hợp ML chưa khả dụng.")}</p></div></div>
            <div class="validation-list">
              <div class="validation-item pass"><span class="check">✓</span><div><strong>${t("EXIF capture time", "Thời gian chụp EXIF")}</strong><div class="muted">${e(UI.formatDate(report.metadata?.captureTime))}</div></div></div>
              <div class="validation-item pass"><span class="check">✓</span><div><strong>${t("GPS lock / geofence", "Khóa GPS / vùng địa lý")}</strong><div class="muted">${report.metadata?.latitude?.toFixed(6)}, ${report.metadata?.longitude?.toFixed(6)}</div></div></div>
              
            </div>
            ${report.metadataSource === "demo_preset" ? `<div class="alert warning" style="margin-top:12px"><span>⚠</span><div>${t("Simulated metadata (demo)", "Siêu dữ liệu mô phỏng (demo)")}</div></div>` : ""}
          </section>
          ${incident ? `<section class="card">
            <div class="card-header">
              <div>
                <p class="eyebrow">${t("Incident Summary", "Thông Tin Sự Cố")}</p>
                <h2>${t("Incident Type & Coordinates", "Loại Sự Cố & Tọa Độ")}</h2>
              </div>
            </div>
            <div class="setting-row"><span>${t("Incident Type", "Loại sự cố")}</span><strong>${UI.typeLabel(Store.effectiveType(incident))}</strong></div>
            <div class="setting-row"><span>${t("GPS Coordinates", "Tọa độ GPS")}</span><strong class="mono">${report.metadata?.latitude != null ? `${report.metadata.latitude.toFixed(6)}, ${report.metadata.longitude.toFixed(6)}` : `${incident.location.latitude.toFixed(6)}, ${incident.location.longitude.toFixed(6)}`}</strong></div>
          </section>` : ""}
        </div>
        <div class="stack">
          <section class="card"><div class="card-header"><div><h2>${t("Tier 3 · Admin Review Queue", "Tầng 3 · Hàng Đợi Quản Trị Viên Duyệt")}</h2><p class="muted">${t("Evidence and model output are waiting for a human verification decision.", "Bằng chứng và kết quả mô hình đang chờ quyết định xác minh của Quản trị viên.")}</p></div></div>
            <div class="setting-row"><span>${t("Review owner", "Người phụ trách duyệt")}</span><strong>${t("Dispatch Admin · C2 Verified / Pending Queues", "Quản trị viên Điều phối · C2 Hàng đợi Đã xác minh / Chờ xác minh")}</strong></div>
            <div class="setting-row"><span>${t("Dispatch eligibility", "Điều kiện điều động")}</span><strong>${verified ? t("Ready for team matching", "Sẵn sàng ghép đội") : t("Blocked until Admin verification", "Bị chặn cho đến khi Quản trị viên xác minh")}</strong></div>
          </section>
          <section class="card"><img src="${e(report.image)}" alt="${t("Submitted evidence", "Bằng chứng đã gửi")}" style="width:100%;height:240px;object-fit:cover;border-radius:12px"><div class="field-grid" style="margin-top:12px"><div class="surface"><span class="eyebrow">${t("Latitude", "Vĩ độ")}</span><br><strong class="mono">${report.metadata?.latitude?.toFixed(6) || "—"}</strong></div><div class="surface"><span class="eyebrow">${t("Longitude", "Kinh độ")}</span><br><strong class="mono">${report.metadata?.longitude?.toFixed(6) || "—"}</strong></div></div></section>
          ${UI.canOpenDispatch() ? `<a class="btn full" style="display:flex;justify-content:center" href="/dispatch/#C2">${t("Open Dispatch Queue →", "Mở Hàng Đợi Điều Phối →")}</a>` : ""}
          <button class="btn ghost full" data-action="new-report">${t("+ Submit Another Report", "+ Gửi Báo Cáo Khác")}</button>
        </div>
      </div>`;
  }

  function renderR4() {
    const shared = Store.load();
    const reports = shared.reports;
    const successful = reports.filter((item) => item.uploadStatus === "Uploaded").length;
    const failed = reports.length - successful;
    const resolvedCount = reports.filter((item) => {
      const inc = shared.incidents.find((i) => i.id === item.incidentId);
      return inc && inc.status === "Resolved";
    }).length;
    const activeRescueCount = reports.filter((item) => {
      const inc = shared.incidents.find((i) => i.id === item.incidentId);
      return inc && ["Matching Team", "In Progress"].includes(inc.status);
    }).length;

    return `<div class="page-head"><div><p class="eyebrow">Personal Report Log &amp; Live Rescue Status</p><h1>My Reports</h1><p class="muted">Track real-time verification status, dispatched rescue units, and field rescue outcomes for every submitted report.</p></div><div class="page-actions"><button class="btn" data-screen="R1">+ Submit New Report</button>${UI.demoControls(true)}</div></div>
      <div class="grid grid-4"><div class="card kpi-card"><span class="kpi-label">Total Upload Attempts</span><div class="kpi-value">${reports.length}</div><span class="muted">all records</span></div><div class="card kpi-card"><span class="kpi-label">Uploaded Successfully</span><div class="kpi-value" style="color:var(--green)">${successful}</div><span class="muted">${failed} rejected at validation</span></div><div class="card kpi-card"><span class="kpi-label">Active Rescue / Dispatched</span><div class="kpi-value" style="color:var(--blue)">${activeRescueCount}</div><span class="muted">in dispatch or field ops</span></div><div class="card kpi-card"><span class="kpi-label">Resolved</span><div class="kpi-value" style="color:var(--green)">${resolvedCount}</div><span class="muted">completed operations</span></div></div>
      <section class="card" style="margin-top:16px"><div class="filters" style="margin-bottom:14px"><label class="field"><span>Upload Status</span><select id="report-filter"><option value="All">All Uploads</option><option value="Uploaded">Uploaded</option><option value="Failed">Failed</option></select></label><label class="field"><span>Rescue Status</span><select id="rescue-filter"><option value="All">All Rescue States</option><option value="Pending">Pending Review</option><option value="Active">Active Rescue / Dispatched</option><option value="Resolved">Resolved / Completed</option><option value="Failed">Upload Rejected</option></select></label><label class="field" style="flex:2"><span>Search</span><input id="report-search" value="${e(state.search)}" placeholder="Incident ID, type, UAV, team or rescue status"></label><button class="btn ghost" data-action="clear-report-filter">Clear</button></div>
      <div id="report-results">${renderReportResults(shared)}</div></section>`;
  }

  function renderReportResults(shared = Store.load()) {
    const reports = shared.reports;
    const query = state.search.toLowerCase();
    const filtered = reports.filter((report) => {
      const incident = shared.incidents.find((item) => item.id === report.incidentId);
      const prog = rescueProgressSummary(shared, report, incident);
      const matchesUpload = state.filter === "All" || state.filter === report.uploadStatus;
      const matchesRescue = state.rescueFilter === "All" || state.rescueFilter === prog.group;
      const haystack = [report.id, report.filename, report.uav?.id, incident?.id, incident?.originalType, incident?.reviewedType, incident?.status, incident?.assignedTeamId, prog.text].join(" ").toLowerCase();
      return matchesUpload && matchesRescue && haystack.includes(query);
    });
    const perPage = 6;
    const pages = Math.max(1, Math.ceil(filtered.length / perPage));
    state.page = Math.min(state.page, pages);
    const rows = filtered.slice((state.page - 1) * perPage, state.page * perPage);
    return `<div class="table-wrap"><table class="my-reports-table"><colgroup><col style="width:15%"><col style="width:15%"><col style="width:17%"><col style="width:14%"><col style="width:15%"><col style="width:14%"><col style="width:10%"></colgroup><thead><tr><th>Report ID</th><th>Incident ID</th><th>Submission Time</th><th>Verification Queue</th><th>Incident Type</th><th>Rescue Status</th><th>Action</th></tr></thead><tbody>${rows.map((report) => {
        const incident = shared.incidents.find((item) => item.id === report.incidentId);
        return `<tr>
          <td><strong class="mono">${e(report.id)}</strong></td>
          <td><strong class="mono">${e(report.incidentId || "—")}</strong></td>
          <td>${UI.formatDate(report.createdAt)}</td>
          <td>${UI.badge(report.verificationLabel || "Unverified", report.verificationStatus === "verified" ? "success" : "warning")}</td>
          <td>${incident ? UI.typeLabel(Store.effectiveType(incident)) : "—"}</td>
          <td>${UI.badge(reportStatus(report, incident))}</td>
          <td><button class="btn ghost small" data-report="${e(report.id)}">Open</button></td>
        </tr>`;
      }).join("") || '<tr><td colspan="7">No reports match these filters.</td></tr>'}</tbody></table></div>
      <div class="row-between" style="margin-top:14px"><span class="muted">Showing ${rows.length} of ${filtered.length}</span><div class="row"><button class="btn ghost small" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""}>Previous</button><span class="badge neutral">Page ${state.page} / ${pages}</span><button class="btn ghost small" data-page="${state.page + 1}" ${state.page === pages ? "disabled" : ""}>Next</button></div></div>`;
  }

  function openReport(reportId) {
    const shared = Store.load();
    const report = shared.reports.find((item) => item.id === reportId);
    const incident = shared.incidents.find((item) => item.id === report?.incidentId);
    if (!report) return;
    const mission = incident ? (Store.dispatchForIncident ? Store.dispatchForIncident(shared, incident.id) : Store.missionForIncident(shared, incident.id)) : null;
    const teamId = mission?.teamId || incident?.assignedTeamId;
    const team = teamId ? shared.teams.find((item) => item.id === teamId) : null;
    const uploaded = report.uploadStatus === "Uploaded";
    const verified = report.verificationStatus === "verified";
    const noRescueRequired = Boolean(incident && verified && Store.effectiveType(incident) === "Normal");
    const completed = ["Resolved", "Completed"].includes(incident?.status) || mission?.status === "Completed";
    const dispatched = Boolean(mission || teamId || incident?.dispatchId || ["Matching Team", "In Progress"].includes(incident?.status));
    const onSite = incident?.status === "In Progress" || mission?.status === "In Progress";
    const notDispatched = uploaded && !dispatched && !noRescueRequired && !completed;
    const errors = (report.validationErrors || []).map((code) => Object.values(ERRORS).find((item) => item.code === code)).filter(Boolean);

    const dispatchDetail = noRescueRequired ? "Not required"
      : !dispatched && incident?.status === "Matching Team" ? "Matching team"
      : dispatched && !onSite && !completed ? mission?.status || "Dispatched"
      : "";
    const outcomeStatus = completed ? (noRescueRequired ? "Closed" : "Completed")
      : onSite ? "In progress" : "";
    const outcomeDetail = e(outcomeStatus);
    const stages = [
      { label: "Report Intake", state: "done", detail: "" },
      { label: "Admin Review", state: verified ? "done" : "active", detail: "" },
      { label: "Dispatch", state: dispatched || noRescueRequired ? "done" : verified && incident?.status === "Matching Team" ? "active" : "", detail: e(dispatchDetail) },
      { label: "Rescue Outcome", state: completed ? "done" : onSite ? "active" : "", detail: outcomeDetail }
    ];
    const lifecycleHtml = incident ? `<section class="report-lifecycle">
      <p class="eyebrow">Live Rescue Lifecycle</p>
      <div class="ops-stepper">${stages.map((stage, index) => `<div class="ops-step ${stage.state}"><span class="step-dot">${stage.state === "done" ? "✓" : index + 1}</span><div><strong>${stage.label}</strong>${stage.detail ? `<div class="muted">${stage.detail}</div>` : ""}</div></div>`).join("")}</div>
    </section>` : "";
    const evidenceHtml = report.image
      ? `<img class="report-evidence" src="${e(report.image)}" alt="Report evidence">`
      : UI.empty("▧", "No accepted evidence", "This attempt failed before processing.");
    const summaryHtml = `${uploaded ? `<section class="report-verification">
      <div class="row-between"><span class="eyebrow">Source Verification</span>${UI.badge(report.verificationLabel || (verified ? "Verified" : "Unverified"), verified ? "success" : "warning")}</div>
      ${!verified ? '<p class="muted">Awaiting Admin verification before dispatch</p>' : ""}
    </section>` : ""}
    ${incident ? `<dl class="report-facts">
      <div><dt>Incident Type</dt><dd>${UI.typeLabel(Store.effectiveType(incident))}</dd></div>
      <div><dt>GPS Coordinates</dt><dd class="mono">${incident.location.latitude.toFixed(6)}, ${incident.location.longitude.toFixed(6)}</dd></div>
    </dl>` : ""}
    ${team ? `<section class="report-assignment"><p class="eyebrow">Assigned Rescue Team</p><strong>${e(team.name)} (${e(team.id)})</strong><div class="muted"><span>Commander</span>: ${e(team.commander)}</div></section>` : ""}`;

    UI.modal({
      title: report.id,
      subtitle: `${report.filename} · ${UI.formatDate(report.createdAt)}`,
      headerMeta: `<span aria-label="Upload Status">${UI.badge(report.uploadStatus, uploaded ? "success" : "danger")}</span>${notDispatched ? UI.badge("Not Dispatched", "neutral") : ""}`,
      wide: true,
      content: `${summaryHtml.trim() ? `<div class="grid grid-2 report-detail-overview"><div>${evidenceHtml}</div><div class="report-detail-summary">${summaryHtml}</div></div>` : evidenceHtml}${lifecycleHtml}${errors.length ? `<h3 style="margin-top:18px">Validation errors</h3><div class="stack">${errors.map((item) => `<div class="alert danger"><div><strong>${e(item.code)} · ${e(item.title)}</strong><div>${e(item.reason)}</div></div></div>`).join("")}</div>` : ""}`
    });
  }


  // =========================================================================
  function bindReportResults() {
    const results = byId("report-results");
    if (!results) return;
    results.querySelectorAll("[data-report]").forEach((button) => button.addEventListener("click", () => openReport(button.dataset.report)));
    results.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => { state.page = Number(button.dataset.page); render(); }));
  }

  function bind() {
    document.querySelectorAll("[data-nav], [data-screen]").forEach((button) => button.addEventListener("click", () => setScreen(button.dataset.nav || button.dataset.screen)));
    document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "scan") scanUavs();
      if (action === "disconnect") disconnectUav();
      if (action === "live-gps") requestLiveGps();
      if (action === "sim-live-gps") simulateInRegionGpsLock();
      if (action === "choose-file") byId("file-input")?.click();
      if (action === "clear-file") { state.upload = null; render(); }
      if (action === "submit") submitReport();
      if (action === "new-report") { state.upload = null; state.activeReportId = null; setScreen("R1"); }
      if (action === "clear-report-filter") { state.filter = "All"; state.rescueFilter = "All"; state.search = ""; state.page = 1; render(); }
    }));
    document.querySelectorAll("[data-connect]").forEach((button) => button.addEventListener("click", () => connectUav(button.dataset.connect)));
    byId("r1-sample")?.addEventListener("change", (ev) => {
      if (!ev.target.value) return;
      const entry = (state.samples || []).find((item) => item.file === ev.target.value);
      useSampleImage(entry || ev.target.value);
    });
    byId("r1-access-note")?.addEventListener("input", (ev) => { state.declaration.accessNote = ev.target.value; });
    document.querySelectorAll("[data-upload-mode]").forEach((button) => button.addEventListener("click", () => {
      const nextMode = button.dataset.uploadMode;
      if (nextMode === state.mode) return;
      state.mode = nextMode;
      state.upload = null;
      state.lastErrors = [];
      render();
    }));
    document.querySelectorAll("[data-demo]").forEach((button) => button.addEventListener("click", () => demoUpload(button.dataset.demo)));
    document.querySelectorAll("[data-personal-demo]").forEach((button) => button.addEventListener("click", () => demoPersonalUpload(button.dataset.personalDemo)));
    document.querySelectorAll("[data-geo-preset]").forEach((button) => button.addEventListener("click", () => demoGeoPreset(button.dataset.geoPreset)));
    bindReportResults();
    const input = byId("file-input");
    if (input) input.addEventListener("change", () => loadFile(input.files[0]));
    const zone = byId("drop-zone");
    if (zone && (state.mode === "personal" || state.uavStatus === "connected")) {
      zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("drag"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
      zone.addEventListener("drop", (event) => { event.preventDefault(); zone.classList.remove("drag"); loadFile(event.dataTransfer.files[0]); });
    }
    const filter = byId("report-filter");
    if (filter) { filter.value = state.filter; filter.addEventListener("change", () => { state.filter = filter.value; state.page = 1; render(); }); }
    const rescueFilter = byId("rescue-filter");
    if (rescueFilter) { rescueFilter.value = state.rescueFilter; rescueFilter.addEventListener("change", () => { state.rescueFilter = rescueFilter.value; state.page = 1; render(); }); }
    const search = byId("report-search");
    if (search) search.addEventListener("input", () => {
      state.search = search.value;
      state.page = 1;
      const results = byId("report-results");
      if (!results) return;
      results.innerHTML = renderReportResults();
      bindReportResults();
      if (UI.applyLanguage && UI.getPreferences) {
        UI.applyLanguage(UI.getPreferences().language, results);
      }
    });
    const narrowSelect = byId("r1-narrow-entrance");
    if (narrowSelect) narrowSelect.addEventListener("change", () => { state.reportTags.narrow_entrance = narrowSelect.value === "true"; });
    
    SkyUI.bindDemoControls(() => { state.activeReportId = null; setScreen(state.screen === "R3" ? "R1" : state.screen); });
  }

  function renderNav() {
    const navNode = byId("reporter-top-nav") || document.querySelector(".top-nav");
    if (!navNode) return;
    navNode.innerHTML = `
      <button data-nav="R1" class="${state.screen === "R1" ? "active" : ""}">Submit Report</button>
      <button data-nav="R4" class="${state.screen === "R4" ? "active" : ""}">My Reports</button>
    `;
  }

  function render() {
    renderNav();
    if (UI.mountHeaderProfile) UI.mountHeaderProfile();
    const renderers = { R1: renderR1Group1, R2: renderR2, R3: renderR3Group1, R4: renderR4 };
    root.innerHTML = (renderers[state.screen] || renderR1Group1)();
    bind();
    if (UI.applyLanguage && UI.getPreferences) {
      setTimeout(() => UI.applyLanguage(UI.getPreferences().language), 0);
    }
  }

  window.addEventListener("hashchange", () => {
    const screen = location.hash.replace("#", "");
    if (["R1", "R2", "R3", "R4"].includes(screen) && screen !== state.screen) {
      state.screen = screen;
      render();
    }
  });
  Store.subscribe(() => { if (!document.querySelector(".modal-backdrop")) render(); });
  window.addEventListener("skyrescue:preferences:change", () => render());
  window.addEventListener("skyrescue:auth:change", () => { if (state.screen === "R1") { state.upload = null; render(); } });
  render();
  loadSamples();
  if (state.screen === "R3") startPipeline();
})();
