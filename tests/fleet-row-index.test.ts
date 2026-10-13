import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game/state";
import { createFleetRowLookup } from "../src/ui/space-panel";
import type { SpaceFleetView } from "../src/ui/space-present";
import panelSource from "../src/ui/space-panel.ts?raw";

type Flight = Readonly<Pick<SpaceFleetView["fleets"][number], "id" | "title" | "route" | "remaining" | "detail" | "progress">>;
type Write = { node: string; kind: "text" | "width"; value: string };
type Query = { node: string; kind: "one" | "all"; selector: string };
type Realm = { writes: Write[]; queries: Query[]; active: NodeDouble | null; nodes: NodeDouble[]; actions: string[] };

/** Focused behavioral double: preorder descendant queries and destructive
 * textContent writes. Native selectors, browser focus and timing need browser QA.
 * Like the production loop, these scenarios only delete descendants during a
 * paint; they do not claim equivalence for reentrant custom-element insertion. */
class NodeDouble {
  parent: NodeDouble | null = null;
  children: NodeDouble[] = [];
  attrs: Record<string, string> = {};
  ownText = "";
  connectedRoot = false;
  hidden = false;
  value = "";
  checked = false;
  disabled = false;
  open = false;
  selectionStart = 0;
  selectionEnd = 0;
  listeners: (() => void)[] = [];
  private width = "";
  readonly style: { width: string };

  constructor(readonly realm: Realm, readonly label: string, readonly tag = "div") {
    realm.nodes.push(this);
    const node = this;
    this.style = {
      get width() { return node.width; },
      set width(value: string) { node.width = value; realm.writes.push({ node: label, kind: "width", value }); },
    };
  }
  get isConnected(): boolean { return this.connectedRoot || !!this.parent?.isConnected; }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) {
    this.realm.writes.push({ node: this.label, kind: "text", value });
    this.ownText = value;
    for (const child of [...this.children]) child.remove();
  }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  contains(node: NodeDouble): boolean { return this === node || this.children.some(child => child.contains(node)); }
  append(...nodes: NodeDouble[]) {
    for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); }
  }
  remove() {
    if (!this.parent) return;
    if (this.realm.active && this.contains(this.realm.active)) this.realm.active = null;
    this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
  replaceChildren(...nodes: NodeDouble[]) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  focus() { if (this.isConnected) this.realm.active = this; }
  private matches(selector: string): boolean {
    if (selector === "[data-flight]") return Object.hasOwn(this.attrs, "data-flight");
    const match = /^\[data-flight="([^"]*)"\]$/.exec(selector);
    if (match) return this.getAttribute("data-flight") === match[1];
    if (selector.startsWith(".")) return (this.attrs.class ?? "").split(/\s+/).includes(selector.slice(1));
    throw Error(`Unsupported test selector ${selector}`);
  }
  private *descendants(): Generator<NodeDouble> { for (const child of this.children) { yield child; yield* child.descendants(); } }
  querySelector(selector: string): NodeDouble | null {
    this.realm.queries.push({ node: this.label, kind: "one", selector });
    for (const node of this.descendants()) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector: string): NodeDouble[] {
    this.realm.queries.push({ node: this.label, kind: "all", selector });
    return [...this.descendants()].filter(node => node.matches(selector));
  }
}

const element = (node: NodeDouble) => node as unknown as HTMLElement;
const flight = (id: number, suffix = ""): Flight => Object.freeze({ id, title: `舰队 ${id}${suffix}`, route: `来源 → [1:50:${id}]${suffix}`, remaining: `${id} 秒${suffix}`, detail: `货物 ${id}${suffix}`, progress: id % 101 });
function required(root: NodeDouble, selector: string): NodeDouble {
  const node = root.querySelector(selector);
  if (!node) throw Error(`缺少界面节点 ${selector}`);
  return node;
}
function put(root: NodeDouble, selector: string, value: string) {
  const node = required(root, selector);
  if (node.textContent !== value) node.textContent = value;
}

// Execute the production row-write loop itself. The baseline changes only its
// lookup expression back to the original el(list, selector), avoiding a second
// implementation of the write order or a full unrelated mount test framework.
const rowLoop = panelSource.split("\n").find(line => line.includes("for(const f of model.fleets){const row=fleetRow(f.id);"));
if (!rowLoop) throw Error("Production fleet row loop not found");
const originalLoop = rowLoop.replace("fleetRow(f.id)", 'el(list,`[data-flight="${f.id}"]`)');
type Render = (list: NodeDouble, model: { fleets: readonly Flight[] }, lookup: typeof createFleetRowLookup, el: typeof required, write: typeof put) => void;
const indexedRender = new Function("list", "model", "createFleetRowLookup", "el", "put", `const fleetRow=createFleetRowLookup(list);\n${rowLoop}`) as Render;
const originalRender = new Function("list", "model", "createFleetRowLookup", "el", "put", originalLoop) as Render;

function fixture() {
  const realm: Realm = { writes: [], queries: [], active: null, nodes: [], actions: [] };
  const make = (label: string, tag = "div", parent?: NodeDouble) => {
    const node = new NodeDouble(realm, label, tag); parent?.append(node); return node;
  };
  const doc = make("document"); doc.connectedRoot = true;
  const root = make("root", "main", doc), panel = make("panel", "section", root), list = make("list", "div", panel);
  list.attrs.id = "space-fleets"; list.attrs["data-fleet-signature"] = "unchanged-signature";
  const draft = make("draft", "input", root); draft.value = "123.50"; draft.selectionStart = 1; draft.selectionEnd = 4;
  const messages = make("messages", "section", root); messages.ownText = "保留消息"; messages.hidden = true;
  function row(id: string, label = `row-${id}`, parent = list, tag = "div") {
    const node = make(label, tag, parent); node.attrs["data-flight"] = id; node.attrs.class = "space-flight ov-card";
    for (const name of ["title", "route", "time", "detail", "progress"]) make(`${label}-${name}`, "span", node).attrs.class = `flight-${name}`;
    const button = make(`${label}-recall`, "button", node); button.attrs["data-space"] = "recall"; button.attrs["data-fleet"] = id; button.ownText = "召回";
    button.listeners.push(() => realm.actions.push(label));
    const details = make(`${label}-details`, "details", node); details.open = true;
    const input = make(`${label}-input`, "input", details); input.value = `draft-${id}`; input.checked = true; input.selectionStart = 2; input.selectionEnd = 5;
    return node;
  }
  const state = createInitialState(20261012, 97531);
  return { realm, make, doc, root, panel, list, draft, messages, row, state };
}
type Fixture = ReturnType<typeof fixture>;
const named = (f: Fixture, label: string) => f.realm.nodes.find(node => node.label === label)!;
function snapshot(f: Fixture) {
  // Includes removed nodes as well as the attached tree so stale-node writes
  // cannot disappear from the comparison after textContent removes a subtree.
  return {
    nodes: f.realm.nodes.map(node => ({ label: node.label, tag: node.tag, attrs: { ...node.attrs }, parent: node.parent?.label ?? null,
      children: node.children.map(child => child.label), text: node.ownText, width: node.style.width, connected: node.isConnected,
      hidden: node.hidden, value: node.value, checked: node.checked, disabled: node.disabled, open: node.open,
      selectionStart: node.selectionStart, selectionEnd: node.selectionEnd, listeners: node.listeners.length })),
    active: f.realm.active?.label ?? null, actions: [...f.realm.actions], state: JSON.stringify(f.state),
  };
}
function run(f: Fixture, fleets: readonly Flight[], render: Render) {
  f.realm.writes = []; f.realm.queries = [];
  const state = JSON.stringify(f.state), stateRef = f.state, universe = f.state.universe, planets = f.state.planets;
  const modelBefore = JSON.stringify(fleets), refs = [...f.realm.nodes], controls = refs.map(node => ({ node, listeners: [...node.listeners] }));
  let error: { name: string; message: string } | null = null;
  try { render(f.list, { fleets }, createFleetRowLookup, required, put); }
  catch (caught) { const e = caught as Error; error = { name: e.name, message: e.message }; }
  expect(f.state).toBe(stateRef); expect(f.state.universe).toBe(universe); expect(f.state.planets).toBe(planets);
  expect(JSON.stringify(f.state)).toBe(state); expect(JSON.stringify(fleets)).toBe(modelBefore);
  expect(f.realm.nodes).toHaveLength(refs.length);
  for (let i = 0; i < refs.length; i++) {
    expect(f.realm.nodes[i]).toBe(refs[i]);
    expect(controls[i]!.node.listeners).toEqual(controls[i]!.listeners);
  }
  return { dom: snapshot(f), writes: [...f.realm.writes], error };
}
function pair(build: (f: Fixture) => void) {
  const original = fixture(), indexed = fixture(); build(original); build(indexed);
  return { original, indexed, paint(fleets: readonly Flight[]) {
    const expected = run(original, fleets, originalRender), actual = run(indexed, fleets, indexedRender);
    expect(actual).toEqual(expected); return actual;
  } };
}
function listQueries(f: Fixture, kind: Query["kind"]) { return f.realm.queries.filter(query => query.node === "list" && query.kind === kind); }

describe("per-paint fleet row lookup versus the original descendant selector", () => {
  it("builds the production lookup after rebuild and both existing button registrations", () => {
    expect(panelSource).toContain('for(const button of list.querySelectorAll<HTMLButtonElement>(\'[data-space="npc-retry-dock"]\'))npcAttack.register(button,"retry",button.dataset.fleet!);\n    }\n    const fleetRow=createFleetRowLookup(list);');
    expect(originalLoop.trim()).toBe('for(const f of model.fleets){const row=el(list,`[data-flight="${f.id}"]`);put(row,".flight-title",f.title);put(row,".flight-route",f.route);put(row,".flight-time",f.remaining);put(row,".flight-detail",f.detail);el(row,".flight-progress").style.width=`${f.progress}%`;}');
  });

  it.each([0, 3, 1000])("matches the complete row output and write order for %i normal rows", count => {
    const p = pair(f => { for (let i = 1; i <= count; i++) f.row(String(i)); f.draft.focus(); });
    const models = Object.freeze(Array.from({ length: count }, (_, i) => flight(i + 1)));
    const result = p.paint(models);
    expect(result.error).toBeNull(); expect(result.writes).toHaveLength(count * 5);
    expect(p.indexed.realm.active).toBe(p.indexed.draft);
    expect(listQueries(p.indexed, "all")).toEqual([{ node: "list", kind: "all", selector: "[data-flight]" }]);
    expect(listQueries(p.indexed, "one")).toEqual([]); expect(listQueries(p.original, "one")).toHaveLength(count);
  }, 20000);

  it("keeps exact row, child, control, listener and focus identity on repeated models and immutable frames", () => {
    const p = pair(f => { f.row("1"); f.row("2"); named(f, "row-1-input").focus(); });
    const model = Object.freeze([flight(1), flight(2)]), focused = named(p.indexed, "row-1-input"), row = named(p.indexed, "row-1");
    p.paint(model);
    for (const next of [model, Object.freeze([...model]), Object.freeze(model.map(value => Object.freeze({ ...value })))]) {
      const result = p.paint(next);
      expect(result.writes.map(write => write.kind)).toEqual(["width", "width"]);
      expect(named(p.indexed, "row-1")).toBe(row); expect(p.indexed.realm.active).toBe(focused);
      expect(named(p.indexed, "row-1-details").open).toBe(true); expect(focused.value).toBe("draft-1");
    }
    named(p.indexed, "row-1-recall").listeners[0]!(); named(p.original, "row-1-recall").listeners[0]!();
    expect(snapshot(p.indexed)).toEqual(snapshot(p.original)); expect(p.indexed.realm.actions).toEqual(["row-1"]);
  });

  it("uses model order without moving rows and repaints duplicate model IDs in order", () => {
    const p = pair(f => { f.row("1"); f.row("2"); f.row("3"); });
    p.paint([flight(3), flight(1), flight(2), flight(1, " last")]);
    expect(p.indexed.list.children.map(row => row.getAttribute("data-flight"))).toEqual(["1", "2", "3"]);
    expect(named(p.indexed, "row-1-title").textContent).toBe("舰队 1 last");
  });

  it("takes the first duplicate attribute in descendant tree order, including nested arbitrary elements", () => {
    const p = pair(f => {
      const wrapper = f.make("wrapper", "section", f.list), first = f.row("7", "nested-first", wrapper, "article");
      delete first.attrs.class;
      f.row("7", "direct-second");
      const nested = f.row("8", "nested-svg", named(f, "nested-first-details"), "svg"); delete nested.attrs.class;
      f.row("8", "direct-third");
    });
    p.paint([flight(7), flight(8), flight(7, " again")]);
    expect(named(p.indexed, "nested-first-title").textContent).toBe("舰队 7 again");
    expect(named(p.indexed, "nested-svg-title").textContent).toBe("舰队 8");
    expect(named(p.indexed, "direct-second-title").textContent).toBe(""); expect(named(p.indexed, "direct-third-title").textContent).toBe("");
  });

  it("keeps raw attribute strings distinct rather than coercing 01 or 1.0 to 1", () => {
    const p = pair(f => { f.row("01", "leading-zero"); f.row("1.0", "decimal"); f.row("1", "integer"); f.row("", "empty"); });
    p.paint([flight(1)]);
    expect(named(p.indexed, "integer-title").textContent).toBe("舰队 1");
    expect(named(p.indexed, "leading-zero-title").textContent).toBe(""); expect(named(p.indexed, "decimal-title").textContent).toBe("");
    for (const f of [p.original, p.indexed]) named(f, "integer").remove();
    expect(p.paint([flight(1)]).error).toEqual({ name: "Error", message: '缺少界面节点 [data-flight="1"]' });
  });

  it("excludes the list itself even when its data-flight matches", () => {
    const p = pair(f => { f.list.attrs["data-flight"] = "1"; f.row("1", "descendant"); });
    p.paint([flight(1)]); expect(named(p.indexed, "descendant-title").textContent).toBe("舰队 1");
    for (const f of [p.original, p.indexed]) named(f, "descendant").remove();
    expect(p.paint([flight(1)]).error?.message).toBe('缺少界面节点 [data-flight="1"]');
  });

  it.each(["title", "route", "time", "detail"])("falls back to the next duplicate when an earlier %s write removes the cached first match", field => {
    const p = pair(f => { f.row("1"); f.row("2", "removed-first", named(f, `row-1-${field}`)); f.row("2", "surviving-second"); });
    const result = p.paint([flight(1), flight(2)]);
    expect(result.error).toBeNull(); expect(named(p.indexed, "removed-first").parent).toBeNull();
    expect(named(p.indexed, "removed-first-title").textContent).toBe(""); expect(named(p.indexed, "surviving-second-title").textContent).toBe("舰队 2");
    expect(listQueries(p.indexed, "one")).toEqual([{ node: "list", kind: "one", selector: '[data-flight="2"]' }]);
  });

  it("throws the same Chinese error after the same prior writes when a text write removes the last matching row", () => {
    const p = pair(f => { f.row("1"); f.row("2", "removed-last", named(f, "row-1-title")); f.row("3"); });
    const result = p.paint([flight(1), flight(2), flight(3)]);
    expect(result.error).toEqual({ name: "Error", message: '缺少界面节点 [data-flight="2"]' });
    expect(result.writes.map(write => write.node)).toEqual(["row-1-title", "row-1-route", "row-1-time", "row-1-detail", "row-1-progress"]);
    expect(named(p.indexed, "row-3-title").textContent).toBe("");
  });

  it.each(["title", "route", "time", "detail", "progress"])("keeps the original missing-%s-child exception and partial write boundary", field => {
    const p = pair(f => { f.row("1"); f.row("2"); f.row("3"); named(f, `row-2-${field}`).remove(); });
    const result = p.paint([flight(1), flight(2), flight(3)]);
    expect(result.error).toEqual({ name: "Error", message: `缺少界面节点 .flight-${field}` });
    expect(result.writes).toHaveLength(5 + ["title", "route", "time", "detail", "progress"].indexOf(field));
    expect(named(p.indexed, "row-3-title").textContent).toBe("");
  });

  it("uses containment rather than document connection for a detached list", () => {
    const p = pair(f => { f.row("1"); f.list.remove(); });
    expect(p.paint([flight(1)]).error).toBeNull(); expect(p.indexed.list.isConnected).toBe(false);
    expect(listQueries(p.indexed, "one")).toEqual([]);
  });

  it("continues the same writes in a hidden panel without changing hidden controls", () => {
    const p = pair(f => { f.row("1"); f.panel.hidden = true; named(f, "row-1-recall").disabled = true; });
    expect(p.paint([flight(1)]).error).toBeNull(); expect(p.indexed.panel.hidden).toBe(true);
    expect(named(p.indexed, "row-1-recall").disabled).toBe(true);
  });

  it("builds a fresh index for a reordered DOM, replacement row and remounted list on later calls", () => {
    const p = pair(f => { f.row("1", "first"); f.row("1", "second"); });
    p.paint([flight(1, " initial")]);
    for (const f of [p.original, p.indexed]) f.list.append(named(f, "first"));
    p.paint([flight(1, " reordered")]); expect(named(p.indexed, "second-title").textContent).toBe("舰队 1 reordered");
    for (const f of [p.original, p.indexed]) { f.list.replaceChildren(); f.row("1", "replacement"); }
    p.paint([flight(1, " replaced")]); expect(named(p.indexed, "replacement-title").textContent).toBe("舰队 1 replaced");
    expect(named(p.indexed, "first-title").textContent).toBe("舰队 1 initial");
    for (const f of [p.original, p.indexed]) {
      f.list.remove(); f.list = f.make("remounted-list", "div", f.panel); f.row("1", "remounted", f.list);
    }
    p.paint([flight(1, " remounted")]); expect(named(p.indexed, "remounted-title").textContent).toBe("舰队 1 remounted");
    expect(named(p.indexed, "replacement-title").textContent).toBe("舰队 1 replaced");
  });

  it("does not retain a row between independent lists or adopted same-ID models", () => {
    const p = pair(f => { f.row("1"); }); p.paint([flight(1)]);
    const next = pair(f => { f.row("1", "new-world-row"); });
    next.paint([flight(1, " new world")]);
    expect(named(next.indexed, "new-world-row-title").textContent).toBe("舰队 1 new world");
    expect(named(p.indexed, "row-1-title").textContent).toBe("舰队 1");
  });

  it("keeps the first match while it remains contained, without requiring a class or direct parent", () => {
    const f = fixture(), holder = f.make("holder", "aside", f.list), row = f.row("1", "nested", holder, "em");
    row.attrs.class = "";
    const lookup = createFleetRowLookup(element(f.list));
    expect(lookup(1)).toBe(row); expect(f.list.children).toEqual([holder]);
  });
});
