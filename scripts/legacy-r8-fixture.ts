/** Synthetic source-r8 work, generated exclusively by the historical engine and serializer.
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

export async function createLegacyR8Fixtures(root: string, now: number) {
  const load = (file: string) => import(`${root.replace(/\/$/, "")}/src/game/${file}.ts`);
  const [factory, save, content, decimal, orders, fleet, logic, templates, yard, formations, empire] = await Promise.all(
    ["state", "save", "content", "decimal", "orders", "fleet", "logic", "research-templates", "shipyard", "formations", "empire"].map(load));
  if (content.SAVE_REVISION !== 8 || content.SAVE_VERSION !== 9) throw Error("Transport fixture requires the actual v9/r8 source");
  let state = factory.createInitialState(20261018);
  state.arcade.seed = 20261018;
  const donor = state.planets[0];
  donor.name = "合成 r8 固定供货港";
  const payer = factory.createPlanet("synthetic-r8-payer", { galaxy: 3, system: 50, position: 8 });
  payer.name = "合成 r8 固定执行星球";
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
    if (!result.ok) throw Error(`Actual r8 ${label} failed: ${result.reason}`);
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
      state.orders.tasks[0].transport?.trips[0]?.phase.kind !== "outbound") throw Error("Actual r8 transport did not dispatch unpaid work");
  if (!state.orders.tasks[1].activeJob || state.research.queue.length !== 1 || state.research.queue[0].source !== "plan") {
    throw Error("Actual r8 research plan did not pay for its real queue");
  }
  for (const task of state.orders.tasks) state = accept(orders.pauseOrderTask(state, task.id), "pause");
  state = accept(templates.createResearchTemplate(state, { name: "合成 r8 已保存研究目标 🚀", goals: [
    { tech: "energy_tech", targetLevel: 18 }, { tech: "computer_tech", targetLevel: 5 },
  ] }, state.researchTemplates.nextTemplateId), "nonempty research template creation");
  state = accept(templates.createResearchTemplate(state, { name: "合成 r8 第二份研究目标", goals: [
    { tech: "combustion_drive", targetLevel: 8 },
  ] }, state.researchTemplates.nextTemplateId), "second research template creation");
  state = accept(yard.enqueueUnits(state, "light_fighter", 7, "manual"), "ordinary paid ship queue");
  state = yard.advanceShipyard(state, yard.unitSeconds(state, "light_fighter") * 2.5, false).state;
  state = accept(formations.createFormation(state, { expectedNextFormationId: 1,
    name: "合成 r8 原始编成", ships: { light_fighter: 3 } }), "formation creation");
  const review = formations.previewFormationReplenishment(state, { formationId: 1, formationRevision: 1, planetId: payer.id });
  if (!review.ok || !review.request) throw Error(`Actual r8 formation review failed: ${review.reason}`);
  state = accept(formations.createFormationReplenishment(state, review.request), "formation replenishment");
  state = orders.advanceOrderPlans(state, 10);
  state = empire.selectPlanet(state, payer.id);
  state = yard.advanceShipyard(state, yard.unitSeconds(state, "light_fighter") * 2.5, false).state;
  state = empire.selectPlanet(state, donor.id);
  state = accept(formations.editFormation(state, { formationId: 1, expectedRevision: 1,
    name: "合成 r8 已编辑编成", ships: { small_cargo: 4 } }), "formation edit");
  state = accept(orders.pauseOrderTask(state, state.orders.tasks.at(-1).id), "formation plan pause");
  state = logic.tick(state, 0);
  const outbound = JSON.parse(save.exportSave(state, now));
  // Advance only the genuine fleet primitive, then recall that same real ship.
  // This gives a returning receipt without synthesizing its phase or timestamps.
  const flown = fleet.advanceFleets(state, Math.min(30, state.fleets[0].duration / 4));
  const returned = accept(fleet.recallFleet(flown, flown.fleets[0].id), "recall");
  const returning = JSON.parse(save.exportSave(logic.tick(returned, 0), now));
  for (const [label, file] of [["outbound", outbound], ["returning", returning]] as const) {
    if (file.revision !== 8 || file.state.researchTemplates?.templates.length !== 2 || "buildingTemplates" in file.state || file.state.formations?.entries.length !== 1 || file.state.formations.entries[0].revision !== 2 || file.state.orders.tasks.at(-1)?.formationOrigin?.formation?.revision !== 1) throw Error(`Actual r8 ${label} serializer mismatch`);
    const checked = save.importSave(JSON.stringify(file));
    if (JSON.stringify(canonical(checked.state)) !== JSON.stringify(canonical(file.state))) throw Error(`Actual r8 ${label} fixture is not a stable old-reader round trip`);
    if (file.state.orders.tasks.some((task: any) => task.status !== "paused") || file.state.research.queue.length !== 1 || file.state.planets[0].shipyardQueue[0]?.count !== 5) {
      throw Error(`Actual r8 ${label} fixture lost nonempty templates, paused plans, paid research or real ship remainder`);
    }
  }
  if (returning.state.fleets[0]?.returning !== true || returning.state.orders.tasks[0].transport.trips[0].phase.kind !== "returning") {
    throw Error("Actual r8 recall did not retain its returning fleet and receipt");
  }
  if (outbound.state.planets[1].shipyardQueue[0]?.count !== 1 || outbound.state.orders.tasks.at(-1)?.completedUnits !== 2) throw Error("Actual r8 formation must retain its paid partial work");
  return { outbound, returning };
}
