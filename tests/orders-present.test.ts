import { describe, expect, it } from "vitest";
import { ordersView, orderChoices } from "../src/ui/orders-present";
import { present } from "../src/ui/present";
import { createInitialState, createPlanet } from "../src/game/state";
import { big } from "../src/game/decimal";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { orderUnits } from "../src/game/shipyard";
import { selectPlanet } from "../src/game/empire";
import type { OrderTask } from "../src/game/order-state";
import { rich, stateWith } from "./helpers";
const input = {status:"",banner:null,notice:null,catchup:null};
const money = {metal:"0",crystal:"0",deuterium:"0"};

function task(overrides: Partial<OrderTask> = {}): OrderTask {
  return {kind:"shipyard",planetId:"home",unit:"light_fighter",quantity:7,id:1,status:"running",reason:"等待资源",budget:{metal:"100",crystal:"200",deuterium:"0"},charged:{metal:"90.5",crystal:"40",deuterium:"0"},refunded:{metal:"10.25",crystal:"0",deuterium:"0"},activeJob:{jobId:9,quantity:4,credited:2},completedUnits:3,...overrides} as OrderTask;
}

describe("finite plan presentation", () => {
  it("shows additional ship progress, fixed payer and exact net spending without mutation", () => {
    const state = createInitialState();
    state.orders.tasks = [task({planetId:state.activePlanetId})];
    const before = JSON.stringify(state);
    const row = ordersView(state).rows[0]!;
    expect(row.progress).toBe("本计划已完成 3 / 额外 7 个");
    expect(row.spending).toContain("金属 80.25 / 100");
    expect(row.activeJob).toContain("#9 · 本批完成 2 / 4");
    expect(row.reason).toBe("等待资源");
    expect(row.location).toContain(state.planets[0]!.name);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("reads target levels from their real scope and exposes no authority from active navigation", () => {
    const state = createInitialState();
    const colony = createPlanet("other",{...state.planets[0]!.coordinates,position:9});
    colony.buildings.metal_mine = 4; state.planets.push(colony);
    state.research.levels.energy_tech = 3;
    state.orders.tasks = [
      {...task(),kind:"building",planetId:"other",building:"metal_mine",targetLevel:6,charged:money,refunded:money},
      {...task(),id:2,kind:"research",planetId:"other",tech:"energy_tech",targetLevel:5,charged:money,refunded:money},
    ];
    expect(ordersView(state).rows.map(row => row.progress)).toEqual(["当前 4 / 目标 6 级","当前 3 / 目标 5 级"]);
    expect(ordersView(selectPlanet(state,"other")).rows).toEqual(ordersView(state).rows);
    expect(ordersView(state).nextTaskId).toBe(state.orders.nextTaskId);
  });
  it("keeps terminal missing-planet records readable and clamps progress", () => {
    const state = createInitialState();
    state.orders.tasks = [task({status:"cancelled",planetId:"removed-world",activeJob:null}),task({id:2,status:"completed",completedUnits:9})];
    const rows = ordersView(state).rows;
    expect(rows[0]!.location).toContain("removed-world");
    expect(rows[0]!.activeJob).toBe("暂无已付款工作");
    expect(rows[1]!.progressPct).toBe(100);
  });
  it("lists original build, research, ship and defense targets", () => {
    expect(orderChoices("building").some(x=>x.id==="metal_mine")).toBe(true);
    expect(orderChoices("research").some(x=>x.id==="energy_tech")).toBe(true);
    expect(orderChoices("shipyard").some(x=>x.id==="light_fighter")).toBe(true);
    expect(orderChoices("shipyard").some(x=>x.id==="rocket_launcher")).toBe(true);
  });
  it("uses planet plus job ID for all queue identity signatures", () => {
    let state = rich(stateWith({research_lab:2,shipyard:2,robotics_factory:2}));
    state.research.levels.combustion_drive = 1;
    state = enqueue(state,"metal_mine","manual").state;
    state = enqueueResearch(state,"energy_tech","manual").state;
    state = orderUnits(state,"light_fighter",3,"manual").state;
    const shown = present(state,input);
    for (const queue of [shown.queue,shown.research.queue,shown.shipyard.queue]) {
      expect(queue.items).toHaveLength(1);
      const item = queue.items[0]!;
      expect(item.key).toBe(`${item.planetId}:${item.jobId}`);
      expect(queue.signature).toBe(item.key);
    }
    const id = state.planets[0]!.shipyardQueue[0]!.jobId;
    state.planets[0]!.shipyardQueue[0]!.count -= 1;
    state.planets[0]!.resources.metal = big(2_000_000);
    expect(present(state,input).shipyard.queue.items[0]!.key).toBe(`${state.activePlanetId}:${id}`);
    expect(present(state,input).shipyard.queue.signature).toBe(shown.shipyard.queue.signature);
  });
});
