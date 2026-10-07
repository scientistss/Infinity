import { DEEP } from "../data/deep-space";
import { readCharge } from "./deep-save";
import { SHIP_IDS, type ShipId } from "../data/units";
import { big, isValidAmount } from "./decimal";
import { MISSIONS, type Fleet, type FleetMessage, type Mission } from "./fleet";
import { coordinateKey, SPACE, validCoordinates, type Universe } from "./galaxy";
import type { GameState, ResourceAmounts } from "./types";

export function serializeFleets(fleets: Fleet[]) {
  return fleets.map(f=>({...f, ...(f.charge?{charge:structuredClone(f.charge)}:{}), target:{...f.target}, ships:{...f.ships}, cargo:{metal:f.cargo.metal.toString(),crystal:f.cargo.crystal.toString(),deuterium:f.cargo.deuterium.toString()}}));
}
function record(x:unknown): x is Record<string,unknown> { return !!x && typeof x === "object" && !Array.isArray(x); }
function integer(x:unknown,min:number,max:number): number {
  if(typeof x !== "number" || !Number.isSafeInteger(x) || x<min || x>max) throw Error("舰队或宇宙整数无效");
  return x;
}
function seconds(x:unknown,min=0):number {
  if(typeof x !== "number" || !Number.isFinite(x) || x<min || x>1e12) throw Error("舰队计时无效");
  return x;
}
function cargo(x:unknown): ResourceAmounts {
  if(!record(x)) throw Error("舰队货物缺失");
  const amount=(key:string)=>{
    const value=x[key];
    if(typeof value !== "string" || value.length>100 || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) throw Error("舰队货物数值无效");
    const result=big(value);if(!isValidAmount(result)) throw Error("舰队货物必须为非负有限大数");return result;
  };
  return {metal:amount("metal"),crystal:amount("crystal"),deuterium:amount("deuterium")};
}
export function readSpaceState(raw: Record<string,unknown>,state: GameState): Pick<GameState,"universe"|"fleets"|"messages"|"nextFleetId"> {
  if(!record(raw.universe) || raw.universe.layout !== "ring-v1") throw Error("缺少原版 P4 r2 宇宙数据，原存档未导入");
  const universe:Universe={seed:integer(raw.universe.seed,0,0xffffffff),layout:"ring-v1"};
  const coords=new Set(state.planets.map(p=>coordinateKey(p.coordinates)));
  if(coords.size !== state.planets.length) throw Error("星球坐标重复");
  if(!Array.isArray(raw.fleets) || raw.fleets.length>SPACE.maxFleets) throw Error("舰队列表无效");
  const fleetIds=new Set<number>();const reservations=new Set<string>();
  const fleets: Fleet[]=raw.fleets.map((f:unknown)=>{
    if(!record(f) || typeof f.originId !== "string" || !state.planets.some(p=>p.id===f.originId)) throw Error("舰队出发星球不存在");
    const id=integer(f.id,1,Number.MAX_SAFE_INTEGER-1);
    if(fleetIds.has(id)) throw Error("舰队编号重复");fleetIds.add(id);
    if(!validCoordinates(f.target,f.mission==="charge"||f.mission==="recycle") || !(MISSIONS as readonly unknown[]).includes(f.mission) || typeof f.returning !== "boolean") throw Error("舰队任务或目标无效");
    if(!record(f.ships)) throw Error("舰队舰船缺失");
    const ships:Partial<Record<ShipId,number>>={};
    for(const [key,value] of Object.entries(f.ships)){
      if(!(SHIP_IDS as readonly string[]).includes(key) || key==="solar_satellite") throw Error("不能派遣防御或太阳能卫星");
      ships[key as ShipId]=integer(value,0,SPACE.maxShips);
    }
    if(!Object.values(ships).some(n=>n>0)) throw Error("舰队不能为空");
    const duration=seconds(f.duration,SPACE.minFlightSeconds),remaining=seconds(f.remaining),elapsed=seconds(f.elapsed);
    const charge=f.mission==="charge"?readCharge(f.charge):undefined;
    if(f.mission!=="charge"&&f.charge!==undefined)throw Error("普通任务不能夹带充能状态");
    if(charge&&(f.target.position!==16 || (charge.phase==="return")!==f.returning))throw Error("充能任务阶段与目标无效");
    if(f.mission==="recycle"&&!ships.recycler)throw Error("回收舰队缺少回收船");
    const leg=charge?.phase==="holding"?charge.slots*DEEP.segmentSeconds:charge?.phase==="return"?1.5*duration:duration;
    if(remaining>leg+1e-8 || remaining+elapsed>leg+1e-6) throw Error("舰队计时超出当前航段");
    if(!f.returning){
      if(Math.abs(remaining+elapsed-(charge?.phase==="holding"?leg:duration))>1e-6) throw Error("出航计时不一致");
      if(f.mission==="colonize"){
        if(!ships.colony_ship)throw Error("殖民舰队缺少殖民船");
        const key=coordinateKey(f.target);if(reservations.has(key))throw Error("殖民目标重复预留");reservations.add(key);
      }
      if(f.mission==="scout" && !ships.espionage_probe)throw Error("侦察舰队缺少间谍卫星");
    }
    return {id,originId:f.originId,target:{...f.target},mission:f.mission as Mission,ships,cargo:cargo(f.cargo),duration,remaining,elapsed,returning:f.returning,...(charge?{charge}:{})};
  });
  const nextFleetId=integer(raw.nextFleetId,1,Number.MAX_SAFE_INTEGER-1);
  if(fleets.some(f=>f.id>=nextFleetId)) throw Error("下一舰队编号不能重复");
  for(const id of SHIP_IDS){
    const count=state.planets.reduce((n,p)=>n+p.units[id],0)+fleets.reduce((n,f)=>n+(f.ships[id]??0),0);
    if(!Number.isSafeInteger(count))throw Error("帝国舰船总量超出安全整数范围");
  }
  if(!Array.isArray(raw.messages) || raw.messages.length>SPACE.maxMessages) throw Error("舰队消息列表无效");
  const messageIds=new Set<string>();
  const messages:FleetMessage[]=raw.messages.map((m:unknown)=>{
    if(!record(m) || typeof m.id!=="string" || m.id.length>100 || messageIds.has(m.id) || typeof m.text!=="string" || m.text.length>1000)throw Error("舰队消息无效");
    messageIds.add(m.id);return {id:m.id,text:m.text,at:seconds(m.at)};
  });
  return {universe,fleets,messages,nextFleetId};
}
