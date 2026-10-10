import pkg from "../../package.json";
import { chargePreview, deepFlightDetails } from "./deep-present";
import { expeditionSlots } from "../game/deep-state";
import { SPACE, coordinateKey, distance, npcAt, planetProperties, positionBonus, type Coordinates } from "../game/galaxy";
import { quoteFlight, colonyCount, colonyLimit, fleetSlots, reservedColonies, MISSION_LABEL, type FleetRequest } from "../game/fleet";
import { activePlanet } from "../game/empire";
import { HOMEWORLD_ID } from "../game/planet";
import { formatAmount, formatDuration } from "../game/format";
import { big } from "../game/decimal";
import { SHIP_IDS, unitById } from "../data/units";
import type { GameState } from "../game/types";

/** Shared extension chrome stays fresh without projecting any hidden panel. */
export function spaceOrigin(state:GameState):string {
  const home=activePlanet(state);
  return `${home.name} [${coordinateKey(home.coordinates)}]`;
}

/** Pure galaxy-only projection: no fleet request, quote, or report formatting. */
export function spaceGalaxyView(state:GameState,cursor:Coordinates) {
  const home=activePlanet(state);
  return {
    rows:Array.from({length:16},(_,i)=>{
      const c={galaxy:cursor.galaxy,system:cursor.system,position:i+1};
      const own=state.planets.find(p=>coordinateKey(p.coordinates)===coordinateKey(c));
      const npc=npcAt(state,c);const deep=c.position===16;
      const reserved=state.fleets.some(f=>f.mission==="colonize"&&!f.returning&&coordinateKey(f.target)===coordinateKey(c));
      const props=own??(deep?null:planetProperties(state.universe.seed,c));
      const bonus=deep?"—":own?.id===HOMEWORLD_ID?"母星基准":`金属 ×${positionBonus(c.position,"metal")} · 晶体 ×${positionBonus(c.position,"crystal")}`;
      return {key:coordinateKey(c),position:c.position,name:deep?"深空 · 星环充能区":own?.name??npc?.name??"未占据行星",kind:deep?"可充能 / 回收":own?"己方":npc?"NPC 邻居":reserved?"殖民在途":"空位",properties:props?`${props.tempMax-40}～${props.tempMax} °C · ${props.fieldsMax} 格`:"驻留 1–3 段后结算事件",bonus,distance:distance(home.coordinates,c),planetId:own?.id??"",canColonize:!deep&&!own&&!npc&&!reserved,canScout:!deep&&!own,canTransport:!!own&&own.id!==home.id};
    }),
    seed:String(state.universe.seed),
    phase:`原版续作 · 深空扩展 v${pkg.version} · 宇宙 ${SPACE.galaxies}×${SPACE.systems}×${SPACE.positions}+深空`,
  };
}

/** Pure fleet-only projection. This is the only projection needing a draft request. */
export function spaceFleetView(state:GameState,request:FleetRequest) {
  const home=activePlanet(state);
  const quote=quoteFlight(state,request);
  const flightDetails=new Map(deepFlightDetails(state).map(f=>[f.id,f.text]));
  return {
    isCharge:request.mission==="charge",
    chargePreview:chargePreview(state,request),
    slots:`舰队 ${state.fleets.length}/${fleetSlots(state)} · 殖民地 ${colonyCount(state)}/${colonyLimit(state)} · 在途预留 ${reservedColonies(state)} · 远征 ${state.fleets.filter(f=>f.mission==="charge").length}/${expeditionSlots(state)}`,
    quote:{ok:quote.ok,text:quote.ok?`单程 ${formatDuration(Math.ceil(quote.duration))} · 往返燃料 ${formatAmount(quote.fuel)} 重氢 · 总货舱 ${formatAmount(quote.capacity)}${request.mission==="charge"?` · 驻留 ${quote.holdSeconds} 秒 · 押注 ${formatAmount(big(quote.stake??0))} 重氢`:""}`:quote.reason},
    ships:SHIP_IDS.filter(id=>id!=="solar_satellite").map(id=>({id,name:unitById(id).nameZh,count:home.units[id]})),
    fleets:state.fleets.map(f=>({id:f.id,detail:flightDetails.get(f.id)??"",title:`#${f.id} ${MISSION_LABEL[f.mission]} · ${f.returning?"返航":f.charge?.phase==="holding"?"驻留充能":"出航"}`,route:`${state.planets.find(p=>p.id===f.originId)?.name??f.originId} → [${coordinateKey(f.target)}]`,remaining:`${formatDuration(Math.ceil(f.remaining))} 后${f.returning?"入港":f.charge?.phase==="holding"?"生成结果":"抵达"}`,progress:Math.max(0,Math.min(100,100*f.elapsed/Math.max(1e-9,f.elapsed+f.remaining))),canRecall:!f.returning})),
    planets:state.planets.map(p=>({id:p.id,name:p.name,coordinate:coordinateKey(p.coordinates),stock:`金属 ${formatAmount(p.resources.metal)} · 晶体 ${formatAmount(p.resources.crystal)} · 重氢 ${formatAmount(p.resources.deuterium)}`,selected:p.id===home.id,canAbandon:p.id!==HOMEWORLD_ID})),
  };
}

export function spaceMessagesView(state:GameState) {
  return {messages:state.messages.slice().reverse().map(m=>({id:m.id,text:m.text,time:`游戏 ${formatDuration(Math.floor(m.at))}`}))};
}

/** Full reference/default API; visible projections share exactly the same builders. */
export function spaceView(state:GameState,cursor:Coordinates,request:FleetRequest) {
  const galaxy=spaceGalaxyView(state,cursor),fleet=spaceFleetView(state,request),messages=spaceMessagesView(state);
  return {
    isCharge:fleet.isCharge,
    chargePreview:fleet.chargePreview,
    origin:spaceOrigin(state),
    slots:fleet.slots,
    quote:fleet.quote,
    rows:galaxy.rows,
    ships:fleet.ships,
    fleets:fleet.fleets,
    planets:fleet.planets,
    messages:messages.messages,
    seed:galaxy.seed,
    phase:galaxy.phase,
    // Explicit structured text: no unit count is fabricated from a decorative picture.
    zero:formatAmount(big(0)),
  };
}
export type SpaceView = ReturnType<typeof spaceView>;
export type SpaceGalaxyView = ReturnType<typeof spaceGalaxyView>;
export type SpaceFleetView = ReturnType<typeof spaceFleetView>;
export type SpaceMessagesView = ReturnType<typeof spaceMessagesView>;
