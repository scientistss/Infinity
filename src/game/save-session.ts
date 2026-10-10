import { catchUp, emptyCatchup, type OfflineCatchup } from "../core/offline";
import { SAVE_REVISION, STORAGE_KEY } from "./content";
import { deserializeState, exportSave, importSave, preserveRawSave, type KeyValueStore } from "./save";
import { createInitialState } from "./state";
import type { GameState } from "./types";

export type SaveSessionMode = "ready" | "protected" | "conflict" | "unavailable";
export type SaveFailureCode = "invalid" | "storage" | "protected" | "conflict" | "stale";
export interface SaveFailure { ok: false; code: SaveFailureCode; message: string }
export type SaveResult = { ok: true } | SaveFailure;
export type ReplacementResult = { ok: true; state: GameState; raw: string; intent: number } | SaveFailure;
export type FileImportResult = ReplacementResult & { completionIntent: number };

const PROTECTION_NOTICE = "原件已保留并受保护，自动保存暂停。请先导出原件；导入有效存档或明确重新开始可重试替换。";
const CONFLICT_NOTICE = "检测到其他标签页修改了存档，已暂停写入。请先导出本页保留的原件，再刷新读取最新存档。";
const STALE_IMPORT = "文件读取期间出现了更新的操作，已取消这次导入，当前进度未改动。";

class SaveConflict extends Error {}

/**
 * Owns the storage baseline, never the live simulation. The UI may adopt a replacement
 * only after this session has validated it and verified its durable write.
 * localStorage has no true CAS: comparisons catch observed conflicts, not every
 * possible simultaneous cross-process write. See docs/SAVE_SESSION.md.
 */
export class SaveSession {
  loaded: OfflineCatchup = emptyCatchup(createInitialState());
  mode: SaveSessionMode = "ready";
  notice: string | null = null;
  message = "已读取本地存档";
  private expectedRaw: string | null | undefined;
  private protectedRaw: string | null = null;
  private intent = 0;

  constructor(private readonly store: KeyValueStore | null, now = Date.now()) {
    if (!store) {
      this.mode = "unavailable";
      this.message = "本地存储不可用，本局不会保存";
      this.notice = this.message;
      return;
    }
    let readable = false;
    try {
      const raw = store.getItem(STORAGE_KEY);
      this.expectedRaw = raw;
      if (raw === null) {
        this.message = "新游戏，尚未保存";
        return;
      }
      const file = importSave(raw);
      const restored = deserializeState(file.state);
      // A readable source stays visible, frozen, if migration cannot be committed.
      this.loaded = emptyCatchup(restored);
      readable = true;
      const loaded = catchUp(restored, (now - file.lastTickAt) / 1000);
      const sourceRevision = (JSON.parse(raw) as { revision: number }).revision;
      if (sourceRevision !== SAVE_REVISION) {
        // Migration is a replacement too: do not show migrated progress on a failed commit.
        const candidate = this.prepare(loaded.state, now);
        const committed = this.writeCandidate(candidate, true);
        if (!committed.ok) return;
        this.notice = `同源 v9/r${sourceRevision} 存档已备份并升级为 r${SAVE_REVISION}；` +
          (sourceRevision === 5 ? "已有有限计划、付款队列与舰队保持原授权，单源运输授权为空。" : "有限计划为空，已有付款队列已保留。") +
          "按原规则离线推进。" +
          (sourceRevision < 4 ? "旧星环自动卡已停用，请重新确认有限批次。" : "已有星环有限批次授权保持不变。");
        this.message = "已升级并保存本地存档";
      }
      this.loaded = loaded;
    } catch (error) {
      this.protect(error);
      if (!readable) {
        this.notice = `原存档无法读取，当前仅显示临时初始画面，未新建或覆盖存档。${PROTECTION_NOTICE}`;
        this.message = `${this.message} 当前画面为临时初始画面。`;
      }
    }
  }

  /** Saves are disabled after any unresolved storage failure or conflict. */
  save(state: GameState, now = Date.now()): SaveResult {
    if (this.mode !== "ready") return this.blocked();
    let raw: string;
    try {
      raw = this.prepare(state, now);
    } catch (error) {
      return this.invalid(error);
    }
    const result = this.writeCandidate(raw, false);
    if (result.ok) this.cancelPendingImport();
    return result;
  }

  /** A newer import/reset, manual action, save, or observed conflict invalidates a pending file read. */
  cancelPendingImport(): void {
    this.intent += 1;
  }

  importText(json: string, now = Date.now()): ReplacementResult {
    const intent = ++this.intent;
    return this.importForIntent(json, now, intent);
  }

  async importFile(file: { text(): Promise<string> }, now: () => number = Date.now): Promise<FileImportResult> {
    const intent = ++this.intent;
    try {
      const json = await file.text();
      if (intent !== this.intent) return { ...this.stale(), completionIntent: this.intent };
      const result = this.importForIntent(json, now(), intent);
      return { ...result, completionIntent: this.intent };
    } catch (error) {
      const result = intent !== this.intent ? this.stale() : this.invalid(error);
      return { ...result, completionIntent: this.intent };
    }
  }

  /** Failure status can also become stale between promise completion and UI resumption. */
  isCurrentFileResult(result: FileImportResult): boolean {
    return result.completionIntent === this.intent;
  }

  reset(now = Date.now()): ReplacementResult {
    const intent = ++this.intent;
    return this.replace(createInitialState(), now, intent);
  }

  /** Check again before adopting an asynchronously returned replacement in the UI. */
  isCurrentReplacement(result: { intent: number }): boolean {
    return result.intent === this.intent && this.mode === "ready";
  }

  /** Export protected bytes from memory, even if localStorage is currently unreadable. */
  export(state: GameState, now = Date.now()): { raw: string; protected: boolean } {
    if (this.mode !== "ready") {
      if (this.protectedRaw !== null) return { raw: this.protectedRaw, protected: true };
      if (this.expectedRaw !== null && this.expectedRaw !== undefined) {
        return { raw: this.expectedRaw, protected: true };
      }
      // A failed initial read may now be recoverable. Never label a fresh game as the original.
      if (this.expectedRaw === undefined && this.store) {
        const raw = this.store.getItem(STORAGE_KEY);
        if (raw !== null) {
          this.protectedRaw = raw;
          return { raw, protected: true };
        }
      }
    }
    return { raw: exportSave(state, now), protected: false };
  }

  /** Reread instead of trusting potentially queued/stale event.newValue bytes. */
  handleStorageEvent(key: string | null): boolean {
    if (!this.store || (key !== null && key !== STORAGE_KEY)) return false;
    try {
      if (this.store.getItem(STORAGE_KEY) === this.expectedRaw) return false;
      this.conflict();
    } catch (error) {
      this.protect(error);
    }
    return true;
  }

  private importForIntent(json: string, now: number, intent: number): ReplacementResult {
    if (intent !== this.intent) return this.stale();
    try {
      const file = importSave(json);
      return this.replace(deserializeState(file.state), now, intent);
    } catch (error) {
      return this.invalid(error);
    }
  }

  private replace(state: GameState, now: number, intent: number): ReplacementResult {
    if (intent !== this.intent) return this.stale();
    if (this.mode === "conflict" || this.mode === "unavailable") return this.blocked();
    let raw: string;
    try {
      raw = this.prepare(state, now);
    } catch (error) {
      return this.invalid(error);
    }
    const result = this.writeCandidate(raw, true);
    if (!result.ok) return result;
    return { ok: true, state, raw, intent };
  }

  private prepare(state: GameState, now: number): string {
    const raw = exportSave(state, now);
    // Prevent accidentally serializing an invalid live state into the only current slot.
    importSave(raw);
    return raw;
  }

  private writeCandidate(raw: string, preserve: boolean): SaveResult {
    if (!this.store) return this.blocked();
    try {
      if (this.expectedRaw === undefined) {
        // Only explicit replacement reaches here after an unreadable startup.
        this.expectedRaw = this.store.getItem(STORAGE_KEY);
        this.protectedRaw = this.expectedRaw;
      }
      this.compareCurrent();
      if (preserve && this.expectedRaw !== null) {
        const backup = preserveRawSave(this.store, this.expectedRaw);
        if (this.store.getItem(backup) !== this.expectedRaw) throw new Error("原存档备份校验失败");
      }
      this.compareCurrent();
      if (raw !== this.expectedRaw) this.store.setItem(STORAGE_KEY, raw);
      if (this.store.getItem(STORAGE_KEY) !== raw) throw new Error("当前存档写入后校验失败");
      this.expectedRaw = raw;
      this.protectedRaw = null;
      this.mode = "ready";
      this.notice = null;
      this.message = "已保存到本地";
      return { ok: true };
    } catch (error) {
      return error instanceof SaveConflict ? this.conflict() : this.protect(error);
    }
  }

  private compareCurrent(): void {
    if (this.store?.getItem(STORAGE_KEY) !== this.expectedRaw) throw new SaveConflict();
  }

  private conflict(): SaveFailure {
    this.protectedRaw ??= this.expectedRaw ?? null;
    this.mode = "conflict";
    this.notice = CONFLICT_NOTICE;
    this.message = CONFLICT_NOTICE;
    this.cancelPendingImport();
    return { ok: false, code: "conflict", message: this.message };
  }

  private protect(error: unknown): SaveFailure {
    this.protectedRaw ??= this.expectedRaw ?? null;
    this.mode = "protected";
    this.notice = PROTECTION_NOTICE;
    this.message = `存档操作失败：${error instanceof Error ? error.message : "未知错误"}。${PROTECTION_NOTICE}`;
    this.cancelPendingImport();
    return { ok: false, code: "storage", message: this.message };
  }

  private blocked(): SaveFailure {
    return { ok: false, code: this.mode === "conflict" ? "conflict" : "protected", message: this.message };
  }

  private invalid(error: unknown): SaveFailure {
    return { ok: false, code: "invalid", message: error instanceof Error ? error.message : "存档无效或文件无法读取" };
  }

  private stale(): SaveFailure {
    return { ok: false, code: "stale", message: STALE_IMPORT };
  }
}
