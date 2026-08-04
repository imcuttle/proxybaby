import { useEffect, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Check } from 'lucide-react';
import type { RuleQuickInputParams } from '../../shared/types';
import { cn } from '../lib/cn';

/**
 * 快速规则子菜单：Sidebar 里 host/subpath 右键，以及 RequestList 里 flow 右键都会用。
 * 交互：每个 preset 一行；命中同 pattern 下已有临时规则时左侧显示 ✓，再点即删除（toggle）。
 */
export type QuickRulePreset = {
  key: string;
  label: string;
} & (
  | { kind: 'immediate'; operator: string; value: string }
  | { kind: 'input'; operator: 'mapLocal' | 'mapRemote' | 'mock' | 'statusCode' | 'resDelay' | 'resBody'; inputKind: 'text' | 'textarea' | 'number' | 'file'; placeholder?: string }
);

/** 内置 preset 顺序：immediate 在前（一键生效），input 在后（打开配置窗口）。 */
export const DEFAULT_QUICK_RULE_PRESETS: QuickRulePreset[] = [
  { key: 'abort',     label: '禁止访问',        kind: 'immediate', operator: 'abort',  value: '' },
  { key: 'cors',      label: '一键 CORS',       kind: 'immediate', operator: 'raw',    value: 'resHeaders://{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"*","Access-Control-Allow-Headers":"*","Access-Control-Expose-Headers":"*"}' },
  { key: 'mapLocal',  label: '本地映射…',       kind: 'input', operator: 'mapLocal',  inputKind: 'file',     placeholder: '本地文件绝对路径' },
  { key: 'mapRemote', label: '远程映射…',       kind: 'input', operator: 'mapRemote', inputKind: 'text',     placeholder: 'http://target.example.com' },
  { key: 'mock',      label: '返回 Mock JSON…',  kind: 'input', operator: 'mock',      inputKind: 'textarea', placeholder: '{"key":"value"}' },
  { key: 'statusCode',label: '状态码替换…',      kind: 'input', operator: 'statusCode',inputKind: 'number',   placeholder: '如 404' },
  { key: 'resDelay',  label: '响应延迟…',        kind: 'input', operator: 'resDelay',  inputKind: 'number',   placeholder: '毫秒' },
  { key: 'resBody',   label: '重写响应体…',      kind: 'input', operator: 'resBody',   inputKind: 'textarea', placeholder: '响应体文本' },
];

/** 立即写入 or 打开参数子窗口。规则名格式 `[临时] <shortOp> <pattern>`，其中 raw preset 的 shortOp='cors'。 */
export async function applyQuickRule(pattern: string, preset: QuickRulePreset) {
  if (preset.kind === 'immediate') {
    try {
      await window.proxybaby.rulesQuickAdd({ pattern, operator: preset.operator, value: preset.value });
    } catch {}
    return;
  }
  const params: RuleQuickInputParams = {
    operator: preset.operator,
    pattern,
    label: preset.label.replace(/…$/, ''),
    inputKind: preset.inputKind,
    placeholder: preset.placeholder,
  };
  try {
    await window.proxybaby.ruleQuickInputOpen(params);
  } catch {}
}

export async function openCustomRule(pattern: string) {
  try {
    await window.proxybaby.rulesQuickAddCustom({ pattern });
    window.proxybaby.broadcast('nav:goto', { page: 'rules' });
  } catch {}
}

export function QuickRuleSubMenu({
  pattern,
  presets = DEFAULT_QUICK_RULE_PRESETS,
  onApply = applyQuickRule,
  onOpenCustom = openCustomRule,
}: {
  pattern: string;
  presets?: QuickRulePreset[];
  onApply?: (pattern: string, preset: QuickRulePreset) => void;
  onOpenCustom?: (pattern: string) => void;
}) {
  const itemCls = 'flex items-center px-3 py-1.5 outline-none cursor-default select-none text-pb-text hover:bg-pb-hover data-[highlighted]:bg-pb-hover';
  const trigCls = 'flex items-center px-3 py-1.5 text-pb-text hover:bg-pb-hover data-[state=open]:bg-pb-hover cursor-default outline-none';
  const [existingByPreset, setExistingByPreset] = useState<Record<string, { ruleSetId: string; lineNo: number }>>({});
  const activeCount = Object.keys(existingByPreset).length;
  const presetShortOp = (p: QuickRulePreset): string => (p.operator === 'raw' ? 'cors' : p.operator);

  /**
   * 按 pattern + operator 精准定位到临时规则集中的某一行。
   *
   * 定位规则：
   *   1. rs.temporary=true 才考虑
   *   2. 规则集名字要能解出 shortOp（`[临时] <shortOp> ...` 前缀），且与 preset 匹配
   *   3. 规则集内至少有一条 `rule.pattern === pattern` 的规则行；取第一条命中的 `lineNo`
   *      —— 这样即使规则集里有用户手工加的其它规则行，toggle 只影响我们创建的这一行。
   */
  const refresh = async () => {
    try {
      const list = await window.proxybaby.rulesList();
      const map: Record<string, { ruleSetId: string; lineNo: number }> = {};
      for (const rs of list as any[]) {
        if (!rs.temporary) continue;
        const m = String(rs.name || '').match(/^\[临时\]\s+(\S+)\s+/);
        if (!m) continue;
        const shortOp = m[1];
        const hit = presets.find((p) => presetShortOp(p) === shortOp);
        if (!hit) continue;
        const rule = rs.rules?.find((r: any) => r.pattern === pattern);
        if (!rule || typeof rule.lineNo !== 'number') continue;
        map[hit.key] = { ruleSetId: rs.id, lineNo: rule.lineNo };
      }
      setExistingByPreset(map);
    } catch {}
  };
  useEffect(() => {
    refresh();
    const off = window.proxybaby.onEvent('rules:changed' as any, () => refresh());
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern]);

  /**
   * 删除临时规则集中的某一行：
   *   - 若删完后规则集只剩空白/注释 → 整个规则集 remove
   *   - 否则 update text 保留其它行
   *
   * 保守处理跨行值：如果紧跟在被删行之后有若干"无效续行"（既不是空/注释/组标签，
   * 也不是合法规则起始 —— 即 parser 视之为错误），一起吃掉。这样即使用户之前用
   * Enter 把 mock JSON 分成了多行（parser 层其实不认，但会残留在 text 里），toggle
   * 删除时不会留下孤儿续行。
   */
  const removeRuleLine = async (ruleSetId: string, lineNo: number) => {
    try {
      const rs = await window.proxybaby.rulesGet(ruleSetId);
      if (!rs) return;
      const lines = String(rs.text || '').split(/\r?\n/);
      const idx = lineNo - 1;
      if (idx < 0 || idx >= lines.length) return;

      // 找出紧邻其后的"无效续行"范围：既非空白/注释/组标签，也不是新规则起始
      // （新规则起始的判断：trim 后能被 parser 认作至少一个 token + 已知 operator；
      // 这里做近似判断：行内含 `<op>://` 或 `\b<op>\b` 之一即视为可能是新规则起始）
      const knownOps = ['statusCode','redirect','abort','reqHeaders','resHeaders','reqBody','resBody',
        'host','file','mock','tpl','reqDelay','resDelay','log','ua','referer','req','res',
        'breakpoint','script','throttle','block','allow'];
      const opAlt = new RegExp(`(?:^|\\s)(?:${knownOps.join('|')})(?::\\/\\/|\\b)`);
      let removeEnd = idx;
      for (let j = idx + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (t === '') break;                  // 空行 → 停
        if (t.startsWith('#')) break;         // 注释 → 停
        if (t.startsWith('[') && t.endsWith(']')) break; // 组标签 → 停
        if (opAlt.test(lines[j])) break;      // 看起来像新规则起始 → 停
        removeEnd = j;                        // 无效续行，一起删
      }

      lines.splice(idx, removeEnd - idx + 1);
      const nextText = lines.join('\n');
      //剩下的都是空白/注释/组标签？→ 整个 remove
      const hasRule = lines.some((l) => {
        const t = l.trim();
        return t !== '' && !t.startsWith('#') && !(t.startsWith('[') && t.endsWith(']'));
      });
      if (!hasRule) {
        await window.proxybaby.rulesRemove(ruleSetId);
      } else {
        await window.proxybaby.rulesUpdate(ruleSetId, { text: nextText });
      }
    } catch {}
  };
  const onItemClick = (preset: QuickRulePreset) => {
    const existing = existingByPreset[preset.key];
    if (existing) {
      removeRuleLine(existing.ruleSetId, existing.lineNo);
      return;
    }
    onApply(pattern, preset);
  };
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className={trigCls} data-testid="quick-rule-trigger">
        <span className="flex-1">
          规则
          {activeCount > 0 && (
            <span className="ml-2 text-[10px] text-pb-accent">
              ({activeCount} 生效)
            </span>
          )}
        </span>
        <span className="text-pb-muted">▸</span>
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent className="min-w-[240px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
          {presets.map((p) => {
            const active = !!existingByPreset[p.key];
            return (
              <ContextMenu.Item
                key={p.key}
                className={itemCls}
                onSelect={() => onItemClick(p)}
                data-testid={`quick-rule-${p.key}`}
                data-active={active ? 'true' : 'false'}
              >
                <span className="w-3.5 mr-1 inline-flex items-center justify-center text-pb-accent">
                  {active ? <Check size={12} /> : null}
                </span>
                <span className={cn('flex-1', active && 'text-pb-accent')}>{p.label}</span>
              </ContextMenu.Item>
            );
          })}
          <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => onOpenCustom(pattern)}
            data-testid="quick-rule-custom"
          >
            <span className="w-3.5 mr-1 inline-block" />
            <span className="flex-1">自定义规则…</span>
          </ContextMenu.Item>
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}
