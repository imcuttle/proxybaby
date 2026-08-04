import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { loader, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { Plus, Trash2, Power, Save, Pencil, Info } from 'lucide-react';
import type { RuleSetSummary, PluginSummary } from '../../shared/types';
import { cn } from '../lib/cn';
import { PluginDocModal } from './PluginDocModal';
import { ScriptsPanel } from './ScriptsPanel';

// —— Monaco worker：只用 editor worker（whistle 是自定义语言，不需 TS/JSON/CSS worker）
// 必须在 loader.init 之前挂 self.MonacoEnvironment
if (typeof self !== 'undefined' && !(self as any).MonacoEnvironment) {
  (self as any).MonacoEnvironment = {
    getWorker() {
      return new EditorWorker();
    },
  };
}
loader.config({ monaco });

// —— whistle 规则语言（简易 tokenizer + 补全）
const LANG_ID = 'whistle-rules';
const OPERATORS = [
  { op: 'statusCode', valueHint: '200', doc: '设置响应状态码' },
  { op: 'redirect', valueHint: 'https://target', doc: '302 跳转到目标 URL' },
  { op: 'abort', valueHint: '', doc: '立即断开连接' },
  { op: 'reqHeaders', valueHint: '{"Authorization":"Bearer x"}', doc: '合并/添加请求头' },
  { op: 'resHeaders', valueHint: '{"X-Env":"dev"}', doc: '合并/添加响应头' },
  { op: 'reqBody', valueHint: '{"a":1}', doc: '替换请求体（字符串或 JSON）' },
  { op: 'resBody', valueHint: '{"ok":true}', doc: '替换响应体' },
  { op: 'host', valueHint: '127.0.0.1:3000', doc: '域名劫持到指定 host:port' },
  { op: 'file', valueHint: '/absolute/path/to/file', doc: 'Map Local：用本地文件作为响应体' },
  { op: 'mock', valueHint: '{"id":1}', doc: '返回内联 JSON/文本 mock' },
  { op: 'req', valueHint: 'https://staging.example.com/', doc: 'Map Remote：把请求转发到另一个 URL' },
  { op: 'reqDelay', valueHint: '500', doc: '请求延迟（毫秒）' },
  { op: 'resDelay', valueHint: '2000', doc: '响应延迟（毫秒）' },
  { op: 'breakpoint', valueHint: 'both', doc: '断点暂停（both/req/res）' },
  { op: 'log', valueHint: '', doc: '打印命中日志' },
  { op: 'ua', valueHint: 'MyAgent/1.0', doc: '替换 User-Agent' },
  { op: 'referer', valueHint: 'https://ref', doc: '替换 Referer' },
  { op: 'script', valueHint: 'my-script', doc: '触发 Scripts 插件里名为 <id|name> 的脚本' },
  { op: 'throttle', valueHint: '3g', doc: '模拟网络：offline / 2g / 3g / 4g / 5g / wifi / custom:latencyMs:kbps' },
  { op: 'block', valueHint: '', doc: '阻止请求（相当于 abort，但语义清晰）' },
  { op: 'allow', valueHint: '', doc: '在白名单模式下明确允许一条规则' },
];

let langRegistered = false;
function registerWhistleLang(m: Monaco) {
  if (langRegistered) return;
  langRegistered = true;

  m.languages.register({ id: LANG_ID });
  m.languages.setLanguageConfiguration(LANG_ID, {
    comments: { lineComment: '#' },
    brackets: [['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  const OP_ALT = OPERATORS.map((o) => o.op).join('|');
  m.languages.setMonarchTokensProvider(LANG_ID, {
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^\s*\[[^\]]+\]/, 'metatag'],
        [/\/[^/\s]+\//, 'regexp'],
        [new RegExp(`\\b(${OP_ALT})(?=:\\/\\/|\\b)`), 'keyword'],
        [/\{[^}]*\}/, 'string'],
        [/https?:\/\/\S+/, 'string.link'],
        [/\bfile:\/\/\S+/, 'string.link'],
        [/\bmock:\/\/[^\s]+/, 'string'],
        [/\S+/, ''],
      ],
    },
  });

  m.editor.defineTheme('proxybaby-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c586c0' },
      { token: 'string.link', foreground: '4ec9b0' },
      { token: 'metatag', foreground: '569cd6' },
      { token: 'regexp', foreground: 'd7ba7d' },
    ],
    colors: {
      'editor.background': '#0d1117',
      'editor.foreground': '#c9d1d9',
      'editorLineNumber.foreground': '#484f58',
      'editor.selectionBackground': '#264f78',
      'editor.lineHighlightBackground': '#161b22',
    },
  });

  // 补全：op 名 + op:// + 文件路径
  m.languages.registerCompletionItemProvider(LANG_ID, {
    // 触发字符：字母 -> op 名补全；/ -> 路径补全
    triggerCharacters: ['/', '.', ':', ' ', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i',
      'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'],
    async provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
      const line = model.getLineContent(position.lineNumber);
      const prefix = line.slice(0, position.column - 1);

      // 1) file:// 后触发文件路径补全
      const fileMatch = prefix.match(/file:\/\/([^\s]*)$/);
      if (fileMatch) {
        const typed = fileMatch[1] || '/';
        const suggestions = await listPathCompletions(typed, model, position);
        return { suggestions };
      }

      // 2) 已经打完 op，进入 :// 之后：什么都不补
      if (/\b(\w+):\/\/[^\s]*$/.test(prefix)) return { suggestions: [] };

      // 3) 补 op 名
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions: monaco.languages.CompletionItem[] = OPERATORS.map((o) => ({
        label: o.op,
        kind: m.languages.CompletionItemKind.Function,
        detail: o.valueHint ? `${o.op}://${o.valueHint}` : o.op,
        documentation: o.doc,
        insertText: o.valueHint ? `${o.op}://\${1:${o.valueHint}}` : o.op,
        insertTextRules: m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
      }));
      return { suggestions };
    },
  });
}

// —— 文件路径补全：走 IPC 列目录
async function listPathCompletions(
  typed: string,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): Promise<monaco.languages.CompletionItem[]> {
  const api = (window as any).proxybaby;
  if (!api?.fsListDir) return [];
  // 把 typed 拆成 已完成目录 + 待补片段
  const lastSlash = typed.lastIndexOf('/');
  const dir = lastSlash >= 0 ? typed.slice(0, lastSlash + 1) || '/' : '/';
  const frag = lastSlash >= 0 ? typed.slice(lastSlash + 1) : typed;
  const res = await api.fsListDir(dir);
  if (!res?.entries) return [];

  const startCol = position.column - frag.length;
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: startCol,
    endColumn: position.column,
  };
  return res.entries.map((e: { name: string; isDir: boolean }) => ({
    label: e.name + (e.isDir ? '/' : ''),
    kind: e.isDir
      ? monaco.languages.CompletionItemKind.Folder
      : monaco.languages.CompletionItemKind.File,
    insertText: e.name + (e.isDir ? '/' : ''),
    range,
    // 目录：插入完成后再次触发补全，实现层层深入
    command: e.isDir ? { id: 'editor.action.triggerSuggest', title: '' } : undefined,
  }));
}

const EXAMPLES: { label: string; rule: string; desc: string }[] = [
  { label: 'Mock JSON 响应', rule: 'api.example.com/user  mock://{"id":1,"name":"test"}', desc: '直接返回内联 JSON' },
  { label: 'Map Local（本地文件）', rule: 'api.example.com/data  file:///tmp/data.json', desc: '把请求的响应映射到本地文件' },
  { label: 'Map Remote（转发到其他 URL）', rule: 'api.example.com/*  req://https://staging.example.com/', desc: '把请求转发到另一个域' },
  { label: '域名改上游 host', rule: 'api.example.com  host://127.0.0.1:3000', desc: '把域名指向本地服务' },
  { label: '改状态码', rule: 'api.example.com/checkout  statusCode://500', desc: '模拟错误响应' },
  { label: '重定向', rule: 'old.example.com  redirect://https://new.example.com', desc: '302 跳转' },
  { label: '注入请求头', rule: '*.example.com/*  reqHeaders://{"Authorization":"Bearer test"}', desc: '给请求加 header' },
  { label: '延迟响应', rule: 'api.example.com/slow  resDelay://2000', desc: '模拟慢网络(ms)' },
  { label: '断点编辑', rule: 'api.example.com/edit  breakpoint', desc: '命中时暂停手动改' },
  { label: 'JS 脚本（Scripts 插件）', rule: 'api.example.com/*  script://<script-id-or-name>', desc: '触发脚本改写请求/响应' },
  { label: '限速（网络条件）', rule: 'api.example.com/*  throttle://3g', desc: '按 3G/4G/5G/offline 预设限速' },
  { label: '阻止（Block）', rule: '*.tracker.com  block', desc: '直接断开命中请求' },
];

export function RulesView() {
  const [sets, setSets] = useState<RuleSetSummary[]>([]);
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftText, setDraftText] = useState('');
  const [dirty, setDirty] = useState(false);
  // 侧栏重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  // 插件详情
  const [docPlugin, setDocPlugin] = useState<PluginSummary | null>(null);
  // 顶部子 tab：规则集 / 脚本
  const [mode, setMode] = useState<'rules' | 'scripts'>('rules');
  // 规则集左栏 sub-tab：常规 / 临时（Sidebar 右键"快速规则"生成的）
  const [ruleTab, setRuleTab] = useState<'normal' | 'temporary'>('normal');

  const reload = useCallback(async () => {
    const [rs, pl] = await Promise.all([
      window.proxybaby.rulesList(),
      window.proxybaby.pluginsList(),
    ]);
    setSets(rs);
    setPlugins(pl);
    if (!selectedId && rs.length) {
      setSelectedId(rs[0].id);
      setDraftName(rs[0].name);
      setDraftText(rs[0].text);
      setDirty(false);
      return;
    }
    // 若当前选中的规则集已被外部改动（QuickRuleSubMenu toggle-off、其它窗口编辑等），
    // 需要把draft 同步到最新——但用户正在编辑（dirty=true）时保持本地内容不覆盖。
    if (selectedId) {
      const cur = rs.find((s) => s.id === selectedId);
      if (!cur) {
        // 被外部删除：清空选择
        setSelectedId(null);
        setDraftName('');
        setDraftText('');
        setDirty(false);
      } else if (!dirty) {
        setDraftName(cur.name);
        setDraftText(cur.text);
      }
    }
  }, [selectedId, dirty]);
  useEffect(() => { reload(); }, [reload]);

  const selectSet = (s: RuleSetSummary) => {
    setSelectedId(s.id);
    setDraftName(s.name);
    setDraftText(s.text);
    setDirty(false);
  };

  const create = async () => {
    const s = await window.proxybaby.rulesAdd('新规则集', '# 在此写规则\n# 示例:\n# api.example.com/user  mock://{"ok":true}\n', true);
    await reload();
    selectSet(s);
  };
  const save = async () => {
    if (!selectedId) return;
    const s = await window.proxybaby.rulesUpdate(selectedId, { name: draftName, text: draftText });
    if (s) {
      await reload();
      setSelectedId(s.id);
      setDirty(false);
    }
  };
  const remove = async (id: string) => {
    if (!confirm('删除该规则集？')) return;
    await window.proxybaby.rulesRemove(id);
    if (selectedId === id) { setSelectedId(null); setDraftText(''); setDraftName(''); }
    await reload();
  };
  const toggle = async (id: string, enabled: boolean) => {
    await window.proxybaby.rulesSetEnabled(id, enabled);
    await reload();
  };
  const togglePlugin = async (id: string, enabled: boolean) => {
    await window.proxybaby.pluginsSetEnabled(id, enabled);
    await reload();
  };
  const commitRename = async (id: string) => {
    const name = renameVal.trim();
    setRenamingId(null);
    if (!name) return;
    await window.proxybaby.rulesUpdate(id, { name });
    if (selectedId === id) setDraftName(name);
    await reload();
  };

  const selected = sets.find((s) => s.id === selectedId);

  // 常规/临时 分组
  const normalSets = sets.filter((s) => !s.temporary);
  const temporarySets = sets.filter((s) => s.temporary);
  const visibleSets = ruleTab === 'temporary' ? temporarySets : normalSets;

  // 主进程 broadcast 事件：规则改动 & 光标定位
  useEffect(() => {
    const offChanged = window.proxybaby.onEvent('rules:changed' as any, () => reload());
    const offFocus = window.proxybaby.onEvent('rules:focus-line' as any, (p: any) => {
      if (!p) return;
      setMode('rules');
      // 若是临时规则集，先切到临时 tab
      // 需异步 —— 让 reload 完成后再选中
      (async () => {
        await reload();
        // 用最新 list 找目标
        const list = await window.proxybaby.rulesList();
        const target = list.find((x) => x.id === p.ruleSetId);
        if (!target) return;
        setRuleTab(target.temporary ? 'temporary' : 'normal');
        setSelectedId(target.id);
        setDraftName(target.name);
        setDraftText(target.text);
        setDirty(false);
        // 光标定位到指定行末尾
        setTimeout(() => {
          const ed = editorRef.current;
          if (!ed) return;
          const model = ed.getModel();
          if (!model) return;
          const line = Math.max(1, Math.min(p.lineNo || model.getLineCount(), model.getLineCount()));
          const col = model.getLineMaxColumn(line);
          ed.setPosition({ lineNumber: line, column: col });
          ed.revealLineInCenter(line);
          ed.focus();
        }, 50);
      })();
    });
    return () => { offChanged(); offFocus(); };
  }, [reload]);

  const clearTemp = async () => {
    if (!confirm('确定清空全部临时规则？')) return;
    await window.proxybaby.rulesClearTemp();
    // 若当前选中的是临时集，清掉选中
    if (selected?.temporary) {
      setSelectedId(null);
      setDraftText('');
      setDraftName('');
    }
    setRuleTab('normal');
    await reload();
  };

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor, mm: Monaco) => {
    editorRef.current = editor;
    registerWhistleLang(mm);
    mm.editor.setModelLanguage(editor.getModel()!, LANG_ID);
    editor.updateOptions({ theme: 'proxybaby-dark' });
    // Ctrl/Cmd+S 保存
    editor.addCommand(mm.KeyMod.CtrlCmd | mm.KeyCode.KeyS, () => saveRef.current());
  }, []);

  // save 需在 onMount 里能读到最新，用 ref 桥接
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  const insertRule = (rule: string) => {
    const ed = editorRef.current;
    if (!ed) {
      setDraftText((prev) => (prev && !prev.endsWith('\n') ? prev + '\n' : prev) + rule + '\n');
      setDirty(true);
      return;
    }
    const model = ed.getModel();
    if (!model) return;
    const last = model.getLineCount();
    const col = model.getLineMaxColumn(last);
    ed.executeEdits('insert-example', [{
      range: new monaco.Range(last, col, last, col),
      text: (model.getLineContent(last).length ? '\n' : '') + rule + '\n',
    }]);
    ed.focus();
  };

  return (
    <div className="h-full flex flex-col bg-pb-bg">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-pb-border" data-testid="rules-mode-tabs">
        <button
          data-testid="rules-tab-rules"
          data-active={mode === 'rules' ? 'true' : 'false'}
          onClick={() => setMode('rules')}
          className={cn(
            'px-2 py-0.5 text-xs rounded',
            mode === 'rules' ? 'bg-pb-selected text-white' : 'text-pb-muted hover:bg-pb-hover',
          )}
        >规则集 / 插件</button>
        <button
          data-testid="rules-tab-scripts"
          data-active={mode === 'scripts' ? 'true' : 'false'}
          onClick={() => setMode('scripts')}
          className={cn(
            'px-2 py-0.5 text-xs rounded',
            mode === 'scripts' ? 'bg-pb-selected text-white' : 'text-pb-muted hover:bg-pb-hover',
          )}
        >脚本（Scripts）</button>
        <button
          data-testid="rules-open-debug"
          onClick={() => window.proxybaby.ruleDebugOpen()}
          className="ml-auto px-2 py-0.5 text-xs rounded text-pb-muted hover:bg-pb-hover border border-pb-border"
          title="打开 Rule Debug 面板：模拟请求，查看每条规则的匹配情况与 dry-run 效果"
        >Debug…</button>
      </div>
      {mode === 'scripts' ? (
        <div className="flex-1 min-h-0">
          <ScriptsPanel />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <div className="w-64 border-r border-pb-border flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-pb-border">
          <span className="text-xs uppercase tracking-wide text-pb-muted">规则集</span>
          <button className="pb-btn" onClick={create} title="新建"><Plus size={14} /></button>
        </div>
        {/* 常规 / 临时 sub-tab：存在临时规则或当前正处于临时 tab 时展示，
            确保临时规则清空后仍能切回常规 */}
        {(temporarySets.length > 0 || ruleTab === 'temporary') && (
          <div className="flex items-center gap-1 px-2 py-1 border-b border-pb-border text-xs" data-testid="rules-subtabs">
            <button
              data-testid="rules-subtab-normal"
              className={cn(
                'px-2 py-0.5 rounded',
                ruleTab === 'normal' ? 'bg-pb-selected text-white' : 'text-pb-muted hover:bg-pb-hover',
              )}
              onClick={() => setRuleTab('normal')}
            >常规</button>
            <button
              data-testid="rules-subtab-temporary"
              className={cn(
                'px-2 py-0.5 rounded',
                ruleTab === 'temporary' ? 'bg-pb-selected text-white' : 'text-pb-muted hover:bg-pb-hover',
              )}
              onClick={() => setRuleTab('temporary')}
            >临时 ({temporarySets.length})</button>
            {ruleTab === 'temporary' && (
              <button
                className="ml-auto text-pb-error hover:underline"
                onClick={clearTemp}
                title="清空全部临时规则"
                data-testid="rules-clear-temp"
              >清空</button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-auto pb-scroll">
          {visibleSets.map((s) => (
            <div
              key={s.id}
              className={cn(
                'group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-sm',
                selectedId === s.id ? 'bg-pb-selected text-white' : 'hover:bg-pb-hover',
              )}
              onClick={() => renamingId !== s.id && selectSet(s)}
              onDoubleClick={() => { setRenamingId(s.id); setRenameVal(s.name); }}
            >
              <button
                onClick={(e) => { e.stopPropagation(); toggle(s.id, !s.enabled); }}
                title={s.enabled ? '禁用' : '启用'}
                className={cn('shrink-0', s.enabled ? 'text-pb-success' : 'text-pb-muted')}
              >
                <Power size={12} />
              </button>
              {renamingId === s.id ? (
                <input
                  autoFocus
                  className="pb-input flex-1 py-0 h-5 text-xs"
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(s.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onBlur={() => commitRename(s.id)}
                />
              ) : (
                <span className="flex-1 truncate" title="双击重命名">{s.name}</span>
              )}
              <span className="text-xs text-pb-muted">{s.rules.length}</span>
              {renamingId !== s.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); setRenamingId(s.id); setRenameVal(s.name); }}
                  className="opacity-0 group-hover:opacity-100 text-pb-muted hover:text-pb-text"
                  title="重命名"
                >
                  <Pencil size={12} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); remove(s.id); }}
                className="opacity-0 group-hover:opacity-100 text-pb-muted hover:text-pb-error"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {!visibleSets.length && (
            <div className="p-4 text-xs text-pb-muted">
              {ruleTab === 'temporary' ? (
                <>
                  <div>暂无临时规则</div>
                  <button
                    className="mt-2 px-2 py-0.5 rounded border border-pb-border text-pb-text hover:bg-pb-hover"
                    onClick={() => setRuleTab('normal')}
                    data-testid="rules-switch-to-normal"
                  >切换到常规规则</button>
                </>
              ) : (
                '还没有规则集'
              )}
            </div>
          )}
        </div>

        <div className="border-t border-pb-border">
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-pb-muted">插件</div>
          {plugins.map((p) => (
            <div
              key={p.id}
              className="group flex items-center gap-2 px-2 py-1 text-xs hover:bg-pb-hover cursor-default"
              onClick={() => setDocPlugin(p)}
              title="点击查看详细说明"
            >
              <button
                onClick={(e) => { e.stopPropagation(); togglePlugin(p.id, !p.enabled); }}
                className={cn('shrink-0', p.enabled ? 'text-pb-success' : 'text-pb-muted')}
                title={p.enabled ? '禁用' : '启用'}
              >
                <Power size={12} />
              </button>
              <span className="flex-1 truncate">{p.name}</span>
              <Info
                size={12}
                className="opacity-0 group-hover:opacity-100 text-pb-muted"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex min-w-0">
        {selected ? (
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-pb-border">
              <input
                className="pb-input flex-1"
                value={draftName}
                onChange={(e) => { setDraftName(e.target.value); setDirty(true); }}
              />
              <button className="pb-btn" onClick={save} disabled={!dirty} title="保存 (⌘S)">
                <Save size={14} />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                theme="proxybaby-dark"
                defaultLanguage={LANG_ID}
                path={selected.id}
                value={draftText}
                onChange={(v) => { setDraftText(v ?? ''); setDirty(true); }}
                onMount={onMount}
                options={{
                  fontSize: 12,
                  fontFamily: 'ui-monospace, Menlo, Monaco, "SF Mono", monospace',
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  renderWhitespace: 'boundary',
                  wordWrap: 'on',
                  automaticLayout: true,
                  quickSuggestions: { other: true, comments: false, strings: true },
                  suggestOnTriggerCharacters: true,
                  tabSize: 2,
                }}
              />
            </div>
            {selected.errors.length > 0 && (
              <div className="border-t border-pb-error/40 bg-pb-error/10 text-xs p-2 text-pb-error">
                {selected.errors.map((e, i) => (
                  <div key={i}>第 {e.lineNo} 行：{e.message}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-pb-muted text-sm">
            选择或新建一个规则集
          </div>
        )}

        {selected && (
          <div className="w-64 border-l border-pb-border overflow-auto pb-scroll text-xs">
            <div className="px-3 py-2 border-b border-pb-border text-pb-muted uppercase tracking-wide">
              示例（点击插入）
            </div>
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => insertRule(ex.rule)}
                className="w-full text-left px-3 py-1.5 hover:bg-pb-hover border-b border-pb-border/30"
              >
                <div className="text-pb-text">{ex.label}</div>
                <div className="font-mono text-pb-accent break-all mt-0.5">{ex.rule}</div>
                <div className="text-pb-muted mt-0.5">{ex.desc}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
      )}

      {docPlugin && (
        <PluginDocModal plugin={docPlugin} onClose={() => setDocPlugin(null)} />
      )}
    </div>
  );
}
