import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, RefreshCcw, Play, Filter as FilterIcon } from 'lucide-react';
import type {
  ScriptSummary,
  ScriptTestCase,
  ScriptTestResult,
  UpstreamProxyConfig,
} from '../../shared/types';
import { cn } from '../lib/cn';
import { MonacoView } from './MonacoView';

/**
 * 设置 & 高级工具页：
 *  - 脚本管理（Scripts）：作为 whistle 插件，`script://<id-or-name>` 引用；可勾选“全局”
 *  - 过滤配置入口提示（Allow/Block + SSL 解密清单已迁移至左下角 + 按钮）
 *  - 网络条件预设
 *  - 上游代理
 */
export function SettingsView() {
  return (
    <div className="h-full flex flex-col overflow-y-auto pb-scroll" data-testid="settings-view">
      <div className="p-4 space-y-6 max-w-4xl">
        <AiPanel />
        <FilterConfigEntry />
        <NetworkPanel />
        <UpstreamProxyPanel />
      </div>
    </div>
  );
}

// -------- AI --------

function AiPanel() {
  const [cfg, setCfg] = useState<{ enabled: boolean; cliPath: string; model?: string; permissionMode?: string }>({
    enabled: true, cliPath: 'codebuddy',
  });
  const refresh = async () => {
    const c = await window.proxybaby.aiGetConfig();
    if (c) setCfg({ enabled: !!c.enabled, cliPath: c.cliPath || 'codebuddy', model: c.model, permissionMode: c.permissionMode });
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const save = async (patch: any) => {
    const c = await window.proxybaby.aiSetConfig(patch);
    if (c) setCfg({ enabled: !!c.enabled, cliPath: c.cliPath || 'codebuddy', model: c.model, permissionMode: c.permissionMode });
  };

  return (
    <section data-testid="ai-settings">
      <SectionHeader
        title="AI 助手"
        subtitle={
          <>默认调用本机 <code className="text-pb-accent">codebuddy</code>（Agent Client Protocol，stdio 模式）。</> as any
        }
      />
      <div className="space-y-3 rounded border border-pb-border bg-pb-panel/40 p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            data-testid="ai-enable-toggle"
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          启用 AI 助手（顶栏显示 AI 按钮）
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-24 text-pb-muted">CLI 路径</span>
          <input
            data-testid="ai-cli-input"
            className="pb-input flex-1"
            value={cfg.cliPath}
            onChange={(e) => setCfg({ ...cfg, cliPath: e.target.value })}
            onBlur={() => save({ cliPath: cfg.cliPath })}
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-24 text-pb-muted">Model</span>
          <input
            className="pb-input flex-1"
            placeholder="不填使用默认"
            value={cfg.model || ''}
            onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
            onBlur={() => save({ model: cfg.model })}
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-24 text-pb-muted">Permission Mode</span>
          <select
            className="pb-input flex-1"
            value={cfg.permissionMode || 'bypassPermissions'}
            onChange={(e) => save({ permissionMode: e.target.value })}
          >
            <option value="default">default</option>
            <option value="acceptEdits">acceptEdits</option>
            <option value="bypassPermissions">bypassPermissions</option>
            <option value="plan">plan</option>
          </select>
        </div>
      </div>
    </section>
  );
}

// -------- 过滤配置入口（迁移提示） --------
function FilterConfigEntry() {
  const open = () => {
    window.proxybaby.openWindow('filter-config', { title: 'ProxyBaby · 过滤配置', width: 760, height: 640 });
  };
  return (
    <section data-testid="filter-config-entry">
      <SectionHeader
        title="过滤配置"
        subtitle="允许 / 阻止列表 与 SSL 解密清单已迁移到独立窗口，从左下角 + 按钮打开。"
      />
      <div className="border border-pb-border rounded p-3 flex items-center gap-2">
        <FilterIcon size={14} className="text-pb-muted" />
        <span className="text-xs text-pb-muted flex-1">
          支持按 App / 域名 / URL 三维度配置黑白名单。
        </span>
        <button
          className="pb-btn px-2 py-0.5 text-xs"
          data-testid="filter-config-open"
          onClick={open}
        >
          打开过滤配置
        </button>
      </div>
    </section>
  );
}

// -------- Network conditions --------
function NetworkPanel() {
  const [key, setKey] = useState<string>('');
  const refresh = async () => setKey((await window.proxybaby.networkGetProfile()) || '');
  useEffect(() => { refresh(); }, []);
  const set = async (k: string) => setKey((await window.proxybaby.networkSetProfile(k || null)) || '');
  const PRESETS = ['', 'wifi', '5g', '4g', '3g', '2g', 'gprs', 'offline'];
  return (
    <section data-testid="network-panel">
      <SectionHeader title="网络条件" subtitle="模拟慢速/离线网络。" />
      <div className="border border-pb-border rounded p-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p || 'off'}
            data-testid={`network-preset-${p || 'off'}`}
            onClick={() => set(p)}
            className={cn('pb-btn px-2 py-0.5 text-xs', key === p && 'bg-pb-hover text-pb-text')}
          >
            {p === '' ? '关闭' : p.toUpperCase()}
          </button>
        ))}
        <div className="ml-auto text-xs text-pb-muted flex items-center gap-1">
          <RefreshCcw size={12} /> 当前：{key || '关闭'}
        </div>
      </div>
    </section>
  );
}

// -------- Upstream Proxy --------
function UpstreamProxyPanel() {
  const [cfg, setCfg] = useState<UpstreamProxyConfig>({ kind: 'off' });
  const [draft, setDraft] = useState<UpstreamProxyConfig>({ kind: 'off' });
  useEffect(() => {
    window.proxybaby.upstreamProxyGet().then((c) => { setCfg(c); setDraft(c); });
  }, []);
  const save = async () => {
    const next = await window.proxybaby.upstreamProxySet(draft);
    setCfg(next); setDraft(next);
  };
  return (
    <section data-testid="upstream-panel">
      <SectionHeader title="上游代理" subtitle="所有出站请求通过外部 HTTP / SOCKS 代理转发。" />
      <div className="border border-pb-border rounded p-3 space-y-2 text-xs">
        <div className="flex gap-2 items-center" data-testid="upstream-kind">
          {(['off', 'http', 'socks5'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input
                type="radio"
                name="upstream-kind"
                data-testid={`upstream-kind-${k}`}
                checked={draft.kind === k}
                onChange={() => setDraft({ ...draft, kind: k })}
              /> {k === 'off' ? '关闭' : k.toUpperCase()}
            </label>
          ))}
        </div>
        {draft.kind !== 'off' && (
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Host" className="pb-input px-2 py-0.5" data-testid="upstream-host" value={draft.host || ''} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
            <input placeholder="Port" type="number" className="pb-input px-2 py-0.5" data-testid="upstream-port" value={draft.port || ''} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) || undefined })} />
            <input placeholder="Username (可选)" className="pb-input px-2 py-0.5" data-testid="upstream-user" value={draft.username || ''} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
            <input placeholder="Password (可选)" type="password" className="pb-input px-2 py-0.5" data-testid="upstream-pass" value={draft.password || ''} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
          </div>
        )}
        <div className="flex gap-2 items-center">
          <button className="pb-btn px-2 py-0.5" onClick={save} data-testid="upstream-save"><Save size={12} className="inline mr-1" /> 保存</button>
          <span className="text-pb-muted">当前：{cfg.kind === 'off' ? '关闭' : `${cfg.kind}://${cfg.host}:${cfg.port}`}</span>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-sm font-semibold">{title}</div>
      {subtitle && <div className="text-xs text-pb-muted mt-0.5">{subtitle}</div>}
    </div>
  );
}
