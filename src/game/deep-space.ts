import { DEEP, chargeChances } from "../data/deep-space";
import { ARCADE, BOARD, BET_SYMBOLS, arcadeSymbolDef, type BetSymbol, type ArcadeSymbol } from "../data/arcade";
import { SHIP_IDS, unitById } from "../data/units";
import { INVENTORY_IDS, INVENTORY_LABEL } from "../data/dark-matter";
import { rollOutcome, prizeCap, productionMe, drifterShips, shipValueMe, type RunOutcome, type RunLight } from "./arcade";
import { grantDarkMatter, addInventory } from "./dark-matter";
import { fightEncounter } from "./encounter-combat";
import { createOffer, merchantCreationReason } from "./merchant";
import { selectPlanet } from "./empire";
import { coordinateKey, SPACE, type Coordinates } from "./galaxy";
import { big, type BigNumber } from "./decimal";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "./types";
import type { Fleet } from "./fleet";
import type { ChargeOrder, ChargeReport, ShipCounts } from "./deep-state";
import { storedRunLimit, retainChargeReports } from "./deep-state";

const zeroCargo=():ResourceAmounts=>({metal:big(0),crystal:big(0),deuterium:big(0)});
const count=(ships:ShipCounts)=>Object.values(ships).reduce((n,v)=>n+(v??0),0);
export function fleetValue(ships:ShipCounts):number {
  return SHIP_IDS.filter(id=>id!=="solar_satellite").reduce((sum,id)=>sum+(ships[id]??0)*shipValueMe(id),0);
}
export function empireFleetValue(state:GameState):number {
  return state.planets.reduce((s,p)=>s+fleetValue(p.units),0)+state.fleets.reduce((s,f)=>s+fleetValue(f.ships),0);
}
export function blackholeProtection(state:GameState,fleet:Fleet):string {
  const index=state.deepSpace.completed+1;
  if(index<=DEEP.beginnerProtection)return `前 ${DEEP.beginnerProtection} 次充能保护`;
  if(state.deepSpace.lastBlackhole>0 && index-state.deepSpace.lastBlackhole<=DEEP.blackholeCooldown)return `黑洞后 ${DEEP.blackholeCooldown} 次保护`;
  if(fleetValue(fleet.ships)>empireFleetValue(state)*DEEP.fleetShareProtection)return "充能舰队价值超过帝国可飞行舰队的 50%";
  return "";
}
/** Draw at the hold-completion boundary; store the full result before rendering it. */
export function rollCharge(state:GameState,fleet:Fleet):{state:GameState;outcome:RunOutcome;rawSymbol:ArcadeSymbol;protection:string} {
  const chances=chargeChances(fleet.charge!.slots);
  const weights=BOARD.map(s=>chances[s]/100/BOARD.filter(v=>v===s).length);
  const rolled=rollOutcome({...state.arcade,seed:state.deepSpace.seed,rollPity:{empty:state.deepSpace.emptyStreak,jackpot:state.deepSpace.jackpotStreak}},false,weights);
  const outcome=structuredClone(rolled.outcome),rawSymbol=BOARD[outcome.main.tile]!;
  const protection=rawSymbol==="blackhole"?blackholeProtection(state,fleet):"";
  if(protection)outcome.main.tile=BOARD.indexOf("turbulence");
  const symbol=BOARD[outcome.main.tile]!,completed=state.deepSpace.completed+1;
  return {outcome,rawSymbol,protection,state:{...state,deepSpace:{...state.deepSpace,
    seed:rolled.arcade.seed,completed,lastBlackhole:symbol==="blackhole"?completed:state.deepSpace.lastBlackhole,
    emptyStreak:symbol==="empty"||symbol==="turbulence"?state.deepSpace.emptyStreak+1:0,
    jackpotStreak:symbol==="jackpot"?0:state.deepSpace.jackpotStreak+1}}};
}
export function cargoCapacity(fleet:Fleet):BigNumber {
  const factor=fleet.charge?.cargoFactor??1;
  return SHIP_IDS.reduce((s,id)=>s.add(big(unitById(id).cargo).mul(fleet.ships[id]??0).mul(factor)),big(0));
}
function cargoTotal(c:ResourceAmounts):BigNumber{return RESOURCE_IDS.reduce((sum,id)=>sum.add(c[id]),big(0));}
function trimCargo(c:ResourceAmounts,capacity:BigNumber):ResourceAmounts {
  const total=cargoTotal(c);if(total.lte(capacity))return {...c};
  const factor=capacity.div(total);
  return {metal:c.metal.mul(factor).floor(),crystal:c.crystal.mul(factor).floor(),deuterium:c.deuterium.mul(factor).floor()};
}
export function addDebris(state:GameState,target:Coordinates,metal:BigNumber,crystal:BigNumber):GameState {
  if(metal.lte(0)&&crystal.lte(0))return state;
  const key=coordinateKey(target),existing=state.deepSpace.debris.find(d=>coordinateKey(d.target)===key);
  const debris=state.deepSpace.debris.filter(d=>coordinateKey(d.target)!==key);
  if(debris.length>=DEEP.debrisLimit)throw Error("残骸场超过宇宙安全上限");
  debris.push({target:{...target},metal:big(existing?.metal??0).add(metal).floor().toString(),crystal:big(existing?.crystal??0).add(crystal).floor().toString()});
  return {...state,deepSpace:{...state.deepSpace,debris}};
}
export function recycleDebris(state:GameState,fleet:Fleet):{state:GameState;fleet:Fleet;summary:string} {
  const key=coordinateKey(fleet.target),field=state.deepSpace.debris.find(d=>coordinateKey(d.target)===key);
  if(!field)return {state,fleet,summary:"目标已无残骸，空载返航"};
  const factor=1+.05*state.research.levels.hyperspace_tech;
  const capacity=SHIP_IDS.reduce((s,id)=>s.add(big(unitById(id).cargo).mul(fleet.ships[id]??0).mul(factor)),big(0));
  const collector=big(unitById("recycler").cargo).mul(fleet.ships.recycler??0).mul(factor);
  const room=capacity.sub(cargoTotal(fleet.cargo)).max(0).min(collector),m=big(field.metal),c=big(field.crystal),total=m.add(c);
  const take=room.min(total),metal=total.gt(0)?take.mul(m).div(total).floor():big(0),crystal=take.sub(metal).min(c).floor();
  const leftM=m.sub(metal),leftC=c.sub(crystal);
  const debris=state.deepSpace.debris.filter(d=>coordinateKey(d.target)!==key);
  if(leftM.gt(0)||leftC.gt(0))debris.push({...field,metal:leftM.toString(),crystal:leftC.toString()});
  return {state:{...state,deepSpace:{...state.deepSpace,debris}},fleet:{...fleet,cargo:{...fleet.cargo,metal:fleet.cargo.metal.add(metal),crystal:fleet.cargo.crystal.add(crystal)}},summary:`已回收金属 ${metal.toString()}、晶体 ${crystal.toString()}，返航后入库`};
}
function enemyFleet(fleet:Fleet,alien:boolean,u:number):ShipCounts {
  const budget=fleetValue(fleet.ships)*(alien?.65+.4*u:.25+.25*u);
  const cruisers=Math.min(SPACE.maxShips,Math.floor(budget*.35/shipValueMe("cruiser")));
  const fighters=Math.min(SPACE.maxShips,Math.max(1,Math.floor((budget-cruisers*shipValueMe("cruiser"))/shipValueMe("light_fighter"))));
  return {light_fighter:fighters,...(cruisers?{cruiser:cruisers}:{})};
}
/** Resolve a due charge exactly once. Cargo/loot remains with the returning fleet, never the selected UI world. */
export function finishCharge(state:GameState,input:Fleet):{state:GameState;fleet:Fleet|null} {
  const live=state.fleets.find(f=>f.id===input.id);
  if(!live?.charge||live.charge.phase!=="holding"||live.returning||live.remaining>1e-9||live.charge.reportId)return {state,fleet:live??null};
  const rolled=rollCharge(state,live);let next=rolled.state;
  const charge:ChargeOrder={...live.charge,phase:"return",items:{},dm:0,reportId:`charge-${live.id}`};
  let fleet:Fleet={...live,charge,ships:{...live.ships},cargo:{...live.cargo},returning:true,elapsed:0,remaining:live.duration};
  const outcome=rolled.outcome,symbol=BOARD[outcome.main.tile]!,main=outcome.main;
  const lines:string[]=[],lights:RunLight[]=[];
  if(rolled.protection)lines.push(`黑洞改判引力乱流：${rolled.protection}`);
  const cap = prizeCap(state), production = productionMe(state);
  const rangeValue = (range: readonly number[], u: number) => range[0]! + (range[1]! - range[0]!) * u;
  // Apply the tier to the ladder cap BEFORE the production-window ceiling, as in beacon rewards.
  const prize = (u: number, isBig: boolean) => Math.floor(Math.max(0, Math.min(
    cap * rangeValue(isBig ? ARCADE.tiers.big : ARCADE.tiers.normal, u),
    production * ARCADE.prizeWindowSeconds,
  )));
  let battle:ChargeReport["battle"]=null;
  const giveResource=(id:typeof RESOURCE_IDS[number],value:number)=>{
    const room=cargoCapacity(fleet).sub(cargoTotal(fleet.cargo)).max(0),desired=big(Math.floor(Math.max(0,value))),amount=desired.min(room).floor();
    fleet.cargo={...fleet.cargo,[id]:fleet.cargo[id].add(amount)};
    lines.push(`${id==="metal"?"金属":id==="crystal"?"晶体":"重氢"} +${amount.toString()} 装入返航货舱${amount.lt(desired)?"（超舱部分放弃）":""}`);
  };
  const giveShips=(value:number,u:number)=>{
    const result=drifterShips(selectPlanet(state, live.originId),value,u);
    for(const entry of result.ships){
      const existing=state.planets.reduce((s,p)=>s+p.units[entry.id],0)+state.fleets.reduce((s,f)=>s+(f.ships[entry.id]??0),0)+(fleet.ships[entry.id]??0)-(live.ships[entry.id]??0);
      const n=Math.min(entry.count,Math.max(0,SPACE.maxShips-existing));
      fleet.ships[entry.id]=(fleet.ships[entry.id]??0)+n;
      if(n)lines.push(`发现 ${unitById(entry.id).nameZh} ×${n}，随舰队返航`);
    }
    if(result.leftoverMe>=1)giveResource("metal",result.leftoverMe);
  };
  const reward=(tile:number,u:number,v:number,bigTier:boolean,extra:boolean)=>{
    const s=BOARD[tile]!;
    const good=["metal","crystal","deuterium","drifter","dark_matter","supply","tailwind"].includes(s);
    lights.push({tile,symbol:s,big:bigTier,paid:!extra||good});
    if(extra&&!good)return;
    if(s==="metal"||s==="crystal"||s==="deuterium")giveResource(s,prize(u,bigTier)/(s==="metal"?1:s==="crystal"?2:3));
    if(s==="drifter")giveShips(prize(u,bigTier)/2,v);
    if(s==="dark_matter") {const dm=Math.round(bigTier?500+200*u:300+100*u);charge.dm+=dm;lines.push(`暗物质 +${dm}，返航后领取`);}
    if(s==="supply") {const item=INVENTORY_IDS[Math.min(INVENTORY_IDS.length-1,Math.floor(v*INVENTORY_IDS.length))]!;charge.items[item]=(charge.items[item]??0)+(bigTier?2:1);lines.push(`${INVENTORY_LABEL[item].name} ×${bigTier?2:1}，返航后入背包`);}
    if(s==="tailwind") {fleet.remaining=live.duration*.5;lines.push("曲速顺流：返航时间减半");}
  };
  if(symbol==="blackhole"){
    fleet={...fleet,ships:{},cargo:zeroCargo()};lines.push("黑洞吞噬本支充能舰队及所载货物；不产生可回收残骸");
  } else if(symbol==="pirate"||symbol==="alien"){
    const levels=state.research.levels,tech={weapons:levels.weapons_tech,shields:levels.shielding_tech,armour:levels.armour_tech};
    const enemyTech={weapons:Math.floor(tech.weapons*(symbol==="alien"?1:.7)),shields:Math.floor(tech.shields*(symbol==="alien"?1:.7)),armour:Math.floor(tech.armour*(symbol==="alien"?1:.7))};
    battle=fightEncounter(live.ships,enemyFleet(live,symbol==="alien",main.u),tech,enemyTech,Math.floor(main.v*4294967296));
    fleet={...fleet,ships:{...battle.attackerAfter}};fleet.cargo=trimCargo(fleet.cargo,cargoCapacity(fleet));
    let m=big(0),c=big(0);
    for(const [before,after]of [[battle.attackerBefore,battle.attackerAfter],[battle.defenderBefore,battle.defenderAfter]])for(const id of SHIP_IDS){
      const lost=(before?.[id]??0)-(after?.[id]??0),cost=unitById(id).cost;
      m=m.add(big(cost.metal).mul(lost).mul(DEEP.debrisFraction));c=c.add(big(cost.crystal).mul(lost).mul(DEEP.debrisFraction));
    }
    next=addDebris(next,live.target,m,c);
    lines.push(`${symbol==="pirate"?"海盗":"异星"}遭遇战：${battle.rounds.length} 回合，${battle.winner==="attacker"?"胜利":battle.winner==="defender"?"战败":"平局"}；己方剩余 ${count(fleet.ships)} 艘`);
    lines.push(`战后残骸：金属 ${m.floor().toString()}、晶体 ${c.floor().toString()}，可派回收船`);
    if(battle.winner==="attacker")giveResource("metal",prize(main.u,true));
  } else if(symbol==="merchant"){
    if(!merchantCreationReason(next, live.originId)){
      const offer=createOffer(next,live.originId,Math.floor(main.v*4294967296),false);next=offer.state;charge.offerId=offer.id;
      lines.push("获得商人联络；返航到母港后报价生效 10 分钟");
    } else lines.push(`无法新增商人报价：${merchantCreationReason(next, live.originId)}；舰队正常返航`);
  } else if(symbol==="turbulence") {fleet.remaining=live.duration*1.5;lines.push("引力乱流：返航时间增加 50%，舰船未损失");}
  else if(symbol==="empty")lines.push("空域：未发现物资，按原计划返航");
  else if(symbol==="jackpot") {
    // Use the paid departure contract; editing current standing bets cannot redirect this jackpot.
    let kind: BetSymbol | null = null;
    for (const candidate of BET_SYMBOLS) if (charge.bets[candidate] > 0
      && (kind === null || charge.bets[candidate] > charge.bets[kind])) kind = candidate;
    if (kind === null) {
      const weights = ARCADE.jackpotKinds, pick = main.v * (weights.metal + weights.crystal + weights.deuterium);
      kind = pick < weights.metal ? "metal" : pick < weights.metal + weights.crystal ? "crystal" : "deuterium";
    }
    const value = Math.min(cap * rangeValue(ARCADE.tiers.jackpot, main.u), production * ARCADE.jackpotWindowSeconds);
    if (kind === "drifter") giveShips(value / 2, main.v);
    else giveResource(kind, value / (kind === "metal" ? 1 : kind === "crystal" ? 2 : 3));
    charge.dm += Math.round(rangeValue(ARCADE.darkMatter.jackpot, main.v));
    lines.push(`JACKPOT：${arcadeSymbolDef(kind).nameZh}大奖，暗物质 +${charge.dm}，返航后领取`);
  }
  else reward(main.tile,main.u,main.v,main.big,false);
  if(!lights.length)lights.push({tile:main.tile,symbol,big:main.big,paid:true});
  if(outcome.lucky){lines.push(`LUCKY：额外揭晓 ${outcome.lucky.lights.length} 盏灯`);for(const l of outcome.lucky.lights)reward(l.tile,l.u,l.v,l.big,true);}
  if(charge.stake>0){
    const chances=chargeChances(charge.slots);
    for(const light of lights){if(!light.paid||!BET_SYMBOLS.includes(light.symbol as typeof BET_SYMBOLS[number]))continue;
      const s=light.symbol as typeof BET_SYMBOLS[number],bets=charge.bets[s];if(!bets)continue;
      const value=bets*charge.betUnit*3*.9/(chances[s]/100);
      lines.push(`充能押中${arcadeSymbolDef(s).nameZh}，按出发时的注数与驻留赔率结算`);
      if(s==="drifter")giveShips(value,main.v);else giveResource(s,value/(s==="metal"?1:s==="crystal"?2:3));
    }
  }
  const destroyed=count(fleet.ships)===0;
  if(destroyed) {charge.dm=0;charge.items={};lines.push("舰队全损，没有返航奖励；已经生成的战报仍可查看");}
  else lines.push(`舰船和货物返回出发星球；切换界面不改变归属。剩余返航 ${Math.ceil(fleet.remaining)} 秒`);
  const report:ChargeReport={id:charge.reportId!,fleetId:live.id,originId:live.originId,at:state.totalTime.toNumber(),target:{...live.target},slots:charge.slots,rawSymbol:rolled.rawSymbol,symbol,protection:rolled.protection,outcome,lines:lines.slice(0,DEEP.maxReceiptLines),returned:false,destroyed,battle};
  if(next.arcade.runs.length>=storedRunLimit(next))throw Error("充能预留开奖槽失效，停止以防丢失结果");
  next={...next,deepSpace:{...next.deepSpace,reports:retainChargeReports([...next.deepSpace.reports,report], next.fleets)},arcade:{...next.arcade,runs:[...next.arcade.runs,{source:"charge",outcome,receipt:{reportId:report.id,originId:live.originId,lines:report.lines,lights}}]}};
  next={...next,fleets:destroyed?next.fleets.filter(f=>f.id!==live.id):next.fleets.map(f=>f.id===live.id?fleet:f)};
  return {state:next,fleet:destroyed?null:fleet};
}
export function finishChargeReturn(state:GameState,fleet:Fleet):GameState {
  if(!fleet.charge || !state.fleets.some(f=>f.id===fleet.id && f.returning && f.remaining<=1e-9))return state;
  // A cancelled charge releases its escrow at the origin, not as impossible over-capacity cargo.
  if(!fleet.charge.reportId)return {...state,fleets:state.fleets.filter(f=>f.id!==fleet.id),planets:state.planets.map(p=>p.id===fleet.originId?{...p,resources:{...p.resources,deuterium:p.resources.deuterium.add(fleet.charge!.stake)}}:p)};
  let next=grantDarkMatter(state,fleet.charge.dm);
  for(const id of INVENTORY_IDS)if(fleet.charge.items[id])next=addInventory(next,id,fleet.charge.items[id]!);
  const now=state.totalTime.toNumber();
  return {...next,fleets:next.fleets.filter(f=>f.id!==fleet.id),deepSpace:{...next.deepSpace,reports:next.deepSpace.reports.map(r=>r.id===fleet.charge!.reportId?{...r,returned:true}:r),offers:next.deepSpace.offers.map(o=>o.id===fleet.charge!.offerId?{...o,startsAt:now,expiresAt:now+DEEP.merchantSeconds}:o)}};
}
