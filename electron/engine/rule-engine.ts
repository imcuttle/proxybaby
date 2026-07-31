/**
 * 规则调度器：管理多规则集，把匹配到的规则的操作符编译成 middleware 链。
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
    // 每个规则集一个文件： <id>__<encodedName>__<enabled>.rules
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.rules'));
    for (const f of files) {
      const abs = path.join(this.dir, f);
      const text = fs.readFileSync(abs, 'utf8');
      const meta = parseFileName(f);
      const set = parseRuleSet(meta.id, meta.name, text, meta.enabled);
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
    const fname = `${set.id}__${encodeURIComponent(set.name)}__${set.enabled ? '1' : '0'}.rules`;
    fs.writeFileSync(path.join(this.dir, fname), set.text);
  }

  list(): RuleSet[] {
    return [...this.sets.values()];
  }

  get(id: string): RuleSet | undefined {
    return this.sets.get(id);
  }

  add(name: string, text: string, enabled = true): RuleSet {
    const id = `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const set = parseRuleSet(id, name, text, enabled);
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
   * 为一个请求 URL 收集所有匹配规则，构造 middleware 链。
   */
  buildMiddlewares(url: string, scheme: 'http' | 'https', hostPath: string): {
    middlewares: Middleware[];
    matched: { ruleId: string; ruleName: string; pattern: string }[];
    hints: { needsReqBodyBuffer: boolean; needsResBodyBuffer: boolean };
  } {
    const middlewares: Middleware[] = [];
    const matched: { ruleId: string; ruleName: string; pattern: string }[] = [];
    let needsReqBodyBuffer = false;
    let needsResBodyBuffer = false;
    for (const set of this.sets.values()) {
      if (!set.enabled) continue;
      for (const rule of set.rules) {
        if (!matchRule(rule, url, scheme, hostPath)) continue;
        matched.push({ ruleId: set.id, ruleName: set.name, pattern: rule.pattern });
        middlewares.push(...buildOpsMiddlewares(rule.ops));
        const h = opsRequireBuffering(rule.ops);
        if (h.needsReqBodyBuffer) needsReqBodyBuffer = true;
        if (h.needsResBodyBuffer) needsResBodyBuffer = true;
      }
    }
    return { middlewares, matched, hints: { needsReqBodyBuffer, needsResBodyBuffer } };
  }
}

function parseFileName(f: string): { id: string; name: string; enabled: boolean } {
  const base = f.replace(/\.rules$/, '');
  const [id, encodedName, enabled] = base.split('__');
  return {
    id: id || 'rs_unknown',
    name: encodedName ? decodeURIComponent(encodedName) : 'unnamed',
    enabled: enabled !== '0',
  };
}
