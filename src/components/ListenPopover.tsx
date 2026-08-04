import { useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff, Pencil, Check, X, Copy } from 'lucide-react';
import { useFlowStore } from '../store/flows';
import { cn } from '../lib/cn';

/**
 * 监听地址气泡（Proxyman 风格）：显示 IP / 可编辑端口 / 回环，
 * 并提供"启用/取消系统代理"开关。
 */
export function ListenPopover() {
  const status = useFlowStore((s) => s.proxyStatus);
  const setProxyStatus = useFlowStore((s) => s.setProxyStatus);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [portVal, setPortVal] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyHost, setCopyHost] = useState<string>(() => {
    try { return localStorage.getItem('pb:copyHost') || '127.0.0.1'; } catch { return '127.0.0.1'; }
  });
  const [editingHost, setEditingHost] = useState(false);
  const [hostVal, setHostVal] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as any)) { setOpen(false); setEditing(false); }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!status) return null;

  const savePort = async () => {
    const p = Number(portVal);
    if (Number.isInteger(p) && p >= 1 && p <= 65535) {
      const s = await window.proxybaby.setProxyPort(p);
      setProxyStatus(s);
    }
    setEditing(false);
  };
  const toggleSystem = async () => {
    const s = await window.proxybaby.setSystemProxy(!status.systemProxyApplied);
    setProxyStatus(s);
  };
  const copyShellEnv = async () => {
    const url = `http://${copyHost}:${status.port}`;
    const text = `export http_proxy=${url}\nexport https_proxy=${url}\nexport all_proxy=${url}\n`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默失败（e2e 环境下permissions 已授权）
    }
  };
  const saveHost = () => {
    const h = hostVal.trim();
    if (h) {
      setCopyHost(h);
      try { localStorage.setItem('pb:copyHost', h); } catch {}
    }
    setEditingHost(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-1.5 text-sm text-pb-muted hover:text-pb-text"
        onClick={() => setOpen((o) => !o)}
      >
        {status.running ? <Wifi size={14} className="text-pb-success" /> : <WifiOff size={14} className="text-pb-error" />}
        <span>
          ProxyBaby | {status.running ? '正在监听' : '未启动'}{' '}
          <span className="text-pb-text font-mono">{status.host}:{status.port}</span>
        </span>
        {status.systemProxyApplied && <span className="ml-1 text-pb-success text-xs">● 代理已开</span>}
      </button>

      {open && (
        <div className="absolute z-50 top-7 left-1/2 -translate-x-1/2 w-64 rounded-lg border border-pb-border bg-pb-panel shadow-2xl p-3 text-sm">
          <Row label="IP">{status.host}</Row>
          <Row label="代理端口">
            {editing ? (
              <span className="flex items-center gap-1">
                <input
                  autoFocus
                  className="pb-input w-20 py-0"
                  defaultValue={status.port}
                  onChange={(e) => setPortVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') savePort(); if (e.key === 'Escape') setEditing(false); }}
                />
                <button className="text-pb-success" onClick={savePort}><Check size={14} /></button>
                <button className="text-pb-muted" onClick={() => setEditing(false)}><X size={14} /></button>
              </span>
            ) : (
              <span className="flex items-center gap-1 font-mono">
                {status.port}
                <button className="text-pb-muted hover:text-pb-text" onClick={() => { setPortVal(String(status.port)); setEditing(true); }}>
                  <Pencil size={12} />
                </button>
              </span>
            )}
          </Row>
          <Row label="回环">
            {editingHost ? (
              <span className="flex items-center gap-1">
                <input
                  autoFocus
                  data-testid="copy-host-input"
                  className="pb-input w-32 py-0 font-mono"
                  defaultValue={copyHost}
                  onChange={(e) => setHostVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveHost(); if (e.key === 'Escape') setEditingHost(false); }}
                />
                <button className="text-pb-success" onClick={saveHost}><Check size={14} /></button>
                <button className="text-pb-muted" onClick={() => setEditingHost(false)}><X size={14} /></button>
              </span>
            ) : (
              <span className="flex items-center gap-1 font-mono">
                <span data-testid="copy-host-value">{copyHost}</span>
                <button
                  data-testid="copy-host-edit"
                  className="text-pb-muted hover:text-pb-text"
                  onClick={() => { setHostVal(copyHost); setEditingHost(true); }}
                >
                  <Pencil size={12} />
                </button>
              </span>
            )}
          </Row>

          <div className="mt-2 pt-2 border-t border-pb-border flex items-center justify-between">
            <span className="text-pb-muted">系统代理</span>
            <button
              onClick={toggleSystem}
              className={cn('px-2 py-0.5 rounded text-xs', status.systemProxyApplied ? 'bg-pb-success/20 text-pb-success' : 'bg-pb-hover text-pb-muted')}
            >
              {status.systemProxyApplied ? '已启用（点击取消）' : '已取消（点击启用）'}
            </button>
          </div>

          <div className="mt-2 pt-2 border-t border-pb-border">
            <div className="flex items-center justify-between">
              <span className="text-pb-muted">Shell 环境变量</span>
              <button
                data-testid="copy-shell-env"
                onClick={copyShellEnv}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded text-xs',
                  copied ? 'bg-pb-success/20 text-pb-success' : 'bg-pb-hover text-pb-muted hover:text-pb-text',
                )}
                title="复制 http_proxy / https_proxy / all_proxy 的 export 命令"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <div className="mt-1 text-[11px] font-mono text-pb-muted leading-relaxed">
              export http_proxy=http://{copyHost}:{status.port}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-pb-muted">{label}</span>
      <span className="text-pb-text">{children}</span>
    </div>
  );
}
