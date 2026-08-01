import { Pause, Play, Plus, Trash2, Download, Upload, ChevronRight, ChevronLeft, Layers } from 'lucide-react';
import { useFlowStore } from '../store/flows';
import { ListenPopover } from './ListenPopover';
import { cn } from '../lib/cn';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'http', label: 'HTTP' },
  { key: 'https', label: 'HTTPS' },
  { key: 'websocket', label: 'WebSocket' },
  { key: 'json', label: 'JSON' },
  { key: 'form', label: '表单' },
  { key: 'xml', label: 'XML' },
  { key: 'js', label: 'JS' },
  { key: 'css', label: 'CSS' },
  { key: 'graphql', label: 'GraphQL' },
  { key: 'doc', label: '文档' },
  { key: 'media', label: '媒体' },
  { key: 'other', label: '其他' },
] as const;

const STATUS_FILTERS = [
  { key: '1xx', label: '1xx' },
  { key: '2xx', label: '2xx' },
  { key: '3xx', label: '3xx' },
  { key: '4xx', label: '4xx' },
  { key: '5xx', label: '5xx' },
] as const;

export function Toolbar() {
  const status = useFlowStore((s) => s.proxyStatus);
  const filter = useFlowStore((s) => s.filter);
  const setFilter = useFlowStore((s) => s.setFilter);
  const clear = useFlowStore((s) => s.clear);
  const statusChipsExpanded = useFlowStore((s) => s.statusChipsExpanded);
  const toggleStatusChips = useFlowStore((s) => s.toggleStatusChips);
  const recording = status?.recording ?? true;

  const toggleRecording = async () => {
    const s = await window.proxybaby.toggleRecording(!recording);
    useFlowStore.getState().setProxyStatus(s);
  };
  const doClear = async () => {
    await window.proxybaby.clearFlows();
    clear();
  };
  const doNewSession = async () => {
    // 新建会话：确认后清空当前所有 flow + 重置过滤器/选中，等同"从头开始"
    const ok = window.confirm('新建会话将清空当前抓包并重置过滤器，确定继续？');
    if (!ok) return;
    await window.proxybaby.clearFlows();
    const s = useFlowStore.getState();
    s.clear();
    s.resetFilter?.();
    s.setSidebarQuery('');
    s.clearSelection();
  };
  const doExport = async () => { await window.proxybaby.sessionExport('proxybaby'); };
  const doExportHar = async () => { await window.proxybaby.sessionExport('har'); };
  const doImport = async () => {
    const r = await window.proxybaby.sessionImport();
    if (r.ok && r.flows) useFlowStore.getState().hydrate(r.flows);
  };

  return (
    <div className="border-b border-pb-border bg-pb-panel">
      <div className="flex items-center gap-1 px-3 py-1.5">
        <button className="pb-btn" onClick={toggleRecording} title={recording ? '暂停记录' : '开始记录'}>
          {recording ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="pb-btn" onClick={doNewSession} title="新建会话（清空当前并重置过滤）">
          <Plus size={16} />
        </button>
        <button className="pb-btn" onClick={doClear} title="清空">
          <Trash2 size={16} />
        </button>
        <button className="pb-btn" onClick={doExport} title="导出 .proxybaby" data-testid="export-btn">
          <Download size={16} />
        </button>
        <button className="pb-btn" onClick={doExportHar} title="导出 HAR">
          <span className="text-xs">HAR</span>
        </button>
        <button className="pb-btn" onClick={doImport} title="导入会话">
          <Upload size={16} />
        </button>

        <div className="mx-3 h-4 w-px bg-pb-border" />

        <button
          className="pb-btn"
          data-testid="open-ai-sessions"
          title="打开 AI Sessions 视图（按会话 → 轮次 → 请求聚合）"
          onClick={() =>
            window.proxybaby.openWindow('ai-session', {
              title: 'ProxyBaby · AI Sessions',
              width: 1100,
              height: 720,
            })
          }
        >
          <Layers size={16} />
        </button>

        <div className="mx-3 h-4 w-px bg-pb-border" />

        <ListenPopover />
      </div>
      <div className="flex items-center gap-1 px-3 pb-1.5 text-xs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter({ type: f.key as any })}
            className={cn(
              'px-2 py-0.5 rounded transition-colors',
              filter.type === f.key
                ? 'bg-pb-selected text-white'
                : 'text-pb-muted hover:bg-pb-hover',
            )}
          >
            {f.label}
          </button>
        ))}
        <div className="mx-1 h-3 w-px bg-pb-border" />
        {statusChipsExpanded && STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter({ type: f.key as any })}
            className={cn(
              'px-2 py-0.5 rounded transition-colors',
              filter.type === f.key
                ? 'bg-pb-selected text-white'
                : 'text-pb-muted hover:bg-pb-hover',
            )}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={toggleStatusChips}
          className="px-1 py-0.5 rounded text-pb-muted hover:bg-pb-hover"
          title={statusChipsExpanded ? '收起状态码筛选' : '展开状态码筛选'}
        >
          {statusChipsExpanded ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>
    </div>
  );
}
