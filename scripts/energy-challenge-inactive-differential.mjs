/**
 * Independent public-base comparison input. Run this same driver once against
 * untouched public A 56c16a1 and once against B, in separate Node processes. It uses only
 * exports present at that public base. Inputs are explicitly synthetic.
 *
 * node --import tsx scripts/energy-challenge-inactive-differential.mjs ROOT baseline|candidate OUTPUT
 * python3 scripts/compare-energy-challenge-inactive.py BASE.json B.json
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BASE = "56c16a1c73e24347919141c2b789655ae59e82cb";
const [rootArg, role, output] = process.argv.slice(2);
if (!rootArg || !output || !["baseline", "candidate"].includes(role)) throw new Error("Expected ROOT baseline|candidate OUTPUT");
const root = resolve(rootArg);
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD"), mergeBase = git("merge-base", "HEAD", BASE);
const dirtyTracked = git("status", "--porcelain=v1", "--untracked-files=no");
const extraSource = git("ls-files", "--others", "--exclude-standard", "--", "src");
const ignoredSource = git("ls-files", "--others", "--ignored", "--exclude-standard", "--", "src");
if (role === "baseline" && (commit !== BASE || dirtyTracked || extraSource || ignoredSource)) throw new Error("Baseline must be the clean, exact public A 56c16a1 tree");
if (mergeBase !== BASE) throw new Error("Source root is not descended from the stated public base");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function productionManifest() {
  function walk(path) {
    return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry => {
      const next = `${path}/${entry.name}`;
      if (entry.isDirectory()) return walk(next);
      if (!entry.isFile()) throw new Error(`Production manifest refuses nonregular source: ${next}`);
      return [{ path: next, sha256: hash(readFileSync(resolve(root, next))) }];
    });
  }
  return [...walk("src"), ...["package.json", "package-lock.json"].map(path => ({ path, sha256: hash(readFileSync(resolve(root, path))) }))]
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
const sourceFiles = productionManifest(), driverSha256 = hash(readFileSync(fileURLToPath(import.meta.url)));
const moduleAt = (path) => import(pathToFileURL(resolve(root, `src/${path}.ts`)).href);
const [{ createInitialState }, { big }, { activePlanet, selectPlanet, withPlanet }, { createPlanet }, { tick, evaluatePrestige },
  { enqueue, cancel }, { enqueueResearch }, { createOrderTask, runDueOrderPass }, { equipCard, patchSlot },
  { advanceBuild }, { catchUp }, { serializeState }] = await Promise.all([
  moduleAt("game/state"), moduleAt("game/decimal"), moduleAt("game/empire"), moduleAt("game/planet"), moduleAt("game/logic"),
  moduleAt("game/queue"), moduleAt("game/research"), moduleAt("game/orders"), moduleAt("automation/engine"),
  moduleAt("game/dark-matter"), moduleAt("core/offline"), moduleAt("game/save"),
]);
const checkpoints = [];
const checked = (value) => {
  if (!value.ok) throw new Error(value.reason ?? value.status ?? "Scenario action failed");
  return value.state;
};
const snapshot = (name, state) => checkpoints.push({ name, state: JSON.parse(JSON.stringify(serializeState(state))) });
const fresh = () => createInitialState(0x31415926, 0x27182818);
const rich = (state, n = 1e6) => withPlanet(state, { resources: { metal: big(n), crystal: big(n), deuterium: big(n) } });

let state = fresh();
snapshot("single-fresh", state);
state = tick(state, 0);
snapshot("single-zero-time", state);
state = tick(state, -1);
snapshot("single-negative-time", state);
state = tick(state, Infinity);
snapshot("single-nonfinite-time", state);
state = tick(state, 60);
snapshot("single-live-base-production", state);
state = checked(enqueue(state, "metal_mine", "manual"));
state = checked(enqueue(state, "solar_plant", "protocol"));
snapshot("single-two-paid-jobs", state);
state = tick(state, 5.125);
snapshot("single-completions-live", state);
state = catchUp(state, 600).state;
snapshot("single-offline", state);

state = rich(fresh());
Object.assign(activePlanet(state).buildings, { metal_mine: 8, crystal_mine: 7, deuterium_synth: 5, solar_plant: 8,
  fusion_reactor: 2, research_lab: 4, robotics_factory: 2, shipyard: 2 });
state.research.levels.energy_tech = 4;
state.research.levels.computer_tech = 4;
const home = activePlanet(state).coordinates;
for (let i = 1; i <= 2; i++) {
  const planet = createPlanet(`colony-${i}`, { ...home, system: (home.system + i) % 499 + 1 });
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  Object.assign(planet.buildings, { metal_mine: 7 + i, crystal_mine: 5 + i, deuterium_synth: 3 + i, solar_plant: 7, research_lab: 2 });
  planet.units.solar_satellite = i * 4;
  state.planets.push(planet);
}
state = checked(enqueue(state, "metal_mine", "manual"));
state = checked(enqueueResearch(state, "energy_tech", "manual"));
state = selectPlanet(state, "colony-1");
state = checked(enqueue(state, "crystal_mine", "protocol"));
state = checked(enqueue(state, "solar_plant", "manual"));
snapshot("multi-independent-paid-queues", state);
for (const seconds of [0.017, 0.125, 2.75, 17.375]) state = tick(state, seconds);
snapshot("multi-live-piecewise", state);
state = catchUp(state, 1200).state;
snapshot("multi-offline-queues-and-production", state);

state = fresh();
Object.assign(activePlanet(state).buildings, { metal_mine: 9, crystal_mine: 7, deuterium_synth: 1, fusion_reactor: 6 });
state.research.levels.energy_tech = 1;
activePlanet(state).resources.deuterium = big(0);
snapshot("fusion-empty-before", state);
state = tick(state, 61.25);
snapshot("fusion-empty-live-derating", state);
state = catchUp(state, 3600).state;
snapshot("fusion-empty-offline", state);

state = fresh();
activePlanet(state).resources.metal = big(9999);
activePlanet(state).resources.crystal = big(9999);
state = tick(state, 60, "offline");
snapshot("storage-canonical-boundary", state);
state = checked(enqueue(state, "metal_mine", "manual"));
state = checked(enqueue(state, "metal_mine", "manual"));
state = checked(cancel(state, 0));
snapshot("refund-and-retarget", state);
state = advanceBuild(state, 100, true);
snapshot("accelerated-paid-completion", state);

state = rich(fresh());
activePlanet(state).buildings.robotics_factory = 2;
state.unlockedCards.push("auto_collect", "auto_build", "auto_prestige");
let equipped = equipCard(state, 0, "auto_collect");
if (equipped.state === state) throw new Error(equipped.status);
state = equipped.state;
equipped = equipCard(state, 1, "auto_build");
if (equipped.state === state) throw new Error(equipped.status);
state = equipped.state;
state = patchSlot(state, 1, "trigger.seconds", "5");
state = checked(createOrderTask(state, { kind: "building", planetId: state.activePlanetId, building: "crystal_mine", targetLevel: 3,
  expectedNextTaskId: state.orders.nextTaskId, budget: { metal: "100000", crystal: "100000", deuterium: "0" } }));
state = runDueOrderPass(state);
snapshot("protocol-and-finite-plan-authorized", state);
state = tick(state, 60);
snapshot("protocol-and-finite-plan-live", state);
state = catchUp(state, 600).state;
snapshot("protocol-and-finite-plan-offline", state);
state.lifetime.metal = big(1e8);
snapshot("ordinary-prestige-before", state);
state = evaluatePrestige(state).next;
snapshot("ordinary-prestige-after", state);

if (JSON.stringify(productionManifest()) !== JSON.stringify(sourceFiles)) throw new Error("Production source changed during differential run");
writeFileSync(output, JSON.stringify({ schema: "energy-challenge-inactive-diff-v1", role, base: BASE,
  source: { root, commit, mergeBase, dirtyTracked, extraSource, ignoredSource, sourceFiles, driverSha256, node: process.version }, scenarioKind: "explicitly synthetic deterministic public-API differential",
  checkpoints }, null, 2) + "\n");
process.stdout.write(JSON.stringify({ output, role, checkpoints: checkpoints.length, commit }) + "\n");
