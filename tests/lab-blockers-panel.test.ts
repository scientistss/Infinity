import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LabBlockersModel } from "../src/ui/lab-blockers-model";
import { labBlockersHtml, updateLabBlockers, updateLabBlockersProtection } from "../src/ui/lab-blockers-panel";
import source from "../src/ui/lab-blockers-panel.ts?raw";
import modelSource from "../src/ui/lab-blockers-model.ts?raw";
import adapter from "../src/ui/space-panel.ts?raw";

// Like the repo's Node-only evidence scripts, keep test-only Node APIs out of
// the browser type surface. Read exact source bytes; Vite transforms CSS ?raw.
const { readFileSync } = await import("node:fs" as string) as {
  readFileSync(path: URL, encoding: "utf8"): string;
};
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

/** Behavior-only DOM double. Native keyboard, layout and storage are separate gates. */
class NodeDouble {
  dataset: Record<string, string> = {};
  children: NodeDouble[] = [];
  hidden = false;
  open = false;
  title = "";
  private ownText = "";
  constructor(readonly tagName: string) {}
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.ownText = value; this.children = []; }
  set innerHTML(_value: string) { throw new Error("Untrusted HTML must never be parsed"); }
  replaceChildren(...children: NodeDouble[]) { this.children = children; }
  querySelector(selector: string): NodeDouble | null {
    const bind = selector.match(/^\[data-bind="([^"]+)"\]$/)?.[1];
    for (const child of this.children) {
      if (child.dataset.bind === bind) return child;
      const descendant = child.querySelector(selector);
      if (descendant) return descendant;
    }
    return null;
  }
}

const HOSTILE_NAME = '特别长的星球名称'.repeat(20) + '<img src=x onerror="boom()"> & "同名"';
function fixture() {
  const root = new NodeDouble("div");
  function node(tag: string, name: string, parent: NodeDouble) {
    const result = new NodeDouble(tag);
    result.dataset.bind = `research-lab-blockers${name ? `-${name}` : ""}`;
    parent.children.push(result);
    return result;
  }
  const details = node("details", "", root);
  const summary = node("summary", "summary", details);
  const headline = node("span", "headline", summary);
  const protection = node("span", "protection", summary);
  protection.hidden = true;
  const note = node("p", "note", details);
  const list = node("ul", "list", details);
  const model: LabBlockersModel = Object.freeze({
    planetCount: 1, jobCount: 1, summary: "研究受阻：1处实验室施工",
    note: "按星球计，共 1 项已付工作（含排队）；以下仅列已付款的升级与拆除。",
    items: Object.freeze([Object.freeze({
      planetId: "homeworld", planetName: HOSTILE_NAME, coordinates: "[1:56:11]", jobId: 183,
      kind: "upgrade" as const, targetLevel: 7, queuePosition: 2, status: "已付排队" as const,
      text: `${HOSTILE_NAME} [1:56:11] · 升级 → 等级 7 · 建造队列第 2 位 · 已付排队 · 工作 #183`,
    })]),
  });
  return { root: root as unknown as HTMLElement, details, summary, headline, protection, note, list, model };
}

beforeEach(() => {
  vi.stubGlobal("document", { createElement: (tag: string) => new NodeDouble(tag) });
  vi.stubGlobal("localStorage", { setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("native read-only lab blocker disclosure", () => {
  it("starts with a hidden, closed semantic disclosure and no controls or action handler", () => {
    const html = labBlockersHtml();
    expect(html).toContain('<details class="research-lab-blockers" data-bind="research-lab-blockers" hidden>');
    expect(html).toContain('<summary data-bind="research-lab-blockers-summary">');
    expect(html).not.toMatch(/\bopen\b|<button|<input|<a\b|data-action|onclick/);
    expect(source).not.toMatch(/\b(localStorage|sessionStorage|addEventListener|onAction|setTimeout|requestAnimationFrame)\b/);
    expect(modelSource).not.toMatch(/\b(canEnqueueResearch|labBusyReason|enqueue|cancel|tick|quoteDemolition|Date|setTimeout)\(/);
    expect(adapter).toContain("updateLabBlockersProtection(root,writable,protectionMessage)");
    expect(css).toContain(".research-lab-blockers { min-width: 0;");
    expect(css).toMatch(/\.research-lab-blockers \{[^}]*overflow-wrap: anywhere;/);
  });

  it("uses only textContent for long names and markup-like characters", () => {
    const f = fixture(), before = JSON.stringify(f.model);
    updateLabBlockers(f.root, f.model);
    expect(f.details.hidden).toBe(false);
    expect(f.details.open).toBe(false);
    expect(f.headline.textContent).toBe("研究受阻：1处实验室施工");
    expect(f.note.textContent).toBe(f.model.note);
    expect(f.list.children).toHaveLength(1);
    const row = f.list.children[0]!;
    expect(row.tagName).toBe("li");
    expect(row.textContent).toBe(`${HOSTILE_NAME} [1:56:11] · 升级 → 等级 7 · 建造队列第 2 位 · 已付排队 · 工作 #183`);
    expect(row.children).toEqual([]);
    expect(row.dataset).toEqual({ planetId: "homeworld", jobId: "183", kind: "upgrade", queuePosition: "2" });
    expect(JSON.stringify(f.model)).toBe(before);
  });

  it("preserves a user's open disclosure and unchanged rows across repeated paints without writes", () => {
    const f = fixture(), before = JSON.stringify(f.model);
    updateLabBlockers(f.root, f.model);
    const row = f.list.children[0];
    for (const open of [true, false, true]) {
      f.details.open = open;
      updateLabBlockers(f.root, f.model);
      expect(f.details.open).toBe(open);
      expect(f.list.children[0]).toBe(row);
    }
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(localStorage.clear).not.toHaveBeenCalled();
    expect(JSON.stringify(f.model)).toBe(before);
  });

  it("replaces same-ID details when names, coordinates, target, kind or position change", () => {
    const f = fixture();
    updateLabBlockers(f.root, f.model);
    f.details.open = true;
    const next: LabBlockersModel = { ...f.model, items: [{ ...f.model.items[0]!,
      planetName: "导入的同编号星球", coordinates: "[2:3:4]", kind: "demolition", targetLevel: 6,
      queuePosition: null, status: "已付 · 施工中",
      text: "导入的同编号星球 [2:3:4] · 拆除 → 等级 6 · 独立拆除位 · 已付 · 施工中 · 工作 #183",
    }] };
    updateLabBlockers(f.root, next);
    expect(f.details.open).toBe(true);
    expect(f.list.children[0]!.textContent).toBe(next.items[0]!.text);
    expect(f.list.children[0]!.dataset).toEqual({ planetId: "homeworld", jobId: "183", kind: "demolition", queuePosition: "" });
    expect(f.list.textContent).not.toContain(HOSTILE_NAME);
  });

  it.each([null, { planetCount: 0, jobCount: 0, summary: "", note: "", items: [] }])(
    "clears and closes the disclosure for a hidden page or adopted blocker-free world: %s", next => {
      const f = fixture();
      updateLabBlockers(f.root, f.model);
      f.details.open = true;
      updateLabBlockers(f.root, next);
      expect(f.details.hidden).toBe(true);
      expect(f.details.open).toBe(false);
      expect(f.list.children).toEqual([]);
      expect(f.headline.textContent).toBe("");
      expect(f.note.textContent).toBe("");
      updateLabBlockers(f.root, f.model);
      expect(f.details.hidden).toBe(false);
      expect(f.details.open).toBe(false);
      expect(f.list.children[0]!.textContent).toBe(f.model.items[0]!.text);
    },
  );

  it("marks protection from the actual writable flag even with details closed and notice dismissed", () => {
    const f = fixture();
    updateLabBlockersProtection(f.root, false, "其他标签页改变了存档，本页已暂停");
    updateLabBlockers(f.root, f.model);
    expect(f.protection.hidden).toBe(false);
    expect(f.protection.textContent).toBe(" · 保护中：显示冻结进度");
    expect(f.protection.title).toBe("其他标签页改变了存档，本页已暂停");
    expect(f.details.open).toBe(false);
    expect(f.summary.textContent).toContain("研究受阻：1处实验室施工 · 保护中：显示冻结进度");
    // A subsequent projection cannot erase the guard or derive ready from status text.
    updateLabBlockers(f.root, f.model);
    expect(f.protection.hidden).toBe(false);
    updateLabBlockersProtection(f.root, true, "旧提示文本不代表当前保护状态");
    expect(f.protection.hidden).toBe(true);
    expect(f.protection.textContent).toBe("");
    expect(f.protection.title).toBe("");
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});
