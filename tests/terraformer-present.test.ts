import { describe, expect, it } from "vitest";
import { activeBuildings, CURRENT_PHASE } from "../src/data/buildings";
import { createBuildingTemplate, mapBuildingTemplate } from "../src/game/building-templates";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { usedFields } from "../src/game/planet";
import { enqueue } from "../src/game/queue";
import { serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";
import { presentVisible } from "../src/ui/present";
import { localOrderQuoteContextKey, quoteLocalOrder } from "../src/ui/order-quote-model";
import { rich, stateWith, withResearch } from "./helpers";

const input = { status: "", banner: null, notice: null, catchup: null };
const view = (state: GameState) => presentVisible(state, input, "facilities");
const ready = () => withResearch(rich(stateWith({ nanite_factory: 1, robotics_factory: 10, solar_plant: 14 })), { energy_tech: 12 });

describe("terraformer current-rule presentation", () => {
  it("opens exactly the terraformer exception without changing the phase or other later buildings", () => {
    expect(CURRENT_PHASE).toBe(3);
    expect(activeBuildings().filter(def => def.phase > CURRENT_PHASE).map(def => def.id)).toEqual(["terraformer"]);
    expect(view(stateWith()).buildings.filter(row => row.id === "terraformer")).toHaveLength(1);
  });

  it("shows the real next cost, supply threshold and net field rule without paying", () => {
    const state = ready(); const before = serializeState(state);
    const row = view(state).buildings.find(row => row.id === "terraformer")!;
    expect(row.canEnqueue).toBe(true);
    expect(row.cost).toContain("5.00e4"); expect(row.cost).toContain("1.00e5");
    expect(row.cost).toContain("供能 1.06e3 / 需要 1.00e3（不消耗）");
    expect(row.effect).toBe("本版新付款入队每级 +5 总格，建筑占 1 格（净 +4）");
    expect(row.button).toBe("升级到 等级 1");
    expect(serializeState(state)).toEqual(before);
  });

  it("explains old paid work separately from an actual new paid expansion", () => {
    const paid = enqueue(ready(), "terraformer", "manual"); expect(paid.ok).toBe(true);
    expect(view(paid.state).queue.items[0]!.detail).toContain("完成总格 +5，建筑占 1 格");
    const old = { ...paid.state, terraformerGrantJobFloor: paid.state.orders.nextJobId };
    const before = serializeState(old);
    const current = view(old);
    expect(current.queue.items[0]!.detail).toContain("旧版已付：完成升级，不增加格数");
    const row = current.buildings.find(row => row.id === "terraformer")!;
    expect(row.canEnqueue).toBe(false); expect(row.reason).toContain("旧版已付");
    expect(serializeState(old)).toEqual(before);
  });

  it("recomputes a second-level energy block rather than reusing a first-level quote", () => {
    const state = ready(); activePlanet(state).buildings.terraformer = 1;
    const target = { kind: "building" as const, planetId: state.activePlanetId, building: "terraformer" as const, targetLevel: 2 };
    const before = serializeState(state), firstKey = localOrderQuoteContextKey(state, target);
    const quote = quoteLocalOrder(state, target);
    expect(quote.cost).toEqual({ metal: "0", crystal: "100000", deuterium: "200000" });
    expect(quote.warnings.join(" ")).toContain("能源不足");
    expect(quote.warnings.join(" ")).not.toContain("第 4 阶段");
    expect(serializeState(state)).toEqual(before);
    activePlanet(state).buildings.solar_plant = 18;
    expect(localOrderQuoteContextKey(state, target)).not.toBe(firstKey);
    expect(quoteLocalOrder(state, target).warnings.join(" ")).not.toContain("能源不足");
  });

  it("warns terraformer templates using current fields without promising future capacity", () => {
    let state = ready(); const planet = activePlanet(state);
    planet.fieldsMax = usedFields(planet) + 1; planet.terraformerFields.base = planet.fieldsMax;
    const result = createBuildingTemplate(state, { name: "扩格后建设", goals: [
      { building: "terraformer", targetLevel: 1 }, { building: "metal_mine", targetLevel: 3 },
    ] }, 1);
    expect(result.ok).toBe(true); state = result.state;
    const mapping = mapBuildingTemplate(state, 1, state.activePlanetId);
    expect(mapping.rows.every(row => row.warnings.join(" ").includes("按当前格子估算，地形改造实际完成后重新检查，不预支未来格数"))).toBe(true);
    expect(activePlanet(state).terraformerFields.grantedLevels).toBe(0);
    expect(state.orders.nextJobId).toBe(1);
  });

  it("refreshes read-only conditions when fusion fuel runs out without changing the fixed quote", () => {
    let state = ready(); const planet = activePlanet(state);
    planet.buildings.terraformer = 1; planet.buildings.fusion_reactor = 1;
    planet.productionPct.solar_plant = 0; planet.units.solar_satellite = 66;
    const result = createBuildingTemplate(state, { name: "燃料门槛", goals: [{ building: "terraformer", targetLevel: 2 }] }, 1);
    expect(result.ok).toBe(true); state = result.state;
    const target = { kind: "building" as const, planetId: state.activePlanetId, building: "terraformer" as const, targetLevel: 2 };
    const price = quoteLocalOrder(state, target).cost;
    expect(mapBuildingTemplate(state, 1, state.activePlanetId).rows[0]!.warnings.join(" ")).not.toContain("能源不足");
    activePlanet(state).resources.deuterium = big(0);
    expect(mapBuildingTemplate(state, 1, state.activePlanetId).rows[0]!.warnings.join(" ")).toContain("能源不足");
    expect(quoteLocalOrder(state, target).cost).toEqual(price);
    expect(view(state).buildings.find(row => row.id === "terraformer")!.canEnqueue).toBe(false);
    expect(state.orders.nextJobId).toBe(1); expect(activePlanet(state).buildQueue).toHaveLength(0);
  });

  it("templates retain unpowered intent and show the shared current payment blocker", () => {
    let state = ready(); activePlanet(state).buildings.terraformer = 1;
    const result = createBuildingTemplate(state, { name: "扩格工位", goals: [{ building: "terraformer", targetLevel: 2 }] }, 1);
    expect(result.ok).toBe(true); state = result.state;
    const before = serializeState(state);
    const mapping = mapBuildingTemplate(state, 1, state.activePlanetId);
    expect(mapping.ok).toBe(true); expect(mapping.rows[0]!.warnings.join(" ")).toContain("能源不足");
    expect(mapping.rows[0]!.warnings.join(" ")).not.toContain("第 4 阶段");
    expect(serializeState(state)).toEqual(before);
    expect(activePlanet(state).buildQueue).toHaveLength(0);
    expect(state.orders.nextJobId).toBe(1);
    expect(activePlanet(state).resources.deuterium.eq(big(1e12))).toBe(true);
  });
});
