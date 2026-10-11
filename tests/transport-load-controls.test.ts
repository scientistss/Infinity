import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, type FleetRequest, type Mission } from "../src/game/fleet";
import { createInitialState, createPlanet } from "../src/game/state";
import { installTransportLoadControls } from "../src/ui/space-panel";
import * as loads from "../src/ui/transport-load-model";

/** Small controller double, not browser/layout evidence. Native DOM is tested separately. */
class TestElement {
  parentElement:TestElement|null=null;
  children:TestElement[]=[];
  dataset:Record<string,string>={};
  listeners=new Map<string,Array<(event:{target:TestElement})=>void>>();
  hidden=false;disabled=false;title="";textContent="";value="";connectedRoot=false;
  constructor(public id=""){}
  get parentNode():TestElement|null{return this.parentElement;}
  get isConnected():boolean{return this.connectedRoot||!!this.parentElement?.isConnected;}
  contains(node:TestElement):boolean{return node===this||this.children.some(child=>child.contains(node));}
  append(child:TestElement){child.parentElement?.remove(child);child.parentElement=this;this.children.push(child);}
  remove(child:TestElement){
    this.children=this.children.filter(item=>item!==child);child.parentElement=null;
    for(const observer of TestObserver.instances)if(observer.parents.has(this))observer.records.push({removedNodes:[child]} as unknown as MutationRecord);
  }
  matches(selector:string):boolean{
    if(selector.startsWith("#"))return this.id===selector.slice(1);
    if(selector==='[data-ship]')return !!this.dataset.ship;
    return /^\[data-ship="(.+)"\]$/.exec(selector)?.[1]===this.dataset.ship;
  }
  querySelectorAll(selector:string):TestElement[]{
    const result:TestElement[]=[];
    const visit=(node:TestElement)=>{for(const child of node.children){if(selector.split(",").some(part=>child.matches(part)))result.push(child);visit(child);}};
    visit(this);return result;
  }
  querySelector(selector:string):TestElement|null{return this.querySelectorAll(selector)[0]??null;}
  addEventListener(type:string,callback:(event:{target:TestElement})=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),callback]);}
  emit(type:string,target:TestElement=this){for(const listener of this.listeners.get(type)??[])listener({target});}
}
class TestSelect extends TestElement {}
class TestObserver {
  static instances:TestObserver[]=[];
  parents=new Set<TestElement>();records:MutationRecord[]=[];
  constructor(_callback:MutationCallback){TestObserver.instances.push(this);}
  observe(parent:TestElement,options:MutationObserverInit){expect(options).toEqual({childList:true});this.parents.add(parent);}
  disconnect(){this.parents.clear();}
  takeRecords(){const records=this.records;this.records=[];return records;}
}

function fixture(){
  // Attachment root doubles Document; document.hidden remains a separate stub.
  const doc=new TestElement();doc.connectedRoot=true;
  const html=new TestElement();doc.append(html);
  const body=new TestElement();html.append(body);
  const root=new TestElement("app");body.append(root);
  const panel=new TestElement("space-fleet");root.append(panel);
  const helper=new TestElement("transport-load-helper");panel.append(helper);
  const make=(id:string,value="",select=false,parent=panel)=>{const node=select?new TestSelect(id):new TestElement(id);node.value=value;parent.append(node);return node;};
  const mission=make("flight-mission","transport",true),speed=make("flight-speed","100",true);
  const g=make("flight-galaxy","1"),s=make("flight-system","56"),p=make("flight-position","10");
  const ship=make("","2");ship.dataset.ship="small_cargo";
  const metal=make("cargo-metal","0"),crystal=make("cargo-crystal","0"),deuterium=make("cargo-deuterium","0");
  const summary=make("transport-load-summary","",false,helper),reason=make("transport-load-reason","",false,helper);
  const metalFill=make("transport-fill-metal","",false,helper),crystalFill=make("transport-fill-crystal","",false,helper),deuteriumFill=make("transport-fill-deuterium","",false,helper);
  const state=createInitialState(42,4242),home=activePlanet(state);
  home.coordinates={galaxy:1,system:56,position:11};
  home.resources={metal:big(100000),crystal:big(100000),deuterium:big(100000)};
  home.units.small_cargo=2;state.research.levels.combustion_drive=2;
  state.planets.push(createPlanet("load-controls-colony",{galaxy:1,system:56,position:10}));
  const read=():FleetRequest=>({mission:mission.value as Mission,target:{galaxy:Number(g.value),system:Number(s.value),position:Number(p.value)},ships:{small_cargo:Number(ship.value)},
    cargo:{...emptyCargo(),metal:big(metal.value),crystal:big(crystal.value),deuterium:big(deuterium.value)},speedPercent:Number(speed.value)});
  const controls=installTransportLoadControls(root as unknown as HTMLElement,read);
  const edit=(node:TestElement,value:string,type="input")=>{node.value=value;root.emit(type,node);};
  const start=()=>{controls.observe(state,true,"");controls.update();};
  return {doc,html,body,root,panel,helper,mission,speed,g,s,p,ship,metal,crystal,deuterium,summary,reason,metalFill,crystalFill,deuteriumFill,state,home,controls,edit,start};
}

beforeEach(()=>{
  TestObserver.instances=[];
  vi.stubGlobal("Element",TestElement);vi.stubGlobal("HTMLSelectElement",TestSelect);
  vi.stubGlobal("MutationObserver",TestObserver);vi.stubGlobal("document",{hidden:false});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("transport draft controls",()=>{
  it("fills only the selected current draft field and preserves other raw text and nodes",()=>{
    const f=fixture();f.start();f.edit(f.crystal,"0042.500");f.edit(f.deuterium,"0003.250");
    const snapshot=JSON.stringify(f.state),nodes=[f.metal,f.crystal,f.deuterium];
    f.metalFill.emit("click");
    expect(big(f.metal.value).eq(big(9992).sub(42.5).sub(3.25))).toBe(true);
    expect(f.crystal.value).toBe("0042.500");expect(f.deuterium.value).toBe("0003.250");
    for(let i=0;i<4;i++)f.controls.update();
    expect([f.root.querySelector("#cargo-metal"),f.root.querySelector("#cargo-crystal"),f.root.querySelector("#cargo-deuterium")]).toEqual(nodes);
    expect(JSON.stringify(f.state)).toBe(snapshot);
  });

  it("fills from current state even when the painted maximum has not updated",()=>{
    const f=fixture();f.start();expect(f.metalFill.disabled).toBe(false);
    f.home.resources.metal=big("17.25");
    const preview=vi.spyOn(loads,"transportLoadPreview");
    f.controls.observe(f.state,true,"");expect(preview).not.toHaveBeenCalled();
    f.metalFill.emit("click");expect(f.metal.value).toBe("17.25");
  });

  it("keeps all inputs and explains failure when the current route is invalid",()=>{
    const f=fixture();f.start();f.metal.value="0020";f.p.value="16";
    f.metalFill.emit("click");
    expect(f.metal.value).toBe("0020");expect(f.p.value).toBe("16");
    expect(f.reason.textContent).toContain("目标坐标无效");
  });

  it("disables immediately on protection without painting and requires a real edit after recovery",()=>{
    const f=fixture();f.start();f.edit(f.metal,"20");
    f.controls.observe(f.state,false,"另一标签页更新了存档");
    expect(f.metalFill.disabled).toBe(true);expect(f.reason.textContent).toContain("另一标签页更新了存档");
    f.metalFill.disabled=false;f.metalFill.emit("click");expect(f.metal.value).toBe("20");
    f.controls.observe(f.state,true,"");f.controls.update();
    expect(f.metalFill.disabled).toBe(true);expect(f.reason.textContent).toContain("请修改运输草稿");
    f.root.emit("change",f.metal);f.root.emit("input",f.metal);
    expect(f.metalFill.disabled).toBe(true);
    f.edit(f.metal,"21");expect(f.metalFill.disabled).toBe(false);
    f.metalFill.emit("click");expect(f.metal.value).toBe("9992");
  });

  it("does not turn edits made while protected into recovery authority",()=>{
    const f=fixture();f.start();f.controls.observe(f.state,false,"写入保护");
    f.edit(f.metal,"77");f.controls.observe(f.state,true,"");
    f.root.emit("input",f.metal);f.root.emit("change",f.mission);
    expect(f.metalFill.disabled).toBe(true);expect(f.metal.value).toBe("77");
  });

  it("retires import and world authority without clearing cargo or changing the target",()=>{
    const f=fixture();f.start();f.edit(f.metal,"73.50");
    f.controls.invalidate();f.controls.observe(f.state,true,"");f.controls.update();
    expect(f.metalFill.disabled).toBe(true);expect(f.metal.value).toBe("73.50");expect(f.p.value).toBe("10");
    f.root.emit("change",f.speed);expect(f.metalFill.disabled).toBe(true);
    f.edit(f.speed,"90","change");expect(f.metalFill.disabled).toBe(false);
    f.state.stats.launches++;f.controls.observe(f.state,true,"");
    expect(f.metalFill.disabled).toBe(true);expect(f.reason.textContent).toContain("世界已替换");
  });

  it.each(["same-node","same-id","ancestor","body","html"])("rejects retained buttons after %s removal, even before the mutation callback",mode=>{
    const f=fixture();f.start();f.metal.value="19";
    if(mode==="body"){f.html.remove(f.body);f.html.append(f.body);}
    else if(mode==="html"){f.doc.remove(f.html);f.doc.append(f.html);}
    else if(mode==="ancestor"){f.root.remove(f.panel);f.root.append(f.panel);}
    else {f.helper.remove(f.metalFill);f.helper.append(mode==="same-node"?f.metalFill:new TestElement("transport-fill-metal"));}
    f.metalFill.disabled=false;f.metalFill.emit("click");
    expect(f.metal.value).toBe("19");expect(f.metalFill.disabled).toBe(true);
    f.edit(f.metal,"20");f.controls.update();expect(f.metalFill.disabled).toBe(true);
  });

  it("observes direct-child removals through the document boundary without a subtree observer",()=>{
    const f=fixture();
    expect(TestObserver.instances).toHaveLength(1);
    expect(TestObserver.instances[0]!.parents.has(f.body)).toBe(true);
    expect(TestObserver.instances[0]!.parents.has(f.html)).toBe(true);
    expect(TestObserver.instances[0]!.parents.has(f.doc)).toBe(true);
  });

  it("blocks detached roots and hides the helper for every other mission",()=>{
    const f=fixture();f.start();
    for(const mission of ["colonize","deploy","scout","charge","recycle"]){
      f.edit(f.mission,mission,"change");expect(f.helper.hidden).toBe(true);
      f.metalFill.disabled=false;f.metalFill.emit("click");expect(f.metal.value).toBe("0");
    }
    f.edit(f.mission,"transport","change");f.body.remove(f.root);f.metalFill.emit("click");expect(f.metal.value).toBe("0");
  });

  it("does not build a transport preview for hidden panels or cheap state observation",()=>{
    const f=fixture();f.start();const preview=vi.spyOn(loads,"transportLoadPreview");
    f.panel.hidden=true;
    for(let i=0;i<10;i++){f.controls.observe(f.state,true,"");f.controls.update();}
    expect(preview).not.toHaveBeenCalled();
    f.panel.hidden=false;(document as unknown as {hidden:boolean}).hidden=true;f.controls.update();
    expect(preview).not.toHaveBeenCalled();
    f.metal.value="19";f.metalFill.disabled=false;f.metalFill.emit("click");
    expect(f.metal.value).toBe("19");expect(preview).not.toHaveBeenCalled();
  });
});
