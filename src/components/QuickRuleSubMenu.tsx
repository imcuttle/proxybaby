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
  const [existingByPreset, setExistingByPreset] = useState<Record<string, string>>({});
  const activeCount = Object.keys(existingByPreset).length;
  const presetShortOp = (p: QuickRulePreset): string => (p.operator === 'raw' ? 'cors' : p.operator);
  const refresh = async () => {
    try {
      const list = await window.proxybaby.rulesList();
      const map: Record<string, string> = {};
      for (const rs of list as any[]) {
        if (!rs.temporary) continue;
        if (!rs.rules?.some((r: any) => r.pattern === pattern)) continue;
        const m = String(rs.name || '').match(/^\[临时\]\s+(\S+)\s+/);
        if (!m) continue;
        const shortOp = m[1];
        const hit = presets.find((p) => presetShortOp(p) === shortOp);
        if (hit) map[hit.key] = rs.id;
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
  const removeById = async (id: string) => {
    try { await window.proxybaby.rulesRemove(id); } catch {}
  };
  const onItemClick = (preset: QuickRulePreset) => {
    const existingId = existingByPreset[preset.key];
    if (existingId) {
      removeById(existingId);
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
