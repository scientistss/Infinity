/** Synthetic source-r6 work, generated exclusively by the historical engine and serializer.
 * Shared by deterministic migration proof and native-browser storage acceptance.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonical(record[key])]));
  }
  return value;
}

export async function createLegacyR6Fixtures(root: string, now: number) {
  const load = (file: string) => import(`${root.replace(/\/$/, "")}/src/game/${file}.ts`);
  const [factory, save, content, decimal, orders, fleet, logic] = await Promise.all(
    ["state", "save", "content", "decimal", "orders", "fleet", "logic"].map(load));
  if (content.SAVE_REVISION !== 6 || content.SAVE_VERSION !== 9) throw Error("Transport fixture requires the actual v9/r6 source");
  let state = factory.createInitialState(20261016);
  state.arcade.seed = 20261016;
  const donor = state.planets[0];
  donor.name = "合成 r6 固定供货港";
  const payer = factory.createPlanet("synthetic-r6-payer", { galaxy: 3, system: 50, position: 8 });
  payer.name = "合成 r6 固定执行星球";
  state.planets.push(payer);
  Object.assign(state.research.levels, { astrophysics: 1, computer_tech: 3, combustion_drive: 6, energy_tech: 16 });
  for (const planet of state.planets) {
    Object.assign(planet.buildings, { robotics_factory: 2, research_lab: 8, shipyard: 7, metal_mine: 15 });
    for (const key of Object.keys(planet.productionPct)) planet.productionPct[key] = 0;
    planet.resources = { metal: decimal.big(10_000), crystal: decimal.big(10_000), deuterium: decimal.big(10_000) };
  }
  donor.resources = { metal: decimal.big(1e9), crystal: decimal.big(1e9), deuterium: decimal.big(1e9) };
  donor.units.small_cargo = 1000;
  state = logic.tick(state, 0);
  const budget = { metal: "100000000", crystal: "100000000", deuterium: "100000000" };
  function accept(result: any, label: string) {
    if (!result.ok) throw Error(`Actual r6 ${label} failed: ${result.reason}`);
    return result.state;
  }
  state = accept(orders.createOrderTask(state, { kind: "building", planetId: payer.id, building: "metal_mine", targetLevel: 16,
    expectedNextTaskId: state.orders.nextTaskId, budget,
    transport: { donorPlanetId: donor.id, ship: "small_cargo", count: 100, speedPercent: 10, maxTrips: 2,
      grossCargoCap: { metal: "1000000", crystal: "1000000", deuterium: "1000000" } } }), "transport creation");
  state = accept(orders.createOrderTask(state, { kind: "research", planetId: donor.id, tech: "energy_tech", targetLevel: 17,
    expectedNextTaskId: state.orders.nextTaskId, budget }), "research creation");
  state = orders.advanceOrderPlans(state, 10);
  if (state.orders.tasks[0].currentWork?.stage !== "pending" || state.fleets.length !== 1 ||
      state.orders.tasks[0].transport?.trips[0]?.phase.kind !== "outbound") throw Error("Actual r6 transport did not dispatch unpaid work");
  if (!state.orders.tasks[1].activeJob || state.research.queue.length !== 1 || state.research.queue[0].source !== "plan") {
    throw Error("Actual r6 research plan did not pay for its real queue");
  }
  for (const task of state.orders.tasks) state = accept(orders.pauseOrderTask(state, task.id), "pause");
  state = logic.tick(state, 0);
  const outbound = JSON.parse(save.exportSave(state, now));
  // Advance only the genuine fleet primitive, then recall that same real ship.
  // This gives a returning receipt without synthesizing its phase or timestamps.
  const flown = fleet.advanceFleets(state, Math.min(30, state.fleets[0].duration / 4));
  const returned = accept(fleet.recallFleet(flown, flown.fleets[0].id), "recall");
  const returning = JSON.parse(save.exportSave(logic.tick(returned, 0), now));
  for (const [label, file] of [["outbound", outbound], ["returning", returning]] as const) {
    if (file.revision !== 6 || "researchTemplates" in file.state) throw Error(`Actual r6 ${label} serializer mismatch`);
    const checked = save.importSave(JSON.stringify(file));
    if (JSON.stringify(canonical(checked.state)) !== JSON.stringify(canonical(file.state))) throw Error(`Actual r6 ${label} fixture is not a stable old-reader round trip`);
    if (file.state.orders.tasks.some((task: any) => task.status !== "paused") || file.state.research.queue.length !== 1) {
      throw Error(`Actual r6 ${label} fixture lost paused plans or paid research`);
    }
  }
  if (returning.state.fleets[0]?.returning !== true || returning.state.orders.tasks[0].transport.trips[0].phase.kind !== "returning") {
    throw Error("Actual r6 recall did not retain its returning fleet and receipt");
  }
  return { outbound, returning };
}
