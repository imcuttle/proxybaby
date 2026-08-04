/**
 * 规则调度器：管理多规则集，把匹配到的规则的操作符编译成 middleware 链。
 *
 * 临时规则（temporary=true）：Sidebar 右键快速添加的规则，独立管理（可批量清空、
 * 在规则页独立 sub-tab 展示）。除标志位外与常规规则集完全一致，参与 buildMiddlewares。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { parseRuleSet, matchRule, type RuleSet } from './rule-parser';
import { buildOpsMiddlewares, opsRequireBuffering } from './operators';
import type { Middleware } from './context';

const RULES_DIR_NAME = 'rules';

export class RuleEngine {
  private sets: Map<string, RuleSet> = new Map();
  private dir: string;

  constructor() {
    this.dir = path.join(app.getPath('userData'), RULES_DIR_NAME);
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    this.loadFromDisk();
  }

  private loadFromDisk() {
    // 每个规则集一个文件： <id>__<encodedName>__<enabled>[__t].rules
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.rules'));
    for (const f of files) {
      const abs = path.join(this.dir, f);
      const text = fs.readFileSync(abs, 'utf8');
      const meta = parseFileName(f);
      const set = parseRuleSet(meta.id, meta.name, text, meta.enabled);
      if (meta.temporary) set.temporary = true;
      this.sets.set(set.id, set);
    }
  }

  private saveSet(set: RuleSet) {
    // 先删除旧文件（可能名字变了）
    for (const f of fs.readdirSync(this.dir)) {
      const m = parseFileName(f);
      if (m.id === set.id) {
        try { fs.unlinkSync(path.join(this.dir, f)); } catch {}
      }
    }
    const tempTag = set.temporary ? '__t' : '';
    const fname = `${set.id}__${encodeURIComponent(set.name)}__${set.enabled ? '1' : '0'}${tempTag}.rules`;
    fs.writeFileSync(path.join(this.dir, fname), set.text);
  }

  list(): RuleSet[] {
    return [...this.sets.values()];
  }

  get(id: string): RuleSet | undefined {
    return this.sets.get(id);
  }

  add(name: string, text: string, enabled = true, temporary = false): RuleSet {
    const id = `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const set = parseRuleSet(id, name, text, enabled);
    if (temporary) set.temporary = true;
    this.sets.set(id, set);
    this.saveSet(set);
    return set;
  }

  update(id: string, patch: { name?: string; text?: string; enabled?: boolean }): RuleSet | undefined {
    const cur = this.sets.get(id);
    if (!cur) return undefined;
    const next = parseRuleSet(
      id,
      patch.name ?? cur.name,
      patch.text ?? cur.text,
      patch.enabled ?? cur.enabled,
    );
    if (cur.temporary) next.temporary = true;
    this.sets.set(id, next);
    this.saveSet(next);
    return next;
  }

  remove(id: string): boolean {
    const cur = this.sets.get(id);
    if (!cur) return false;
    this.sets.delete(id);
    for (const f of fs.readdirSync(this.dir)) {
      const m = parseFileName(f);
      if (m.id === id) {
        try { fs.unlinkSync(path.join(this.dir, f)); } catch {}
      }
    }
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const set = this.update(id, { enabled });
    return !!set;
  }

  /**
   * 快速添加一条临时规则：一条规则 = 一个临时规则集（复用规则集级别的 enabled 作为单条开关）。
   * `line` 是完整的规则行文本，如 `api.demo.com  abort` 或 `api.demo.com/x  resDelay://500`。
   */
  addTemporary(name: string, line: string): RuleSet {
    return this.add(name, line, true, true);
  }

  /**
   * "自定义规则…" 专用：找到（或创建）名为 `[临时] 自定义` 的规则集，追加一行 `<pattern>  ` 到末尾。
   * 返回定位信息给渲染层用于聚焦光标。
   */
  appendCustomLine(pattern: string): { ruleSetId: string; lineNo: number } {
    const CUSTOM_NAME = '[临时] 自定义';
    let target = [...this.sets.values()].find((s) => s.temporary && s.name === CUSTOM_NAME);
    const newLine = `${pattern}  `;
    if (!target) {
      target = this.add(CUSTOM_NAME, newLine, true, true);
      return { ruleSetId: target.id, lineNo: 1 };
    }
    const text = target.text.endsWith('\n') || target.text === ''
      ? target.text + newLine
      : target.text + '\n' + newLine;
    const next = this.update(target.id, { text });
    if (!next) return { ruleSetId: target.id, lineNo: text.split('\n').length };
    return { ruleSetId: next.id, lineNo: next.text.split('\n').length };
  }

  clearTemporary(): number {
    let n = 0;
    for (const s of [...this.sets.values()]) {
      if (s.temporary) {
        this.remove(s.id);
        n++;
      }
    }
    return n;
  }

  /**
   * 为一个请求 URL 收集所有匹配规则，构造 middleware 链。
   */
  buildMiddlewares(url: string, scheme: 'http' | 'https', hostPath: string): {
    middlewares: Middleware[];
    matched: { ruleId: string; ruleName: string; pattern: string; lineNo?: number }[];
    hints: { needsReqBodyBuffer: boolean; needsResBodyBuffer: boolean };
  } {
    const middlewares: Middleware[] = [];
    const matched: { ruleId: string; ruleName: string; pattern: string; lineNo?: number }[] = [];
    let needsReqBodyBuffer = false;
    let needsResBodyBuffer = false;
    for (const set of this.sets.values()) {
      if (!set.enabled) continue;
      for (const rule of set.rules) {
        if (!matchRule(rule, url, scheme, hostPath)) continue;
        matched.push({ ruleId: set.id, ruleName: set.name, pattern: rule.pattern, lineNo: rule.lineNo });
        middlewares.push(...buildOpsMiddlewares(rule.ops, { ruleId: set.id, pattern: rule.pattern }));
        const h = opsRequireBuffering(rule.ops);
        if (h.needsReqBodyBuffer) needsReqBodyBuffer = true;
        if (h.needsResBodyBuffer) needsResBodyBuffer = true;
      }
    }
    return { middlewares, matched, hints: { needsReqBodyBuffer, needsResBodyBuffer } };
  }
}

function parseFileName(f: string): { id: string; name: string; enabled: boolean; temporary: boolean } {
  const base = f.replace(/\.rules$/, '');
  const parts = base.split('__');
  const [id, encodedName, enabled, tempFlag] = parts;
  return {
    id: id || 'rs_unknown',
    name: encodedName ? decodeURIComponent(encodedName) : 'unnamed',
    enabled: enabled !== '0',
    temporary: tempFlag === 't',
  };
}
