/**
 * 自定义预览 Tab 管理器（对标 Proxyman 的 Custom Preview Tabs）。
 * 用户勾选启用哪些额外的预览格式作为独立 Tab 出现在 Request / Response 面板中。
 */
import { useFlowStore } from '../store/flows';
import type { PreviewFormat } from '../lib/body-detect';

interface Item {
  fmt: PreviewFormat;
  label: string;
}

// 展示给用户勾选的格式清单（有意义的、能独立成 Tab 的）。
const ITEMS: Item[] = [
  { fmt: 'json', label: 'JSON' },
  { fmt: 'json-tree', label: 'JSON Tree' },
  { fmt: 'form', label: 'Form URL-Encoded' },
  { fmt: 'multipart', label: 'Multipart/form-data' },
  { fmt: 'html', label: 'HTML' },
  { fmt: 'css', label: 'CSS' },
  { fmt: 'js', label: 'JavaScript' },
  { fmt: 'xml', label: 'XML' },
  { fmt: 'image', label: 'Images' },
  { fmt: 'hex', label: 'Hex' },
  { fmt: 'graphql', label: 'GraphQL' },
  { fmt: 'text', label: 'Text' },
];

export function TabCustomizer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const customTabs = useFlowStore((s) => s.customTabs);
  const toggle = useFlowStore((s) => s.toggleCustomTab);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="tab-customizer"
    >
      <div className="bg-pb-panel border border-pb-border rounded-md shadow-lg w-[560px] max-w-[92vw] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-pb-border">
          <div className="text-sm font-medium">自定义预览标签</div>
          <button
            type="button"
            className="pb-btn px-2 py-0.5 text-xs"
            onClick={onClose}
            data-testid="tab-customizer-close"
          >完成</button>
        </div>
        <div className="px-4 py-2 text-xs text-pb-muted border-b border-pb-border/50">
          以不同格式显示请求 / 响应主体。
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-3 p-3 overflow-auto pb-scroll">
          <Panel
            title="请求面板"
            testId="tab-customizer-request"
            enabled={customTabs.request}
            onToggle={(fmt) => toggle('request', fmt)}
          />
          <Panel
            title="响应面板"
            testId="tab-customizer-response"
            enabled={customTabs.response}
            onToggle={(fmt) => toggle('response', fmt)}
          />
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  enabled,
  onToggle,
  testId,
}: {
  title: string;
  enabled: PreviewFormat[];
  onToggle: (fmt: PreviewFormat) => void;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="text-xs text-pb-muted mb-2">{title}</div>
      <div className="border border-pb-border rounded p-2 space-y-1">
        {ITEMS.map((it) => {
          const checked = enabled.includes(it.fmt);
          return (
            <label
              key={it.fmt}
              className="flex items-center gap-2 text-xs cursor-pointer select-none"
              data-testid={`${testId}-item-${it.fmt}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(it.fmt)}
                data-testid={`${testId}-checkbox-${it.fmt}`}
              />
              <span className={checked ? 'text-pb-text' : 'text-pb-muted'}>{it.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
