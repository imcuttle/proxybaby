import { useEffect, useMemo, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ChevronDown, ChevronRight, Globe, Package, Pin, Bookmark, PanelLeftClose, Trash2 } from 'lucide-react';
import { useFlowStore } from '../store/flows';
import { cn } from '../lib/cn';
import { isFlowPinned } from '../lib/filter';
import type { FilterKind, FilterEntry, RuleQuickInputParams } from '../../shared/types';

export function Sidebar() {
  const flows = useFlowStore((s) => s.flows);
  const filter = useFlowStore((s) => s.filter);
  const setFilter = useFlowStore((s) => s.setFilter);
  const pinnedIds = useFlowStore((s) => s.pinnedIds);
  const pinnedHosts = useFlowStore((s) => s.pinnedHosts);
  const pinnedPaths = useFlowStore((s) => s.pinnedPaths);
  const togglePinHost = useFlowStore((s) => s.togglePinHost);
  const togglePinPath = useFlowStore((s) => s.togglePinPath);
  const savedIds = useFlowStore((s) => s.savedIds);
  const removeFlow = useFlowStore((s) => s.removeFlow);
  const mitmDisabledHosts = useFlowStore((s) => s.mitmDisabledHosts);
  const toggleMitmDisabledHost = useFlowStore((s) => s.toggleMitmDisabledHost);
  const sidebarQuery = useFlowStore((s) => s.sidebarQuery);
  const [pinnedApps, setPinnedApps] = useState<Record<string, true>>({});
  const [alphaSort, setAlphaSort] = useState(false);
  const q = sidebarQuery.trim().toLowerCase();

  const { apps, hosts, subpaths } = useMemo(() => {
    const appMap = new Map<string, { count: number; iconDataUrl?: string; bundlePath?: string; hosts: Set<string>; flowIds: string[] }>();
    const hostMap = new Map<string, number>();
    const subMap = new Map<string, Map<string, number>>();
    for (const f of flows) {
      const appName = f.app?.name || '未知';
      const prev = appMap.get(appName);
      if (prev) {
        prev.count += 1;
        prev.hosts.add(f.request.host);
        prev.flowIds.push(f.id);
        if (!prev.iconDataUrl && f.app?.iconDataUrl) prev.iconDataUrl = f.app.iconDataUrl;
        if (!prev.bundlePath && f.app?.bundlePath) prev.bundlePath = f.app.bundlePath;
      } else {
        appMap.set(appName, {
          count: 1,
          iconDataUrl: f.app?.iconDataUrl,
          bundlePath: f.app?.bundlePath,
          hosts: new Set([f.request.host]),
          flowIds: [f.id],
        });
      }
      hostMap.set(f.request.host, (hostMap.get(f.request.host) || 0) + 1);
      // 记录完整 path（不含 query），供 SubpathTree 按段递归下钻
      const fullPath = f.request.path.split('?')[0] || '/';
      if (!subMap.has(f.request.host)) subMap.set(f.request.host, new Map());
      const m = subMap.get(f.request.host)!;
      m.set(fullPath, (m.get(fullPath) || 0) + 1);
    }
    const appList = [...appMap.entries()];
    appList.sort((a, b) => {
      const ap = pinnedApps[a[0]] ? 1 : 0;
      const bp = pinnedApps[b[0]] ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (alphaSort) return a[0].localeCompare(b[0]);
      return b[1].count - a[1].count;
    });
    return {
      apps: appList,
      hosts: [...hostMap.entries()].sort((a, b) => b[1] - a[1]),
      subpaths: subMap,
    };
  }, [flows, alphaSort, pinnedApps]);

  const filteredApps = useMemo(() => {
    if (!q) return apps;
    return apps.filter(([name, meta]) => {
      if (name.toLowerCase().includes(q)) return true;
      // 若 app 下任一 host 命中，也保留该 app
      for (const h of meta.hosts) if (h.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [apps, q]);

  const filteredHosts = useMemo(() => {
    if (!q) return hosts;
    return hosts.filter(([h]) => {
      if (h.toLowerCase().includes(q)) return true;
      // host 未命中但其子路径命中也保留
      const subs = subpaths.get(h);
      if (subs) {
        for (const seg of subs.keys()) if (seg.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [hosts, subpaths, q]);

  const pinCount = useMemo(
    () => flows.reduce((n, f) => n + (isFlowPinned(f, { pinnedIds, pinnedHosts, pinnedPaths }) ? 1 : 0), 0),
    [flows, pinnedIds, pinnedHosts, pinnedPaths],
  );
  const saveCount = Object.keys(savedIds).length;

  // Saved tree：按 savedIds 反查 flow → app / host / path 聚合（一次遍历）
  const savedTree = useMemo(() => {
    const appMap = new Map<string, { name: string; count: number; iconDataUrl?: string; hosts: Set<string>; flowIds: string[]; bundlePath?: string }>();
    const hostMap = new Map<string, { host: string; count: number; paths: [string, number][] }>();
    const hostPathMap = new Map<string, Map<string, number>>();
    for (const f of flows) {
      if (!savedIds[f.id]) continue;
      const appName = f.app?.name || '未知';
      const a = appMap.get(appName);
      if (a) {
        a.count++;
        a.hosts.add(f.request.host);
        a.flowIds.push(f.id);
      } else {
        appMap.set(appName, { name: appName, count: 1, iconDataUrl: f.app?.iconDataUrl, hosts: new Set([f.request.host]), flowIds: [f.id], bundlePath: f.app?.bundlePath });
      }
      const host = f.request.host;
      const h = hostMap.get(host);
      if (h) h.count++;
      else hostMap.set(host, { host, count: 1, paths: [] });
      const path = f.request.path.split('?')[0] || '/';
      if (!hostPathMap.has(host)) hostPathMap.set(host, new Map());
      const pm = hostPathMap.get(host)!;
      pm.set(path, (pm.get(path) || 0) + 1);
    }
    return { appList: [...appMap.values()], hostList: [...hostMap.values()], hostPathMap };
  }, [flows, savedIds]);

  // 已置顶 tree：apps / hosts（下含 pinnedPaths）。
  // - pinnedApps: 键为 app 名
  // - pinnedHosts: 键为 host 字符串
  // - pinnedPaths: 键为 `${host}${path前缀}`，例如 "api.demo.com/v1"
  const pinnedTree = useMemo(() => {
    const appList = Object.keys(pinnedApps).map((name) => {
      const meta = apps.find(([n]) => n === name)?.[1];
      return {
        name,
        count: meta?.count ?? 0,
        iconDataUrl: meta?.iconDataUrl,
        hosts: meta?.hosts ?? new Set<string>(),
        flowIds: meta?.flowIds ?? [],
        bundlePath: meta?.bundlePath,
      };
    });
    const hostList = Object.keys(pinnedHosts).map((host) => {
      const paths = Object.keys(pinnedPaths)
        .filter((p) => p.startsWith(host + '/'))
        .map((full) => ({ full, seg: full.slice(host.length) }));
      return { host, count: hosts.find(([h]) => h === host)?.[1] ?? 0, paths };
    });
    // orphan pinned paths（其 host 没被置顶）
    const orphanPaths = Object.keys(pinnedPaths)
      .filter((p) => {
        const slash = p.indexOf('/');
        const host = slash > 0 ? p.slice(0, slash) : p;
        return !pinnedHosts[host];
      })
      .map((full) => {
        const slash = full.indexOf('/');
        const host = slash > 0 ? full.slice(0, slash) : full;
        const seg = slash > 0 ? full.slice(slash) : '/';
        return { full, host, seg };
      });
    return { appList, hostList, orphanPaths };
  }, [pinnedApps, pinnedHosts, pinnedPaths, apps, hosts]);

  const deleteAppFlows = async (name: string, ids: string[]) => {
    for (const id of ids) removeFlow(id);
    for (const id of ids) {
      try { await window.proxybaby.flowRemove(id); } catch {}
    }
    if (filter.appName === name) setFilter({ appName: undefined });
  };

  const togglePinApp = (name: string) => {
    setPinnedApps((prev) => {
      const next = { ...prev };
      if (next[name]) delete next[name]; else next[name] = true;
      return next;
    });
  };

  const toggleMitmForApp = (hosts: Set<string>) => {
    // 判断该 app 所有 host 是否已全部禁用 → 若全部禁用则整体启用（清除黑名单），否则全部加入黑名单
    const allDisabled = [...hosts].every((h) => mitmDisabledHosts[h]);
    for (const h of hosts) {
      const currDisabled = !!mitmDisabledHosts[h];
      if (allDisabled) {
        if (currDisabled) {
          toggleMitmDisabledHost(h);
          window.proxybaby.mitmDisableHost(h, false);
        }
      } else if (!currDisabled) {
        toggleMitmDisabledHost(h);
        window.proxybaby.mitmDisableHost(h, true);
      }
    }
  };

  /**
   * 快速规则：无参数的立即写入（abort / CORS）；有参数的打开子窗口。
   * pattern 生成规则：host 右键 → `<host>`；subpath 右键 → `<host><path>*`。
   */
  const quickRulePresets: QuickRulePreset[] = [
    { key: 'abort',     label: '禁止访问',       kind: 'immediate', operator: 'abort',  value: '' },
    { key: 'cors',      label: '一键 CORS',      kind: 'immediate', operator: 'raw',    value: 'resHeaders://{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"*","Access-Control-Allow-Headers":"*","Access-Control-Expose-Headers":"*"}' },
    { key: 'mapLocal',  label: '本地映射…',      kind: 'input', operator: 'mapLocal',  inputKind: 'file',     placeholder: '本地文件绝对路径' },
    { key: 'mapRemote', label: '远程映射…',      kind: 'input', operator: 'mapRemote', inputKind: 'text',     placeholder: 'http://target.example.com' },
    { key: 'mock',      label: '返回 Mock JSON…', kind: 'input', operator: 'mock',      inputKind: 'textarea', placeholder: '{"key":"value"}' },
    { key: 'statusCode',label: '状态码替换…',    kind: 'input', operator: 'statusCode',inputKind: 'number',   placeholder: '如 404' },
    { key: 'resDelay',  label: '响应延迟…',      kind: 'input', operator: 'resDelay',  inputKind: 'number',   placeholder: '毫秒' },
    { key: 'resBody',   label: '重写响应体…',    kind: 'input', operator: 'resBody',   inputKind: 'textarea', placeholder: '响应体文本' },
  ];

  const applyQuickRule = async (pattern: string, preset: QuickRulePreset) => {
    if (preset.kind === 'immediate') {
      try {
        await window.proxybaby.rulesQuickAdd({ pattern, operator: preset.operator, value: preset.value });
      } catch {}
      return;
    }
    // 参数化：打开子窗口
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
  };

  const openCustomRule = async (pattern: string) => {
    try {
      await window.proxybaby.rulesQuickAddCustom({ pattern });
      // 切到规则页
      window.proxybaby.broadcast('nav:goto', { page: 'rules' });
    } catch {}
  };

  const revealInFinder = (bundlePath?: string) => {
    if (!bundlePath) return;
    window.proxybaby.showInFinder(bundlePath);
  };

  const deleteHostFlows = async (host: string, prefix?: string) => {
    const ids = flows.filter((f) => {
      if (f.request.host !== host) return false;
      if (prefix && !`${f.request.host}${f.request.path}`.startsWith(prefix)) return false;
      return true;
    }).map((f) => f.id);
    for (const id of ids) removeFlow(id);
    for (const id of ids) {
      try { await window.proxybaby.flowRemove(id); } catch {}
    }
    if (filter.host === host) setFilter({ host: undefined, pathPrefix: undefined });
  };

  /**
   * 把一条 app/host/url 快速加入 SSL 代理列表（"过滤配置 → SSL 代理列表"）。
   * 语义仅涉及"是否 MITM 解密 HTTPS"，不是"抓/不抓请求"：
   *   - mode='include' → SSL 列表切到"仅命中项 MITM"，其他域走透传（能访问，只是不抓包解密）
   *   - mode='exclude' → SSL 列表切到"命中项不 MITM"，其他域正常抓包
   * 已存在同 kind+value 时不重复追加。URL kind 默认按 glob 前缀（`prefix*`）匹配，仅在请求命中后生效。
   */
  const addToSslList = async (kind: FilterKind, value: string, mode: 'include' | 'exclude') => {
    try {
      const cur = await window.proxybaby.sslListGet();
      const val = kind === 'url' ? (value.endsWith('*') ? value : `${value}*`) : value;
      const exists = cur.entries.some((e) => e.kind === kind && e.value === val);
      const entries: FilterEntry[] = exists
        ? cur.entries
        : [
            ...cur.entries,
            { id: `sb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind, value: val, enabled: true,
              ...(kind === 'url' ? { urlMode: 'glob' as const } : {}) },
          ];
      await window.proxybaby.sslListSet({ enabled: true, mode, entries });
    } catch {}
  };

  /**
   * 把一条 app/host/url 加入抓包记录过滤（record filter）——**真正影响"抓/不抓"** 的过滤，对 HTTP + HTTPS 都生效。
   *   - mode='include' → record-filter 切到"仅记录列表"，命中项被记录，其余请求正常代理但不显示
   *   - mode='exclude' → record-filter 切到"排除列表"，命中项不显示，其余正常记录
   * 请求本身不会被阻止 —— 与 Allow/Block（会 abort）语义不同。
   */
  const addToRecordFilter = async (kind: FilterKind, value: string, mode: 'include' | 'exclude') => {
    try {
      const cur = await window.proxybaby.recordFilterGet();
      const val = kind === 'url' ? (value.endsWith('*') ? value : `${value}*`) : value;
      const exists = cur.entries.some((e) => e.kind === kind && e.value === val);
      const entries: FilterEntry[] = exists
        ? cur.entries
        : [
            ...cur.entries,
            { id: `sb-rf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind, value: val, enabled: true,
              ...(kind === 'url' ? { urlMode: 'glob' as const } : {}) },
          ];
      await window.proxybaby.recordFilterSet({ mode, entries });
    } catch {}
  };

  return (
    <div className="h-full bg-pb-sidebar flex flex-col" data-testid="sidebar">
      <div className="shrink-0 h-7 px-2 flex items-center justify-end border-b border-pb-border">
        <button
          data-testid="toggle-left-sidebar"
          onClick={() => useFlowStore.getState().toggleLeftSidebar()}
          className="p-1 rounded text-pb-muted hover:bg-pb-hover"
          title="收起左侧栏"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-scroll">
        <Section title="收藏夹" defaultOpen>
          <PinnedTree
            pinCount={pinCount}
            tree={pinnedTree}
            active={filter.special === 'pinned'}
            filter={filter}
            setFilter={setFilter}
            subpaths={subpaths}
            mitmDisabledHosts={mitmDisabledHosts}
            quickRulePresets={quickRulePresets}
            pinnedApps={pinnedApps}
            pinnedHosts={pinnedHosts}
            pinnedPaths={pinnedPaths}
            q={q}
            onTogglePinApp={togglePinApp}
            onTogglePinHost={togglePinHost}
            onTogglePinPath={togglePinPath}
            onToggleMitmForApp={(hostSet) => toggleMitmForApp(hostSet)}
            onToggleMitmHost={(host) => {
              const cur = !!mitmDisabledHosts[host];
              toggleMitmDisabledHost(host);
              window.proxybaby.mitmDisableHost(host, !cur);
            }}
            onAlphaSort={() => setAlphaSort((v) => !v)}
            onRevealApp={(bundlePath) => revealInFinder(bundlePath)}
            onDeleteApp={(name, ids) => deleteAppFlows(name, ids)}
            onDeleteHost={(host, prefix) => deleteHostFlows(host, prefix)}
            onAddRecord={(kind, value, mode) => addToRecordFilter(kind, value, mode)}
            onApplyQuickRule={applyQuickRule}
            onOpenCustomRule={openCustomRule}
          />
          <SavedTree
            saveCount={saveCount}
            tree={savedTree}
            active={filter.special === 'saved'}
            filter={filter}
            setFilter={setFilter}
            subpaths={subpaths}
            mitmDisabledHosts={mitmDisabledHosts}
            quickRulePresets={quickRulePresets}
            pinnedApps={pinnedApps}
            pinnedHosts={pinnedHosts}
            pinnedPaths={pinnedPaths}
            q={q}
            onTogglePinApp={togglePinApp}
            onTogglePinHost={togglePinHost}
            onTogglePinPath={togglePinPath}
            onToggleMitmForApp={(hostSet) => toggleMitmForApp(hostSet)}
            onToggleMitmHost={(host) => {
              const cur = !!mitmDisabledHosts[host];
              toggleMitmDisabledHost(host);
              window.proxybaby.mitmDisableHost(host, !cur);
            }}
            onAlphaSort={() => setAlphaSort((v) => !v)}
            onRevealApp={(bundlePath) => revealInFinder(bundlePath)}
            onDeleteApp={(name, ids) => deleteAppFlows(name, ids)}
            onDeleteHost={(host, prefix) => deleteHostFlows(host, prefix)}
            onAddRecord={(kind, value, mode) => addToRecordFilter(kind, value, mode)}
            onApplyQuickRule={applyQuickRule}
            onOpenCustomRule={openCustomRule}
          />
        </Section>

        <Section title={`应用程序 (${filteredApps.length}${q && filteredApps.length !== apps.length ? `/${apps.length}` : ''})`} defaultOpen>
          {filteredApps.map(([name, meta]) => {
            const allHostsMitmDisabled = [...meta.hosts].length > 0 && [...meta.hosts].every((h) => mitmDisabledHosts[h]);
            return (
              <AppContextMenu
                key={name}
                name={name}
                pinned={!!pinnedApps[name]}
                sslDisabled={allHostsMitmDisabled}
                onPin={() => togglePinApp(name)}
                onToggleSsl={() => toggleMitmForApp(meta.hosts)}
                onAlphaSort={() => setAlphaSort((v) => !v)}
                onReveal={() => revealInFinder(meta.bundlePath)}
                onDelete={() => deleteAppFlows(name, meta.flowIds)}
                onAddToList={(mode) => addToRecordFilter('app', name, mode)}
              >
                <Item
                  icon={meta.iconDataUrl
                    ? <img src={meta.iconDataUrl} alt="" className="w-3.5 h-3.5 rounded-[22%]" />
                    : <Package size={12} />}
                  label={name}
                  count={meta.count}
                  active={filter.appName === name}
                  pinned={!!pinnedApps[name]}
                  onClick={() => setFilter({ appName: filter.appName === name ? undefined : name, host: undefined, pathPrefix: undefined, special: undefined })}
                  query={q}
                />
              </AppContextMenu>
            );
          })}
          {q && filteredApps.length === 0 && (
            <div className="pl-6 pr-2 py-1 text-xs text-pb-muted italic">无匹配</div>
          )}
        </Section>

        <Section title={`域名 (${filteredHosts.length}${q && filteredHosts.length !== hosts.length ? `/${hosts.length}` : ''})`} defaultOpen>
          {filteredHosts.map(([host, count]) => (
            <HostItem
              key={host}
              host={host}
              count={count}
              subpaths={[...(subpaths.get(host)?.entries() || [])].sort((a, b) => b[1] - a[1])}
              filter={filter}
              setFilter={setFilter}
              query={q}
              sslDisabled={!!mitmDisabledHosts[host]}
              pinned={!!pinnedHosts[host]}
              onTogglePin={() => togglePinHost(host)}
              isPathPinned={(prefix) => !!pinnedPaths[prefix]}
              onTogglePinPath={togglePinPath}
              onToggleSsl={() => {
                const cur = !!mitmDisabledHosts[host];
                toggleMitmDisabledHost(host);
                window.proxybaby.mitmDisableHost(host, !cur);
              }}
              onAddToList={(mode) => addToRecordFilter('host', host, mode)}
              onAddUrlToList={(prefix, mode) => addToRecordFilter('url', prefix, mode)}
              onDeleteHost={() => deleteHostFlows(host)}
              onDeleteSubpath={(prefix) => deleteHostFlows(host, prefix)}
              quickRulePresets={quickRulePresets}
              onApplyQuickRule={applyQuickRule}
              onOpenCustomRule={openCustomRule}
            />
          ))}
          {q && filteredHosts.length === 0 && (
            <div className="pl-6 pr-2 py-1 text-xs text-pb-muted italic">无匹配</div>
          )}
        </Section>
      </div>
    </div>
  );
}

function AppContextMenu({
  name,
  pinned,
  sslDisabled,
  onPin,
  onToggleSsl,
  onAlphaSort,
  onReveal,
  onDelete,
  onAddToList,
  children,
}: {
  name: string;
  pinned: boolean;
  sslDisabled: boolean;
  onPin: () => void;
  onToggleSsl: () => void;
  onAlphaSort: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onAddToList: (mode: 'include' | 'exclude') => void;
  children: React.ReactNode;
}) {
  const itemCls = 'flex items-center px-3 py-1.5 outline-none cursor-default select-none text-pb-text hover:bg-pb-hover data-[highlighted]:bg-pb-hover';
  const destructiveCls = 'flex items-center px-3 py-1.5 outline-none cursor-default select-none text-pb-error hover:bg-pb-hover data-[highlighted]:bg-pb-hover';
  const trigCls = 'flex items-center px-3 py-1.5 text-pb-text hover:bg-pb-hover data-[state=open]:bg-pb-hover cursor-default outline-none';
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-[220px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
          <ContextMenu.Item onSelect={onPin} className={itemCls}>
            <Pin size={12} className="mr-2" />
            <span className="flex-1">{pinned ? '取消置顶' : '置顶'}</span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={onToggleSsl} className={itemCls}>
            <span className="flex-1">{sslDisabled ? '启用 SSL 代理' : '禁用 SSL 代理'}</span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={onAlphaSort} className={itemCls}>
            <span className="flex-1">按字母排序</span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={onReveal} className={itemCls}>
            <span className="flex-1">在访达中显示…</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
          <ContextMenu.Item onSelect={() => onAddToList('include')} className={itemCls}>
            <span className="flex-1">仅抓取此应用</span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onAddToList('exclude')} className={itemCls}>
            <span className="flex-1">抓包时排除此应用</span>
          </ContextMenu.Item>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={trigCls}>
              <span className="flex-1">工具</span>
              <span className="text-pb-muted">▸</span>
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="min-w-[180px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
                <ContextMenu.Item disabled className="flex items-center px-3 py-1.5 text-pb-muted/60">
                  即将支持
                </ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={trigCls}>
              <span className="flex-1">导出</span>
              <span className="text-pb-muted">▸</span>
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="min-w-[180px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
                <ContextMenu.Item className={itemCls} onSelect={() => window.proxybaby.sessionExport('proxybaby')}>
                  会话文件 (.proxybaby)
                </ContextMenu.Item>
                <ContextMenu.Item className={itemCls} onSelect={() => window.proxybaby.sessionExport('har')}>
                  HAR
                </ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
          <ContextMenu.Item onSelect={onDelete} className={destructiveCls}>
            <span className="flex-1">删除</span>
            <span className="ml-4 text-pb-muted text-xs font-mono">⌘⌫</span>
          </ContextMenu.Item>
          <div className="hidden">{name}</div>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function HostItem({
  host,
  count,
  subpaths,
  filter,
  setFilter,
  query,
  sslDisabled,
  pinned,
  onTogglePin,
  isPathPinned,
  onTogglePinPath,
  onToggleSsl,
  onAddToList,
  onAddUrlToList,
  onDeleteHost,
  onDeleteSubpath,
  quickRulePresets,
  onApplyQuickRule,
  onOpenCustomRule,
}: {
  host: string;
  count: number;
  subpaths: [string, number][];
  filter: any;
  setFilter: (p: any) => void;
  query?: string;
  sslDisabled: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  isPathPinned: (prefix: string) => boolean;
  onTogglePinPath: (prefix: string) => void;
  onToggleSsl: () => void;
  onAddToList: (mode: 'include' | 'exclude') => void;
  onAddUrlToList: (prefix: string, mode: 'include' | 'exclude') => void;
  onDeleteHost: () => void;
  onDeleteSubpath: (prefix: string) => void;
  quickRulePresets: QuickRulePreset[];
  onApplyQuickRule: (pattern: string, preset: QuickRulePreset) => void;
  onOpenCustomRule: (pattern: string) => void;
}) {
  // 若 host 未命中但仅子路径命中 → 默认展开以便看到匹配项
  const hostMatched = !query || host.toLowerCase().includes(query);
  const [open, setOpen] = useState(!!query && !hostMatched);
  const visibleSubs = query
    ? subpaths.filter(([seg]) => hostMatched || seg.toLowerCase().includes(query))
    : subpaths;
  const hostActive = filter.host === host && !filter.pathPrefix;
  return (
    <div>
      <HostContextMenu
        host={host}
        sslDisabled={sslDisabled}
        pinned={pinned}
        onTogglePin={onTogglePin}
        onToggleSsl={onToggleSsl}
        onAddRecord={onAddToList}
        onDelete={onDeleteHost}
        quickRulePresets={quickRulePresets}
        onApplyQuickRule={onApplyQuickRule}
        onOpenCustomRule={onOpenCustomRule}
      >
        <div
          data-testid="host-row"
          data-host={host}
          className={cn(
            'w-full flex items-center gap-1 pl-4 pr-2 py-1 text-sm cursor-default',
            // 选中项 hover 时也保持蓝底：把 hover 灰底只应用在未选中项
            hostActive ? 'bg-pb-selected text-white' : 'hover:bg-pb-hover',
          )}
          onClick={() => setFilter({ host: filter.host === host && !filter.pathPrefix ? undefined : host, pathPrefix: undefined, appName: undefined, special: undefined })}
        >
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            className="text-pb-muted shrink-0 cursor-default"
          >
            {subpaths.length > 1 ? (open ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : <span className="inline-block w-[11px]" />}
          </span>
          <Globe size={12} className={cn('shrink-0', hostActive ? 'text-white' : 'text-pb-muted')} />
          <span className="flex-1 truncate text-left">
            <Highlight text={host} query={query} />
          </span>
          <span className={cn('text-xs', hostActive ? 'text-white/80' : 'text-pb-muted')}>{count}</span>
        </div>
      </HostContextMenu>
      {open && (
        <SubpathTree
          host={host}
          paths={visibleSubs}
          basePrefix=""
          depth={0}
          filter={filter}
          setFilter={setFilter}
          query={query}
          isPathPinned={isPathPinned}
          onTogglePinPath={onTogglePinPath}
          onAddUrlToList={onAddUrlToList}
          onDeleteSubpath={onDeleteSubpath}
          quickRulePresets={quickRulePresets}
          onApplyQuickRule={onApplyQuickRule}
          onOpenCustomRule={onOpenCustomRule}
        />
      )}
    </div>
  );
}

/**
 * 递归子路径分组树：把 [(path, count), ...] 按下一段（下一段 slash 到 slash）聚合为节点，
 * 展开某节点后进入下一段继续下钻，直到到达叶子（无更深段）。
 * - basePrefix: 已下钻的路径前缀（用于生成 pathPrefix，如 host + basePrefix + seg）
 * - depth: 缩进用
 */
function SubpathTree({
  host,
  paths,
  basePrefix,
  depth,
  filter,
  setFilter,
  query,
  isPathPinned,
  onTogglePinPath,
  onAddUrlToList,
  onDeleteSubpath,
  quickRulePresets,
  onApplyQuickRule,
  onOpenCustomRule,
}: {
  host: string;
  paths: [string, number][]; // fullPath, count（fullPath 均以 basePrefix 开头）
  basePrefix: string;
  depth: number;
  filter: any;
  setFilter: (p: any) => void;
  query?: string;
  isPathPinned: (prefix: string) => boolean;
  onTogglePinPath: (prefix: string) => void;
  onAddUrlToList: (prefix: string, mode: 'include' | 'exclude') => void;
  onDeleteSubpath: (prefix: string) => void;
  quickRulePresets: QuickRulePreset[];
  onApplyQuickRule: (pattern: string, preset: QuickRulePreset) => void;
  onOpenCustomRule: (pattern: string) => void;
}) {
  // 分组：按 basePrefix 之后的下一个 `/xxx` 分段聚合
  const groups = useMemo(() => {
    const g = new Map<string, { total: number; children: [string, number][]; hasLeaf: boolean }>();
    for (const [fullPath, c] of paths) {
      const rest = fullPath.startsWith(basePrefix) ? fullPath.slice(basePrefix.length) : fullPath;
      // rest 形如 "/v2/chat" 或 "" (fullPath === basePrefix)
      if (rest === '' || rest === '/') {
        // 该路径本身就是当前层：加入 basePrefix 的 leaf count（虚拟）；这里把它归到一个特殊 "" seg
        const item = g.get('') || { total: 0, children: [], hasLeaf: false };
        item.total += c;
        item.hasLeaf = true;
        g.set('', item);
        continue;
      }
      // rest 首字符必然是 '/'
      const slashIdx = rest.indexOf('/', 1);
      const seg = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
      const item = g.get(seg) || { total: 0, children: [], hasLeaf: false };
      item.total += c;
      item.children.push([fullPath, c]);
      if (slashIdx === -1) item.hasLeaf = true;
      g.set(seg, item);
    }
    return [...g.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [paths, basePrefix]);

  return (
    <>
      {groups.map(([seg, info]) => {
        if (seg === '') return null; // basePrefix 自身，不重复渲染
        const prefix = `${host}${basePrefix}${seg}`;
        const active = filter.pathPrefix === prefix;
        // 该 group 只要孩子长度 > 1 或有更深 path 就可以再展开
        const canExpand = info.children.length > 1 || info.children.some(([p]) => p.length > prefix.length - host.length + 0 && p.replace(basePrefix + seg, '').length > 0);
        return (
          <SubpathNode
            key={prefix}
            host={host}
            prefix={prefix}
            basePrefix={basePrefix + seg}
            seg={seg}
            count={info.total}
            children={info.children}
            depth={depth}
            active={active}
            canExpand={canExpand}
            filter={filter}
            setFilter={setFilter}
            query={query}
            isPathPinned={isPathPinned}
            onTogglePinPath={onTogglePinPath}
            onAddUrlToList={onAddUrlToList}
            onDeleteSubpath={onDeleteSubpath}
            quickRulePresets={quickRulePresets}
            onApplyQuickRule={onApplyQuickRule}
            onOpenCustomRule={onOpenCustomRule}
          />
        );
      })}
    </>
  );
}

function SubpathNode({
  host,
  prefix,
  basePrefix,
  seg,
  count,
  children,
  depth,
  active,
  canExpand,
  filter,
  setFilter,
  query,
  isPathPinned,
  onTogglePinPath,
  onAddUrlToList,
  onDeleteSubpath,
  quickRulePresets,
  onApplyQuickRule,
  onOpenCustomRule,
}: {
  host: string;
  prefix: string;
  basePrefix: string;
  seg: string;
  count: number;
  children: [string, number][];
  depth: number;
  active: boolean;
  canExpand: boolean;
  filter: any;
  setFilter: (p: any) => void;
  query?: string;
  isPathPinned: (prefix: string) => boolean;
  onTogglePinPath: (prefix: string) => void;
  onAddUrlToList: (prefix: string, mode: 'include' | 'exclude') => void;
  onDeleteSubpath: (prefix: string) => void;
  quickRulePresets: QuickRulePreset[];
  onApplyQuickRule: (pattern: string, preset: QuickRulePreset) => void;
  onOpenCustomRule: (pattern: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // 缩进：depth 0 → pl-10（对齐旧样式），每深一层 +pl-4
  const padLeftPx = 40 + depth * 12;
  return (
    <>
      <SubpathContextMenu
        prefix={prefix}
        pinned={isPathPinned(prefix)}
        onTogglePin={() => onTogglePinPath(prefix)}
        onAddRecord={(mode) => onAddUrlToList(prefix, mode)}
        onDelete={() => onDeleteSubpath(prefix)}
        quickRulePresets={quickRulePresets}
        onApplyQuickRule={onApplyQuickRule}
        onOpenCustomRule={onOpenCustomRule}
      >
        <div
          data-testid="subpath-item"
          data-prefix={prefix}
          className={cn(
            'w-full flex items-center gap-1 pr-2 py-1 text-xs cursor-default',
            active ? 'bg-pb-selected text-white' : 'hover:bg-pb-hover',
          )}
          style={{ paddingLeft: padLeftPx }}
          onClick={() =>
            setFilter({
              host,
              pathPrefix: filter.pathPrefix === prefix ? undefined : prefix,
              appName: undefined,
              special: undefined,
            })
          }
        >
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            className={cn('shrink-0 cursor-default', active ? 'text-white' : 'text-pb-muted')}
          >
            {canExpand ? (open ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : <span className="inline-block w-[11px]" />}
          </span>
          <span className="flex-1 truncate text-left font-mono">
            <Highlight text={seg} query={query} />
          </span>
          <span className={cn(active ? 'text-white/80' : 'text-pb-muted')}>{count}</span>
        </div>
      </SubpathContextMenu>
      {open && canExpand && (
        <SubpathTree
          host={host}
          paths={children}
          basePrefix={basePrefix}
          depth={depth + 1}
          filter={filter}
          setFilter={setFilter}
          query={query}
          isPathPinned={isPathPinned}
          onTogglePinPath={onTogglePinPath}
          onAddUrlToList={onAddUrlToList}
          onDeleteSubpath={onDeleteSubpath}
          quickRulePresets={quickRulePresets}
          onApplyQuickRule={onApplyQuickRule}
          onOpenCustomRule={onOpenCustomRule}
        />
      )}
    </>
  );
}

/** 域名（host）行的右键菜单。 */
function HostContextMenu({
  host,
  sslDisabled,
  pinned,
  onTogglePin,
  onToggleSsl,
  onAddRecord,
  onDelete,
  quickRulePresets,
  onApplyQuickRule,
  onOpenCustomRule,
  children,
}: {
  host: string;
  sslDisabled: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onToggleSsl: () => void;
  onAddRecord: (mode: 'include' | 'exclude') => void;
  onDelete: () => void;
  quickRulePresets: QuickRulePreset[];
  onApplyQuickRule: (pattern: string, preset: QuickRulePreset) => void;
  onOpenCustomRule: (pattern: string) => void;
  children: React.ReactNode;
}) {
  const itemCls = 'flex items-center px-3 py-1.5 outline-none cursor-default select-none text-pb-text hover:bg-pb-hover data-[highlighted]:bg-pb-hover';
  const destructiveCls = 'flex items-center px-3 py-1.5 outline-none cursor-default select-none text-pb-error hover:bg-pb-hover data-[highlighted]:bg-pb-hover';
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-[220px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
          <ContextMenu.Item onSelect={onTogglePin} className={itemCls}>
            <span className="flex-1">{pinned ? '取消置顶此域名' : '置顶此域名'}</span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={onToggleSsl} className={itemCls}>
            <span className="flex-1">{sslDisabled ? '启用 SSL 解密' : '禁用 SSL 解密'}</span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => navigator.clipboard?.writeText(host).catch(() => {})} className={itemCls}>
            <span className="flex-1">复制域名</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
          <ContextMenu.Item onSelect={() => onAddRecord('include')} className={itemCls}>
            <span className="flex-1">仅抓取此域名</span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onAddRecord('exclude')} className={itemCls}>
            <span className="flex-1">抓包时排除此域名</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
          <QuickRuleSubMenu
            pattern={host}
            presets={quickRulePresets}
            onApply={onApplyQuickRule}
            onOpenCustom={onOpenCustomRule}
          />
          <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
          <ContextMenu.Item onSelect={onDelete} className={destructiveCls}>
            <span className="flex-1">删除该域下所有请求</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** URL 前缀（subpath）行的右键菜单。 */
function SubpathContextMenu({
  prefix,
  pinned,
  onTogglePin,
  onAddRecord,
  onDelete,
  quickRulePresets,
  onApplyQuickRule,
  onOpenCustomRule,
  children,
}: {
  prefix: string;
  pinned: boolean;
  onTogglePin: () => void;
  onAddRecord: (mode: 'include' | 'exclude') => void;
  onDelete: () => void;
  quickRulePresets: QuickRulePreset[];
  onApplyQuickRule: (pattern: string, preset: QuickRulePreset) => void;
  onOpenCustomRule: (pattern: string) => void;
  children: React.ReactNode;
}) {
  const itemCls = 'flex items-center px-3 py-1.5 outline-none cursor-default select-none text-pb-text hover:bg-pb-hover data-[highlighted]:bg-pb-hover';
  const destructiveCls = 'flex items-center px-3 py-1.5 outline-none cursor-default select-none text-pb-error hover:bg-pb-hover data-[highlighted]:bg-pb-hover';
  // subpath 的 pattern：加 `*` 后缀作为 URL glob
  const pattern = prefix.endsWith('*') ? prefix : `${prefix}*`;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-[220px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
          <ContextMenu.Item onSelect={onTogglePin} className={itemCls}>
            <span className="flex-1">{pinned ? '取消置顶此路径' : '置顶此路径'}</span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => navigator.clipboard?.writeText(prefix).catch(() => {})} className={itemCls}>
            <span className="flex-1">复制 URL 前缀</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
          <ContextMenu.Item onSelect={() => onAddRecord('include')} className={itemCls}>
            <span className="flex-1">仅抓取此路径</span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onAddRecord('exclude')} className={itemCls}>
            <span className="flex-1">抓包时排除此路径</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
          <QuickRuleSubMenu
            pattern={pattern}
            presets={quickRulePresets}
            onApply={onApplyQuickRule}
            onOpenCustom={onOpenCustomRule}
          />
          <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
          <ContextMenu.Item onSelect={onDelete} className={destructiveCls}>
            <span className="flex-1">删除该前缀下所有请求</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** 快速规则子菜单（host / subpath 共用）*/
type QuickRulePreset = {
  key: string;
  label: string;
} & (
  | { kind: 'immediate'; operator: string; value: string }
  | { kind: 'input'; operator: 'mapLocal' | 'mapRemote' | 'mock' | 'statusCode' | 'resDelay' | 'resBody'; inputKind: 'text' | 'textarea' | 'number' | 'file'; placeholder?: string }
);

function QuickRuleSubMenu({
  pattern,
  presets,
  onApply,
  onOpenCustom,
}: {
  pattern: string;
  presets: QuickRulePreset[];
  onApply: (pattern: string, preset: QuickRulePreset) => void;
  onOpenCustom: (pattern: string) => void;
}) {
  const itemCls = 'flex items-center px-3 py-1.5 outline-none cursor-default select-none text-pb-text hover:bg-pb-hover data-[highlighted]:bg-pb-hover';
  const trigCls = 'flex items-center px-3 py-1.5 text-pb-text hover:bg-pb-hover data-[state=open]:bg-pb-hover cursor-default outline-none';
  // 匹配此 pattern 的已有临时规则集，用于展示状态 + 切换启停 / 删除
  const [existing, setExisting] = useState<{ id: string; name: string; enabled: boolean }[]>([]);
  const refresh = async () => {
    try {
      const list = await window.proxybaby.rulesList();
      const hit = list
        .filter((rs: any) => rs.temporary && rs.rules?.some((r: any) => r.pattern === pattern))
        .map((rs: any) => ({ id: rs.id, name: rs.name, enabled: rs.enabled }));
      setExisting(hit);
    } catch {}
  };
  useEffect(() => {
    refresh();
    const off = window.proxybaby.onEvent('rules:changed' as any, () => refresh());
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern]);
  const toggle = async (id: string, enabled: boolean) => {
    try { await window.proxybaby.rulesSetEnabled(id, !enabled); } catch {}
  };
  const remove = async (id: string) => {
    try { await window.proxybaby.rulesRemove(id); } catch {}
  };
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className={trigCls}>
        <span className="flex-1">
          快速规则
          {existing.length > 0 && (
            <span className="ml-2 text-[10px] text-pb-accent">
              ({existing.filter((r) => r.enabled).length}/{existing.length} 生效)
            </span>
          )}
        </span>
        <span className="text-pb-muted">▸</span>
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent className="min-w-[240px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
          {existing.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-pb-muted">已有规则</div>
              {existing.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 px-3 py-1 hover:bg-pb-hover cursor-default select-none"
                  data-testid={`quick-rule-existing-${r.id}`}
                >
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => toggle(r.id, r.enabled)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span
                    className={cn('flex-1 truncate', r.enabled ? 'text-pb-text' : 'text-pb-muted line-through')}
                    title={r.name}
                    onClick={() => toggle(r.id, r.enabled)}
                  >
                    {r.name.replace(/^\[临时\]\s*/, '')}
                  </span>
                  <button
                    className="text-pb-muted hover:text-pb-error"
                    title="删除此规则"
                    onClick={(e) => { e.stopPropagation(); remove(r.id); }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-pb-muted">新增</div>
            </>
          )}
          {presets.map((p) => (
            <ContextMenu.Item
              key={p.key}
              className={itemCls}
              onSelect={() => onApply(pattern, p)}
              data-testid={`quick-rule-${p.key}`}
            >
              <span className="flex-1">{p.label}</span>
            </ContextMenu.Item>
          ))}
          <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => onOpenCustom(pattern)}
            data-testid="quick-rule-custom"
          >
            <span className="flex-1">自定义规则…</span>
          </ContextMenu.Item>
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}


function PinnedTree({
  pinCount,
  tree,
  active,
  filter,
  setFilter,
  subpaths,
  mitmDisabledHosts,
  quickRulePresets,
  pinnedApps,
  pinnedHosts,
  pinnedPaths,
  q,
  onTogglePinApp,
  onTogglePinHost,
  onTogglePinPath,
  onToggleMitmForApp,
  onToggleMitmHost,
  onAlphaSort,
  onRevealApp,
  onDeleteApp,
  onDeleteHost,
  onAddRecord,
  onApplyQuickRule,
  onOpenCustomRule,
}: {
  pinCount: number;
  tree: {
    appList: { name: string; count: number; iconDataUrl?: string; hosts: Set<string>; flowIds: string[]; bundlePath?: string }[];
    hostList: { host: string; count: number; paths: { full: string; seg: string }[] }[];
    orphanPaths: { full: string; host: string; seg: string }[];
  };
  active: boolean;
  filter: { special?: 'pinned' | 'saved'; host?: string; appName?: string; pathPrefix?: string };
  setFilter: (patch: any) => void;
  subpaths: Map<string, Map<string, number>>;
  mitmDisabledHosts: Record<string, true>;
  quickRulePresets: QuickRulePreset[];
  pinnedApps: Record<string, true>;
  pinnedHosts: Record<string, true>;
  pinnedPaths: Record<string, true>;
  q: string;
  onTogglePinApp: (name: string) => void;
  onTogglePinHost: (host: string) => void;
  onTogglePinPath: (prefix: string) => void;
  onToggleMitmForApp: (hosts: Set<string>) => void;
  onToggleMitmHost: (host: string) => void;
  onAlphaSort: () => void;
  onRevealApp: (bundlePath?: string) => void;
  onDeleteApp: (name: string, flowIds: string[]) => void;
  onDeleteHost: (host: string, prefix?: string) => void;
  onAddRecord: (kind: FilterKind, value: string, mode: 'include' | 'exclude') => void;
  onApplyQuickRule: (pattern: string, preset: QuickRulePreset) => void;
  onOpenCustomRule: (pattern: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [openApp, setOpenApp] = useState<Record<string, boolean>>({});
  const empty = tree.appList.length === 0 && tree.hostList.length === 0 && tree.orphanPaths.length === 0;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div
        data-testid="pinned-tree-header"
        className={cn(
          'w-full flex items-center gap-1 pl-1 pr-2 py-1 text-sm cursor-default select-none',
          active ? 'bg-pb-selected text-white' : 'hover:bg-pb-hover',
        )}
      >
        <Collapsible.Trigger asChild>
          <button
            className={cn('p-0.5 rounded', active ? 'text-white' : 'text-pb-muted')}
            disabled={empty}
            data-testid="pinned-tree-toggle"
            onClick={(e) => e.stopPropagation()}
          >
            {empty ? <span className="inline-block w-3" /> : open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </Collapsible.Trigger>
        <div
          className="flex-1 flex items-center gap-1.5"
          onClick={() =>
            setFilter({
              special: filter.special === 'pinned' ? undefined : 'pinned',
              host: undefined,
              appName: undefined,
              pathPrefix: undefined,
            })
          }
        >
          <Pin size={12} className={active ? 'text-white' : 'text-pb-muted'} />
          <span className="flex-1 truncate text-left">已置顶</span>
          <span className={cn('text-xs', active ? 'text-white/80' : 'text-pb-muted')}>{pinCount}</span>
        </div>
      </div>
      <Collapsible.Content>
        {tree.appList.map((a) => {
          const isActive = filter.appName === a.name;
          const allHostsMitmDisabled = [...a.hosts].length > 0 && [...a.hosts].every((h) => mitmDisabledHosts[h]);
          const isOpen = openApp[a.name] ?? true;
          const hostList = [...a.hosts];
          return (
            <div key={`pinned-app:${a.name}`}>
              <AppContextMenu
                name={a.name}
                pinned={!!pinnedApps[a.name]}
                sslDisabled={allHostsMitmDisabled}
                onPin={() => onTogglePinApp(a.name)}
                onToggleSsl={() => onToggleMitmForApp(a.hosts)}
                onAlphaSort={onAlphaSort}
                onReveal={() => onRevealApp(a.bundlePath)}
                onDelete={() => onDeleteApp(a.name, a.flowIds)}
                onAddToList={(mode) => onAddRecord('app', a.name, mode)}
              >
                <div
                  data-testid="pinned-app-row"
                  data-app={a.name}
                  className={cn(
                    'w-full flex items-center gap-1 pl-6 pr-2 py-1 text-sm cursor-default select-none',
                    isActive ? 'bg-pb-selected text-white' : 'hover:bg-pb-hover',
                  )}
                >
                  <button
                    className={cn('p-0.5 rounded', isActive ? 'text-white' : 'text-pb-muted')}
                    disabled={hostList.length === 0}
                    onClick={(e) => { e.stopPropagation(); setOpenApp((s) => ({ ...s, [a.name]: !isOpen })); }}
                  >
                    {hostList.length === 0 ? <span className="inline-block w-3" /> : isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  <div
                    className="flex-1 flex items-center gap-1.5 min-w-0"
                    onClick={() =>
                      setFilter({
                        appName: isActive ? undefined : a.name,
                        host: undefined,
                        pathPrefix: undefined,
                        special: isActive ? undefined : filter.special,
                      })
                    }
                  >
                    {a.iconDataUrl ? (
                      <img src={a.iconDataUrl} alt="" className="w-3.5 h-3.5 rounded-[22%]" />
                    ) : (
                      <Package size={12} className={isActive ? 'text-white' : 'text-pb-muted'} />
                    )}
                    <span className="flex-1 truncate text-left">{a.name}</span>
                    <Pin size={10} className={isActive ? 'text-white' : 'text-pb-accent'} />
                    <span className={cn('text-xs', isActive ? 'text-white/80' : 'text-pb-muted')}>{a.count}</span>
                  </div>
                </div>
              </AppContextMenu>
              {isOpen && hostList.map((host) => (
                <div key={`pinned-app-host:${a.name}:${host}`} className="pl-4">
                  <HostItem
                    host={host}
                    count={subpaths.get(host) ? [...subpaths.get(host)!.values()].reduce((a, b) => a + b, 0) : 0}
                    subpaths={[...(subpaths.get(host)?.entries() || [])].sort((a, b) => b[1] - a[1])}
                    filter={filter}
                    setFilter={setFilter}
                    query={q}
                    sslDisabled={!!mitmDisabledHosts[host]}
                    pinned={!!pinnedHosts[host]}
                    onTogglePin={() => onTogglePinHost(host)}
                    isPathPinned={(prefix) => !!pinnedPaths[prefix]}
                    onTogglePinPath={onTogglePinPath}
                    onToggleSsl={() => onToggleMitmHost(host)}
                    onAddToList={(mode) => onAddRecord('host', host, mode)}
                    onAddUrlToList={(prefix, mode) => onAddRecord('url', prefix, mode)}
                    onDeleteHost={() => onDeleteHost(host)}
                    onDeleteSubpath={(prefix) => onDeleteHost(host, prefix)}
                    quickRulePresets={quickRulePresets}
                    onApplyQuickRule={onApplyQuickRule}
                    onOpenCustomRule={onOpenCustomRule}
                  />
                </div>
              ))}
            </div>
          );
        })}
        {tree.hostList.map((h) => (
          <HostItem
            key={`pinned-host:${h.host}`}
            host={h.host}
            count={h.count}
            subpaths={[...(subpaths.get(h.host)?.entries() || [])].sort((a, b) => b[1] - a[1])}
            filter={filter}
            setFilter={setFilter}
            query={q}
            sslDisabled={!!mitmDisabledHosts[h.host]}
            pinned={!!pinnedHosts[h.host]}
            onTogglePin={() => onTogglePinHost(h.host)}
            isPathPinned={(prefix) => !!pinnedPaths[prefix]}
            onTogglePinPath={onTogglePinPath}
            onToggleSsl={() => onToggleMitmHost(h.host)}
            onAddToList={(mode) => onAddRecord('host', h.host, mode)}
            onAddUrlToList={(prefix, mode) => onAddRecord('url', prefix, mode)}
            onDeleteHost={() => onDeleteHost(h.host)}
            onDeleteSubpath={(prefix) => onDeleteHost(h.host, prefix)}
            quickRulePresets={quickRulePresets}
            onApplyQuickRule={onApplyQuickRule}
            onOpenCustomRule={onOpenCustomRule}
          />
        ))}
        {tree.orphanPaths.map((p) => (
          <HostItem
            key={`orphan-host:${p.host}:${p.full}`}
            host={p.host}
            count={subpaths.get(p.host) ? [...subpaths.get(p.host)!.values()].reduce((a, b) => a + b, 0) : 0}
            subpaths={[...(subpaths.get(p.host)?.entries() || [])].sort((a, b) => b[1] - a[1])}
            filter={filter}
            setFilter={setFilter}
            query={q}
            sslDisabled={!!mitmDisabledHosts[p.host]}
            pinned={!!pinnedHosts[p.host]}
            onTogglePin={() => onTogglePinHost(p.host)}
            isPathPinned={(prefix) => !!pinnedPaths[prefix]}
            onTogglePinPath={onTogglePinPath}
            onToggleSsl={() => onToggleMitmHost(p.host)}
            onAddToList={(mode) => onAddRecord('host', p.host, mode)}
            onAddUrlToList={(prefix, mode) => onAddRecord('url', prefix, mode)}
            onDeleteHost={() => onDeleteHost(p.host)}
            onDeleteSubpath={(prefix) => onDeleteHost(p.host, prefix)}
            quickRulePresets={quickRulePresets}
            onApplyQuickRule={onApplyQuickRule}
            onOpenCustomRule={onOpenCustomRule}
          />
        ))}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}


function SavedTree({
  saveCount,
  tree,
  active,
  filter,
  setFilter,
  subpaths,
  mitmDisabledHosts,
  quickRulePresets,
  pinnedApps,
  pinnedHosts,
  pinnedPaths,
  q,
  onTogglePinApp,
  onTogglePinHost,
  onTogglePinPath,
  onToggleMitmForApp,
  onToggleMitmHost,
  onAlphaSort,
  onRevealApp,
  onDeleteApp,
  onDeleteHost,
  onAddRecord,
  onApplyQuickRule,
  onOpenCustomRule,
}: {
  saveCount: number;
  tree: {
    appList: { name: string; count: number; iconDataUrl?: string; hosts: Set<string>; flowIds: string[]; bundlePath?: string }[];
    hostList: { host: string; count: number }[];
    hostPathMap: Map<string, Map<string, number>>;
  };
  active: boolean;
  filter: { special?: 'pinned' | 'saved'; host?: string; appName?: string; pathPrefix?: string };
  setFilter: (patch: any) => void;
  subpaths: Map<string, Map<string, number>>;
  mitmDisabledHosts: Record<string, true>;
  quickRulePresets: QuickRulePreset[];
  pinnedApps: Record<string, true>;
  pinnedHosts: Record<string, true>;
  pinnedPaths: Record<string, true>;
  q: string;
  onTogglePinApp: (name: string) => void;
  onTogglePinHost: (host: string) => void;
  onTogglePinPath: (prefix: string) => void;
  onToggleMitmForApp: (hosts: Set<string>) => void;
  onToggleMitmHost: (host: string) => void;
  onAlphaSort: () => void;
  onRevealApp: (bundlePath?: string) => void;
  onDeleteApp: (name: string, flowIds: string[]) => void;
  onDeleteHost: (host: string, prefix?: string) => void;
  onAddRecord: (kind: FilterKind, value: string, mode: 'include' | 'exclude') => void;
  onApplyQuickRule: (pattern: string, preset: QuickRulePreset) => void;
  onOpenCustomRule: (pattern: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [openApp, setOpenApp] = useState<Record<string, boolean>>({});
  const empty = tree.appList.length === 0 && tree.hostList.length === 0;
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div
        data-testid="saved-tree-header"
        className={cn(
          'w-full flex items-center gap-1 pl-1 pr-2 py-1 text-sm cursor-default select-none',
          active ? 'bg-pb-selected text-white' : 'hover:bg-pb-hover',
        )}
      >
        <Collapsible.Trigger asChild>
          <button
            className={cn('p-0.5 rounded', active ? 'text-white' : 'text-pb-muted')}
            disabled={empty}
            onClick={(e) => e.stopPropagation()}
          >
            {empty ? <span className="inline-block w-3" /> : open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </Collapsible.Trigger>
        <div
          className="flex-1 flex items-center gap-1.5"
          onClick={() =>
            setFilter({
              special: filter.special === 'saved' ? undefined : 'saved',
              host: undefined,
              appName: undefined,
              pathPrefix: undefined,
            })
          }
        >
          <Bookmark size={12} className={active ? 'text-white' : 'text-pb-muted'} />
          <span className="flex-1 truncate text-left">Saved</span>
          <span className={cn('text-xs', active ? 'text-white/80' : 'text-pb-muted')}>{saveCount}</span>
        </div>
      </div>
      <Collapsible.Content>
        {tree.appList.map((a) => {
          const isActive = filter.appName === a.name;
          const allHostsMitmDisabled = [...a.hosts].length > 0 && [...a.hosts].every((h) => mitmDisabledHosts[h]);
          const isOpen = openApp[a.name] ?? true;
          const hostList = [...a.hosts];
          return (
            <div key={`saved-app:${a.name}`}>
              <AppContextMenu
                name={a.name}
                pinned={!!pinnedApps[a.name]}
                sslDisabled={allHostsMitmDisabled}
                onPin={() => onTogglePinApp(a.name)}
                onToggleSsl={() => onToggleMitmForApp(a.hosts)}
                onAlphaSort={onAlphaSort}
                onReveal={() => onRevealApp(a.bundlePath)}
                onDelete={() => onDeleteApp(a.name, a.flowIds)}
                onAddToList={(mode) => onAddRecord('app', a.name, mode)}
              >
                <div
                  data-testid="saved-app-row"
                  data-app={a.name}
                  className={cn(
                    'w-full flex items-center gap-1 pl-6 pr-2 py-1 text-sm cursor-default select-none',
                    isActive ? 'bg-pb-selected text-white' : 'hover:bg-pb-hover',
                  )}
                >
                  <button
                    className={cn('p-0.5 rounded', isActive ? 'text-white' : 'text-pb-muted')}
                    disabled={hostList.length === 0}
                    onClick={(e) => { e.stopPropagation(); setOpenApp((s) => ({ ...s, [a.name]: !isOpen })); }}
                  >
                    {hostList.length === 0 ? <span className="inline-block w-3" /> : isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  <div
                    className="flex-1 flex items-center gap-1.5 min-w-0"
                    onClick={() =>
                      setFilter({
                        appName: isActive ? undefined : a.name,
                        host: undefined,
                        pathPrefix: undefined,
                        special: isActive ? undefined : filter.special,
                      })
                    }
                  >
                    {a.iconDataUrl ? (
                      <img src={a.iconDataUrl} alt="" className="w-3.5 h-3.5 rounded-[22%]" />
                    ) : (
                      <Package size={12} className={isActive ? 'text-white' : 'text-pb-muted'} />
                    )}
                    <span className="flex-1 truncate text-left">{a.name}</span>
                    <span className={cn('text-xs', isActive ? 'text-white/80' : 'text-pb-muted')}>{a.count}</span>
                  </div>
                </div>
              </AppContextMenu>
              {isOpen && hostList.map((host) => (
                <div key={`saved-app-host:${a.name}:${host}`} className="pl-4">
                  <HostItem
                    host={host}
                    count={tree.hostPathMap.get(host)
                      ? [...tree.hostPathMap.get(host)!.values()].reduce((a, b) => a + b, 0)
                      : 0}
                    subpaths={[...(tree.hostPathMap.get(host)?.entries() || [])].sort((a, b) => b[1] - a[1])}
                    filter={filter}
                    setFilter={setFilter}
                    query={q}
                    sslDisabled={!!mitmDisabledHosts[host]}
                    pinned={!!pinnedHosts[host]}
                    onTogglePin={() => onTogglePinHost(host)}
                    isPathPinned={(prefix) => !!pinnedPaths[prefix]}
                    onTogglePinPath={onTogglePinPath}
                    onToggleSsl={() => onToggleMitmHost(host)}
                    onAddToList={(mode) => onAddRecord('host', host, mode)}
                    onAddUrlToList={(prefix, mode) => onAddRecord('url', prefix, mode)}
                    onDeleteHost={() => onDeleteHost(host)}
                    onDeleteSubpath={(prefix) => onDeleteHost(host, prefix)}
                    quickRulePresets={quickRulePresets}
                    onApplyQuickRule={onApplyQuickRule}
                    onOpenCustomRule={onOpenCustomRule}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}


function Section({
  title,
  children,
  defaultOpen,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger asChild>
        <button className="w-full flex items-center gap-1 px-2 py-1 text-xs text-pb-muted uppercase tracking-wide hover:bg-pb-hover">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{title}</span>
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

function Item({
  icon,
  label,
  count,
  active,
  pinned,
  onClick,
  query,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  pinned?: boolean;
  onClick?: () => void;
  query?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-1.5 pl-6 pr-2 py-1 text-sm cursor-default select-none',
        // 选中项 hover 时也保持蓝底：hover 灰底只在未选中时应用
        active ? 'bg-pb-selected text-white' : 'hover:bg-pb-hover',
      )}
    >
      <span className={cn(active ? 'text-white' : 'text-pb-muted')}>{icon}</span>
      <span className="flex-1 truncate text-left">
        <Highlight text={label} query={query} />
      </span>
      {pinned && <Pin size={10} className={cn(active ? 'text-white' : 'text-pb-accent')} />}
      {count !== undefined && <span className={cn('text-xs', active ? 'text-white/80' : 'text-pb-muted')}>{count}</span>}
    </div>
  );
}

/** 在 text 中高亮 query（大小写不敏感），命中片段渲染为浅色背景 */
function Highlight({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(q, i);
  let k = 0;
  while (idx !== -1) {
    if (idx > i) parts.push(<span key={`t-${k++}`}>{text.slice(i, idx)}</span>);
    parts.push(
      <mark key={`m-${k++}`} className="bg-pb-accent/30 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
    idx = lower.indexOf(q, i);
  }
  if (i < text.length) parts.push(<span key={`t-${k++}`}>{text.slice(i)}</span>);
  return <>{parts}</>;
}
