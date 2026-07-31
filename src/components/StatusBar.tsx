import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, Trash2, Filter, Crosshair, Search, X, Plus, AlertTriangle, Wifi, WifiOff, Radio, Pause } from 'lucide-react';
import { useFlowStore } from '../store/flows';
import { matchFilter } from '../lib/filter';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function formatRate(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB/s`;
  return `${(n / 1024 / 1024).toFixed(1)} MB/s`;
}

export function StatusBar() {
  const cert = useFlowStore((s) => s.certStatus);
  const flows = useFlowStore((s) => s.flows);
  const filter = useFlowStore((s) => s.filter);
  const pinnedIds = useFlowStore((s) => s.pinnedIds);
  const pinnedHosts = useFlowStore((s) => s.pinnedHosts);
  const pinnedPaths = useFlowStore((s) => s.pinnedPaths);
  const savedIds = useFlowStore((s) => s.savedIds);
  const selectedId = useFlowStore((s) => s.selectedId);
  const traffic = useFlowStore((s) => s.traffic);
  const searchOpen = useFlowStore((s) => s.searchOpen);
  const toggleSearch = useFlowStore((s) => s.toggleSearch);
  const autoFollow = useFlowStore((s) => s.autoFollow);
  const toggleAutoFollow = useFlowStore((s) => s.toggleAutoFollow);
  const clear = useFlowStore((s) => s.clear);
  const setCertStatus = useFlowStore((s) => s.setCertStatus);
  const sidebarQuery = useFlowStore((s) => s.sidebarQuery);
  const setSidebarQuery = useFlowStore((s) => s.setSidebarQuery);
  const sidebarWidthPx = useFlowStore((s) => s.sidebarWidthPx);
  const systemProxyOverride = useFlowStore((s) => s.systemProxyOverride);
  const setSystemProxyOverride = useFlowStore((s) => s.setSystemProxyOverride);
  const setProxyStatus = useFlowStore((s) => s.setProxyStatus);
  const [fixing, setFixing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyBusy, setProxyBusy] = useState(false);
  const overrideRef = useRef<HTMLDivElement>(null);
  const proxyRef = useRef<HTMLDivElement>(null);
  const proxyStatus = useFlowStore((s) => s.proxyStatus);

  // 点击外部或 Esc 关闭覆盖 popover
  useEffect(() => {
    if (!overrideOpen) return;
    const onDown = (e: MouseEvent) => {
      if (overrideRef.current && !overrideRef.current.contains(e.target as Node)) {
        setOverrideOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverrideOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [overrideOpen]);

  // 点击外部或 Esc 关闭代理状态 popover
  useEffect(() => {
    if (!proxyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (proxyRef.current && !proxyRef.current.contains(e.target as Node)) {
        setProxyOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setProxyOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [proxyOpen]);

  const toggleSystemProxy = async () => {
    if (!proxyStatus) return;
    setProxyBusy(true);
    try {
      const s = await window.proxybaby.setSystemProxy(!proxyStatus.systemProxyApplied);
      if (s) setProxyStatus(s);
    } finally { setProxyBusy(false); }
  };
  const toggleRecording = async () => {
    if (!proxyStatus) return;
    setProxyBusy(true);
    try {
      const s = await window.proxybaby.toggleRecording(!proxyStatus.recording);
      if (s) setProxyStatus(s);
    } finally { setProxyBusy(false); }
  };

  const switchBack = async () => {
    setSwitching(true);
    try {
      const s = await window.proxybaby.restoreSystemProxyOverride();
      if (s) setProxyStatus(s);
      setSystemProxyOverride(null);
      setOverrideOpen(false);
    } finally {
      setSwitching(false);
    }
  };

  const filtered = useMemo(
    () => flows.filter((f) => matchFilter(f, filter, { pinnedIds, savedIds, pinnedHosts, pinnedPaths })),
    [flows, filter, pinnedIds, savedIds, pinnedHosts, pinnedPaths],
  );
  const selectedCount = selectedId && filtered.some((f) => f.id === selectedId) ? 1 : 0;

  const fixCert = async () => {
    setFixing(true);
    try {
      const s = await window.proxybaby.reinstallCert();
      setCertStatus(s);
    } finally {
      setFixing(false);
    }
  };
  const doClear = async () => {
    await window.proxybaby.clearFlows();
    clear();
  };

  const untrusted = cert && !cert.trusted;

  return (
    <>
      {untrusted && (
        <div className="border-t border-pb-warn/40 bg-pb-warn/10 text-xs px-3 py-1.5 flex items-center gap-2">
          <ShieldAlert size={14} className="text-pb-warn shrink-0" />
          <span className="text-pb-warn">证书未信任，无法解密 HTTPS。</span>
          <button onClick={fixCert} disabled={fixing} className="pb-btn px-2 py-0.5 bg-pb-warn/20 text-pb-warn">
            {fixing ? '安装中…' : '一键修复（需管理员密码）'}
          </button>
          <button onClick={() => setShowHelp((v) => !v)} className="pb-btn px-2 py-0.5 text-pb-muted">
            手动设置
          </button>
        </div>
      )}
      {untrusted && showHelp && (
        <div className="border-t border-pb-border bg-pb-panel text-xs px-3 py-2 text-pb-muted space-y-1">
          <div>手动信任步骤：</div>
          <div>1. 打开「钥匙串访问」→「系统」钥匙串</div>
          <div>2. 找到证书 <span className="font-mono text-pb-text">ProxyBaby CA</span>，双击</div>
          <div>3. 展开「信任」，将「使用此证书时」设为「始终信任」</div>
          <div>4. 关闭窗口并输入管理员密码保存</div>
        </div>
      )}
      <div className="border-t border-pb-border bg-pb-panel text-xs text-pb-muted flex items-stretch">
        {/* 左段：Sidebar 搜索输入（过滤应用/域名/路径）+ 过滤配置入口，宽度对齐 Sidebar */}
        <div
          className="shrink-0 border-r border-pb-border px-2 py-1 flex items-center gap-1.5"
          style={{ width: sidebarWidthPx }}
        >
          <button
            onClick={() =>
              window.proxybaby.openWindow('filter-config', {
                title: 'ProxyBaby · 过滤配置',
                width: 760,
                height: 640,
              })
            }
            className="pb-btn px-1 py-0.5 shrink-0"
            title="过滤配置（App/域名/URL 黑白名单）"
            data-testid="open-filter-config"
          >
            <Plus size={12} />
          </button>
          <div className="flex items-center gap-1.5 pb-input px-2 py-0.5 text-xs flex-1 min-w-0">
            <Search size={12} className="text-pb-muted shrink-0" />
            <input
              type="text"
              data-testid="sidebar-query"
              placeholder="过滤应用/域名/路径"
              className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-pb-muted"
              value={sidebarQuery}
              onChange={(e) => setSidebarQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSidebarQuery(''); }}
            />
            {sidebarQuery && (
              <button
                onClick={() => setSidebarQuery('')}
                className="text-pb-muted hover:text-pb-text shrink-0"
                title="清除"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* 右段：状态按钮 + 计数 + 流量 + 证书 */}
        <div className="flex-1 min-w-0 px-3 py-1 flex items-center gap-3">
          <button onClick={doClear} className="pb-btn px-2 py-0.5 flex items-center gap-1 shrink-0" title="清空所有请求">
            <Trash2 size={12} /> 清除
          </button>
          <button
            onClick={toggleSearch}
            className={cn(
              'pb-btn px-2 py-0.5 flex items-center gap-1 shrink-0',
              searchOpen && 'bg-pb-accent/20 text-pb-accent',
            )}
            title="展开高级过滤器 ⌘F"
          >
            <Filter size={12} /> 过滤器
          </button>
          <button
            onClick={toggleAutoFollow}
            className={cn(
              'pb-btn px-2 py-0.5 flex items-center gap-1 shrink-0',
              autoFollow && 'bg-pb-accent/20 text-pb-accent',
            )}
            title="自动选中最新请求"
          >
            <Crosshair size={12} /> 自动选择
          </button>

          <div className="ml-auto flex items-center gap-3 shrink-0">
            <span>选中 {selectedCount}/{filtered.length} 行</span>
            <span className="font-mono">
              {formatBytes(traffic.totalBytes)} ↑ {formatRate(traffic.txRate)} ↓ {formatRate(traffic.rxRate)}
            </span>
            {cert && (
              <span className={cn(cert.trusted ? 'text-pb-success' : 'text-pb-warn', 'flex items-center gap-1')}>
                {cert.trusted ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                证书 {cert.trusted ? '已信任' : '未信任'}
              </span>
            )}
            {/* 代理状态：点击弹出开关面板 */}
            {proxyStatus && (
              <div className="relative" ref={proxyRef}>
                <button
                  data-testid="proxy-status-btn"
                  data-open={proxyOpen ? 'true' : 'false'}
                  data-running={proxyStatus.running ? 'true' : 'false'}
                  data-system={proxyStatus.systemProxyApplied ? 'true' : 'false'}
                  data-recording={proxyStatus.recording ? 'true' : 'false'}
                  onClick={() => setProxyOpen((v) => !v)}
                  className={cn(
                    'pb-btn px-2 py-0.5 flex items-center gap-1',
                    proxyStatus.systemProxyApplied ? 'text-pb-success' : 'text-pb-muted',
                  )}
                  title={`本地 ${proxyStatus.host}:${proxyStatus.port} · 系统代理${proxyStatus.systemProxyApplied ? '已开' : '已关'} · ${proxyStatus.recording ? '抓包中' : '已暂停'}\n快捷键：⌥⌘O 开/关系统代理 · ⌥⌘R 开/关抓包`}
                >
                  {proxyStatus.systemProxyApplied ? <Wifi size={12} /> : <WifiOff size={12} />}
                  代理 {proxyStatus.host}:{proxyStatus.port}
                  <span className="text-pb-muted">·</span>
                  {proxyStatus.recording
                    ? <Radio size={12} className="text-pb-accent" />
                    : <Pause size={12} className="text-pb-muted" />
                  }
                </button>
                {proxyOpen && (
                  <div
                    data-testid="proxy-status-popover"
                    className="absolute z-50 bottom-7 right-0 w-72 rounded-lg border border-pb-border bg-pb-panel shadow-2xl p-3 text-xs text-pb-text"
                  >
                    <div className="font-medium mb-2 flex items-center gap-1.5">
                      <Wifi size={12} className="text-pb-accent" /> 代理状态
                    </div>
                    <div className="space-y-1 text-pb-muted">
                      <Row k="监听" v={<span className="font-mono text-pb-text">{proxyStatus.host}:{proxyStatus.port}</span>} />
                      <Row k="引擎" v={<span className={proxyStatus.running ? 'text-pb-success' : 'text-pb-warn'}>{proxyStatus.running ? '运行中' : '已停止'}</span>} />
                      <Row k="系统代理" v={<span className={proxyStatus.systemProxyApplied ? 'text-pb-success' : 'text-pb-muted'}>{proxyStatus.systemProxyApplied ? '已开启' : '已关闭'}</span>} />
                      <Row k="抓包" v={<span className={proxyStatus.recording ? 'text-pb-accent' : 'text-pb-muted'}>{proxyStatus.recording ? '录制中' : '已暂停'}</span>} />
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        data-testid="proxy-toggle-system"
                        onClick={toggleSystemProxy}
                        disabled={proxyBusy}
                        className={cn(
                          'pb-btn px-2 py-0.5 flex items-center gap-1',
                          proxyStatus.systemProxyApplied ? 'bg-pb-warn/20 text-pb-warn' : 'bg-pb-accent/20 text-pb-accent',
                        )}
                      >
                        {proxyStatus.systemProxyApplied ? <WifiOff size={12} /> : <Wifi size={12} />}
                        {proxyStatus.systemProxyApplied ? '关闭系统代理' : '开启系统代理'}
                      </button>
                      <button
                        data-testid="proxy-toggle-record"
                        onClick={toggleRecording}
                        disabled={proxyBusy}
                        className={cn(
                          'pb-btn px-2 py-0.5 flex items-center gap-1',
                          proxyStatus.recording ? 'bg-pb-warn/20 text-pb-warn' : 'bg-pb-accent/20 text-pb-accent',
                        )}
                      >
                        {proxyStatus.recording ? <Pause size={12} /> : <Radio size={12} />}
                        {proxyStatus.recording ? '暂停抓包' : '开始抓包'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {systemProxyOverride && (
              <div className="relative" ref={overrideRef}>
                <button
                  data-testid="proxy-override-btn"
                  onClick={() => setOverrideOpen((v) => !v)}
                  className="pb-btn px-2 py-0.5 flex items-center gap-1 bg-pb-warn/20 text-pb-warn"
                  title={`系统代理被 ${systemProxyOverride.host}:${systemProxyOverride.port} 抢占`}
                >
                  <AlertTriangle size={12} /> 代理已被覆盖
                </button>
                {overrideOpen && (
                  <div
                    data-testid="proxy-override-popover"
                    className="absolute z-50 bottom-7 right-0 w-72 rounded-lg border border-pb-border bg-pb-panel shadow-2xl p-3 text-xs text-pb-text"
                  >
                    <div className="flex items-center gap-1.5 text-pb-warn font-medium mb-2">
                      <AlertTriangle size={12} /> 系统代理已被其他工具改写
                    </div>
                    <div className="space-y-1 text-pb-muted">
                      <Row k="当前指向" v={<span className="font-mono text-pb-text" data-testid="override-current">{systemProxyOverride.host}:{systemProxyOverride.port}</span>} />
                      <Row k="ProxyBaby" v={<span className="font-mono text-pb-text">{systemProxyOverride.proxybabyHost}:{systemProxyOverride.proxybabyPort}</span>} />
                      {systemProxyOverride.service && (
                        <Row k="网络服务" v={<span className="text-pb-text">{systemProxyOverride.service}</span>} />
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        data-testid="switch-back-btn"
                        onClick={switchBack}
                        disabled={switching}
                        className="pb-btn px-2 py-0.5 bg-pb-accent/20 text-pb-accent"
                      >
                        {switching ? '切换中…' : '切回 ProxyBaby'}
                      </button>
                      <button
                        onClick={() => setOverrideOpen(false)}
                        className="pb-btn px-2 py-0.5 text-pb-muted ml-auto"
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function cn(...xs: (string | false | undefined)[]) {
  return xs.filter(Boolean).join(' ');
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-16 shrink-0 text-pb-muted">{k}</span>
      <span className="min-w-0 flex-1 truncate">{v}</span>
    </div>
  );
}
