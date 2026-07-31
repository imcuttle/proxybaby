import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEditor, Descendant, Editor, Range, Transforms, Element as SlateElement } from 'slate';
import { Slate, Editable, withReact, RenderElementProps, RenderLeafProps, ReactEditor } from 'slate-react';
import { withHistory } from 'slate-history';
import { Send, Paperclip, X, Image as ImageIcon } from 'lucide-react';
import { emptyDoc, slateToMd, MentionKind, mdToSlate } from '../../lib/ai/md-slate';
import { MentionChip } from './MentionChip';
import { useFlowStore } from '../../store/flows';
import { cn } from '../../lib/cn';

interface Props {
  onSend(markdown: string): void;
  disabled?: boolean;
}

interface MentionOption {
  kind: MentionKind;
  refId: string;
  label: string;
  hint?: string;
}

interface Attachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  /** 图片附件用 data URL；文件附件用绝对路径或 name */
  ref: string;
}

const KIND_LABEL: Record<MentionKind, string> = {
  flow: '抓包',
  rule: '规则',
  plugin: '插件',
  skill: 'Skill',
  file: '文件',
};

const PREFIX_TO_KIND: { prefix: string; kind: MentionKind }[] = [
  { prefix: 'flow:', kind: 'flow' },
  { prefix: 'rule:', kind: 'rule' },
  { prefix: 'r:',    kind: 'rule' },
  { prefix: 'plugin:', kind: 'plugin' },
  { prefix: 'p:',    kind: 'plugin' },
  { prefix: 'skill:', kind: 'skill' },
  { prefix: 's:',    kind: 'skill' },
  { prefix: 'file:', kind: 'file' },
  { prefix: 'f:',    kind: 'file' },
];

export function Composer({ onSend, disabled }: Props) {
  const editor = useMemo(() => withMention(withHistory(withReact(createEditor()))), []);
  const [value, setValue] = useState<Descendant[]>(() => emptyDoc() as unknown as Descendant[]);
  const [mentionQuery, setMentionQuery] = useState<null | { at: Range }>(null);
  const [query, setQuery] = useState('');
  const [mentionKind, setMentionKind] = useState<MentionKind>('flow');
  const [activeIdx, setActiveIdx] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const flows = useFlowStore((s) => s.flows);

  // rule / plugin / skill 数据源（渲染层无长驻 store，mount 时拉取一次）
  const [rules, setRules] = useState<{ id: string; name: string }[]>([]);
  const [plugins, setPlugins] = useState<{ id: string; name: string; description?: string }[]>([]);
  const [skills, setSkills] = useState<{ name: string; description?: string }[]>([]);

  useEffect(() => {
    const api = (window as any).proxybaby;
    if (!api) return;
    api.rulesList?.().then((list: any[]) => {
      setRules((list || []).map((r) => ({ id: r.id, name: r.name })));
    }).catch(() => {});
    api.pluginsList?.().then((list: any[]) => {
      setPlugins((list || []).map((p) => ({ id: p.id, name: p.name, description: p.description })));
    }).catch(() => {});
    api.aiListSkills?.().then((list: any[]) => {
      setSkills((list || []).map((s) => ({ name: s.name, description: s.description })));
    }).catch(() => {});
  }, []);

  // 根据当前 kind + query 生成候选
  const options = useMemo<MentionOption[]>(() => {
    const q = query.toLowerCase();
    if (mentionKind === 'flow') {
      return flows
        .filter((f) => !q || f.request.url.toLowerCase().includes(q) || f.request.method.toLowerCase().includes(q))
        .slice(0, 20)
        .map((f) => ({
          kind: 'flow' as MentionKind,
          refId: f.id,
          label: `${f.request.method} ${f.request.host}${f.request.path}`,
          hint: f.app?.name,
        }));
    }
    if (mentionKind === 'rule') {
      return rules
        .filter((r) => !q || r.name.toLowerCase().includes(q))
        .slice(0, 20)
        .map((r) => ({ kind: 'rule' as MentionKind, refId: r.id, label: r.name }));
    }
    if (mentionKind === 'plugin') {
      return plugins
        .filter((p) => !q || p.name.toLowerCase().includes(q))
        .slice(0, 20)
        .map((p) => ({ kind: 'plugin' as MentionKind, refId: p.id, label: p.name, hint: p.description }));
    }
    if (mentionKind === 'skill') {
      return skills
        .filter((s) => !q || s.name.toLowerCase().includes(q))
        .slice(0, 20)
        .map((s) => ({ kind: 'skill' as MentionKind, refId: s.name, label: s.name, hint: s.description }));
    }
    // file：不做全量列表；popover 只显示一项"选择文件…"
    return [{ kind: 'file' as MentionKind, refId: '__pick__', label: '选择文件…', hint: '打开系统文件选择器' }];
  }, [mentionKind, query, flows, rules, plugins, skills]);

  // 每次候选变了 reset 焦点
  useEffect(() => { setActiveIdx(0); }, [options.length, mentionKind]);

  const renderElement = useCallback((props: RenderElementProps) => {
    const el = props.element as any;
    if (el.type === 'mention') {
      return (
        <span {...props.attributes} contentEditable={false}>
          <MentionChip kind={el.kind} refId={el.refId} />
          {props.children}
        </span>
      );
    }
    return <p {...props.attributes} className="whitespace-pre-wrap m-0">{props.children}</p>;
  }, []);

  const renderLeaf = useCallback((props: RenderLeafProps) => {
    const leaf = props.leaf as any;
    let node = <>{props.children}</>;
    if (leaf.code) node = <code className="rounded bg-pb-hover px-1 text-xs">{node}</code>;
    if (leaf.bold) node = <strong>{node}</strong>;
    if (leaf.italic) node = <em>{node}</em>;
    return <span {...props.attributes}>{node}</span>;
  }, []);

  const renderPlaceholder = useCallback(({ attributes, children }: any) => {
    // 自定义 placeholder：与 Editable 的 padding 对齐，避免默认样式漂移
    return (
      <span
        {...attributes}
        style={{
          position: 'absolute',
          top: '0.25rem',   // py-1
          left: '0.5rem',   // px-2
          pointerEvents: 'none',
          userSelect: 'none',
          opacity: 0.55,
          fontSize: 'inherit',
          lineHeight: 'inherit',
        }}
        className="text-pb-muted"
      >
        {children}
      </span>
    );
  }, []);

  const buildFinalMd = (): string => {
    const text = slateToMd(value as any).trim();
    const attachMd = attachments.map((a) => {
      if (a.kind === 'image') return `![${a.name}](${a.ref})`;
      return '`file:' + a.ref + '`';
    }).join('\n');
    return [text, attachMd].filter(Boolean).join('\n\n');
  };

  const doSend = () => {
    const md = buildFinalMd();
    if (!md) return;
    onSend(md);
    setValue(emptyDoc() as unknown as Descendant[]);
    setAttachments([]);
    Transforms.select(editor, Editor.start(editor, []));
    Transforms.delete(editor, { at: { anchor: Editor.start(editor, []), focus: Editor.end(editor, []) } });
    Transforms.insertNodes(editor, [{ type: 'paragraph', children: [{ text: '' }] } as any], { at: [0] });
  };

  const insertMention = async (opt: MentionOption) => {
    // 先删掉 "@..." 触发文本
    const at = mentionQuery?.at;
    if (at) {
      try {
        // 删除从 @ 前面 anchor 到当前 focus 的范围
        const start = at.anchor;
        const { selection } = editor;
        const end = selection ? Range.end(selection) : Editor.end(editor, []);
        // 把 anchor 往前挪一格覆盖 @
        const before = Editor.before(editor, start, { unit: 'character' });
        const from = before || start;
        Transforms.select(editor, { anchor: from, focus: end });
        Transforms.delete(editor);
      } catch { /* ignore */ }
    }

    if (opt.kind === 'file' && opt.refId === '__pick__') {
      const picked = await (window as any).proxybaby?.aiPickFile?.();
      setMentionQuery(null);
      setQuery('');
      ReactEditor.focus(editor);
      if (!picked) return;
      Transforms.insertNodes(editor, {
        type: 'mention', kind: 'file', refId: picked, children: [{ text: '' }],
      } as any);
      Transforms.move(editor);
      return;
    }

    Transforms.insertNodes(editor, {
      type: 'mention',
      kind: opt.kind,
      refId: opt.refId,
      children: [{ text: '' }],
    } as any);
    Transforms.move(editor);
    setMentionQuery(null);
    setQuery('');
    ReactEditor.focus(editor);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // popover 打开时：↑↓ 移动、Enter 选择、Esc 关闭
    if (mentionQuery && options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(options.length - 1, i + 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'Tab')       { e.preventDefault(); insertMention(options[activeIdx]); return; }
      if (e.key === 'Enter')     { e.preventDefault(); insertMention(options[activeIdx]); return; }
      if (e.key === 'Escape')    { setMentionQuery(null); return; }
    }
    // Enter 直接发送；Shift+Enter 走 Slate 默认（软换行）
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing) {
      e.preventDefault();
      doSend();
      return;
    }
    // 保留 Cmd/Ctrl+Enter 也能发（muscle memory）
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      doSend();
      return;
    }
  };

  const onChange = (v: Descendant[]) => {
    setValue(v);
    const { selection } = editor;
    if (selection && Range.isCollapsed(selection)) {
      const [start] = Range.edges(selection);
      const before = Editor.before(editor, start, { unit: 'character' });
      const charBefore = before && Editor.string(editor, { anchor: before, focus: start });
      if (charBefore === '@' && !mentionQuery) {
        setMentionQuery({ at: selection });
        setQuery('');
        setMentionKind('flow');
      } else if (mentionQuery) {
        // 从 mention 触发点开始一路 string 到当前 focus
        const anchor = mentionQuery.at.anchor;
        try {
          const s = Editor.string(editor, { anchor, focus: start });
          // s 形如 "@foo" 或 "@r:foo"
          if (!s.startsWith('@')) { setMentionQuery(null); return; }
          const rest = s.slice(1);
          // 若以某前缀开头则切 kind，且 query 是前缀后的部分
          const p = PREFIX_TO_KIND.find((x) => rest.toLowerCase().startsWith(x.prefix));
          if (p) {
            setMentionKind(p.kind);
            setQuery(rest.slice(p.prefix.length));
          } else {
            setQuery(rest);
          }
        } catch { setMentionQuery(null); }
      }
    }
  };

  const readFileAsDataUrl = (file: File): Promise<string> => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });

  const attachFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const next: Attachment[] = [];
    for (const f of arr) {
      const isImage = f.type.startsWith('image/');
      if (isImage) {
        const dataUrl = await readFileAsDataUrl(f);
        next.push({ id: 'att_' + Math.random().toString(36).slice(2, 8), kind: 'image', name: f.name, ref: dataUrl });
      } else {
        // 非图片：用 file.path（Electron 特性，若存在），否则退化为文件名
        const p = (f as any).path || f.name;
        next.push({ id: 'att_' + Math.random().toString(36).slice(2, 8), kind: 'file', name: f.name, ref: p });
      }
    }
    setAttachments((prev) => [...prev, ...next]);
  };

  const onDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    await attachFiles(e.dataTransfer.files);
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) {
      e.preventDefault();
      await attachFiles(files);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const setDoc = (md: string) => {
    setValue(mdToSlate(md) as unknown as Descendant[]);
    ReactEditor.focus(editor);
  };
  void setDoc;

  const hasContent = attachments.length > 0 || (value as any[]).some((b) => b.type !== 'paragraph' || b.children.some((c: any) => c.text || c.type === 'mention'));

  return (
    <div
      className="border-t border-pb-border bg-pb-panel p-2"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {attachments.length > 0 && (
        <div data-testid="ai-attachments" className="mb-1 flex flex-wrap gap-1">
          {attachments.map((a) => (
            <div
              key={a.id}
              data-testid="ai-attachment"
              data-kind={a.kind}
              className="inline-flex items-center gap-1 rounded border border-pb-border bg-pb-bg px-1.5 py-0.5 text-[11px]"
            >
              {a.kind === 'image'
                ? <img src={a.ref} alt="" className="h-4 w-4 rounded object-cover" />
                : <Paperclip size={10} />
              }
              <span className="max-w-[140px] truncate">{a.name}</span>
              <button onClick={() => removeAttachment(a.id)} className="opacity-60 hover:opacity-100"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}
      <Slate editor={editor} initialValue={value} onChange={onChange}>
        <div className="flex items-end gap-1 relative">
          <button
            type="button"
            data-testid="ai-attach"
            data-open={attachMenuOpen ? 'true' : 'false'}
            onClick={() => setAttachMenuOpen((v) => !v)}
            className="pb-btn shrink-0"
            title="附加文件/图片"
          >
            <Paperclip size={14} />
          </button>
          {attachMenuOpen && (
            <div
              data-testid="ai-attach-menu"
              className="absolute bottom-full left-0 z-20 mb-1 min-w-[140px] rounded border border-pb-border bg-pb-panel shadow-lg"
            >
              <button
                data-testid="ai-attach-file"
                onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                className="flex w-full items-center gap-2 px-2 py-1 text-xs text-pb-fg hover:bg-pb-hover"
              >
                <Paperclip size={12} />
                <span>附加文件</span>
              </button>
              <button
                data-testid="ai-attach-image"
                onClick={() => { setAttachMenuOpen(false); imageInputRef.current?.click(); }}
                className="flex w-full items-center gap-2 px-2 py-1 text-xs text-pb-fg hover:bg-pb-hover"
              >
                <ImageIcon size={12} />
                <span>附加图片</span>
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            data-testid="ai-file-input"
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && attachFiles(e.target.files).then(() => (e.target.value = ''))}
          />
          <input
            ref={imageInputRef}
            data-testid="ai-image-input"
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && attachFiles(e.target.files).then(() => (e.target.value = ''))}
          />
          <Editable
            data-testid="ai-composer"
            placeholder="给 AI 发消息（Enter 发送 · Shift+Enter 换行 · @ 引用）"
            renderElement={renderElement}
            renderLeaf={renderLeaf}
            renderPlaceholder={renderPlaceholder}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            readOnly={disabled}
            className="relative flex-1 min-h-[32px] max-h-40 overflow-auto rounded bg-pb-bg px-2 py-1 text-sm leading-5 outline-none"
          />
          <button
            type="button"
            data-testid="ai-send"
            onClick={doSend}
            disabled={disabled || !hasContent}
            className="pb-btn shrink-0 bg-pb-accent text-white disabled:opacity-50 disabled:bg-pb-hover"
            title="发送 (Enter)"
          >
            <Send size={14} />
          </button>
        </div>
      </Slate>
      {mentionQuery && (
        <div data-testid="mention-popover" className="mt-1 rounded border border-pb-border bg-pb-panel text-xs">
          {/* kind tabs */}
          <div className="flex border-b border-pb-border" data-testid="mention-kind-tabs">
            {(['flow','rule','plugin','skill','file'] as MentionKind[]).map((k) => (
              <button
                key={k}
                data-testid={`mention-kind-${k}`}
                data-active={mentionKind === k ? 'true' : 'false'}
                onClick={() => { setMentionKind(k); ReactEditor.focus(editor); }}
                className={cn(
                  'flex-1 px-2 py-1 text-[11px]',
                  mentionKind === k ? 'bg-pb-selected text-white' : 'text-pb-muted hover:bg-pb-hover',
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="max-h-40 overflow-auto">
            {options.length === 0 && (
              <div className="px-2 py-2 text-pb-muted">无匹配项</div>
            )}
            {options.map((o, i) => (
              <button
                key={o.kind + ':' + o.refId + ':' + i}
                data-testid="mention-option"
                data-kind={o.kind}
                data-active={i === activeIdx ? 'true' : 'false'}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => insertMention(o)}
                className={cn(
                  'flex w-full items-center gap-1 truncate px-2 py-1 text-left',
                  i === activeIdx ? 'bg-pb-hover' : '',
                )}
              >
                <span className="shrink-0 rounded bg-pb-hover px-1 text-[10px] uppercase text-pb-muted">{KIND_LABEL[o.kind]}</span>
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="ml-auto max-w-[40%] truncate text-[10px] text-pb-muted">{o.hint}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-1 text-xs text-pb-muted flex items-center flex-wrap gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1"><kbd className="inline-flex items-center rounded border border-pb-border bg-pb-bg/60 px-1.5 py-[1px] font-mono leading-none">Enter</kbd> 发送</span>
        <span className="text-pb-muted">·</span>
        <span className="inline-flex items-center gap-1"><kbd className="inline-flex items-center rounded border border-pb-border bg-pb-bg/60 px-1.5 py-[1px] font-mono leading-none">⇧Enter</kbd> 换行</span>
        <span className="text-pb-muted">·</span>
        <span className="inline-flex items-center gap-1"><kbd className="inline-flex items-center rounded border border-pb-border bg-pb-bg/60 px-1.5 py-[1px] font-mono leading-none">@</kbd> 引用抓包/规则/插件/Skill/文件</span>
      </div>
    </div>
  );
}

function withMention<T extends Editor>(editor: T): T {
  const { isInline, isVoid } = editor;
  editor.isInline = (el: any) => (el.type === 'mention' ? true : isInline(el));
  editor.isVoid = (el: any) => (el.type === 'mention' ? true : isVoid(el));
  return editor;
}

void SlateElement;
