# SkyRescue demo sample images

This folder contains the 20 `EXT01`–`EXT20` images from the external UAV test set.
All 20 files are JPEG (`EXT20` is `EXT20.jpeg`; the supplied README's PNG note is stale).
The files keep their original GPS, capture time and camera EXIF. They span seven
provinces. The national bounding box accepts all seven; the fixed capture times
(3–4 November 2026) are older than the 30-minute upload rule.

The Reporter sample picker keeps the real EXIF GPS when it is inside Vietnam. It replaces
only stale capture time or missing source fields, with an explicit
**Simulated metadata (demo)** label. Upload the file manually to test the raw EXIF.

Each file also seeds one national incident (`INC-8801`–`INC-8820`); see `manifest.json`
for the exact coordinates and capture time.

| File | Incident | Scene | Dataset region |
|---|---|---|---|
| `EXT01.jpg` | INC-8801 | Fire | Lam Dong |
| `EXT02.jpeg` | INC-8802 | Fire | Quang Nam |
| `EXT03.jpg` | INC-8803 | Fire | Quang Nam |
| `EXT04.jpg` | INC-8804 | Collapsed | Ha Noi |
| `EXT05.jpg` | INC-8805 | Collapsed | Da Nang |
| `EXT06.jpeg` | INC-8806 | Collapsed | Ho Chi Minh City |
| `EXT07.jpeg` | INC-8807 | Collapsed | Khanh Hoa |
| `EXT08.jpeg` | INC-8808 | Collapsed | Khanh Hoa |
| `EXT09.jpeg` | INC-8809 | Traffic | Can Tho |
| `EXT10.jpeg` | INC-8810 | Traffic | Can Tho |
| `EXT11.jpeg` | INC-8811 | Traffic | Lam Dong |
| `EXT12.jpg` | INC-8812 | Flood | Quang Nam |
| `EXT13.jpg` | INC-8813 | Flood | Ho Chi Minh City |
| `EXT14.jpeg` | INC-8814 | Flood | Ha Noi |
| `EXT15.jpeg` | INC-8815 | Normal | Da Nang |
| `EXT16.jpeg` | INC-8816 | Normal | Khanh Hoa |
| `EXT17.jpeg` | INC-8817 | Normal | Ha Noi |
| `EXT18.jpeg` | INC-8818 | Fire | Da Nang |
| `EXT19.jpeg` | INC-8819 | Flood | Ha Noi |
| `EXT20.jpeg` | INC-8820 | Traffic | Ho Chi Minh City |
