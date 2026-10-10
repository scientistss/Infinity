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
  return {kind:"shipyard",planetId:"home",unit:"light_fighter",quantity:7,id:1,status:"running",reason:"等待资源",budget:{metal:"100",crystal:"200",deuterium:"0"},charged:{metal:"90.5",crystal:"40",deuterium:"0"},refunded:{metal:"10.25",crystal:"0",deuterium:"0"},activeJob:{jobId:9,quantity:4,credited:2},completedUnits:3,transport:null,currentWork:null,formationOrigin:null,...overrides} as OrderTask;
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
  it("shows the immutable creation-time formation name and revision", () => {
    const state = createInitialState();
    state.formations.entries = [{id:1,revision:2,name:"未来编成",ships:{light_fighter:20}}];
    state.formations.nextFormationId = 2;
    state.orders.tasks = [task({formationOrigin:{formation:{id:1,revision:1,name:"<舰&🚀>",ships:{light_fighter:10}},quotedUnitCost:{metal:"3000",crystal:"1000",deuterium:"0"}}})];
    const before = JSON.stringify(state);
    expect(ordersView(state).rows[0]!.title).toContain("编成 #1 <舰&🚀> / r1（创建时版本）");
    expect(ordersView(state).rows[0]!.title).not.toContain("未来编成");
    expect(JSON.stringify(state)).toBe(before);
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

describe("single-source transport presentation", () => {
  function transportState() {
    const state = createInitialState();
    const donor = createPlanet("donor",{...state.planets[0]!.coordinates,galaxy:3});
    donor.name="固定供货港";donor.units.small_cargo=4;state.planets.push(donor);
    const cargo = {metal:"20.000000000000000001",crystal:"5",deuterium:"2"};
    const target = state.planets[0]!;
    state.orders.tasks=[task({planetId:target.id,activeJob:null,charged:{metal:"0",crystal:"0",deuterium:"4"},refunded:money,
      currentWork:{workId:3,spec:{kind:"shipyard",unit:"light_fighter",quantity:4,completedUnitsAtStart:3,paidPerUnit:{metal:"3000",crystal:"1000",deuterium:"0"}},shipmentFleetId:7,stage:"pending",reserved:{metal:"12000",crystal:"4000",deuterium:"0"}},
      transport:{authorization:{donorPlanetId:donor.id,ship:"small_cargo",count:2,speedPercent:80,maxTrips:2,grossCargoCap:{metal:"100",crystal:"50",deuterium:"10"}},
        trips:[{fleetId:7,workId:3,targetPlanetId:target.id,target:{...target.coordinates},cargo,fuel:"4",duration:20,phase:{kind:"outbound"}}]}})];
    state.fleets=[{id:7,originId:donor.id,target:{...target.coordinates},mission:"transport",ships:{small_cargo:2},cargo:{metal:big(cargo.metal),crystal:big(5),deuterium:big(2)},duration:20,remaining:15,elapsed:5,returning:false,orderTransport:{taskId:1,workId:3}}];
    return state;
  }
  it("shows pending reservation separately from spent fuel and exact gross caps", () => {
    const state=transportState(), before=JSON.stringify(state);
    const row=ordersView(state).rows[0]!;
    expect(row.work).toContain("固定子任务 #3");
    expect(row.work).toContain("未付款，预算预留：金属 12000");
    expect(row.work).toContain("唯一运输 #7");
    expect(row.transport).toContain("固定供货港");
    expect(row.transport).toContain("舰队 #7 · 工作 #3 · 出航，尚未交付");
    expect(row.limits).toContain("运输次数 1 / 2");
    expect(row.limits).toContain("金属 20.000000000000000001 / 100");
    expect(row.limits).toContain("不可退往返燃料 4 重氢");
    expect(row.canDismiss).toBe(false);expect(row.retryFleetId).toBe(null);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("does not call delivered returning cargo a returned fleet", () => {
    const state=transportState(), current=state.orders.tasks[0]!;
    current.transport!.trips[0]!.phase={kind:"returning",outcome:{kind:"delivered"},dockBlocked:false};
    current.currentWork=null;current.status="completed";
    state.fleets[0]!.returning=true;
    const row=ordersView(state).rows[0]!;
    expect(row.transport).toContain("已实际卸货；真实返航中");
    expect(row.transport).not.toContain("已实际返港");expect(row.canDismiss).toBe(false);
    current.transport!.trips[0]!.phase={kind:"returned",outcome:{kind:"delivered"}};state.fleets=[];
    expect(ordersView(state).rows[0]!.transport).toContain("已实际返港");
    expect(ordersView(state).rows[0]!.canDismiss).toBe(true);
  });
  it("exposes retry only for the exact owned live fleet, including terminal plans", () => {
    const state=transportState(), current=state.orders.tasks[0]!;
    current.currentWork=null;current.status="cancelled";
    current.transport!.trips[0]!.phase={kind:"returning",outcome:{kind:"not-delivered",reason:"plan-cancel"},dockBlocked:true};
    state.fleets[0]!.returning=true;state.fleets[0]!.remaining=0;
    const row=ordersView(state).rows[0]!;
    expect(row.transport).toContain("未交付（计划取消）；返港入库受阻");
    expect(row.canDismiss).toBe(false);expect(row.retryFleetId).toBe(7);
    state.fleets[0]!.orderTransport={taskId:2,workId:3};
    expect(ordersView(state).rows[0]!.retryFleetId).toBe(null);
  });
  it("reports prestige retirement without inventing delivery or docking", () => {
    const state=transportState(), current=state.orders.tasks[0]!;
    current.transport!.trips[0]!.phase={kind:"prestige-retired",outcome:null};
    current.currentWork=null;current.status="cancelled";state.fleets=[];
    const row=ordersView(state).rows[0]!;
    expect(row.transport).toContain("旧世界已退役；无交付结论");
    expect(row.canDismiss).toBe(true);
  });
  it("offers only flying ships, and supplies each donor's own counts", () => {
    const state=transportState();
    const donor=ordersView(state).donorShips.find(p=>p.planetId==="donor")!;
    expect(donor.ships.find(s=>s.id==="small_cargo")!.count).toBe(4);
    expect(donor.ships.some(s=>String(s.id)==="solar_satellite")).toBe(false);
    expect(donor.ships.some(s=>String(s.id)==="rocket_launcher")).toBe(false);
  });
});
