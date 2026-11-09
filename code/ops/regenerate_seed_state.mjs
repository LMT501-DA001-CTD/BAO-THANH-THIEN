// Regenerate server/seed_state.json from the browser demo dataset.
// Run: node ops/regenerate_seed_state.mjs
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const REGIONS = [
  "region-vietnam",
  "region-hcmc",
  "region-cantho",
  "region-hanoi",
  "region-danang",
  "region-khanhhoa",
  "region-lamdong",
  "region-quangnam"
];

const window = {};
const context = { window, console };
for (const name of REGIONS) {
  vm.runInNewContext(readFileSync(`web/common/js/datasets/${name}.js`, "utf8"), context);
}
vm.runInNewContext(readFileSync("web/common/js/demo-data.js", "utf8"), context);

const state = window.SkyRescueDemo.buildInitialState();
writeFileSync("server/seed_state.json", JSON.stringify(state, null, 2) + "\n", "utf8");
console.log(`Wrote server/seed_state.json: ${state.incidents.length} incidents, ${state.teams.length} teams, ${state.dispatchOrders.length} dispatches`);
