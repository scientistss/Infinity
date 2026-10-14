/**
 * Synthetic compatibility evidence, not natural gameplay.
 * Run with the fixed r9 checkout as argv[2] and a JSON output path as argv[3].
 * The historical serializer/reader generate every old envelope. Current code is
 * used only to verify additive r10 metadata, r11 null slots and exact zero-age r14 NPC metadata, plus rejection by the old reader.
 */
declare const process: { argv: string[]; stdout: { write(text: string): void } };
import { expectedNpcEconomy, projectVerifiedNpcEconomy } from "./r16-compatibility.mjs";
import archivedR8 from "../tests/fixtures/building-templates-r8.json";
import { importSave as importCurrent } from "../src/game/save";

export const TERRAFORMER_SOURCE_SHA = "f96894eb1b32737ab403890ed83fdb3da41a0644";
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
}
function check(value: unknown, reason: string): asserts value { if (!value) throw Error(reason); }
export function withoutTerraformerMetadata(state: any): any {
  const { terraformerGrantJobFloor: _floor, ...rest } = projectVerifiedNpcEconomy(state, expectedNpcEconomy(), "pure historical r9 migration");
  return { ...rest, planets: rest.planets.map((planet: any) => {
    check(Object.hasOwn(planet, "demolition") && planet.demolition === null, "legacy migration must add exactly one empty demolition slot");
    const { terraformerFields: _fields, demolition: _demolition, ...old } = planet;
    return old;
  }) };
}

export async function createTerraformerMigrationFixtures(root: string) {
  const [{ execFileSync }, { createHash }] = await Promise.all([import("node:child_process" as string), import("node:crypto" as string)]);
  check(String(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root })).trim() === TERRAFORMER_SOURCE_SHA,
    "Terraformer oracle must be the exact fixed r9 commit");
  execFileSync("git", ["diff", "--exit-code", TERRAFORMER_SOURCE_SHA, "--", "src"], { cwd: root });
  const load = (file: string) => import(`${root.replace(/\/$/, "")}/src/game/${file}.ts`);
  const [factory, save, content, queue, templates, logic] = await Promise.all(["state", "save", "content", "queue", "building-templates", "logic"].map(load));
  check(content.SAVE_VERSION === 9 && content.SAVE_REVISION === 9, "Oracle must use its own v9/r9 serializer");
  const rows: Array<{ name: string; synthetic: true; canonical: boolean; raw: string; rawSha256: string; oldReaderOutput: any }> = [];
  function capture(name: string, state: any, mutate?: (file: any) => void) {
    let raw = save.exportSave(state, 1000, 900);
    if (mutate) { const file = JSON.parse(raw); mutate(file); raw = JSON.stringify(file, null, 2); }
    const oldReaderOutput = save.importSave(raw);
    check(oldReaderOutput.revision === 9, `${name}: fixed reader lost r9`);
    if (!mutate) check(stable(JSON.parse(raw)) === stable(oldReaderOutput), `${name}: native old serialization was not canonical`);
    rows.push({ name, synthetic: true, canonical: !mutate, raw, rawSha256: createHash("sha256").update(raw).digest("hex"), oldReaderOutput });
  }
  const cases: Array<[string, number, number, number[], "manual" | "protocol" | "plan"]> = [
    ["zero", 0, 163, [], "manual"], ["continuous_manual", 2, 163, [3, 4], "manual"],
    ["jump_protocol", 2, 163, [7], "protocol"], ["duplicate_manual", 2, 163, [3, 3], "manual"],
    ["already_built_manual", 4, 163, [3], "manual"], ["full10000_plan", 2, 10000, [3], "plan"],
    ["9995_two_paid", 2, 9995, [3, 4], "manual"], ["invalid_cancel_after_legacy_duplicate", 0, 163, [1, 1], "manual"],
  ];
  for (const [name, level, fieldsMax, targets, source] of cases) {
    let state = factory.createInitialState(123, 456);
    const planet = state.planets[0];
    planet.buildings.terraformer = level; planet.fieldsMax = fieldsMax;
    planet.buildQueue = targets.map((targetLevel, index) => ({ jobId: index + 1, taskId: source === "plan" ? 1 : null,
      building: "terraformer", targetLevel, paid: queue.costFor(state, "terraformer", targetLevel),
      totalSeconds: index ? 0 : 10, remainingSeconds: index ? 0 : 4, source }));
    state.orders.nextJobId = targets.length + 1;
    if (source === "plan") {
      const paid = Object.fromEntries(Object.entries(planet.buildQueue[0].paid).map(([key, amount]: [string, any]) => [key, amount.toString()]));
      state.orders.nextTaskId = 2;
      state.orders.tasks = [{ id: 1, kind: "building", planetId: planet.id, building: "terraformer", targetLevel: targets.at(-1),
        status: "paused", reason: "synthetic old-reader fixture", budget: { ...paid }, charged: { ...paid },
        refunded: { metal: "0", crystal: "0", deuterium: "0" }, activeJob: { jobId: 1, quantity: 1, credited: 0 },
        completedUnits: 0, transport: null, currentWork: null, formationOrigin: null }];
    }
    // Canonical serializers store current achievements/energy flags after a zero-time refresh.
    state = logic.tick(state, 0);
    capture(name, state);
  }
  capture("legacy_normalization", factory.createInitialState(123, 456), file => {
    const planet = file.state.planets[0];
    planet.buildQueue = [{ jobId: 1, taskId: null, building: "terraformer", targetLevel: 1,
      paid: { metal: "000", crystal: "+5e4", deuterium: 100000 }, totalSeconds: 10, remainingSeconds: 20, source: "manual" }];
    file.state.orders.nextJobId = 2;
    delete planet.fieldsMax; delete planet.buildings.terraformer;
  });
  for (const phase of ["outbound", "returning"] as const) {
    let state = save.deserializeState(save.importSave(JSON.stringify(archivedR8.fixtures[phase])).state);
    const ordinaryBuilding = queue.enqueue(state, "solar_plant", "manual");
    check(ordinaryBuilding.ok, `${phase}: historical ordinary paid building failed`);
    state = ordinaryBuilding.state;
    const home = state.planets[0], payer = state.planets[1];
    home.fieldsMax = 217; home.buildings.terraformer = 2;
    payer.fieldsMax = 187; payer.buildings.terraformer = 1;
    for (const [index, source] of ["manual", "protocol"].entries()) {
      home.buildQueue.push({ building: "terraformer", targetLevel: index + 3, paid: queue.costFor(state, "terraformer", index + 3),
        jobId: state.orders.nextJobId++, taskId: null, source, totalSeconds: 0, remainingSeconds: 0 });
    }
    const taskId = state.orders.nextTaskId++, jobId = state.orders.nextJobId++;
    const paid = queue.costFor(state, "terraformer", 2);
    const money = Object.fromEntries(Object.entries(paid).map(([key, amount]: [string, any]) => [key, amount.toString()]));
    payer.buildQueue.push({ building: "terraformer", targetLevel: 2, paid, jobId, taskId, source: "plan", totalSeconds: 30, remainingSeconds: 17 });
    state.orders.tasks.push({ id: taskId, kind: "building", planetId: payer.id, building: "terraformer", targetLevel: 2,
      status: "paused", reason: "synthetic old terraformer payment", budget: { ...money }, charged: { ...money },
      refunded: { metal: "0", crystal: "0", deuterium: "0" }, activeJob: { jobId, quantity: 1, credited: 0 },
      completedUnits: 0, transport: null, currentWork: null, formationOrigin: null });
    const created = templates.createBuildingTemplate(state, { name: "旧版非空建筑模板", goals: [
      { building: "terraformer", targetLevel: 5 }, { building: "solar_plant", targetLevel: 7 },
    ] }, state.buildingTemplates.nextTemplateId);
    check(created.ok, `${phase}: old building template creation failed`);
    state = logic.tick(created.state, 0);
    capture(`complete_world_${phase}`, state);
  }
  for (const row of rows) {
    const current = importCurrent(row.raw);
    check(current.revision === 16 && current.savedAt === row.oldReaderOutput.savedAt && current.lastTickAt === row.oldReaderOutput.lastTickAt,
      `${row.name}: revision/wall-clock migration drift`);
    check(stable(withoutTerraformerMetadata(current.state)) === stable(row.oldReaderOutput.state), `${row.name}: old-reader semantics changed`);
    check(current.state.terraformerGrantJobFloor === row.oldReaderOutput.state.orders.nextJobId, `${row.name}: paid-job boundary changed`);
    check(current.state.planets.every((planet: any) => planet.terraformerFields.base === planet.fieldsMax && planet.terraformerFields.grantedLevels === 0),
      `${row.name}: migration granted retroactive fields`);
    let oldRejected = false;
    try { save.importSave(JSON.stringify(current)); } catch { oldRejected = true; }
    check(oldRejected, `${row.name}: old r9 reader accepted true r14`);
  }
  return { sourceSha: TERRAFORMER_SOURCE_SHA, description: "Synthetic fixtures generated by the fixed historical r9 serializer and checked by that same reader. The normalization row is separately labeled hand-edited input. No natural progression or browser acceptance is claimed.", rows };
}

if (process.argv[1]?.endsWith("terraformer-migration-fixture.ts")) {
  const root = process.argv[2];
  if (!root) throw Error("Provide the exact historical r9 checkout path");
  const result = await createTerraformerMigrationFixtures(root);
  if (process.argv[3]) {
    const { writeFileSync } = await import("node:fs" as string);
    writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + "\n");
  }
  process.stdout.write(JSON.stringify({ sourceSha: result.sourceSha, checked: result.rows.length,
    fixtures: result.rows.map(row => ({ name: row.name, canonical: row.canonical, rawSha256: row.rawSha256 })) }, null, 2) + "\n");
}
