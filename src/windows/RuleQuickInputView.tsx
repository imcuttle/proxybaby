import { useEffect, useState } from 'react';
import type { RuleQuickInputParams } from '../../shared/types';
import { BodyEditor } from '../components/BodyEditor';

/**
 * 快速规则参数输入子窗口。
 * 由 Sidebar 右键"快速规则 ▸ xxx…"打开，从主进程拉取初始参数（operator / pattern / label / inputKind），
 * 用户填入 value → 调 rulesQuickAdd 直接生成一条临时规则，关闭窗口。
 */
export function RuleQuickInputView() {
  const [params, setParams] = useState<RuleQuickInputParams | null>(null);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = await window.proxybaby.ruleQuickInputConsumeInit();
      setParams(p);
    })();
  }, []);

  const closeSelf = () => window.proxybaby.closeSelfWindow();

  const pickFile = async () => {
    const p = await window.proxybaby.dialogPickFile();
    if (p) setValue(p);
  };

  const save = async () => {
    if (!params) return;
    let v = value.trim();
    if (!v) { setError('值不能为空'); return; }
    // JSON 类 operator：保存前尝试 parse 校验 + minify 成单行。规则语法是"一行一条"，
    // 若 value 含裸换行 parser 会把续行当独立规则报错（详见 rule-normalize.ts）。
    const isJson = ['mock', 'resBody', 'reqBody', 'reqHeaders', 'resHeaders'].includes(params.operator);
    if (isJson) {
      try {
        v = JSON.stringify(JSON.parse(v));
      } catch (e: any) {
        setError(`JSON 语法错误：${e?.message || '无法解析'}`);
        return;
      }
    }
    // 简单校验
    if (params.operator === 'statusCode' && !/^\d{3}$/.test(v)) { setError('状态码需为 3 位数字'); return; }
    if (params.operator === 'resDelay' && !/^\d+$/.test(v)) { setError('延迟需为整数毫秒'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await window.proxybaby.rulesQuickAdd({
        pattern: params.pattern,
        operator: params.operator,
        value: v,
      });
      await window.proxybaby.broadcast('rule-quick-input:committed', { operator: params.operator });
      closeSelf();
    } catch (e: any) {
      setError(e?.message || '保存失败');
      setSubmitting(false);
    }
  };

  if (!params) {
    return (
      <div className="p-4 text-xs text-pb-muted" data-testid="rule-quick-input-loading">
        加载中…
      </div>
    );
  }

  const isTextarea = params.inputKind === 'textarea';
  const inputType = params.inputKind === 'number' ? 'number' : 'text';
  // JSON 类 operator（mock/resBody/reqBody/reqHeaders/resHeaders）用 BodyEditor 提供
  // 语法高亮+ JSON 校验，比裸 textarea 好用得多
  const isJsonEditor = isTextarea && ['mock', 'resBody', 'reqBody', 'reqHeaders', 'resHeaders'].includes(params.operator);

  return (
    <div className="p-4 space-y-3 text-sm" data-testid="rule-quick-input">
      <div className="text-xs text-pb-muted">
        为 <span className="font-mono text-pb-text">{params.pattern}</span> 添加临时规则：{params.label}
      </div>

      <div className="flex items-start gap-2 text-xs">
        <span className="w-14 text-pb-muted mt-1.5 shrink-0">值</span>
        {isJsonEditor ? (
          <div
            className="flex-1 border border-pb-border rounded overflow-hidden"
            data-testid="rqi-value"
            onKeyDownCapture={(e) => {
              if (e.key === 'Escape') closeSelf();
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && value.trim() && !submitting) save();
            }}
          >
            <BodyEditor
              value={value}
              onChange={setValue}
              language="json"
              height="160px"
            />
          </div>
        ) : isTextarea ? (
          <textarea
            className="pb-input px-2 py-1 flex-1 text-xs font-mono"
            rows={6}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={params.placeholder || ''}
            data-testid="rqi-value"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSelf();
              // Cmd/Ctrl+Enter 提交
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && value.trim() && !submitting) save();
            }}
          />
        ) : (
          <input
            type={inputType}
            className="pb-input px-2 py-1 flex-1 text-xs font-mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={params.placeholder || ''}
            data-testid="rqi-value"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim() && !submitting) save();
              if (e.key === 'Escape') closeSelf();
            }}
          />
        )}
        {params.inputKind === 'file' && (
          <button
            className="pb-btn px-2 py-1 text-xs shrink-0"
            onClick={pickFile}
            data-testid="rqi-pick-file"
          >选择…</button>
        )}
      </div>

      {error && (
        <div className="text-xs text-pb-error" data-testid="rqi-error">{error}</div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          className="pb-btn px-3 py-1 text-xs"
          onClick={closeSelf}
          disabled={submitting}
          data-testid="rqi-cancel"
        >取消</button>
        <button
          className="pb-btn pb-btn-primary px-3 py-1 text-xs"
          onClick={save}
          disabled={submitting || !value.trim()}
          data-testid="rqi-save"
        >保存</button>
      </div>
    </div>
  );
}
