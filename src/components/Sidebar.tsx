import { useMemo, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ChevronDown, ChevronRight, Globe, Package, Pin, Bookmark, PanelLeftClose } from 'lucide-react';
import { useFlowStore } from '../store/flows';
import { cn } from '../lib/cn';

export function Sidebar() {
  const flows = useFlowStore((s) => s.flows);
  const filter = useFlowStore((s) => s.filter);
  const setFilter = useFlowStore((s) => s.setFilter);
  const pinnedIds = useFlowStore((s) => s.pinnedIds);
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
      const seg = '/' + (f.request.path.split('?')[0].split('/').filter(Boolean)[0] || '');
      if (!subMap.has(f.request.host)) subMap.set(f.request.host, new Map());
      const m = subMap.get(f.request.host)!;
      m.set(seg, (m.get(seg) || 0) + 1);
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

  const pinCount = Object.keys(pinnedIds).length;
  const saveCount = Object.keys(savedIds).length;

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

  const revealInFinder = (bundlePath?: string) => {
    if (!bundlePath) return;
    window.proxybaby.showInFinder(bundlePath);
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
          <Item
            icon={<Pin size={12} />}
            label="已置顶"
            count={pinCount}
            active={filter.special === 'pinned'}
            onClick={() => setFilter({ special: filter.special === 'pinned' ? undefined : 'pinned', host: undefined, appName: undefined, pathPrefix: undefined })}
            query={q}
          />
          <Item
            icon={<Bookmark size={12} />}
            label="Saved"
            count={saveCount}
            active={filter.special === 'saved'}
            onClick={() => setFilter({ special: filter.special === 'saved' ? undefined : 'saved', host: undefined, appName: undefined, pathPrefix: undefined })}
            query={q}
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
            <span className="ml-4 text-pb-muted text-[11px] font-mono">⌘⌫</span>
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
}: {
  host: string;
  count: number;
  subpaths: [string, number][];
  filter: any;
  setFilter: (p: any) => void;
  query?: string;
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
      <div className={cn('w-full flex items-center gap-1 pl-4 pr-2 py-1 text-sm hover:bg-pb-hover', hostActive && 'bg-pb-selected text-white')}>
        <button onClick={() => setOpen((o) => !o)} className="text-pb-muted shrink-0">
          {subpaths.length > 1 ? (open ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : <span className="inline-block w-[11px]" />}
        </button>
        <Globe size={12} className="text-pb-muted shrink-0" />
        <button
          className="flex-1 truncate text-left"
          onClick={() => setFilter({ host: filter.host === host && !filter.pathPrefix ? undefined : host, pathPrefix: undefined, appName: undefined, special: undefined })}
        >
          <Highlight text={host} query={query} />
        </button>
        <span className="text-xs text-pb-muted">{count}</span>
      </div>
      {open && visibleSubs.map(([seg, c]) => {
        const prefix = `${host}${seg}`;
        return (
          <button
            key={seg}
            data-testid="subpath-item"
            className={cn('w-full flex items-center gap-1.5 pl-10 pr-2 py-1 text-xs hover:bg-pb-hover', filter.pathPrefix === prefix && 'bg-pb-selected text-white')}
            onClick={() => setFilter({ host, pathPrefix: filter.pathPrefix === prefix ? undefined : prefix, appName: undefined, special: undefined })}
          >
            <span className="flex-1 truncate text-left font-mono">
              <Highlight text={seg} query={query} />
            </span>
            <span className="text-pb-muted">{c}</span>
          </button>
        );
      })}
    </div>
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
        'w-full flex items-center gap-1.5 pl-6 pr-2 py-1 text-sm hover:bg-pb-hover cursor-default select-none',
        active && 'bg-pb-selected text-white',
      )}
    >
      <span className="text-pb-muted">{icon}</span>
      <span className="flex-1 truncate text-left">
        <Highlight text={label} query={query} />
      </span>
      {pinned && <Pin size={10} className="text-pb-accent" />}
      {count !== undefined && <span className="text-xs text-pb-muted">{count}</span>}
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
