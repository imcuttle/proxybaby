/**
 * 只读的 Markdown → Slate 渲染。
 *
 * 用于消息气泡里展示 assistant/user 的 markdown 内容，
 * 支持我们的 mention 语法（`kind:id` 渲染成胶囊）。
 */
import { useMemo } from 'react';
import { createEditor, Descendant, Editor, Element as SlateElement, Text } from 'slate';
import { Slate, Editable, withReact, RenderElementProps, RenderLeafProps } from 'slate-react';
import { withHistory } from 'slate-history';
import { mdToSlate, MentionKind } from '../../lib/ai/md-slate';
import { MentionChip } from './MentionChip';

interface Props {
  markdown: string;
}

export function MarkdownSlateView({ markdown }: Props) {
  const editor = useMemo(() => withMention(withHistory(withReact(createEditor()))), []);
  const value = useMemo<Descendant[]>(() => mdToSlate(markdown) as unknown as Descendant[], [markdown]);

  return (
    <div className="ai-markdown">
      <Slate editor={editor} initialValue={value} key={markdown}>
        <Editable
          readOnly
          renderElement={renderElement}
          renderLeaf={renderLeaf}
          data-testid="ai-msg-body"
        />
      </Slate>
    </div>
  );
}

function withMention<T extends Editor>(editor: T): T {
  const { isInline, isVoid } = editor;
  editor.isInline = (el: any) => (el.type === 'mention' ? true : isInline(el));
  editor.isVoid = (el: any) => (el.type === 'mention' || el.type === 'image' ? true : isVoid(el));
  return editor;
}

function renderElement(props: RenderElementProps) {
  const el = props.element as any;
  if (el.type === 'mention') {
    return (
      <span {...props.attributes} contentEditable={false}>
        <MentionChip kind={el.kind as MentionKind} refId={el.refId} />
        {props.children}
      </span>
    );
  }
  if (el.type === 'image') {
    return (
      <div {...props.attributes} contentEditable={false} className="my-1">
        <img
          src={el.url}
          alt={el.alt || ''}
          data-testid="ai-image"
          className="max-w-full max-h-80 rounded border border-pb-border"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
        {el.alt && <div className="text-[10px] text-pb-muted mt-0.5">{el.alt}</div>}
        {props.children}
      </div>
    );
  }
  if (el.type === 'code-block') {
    return (
      <pre {...props.attributes} className="my-2 rounded bg-pb-hover px-2 py-1 text-xs whitespace-pre-wrap">
        <code>{props.children}</code>
      </pre>
    );
  }
  return (
    <p {...props.attributes} className="whitespace-pre-wrap leading-relaxed">
      {props.children}
    </p>
  );
}

function renderLeaf(props: RenderLeafProps) {
  const leaf = props.leaf as any;
  let node = <>{props.children}</>;
  if (leaf.code) node = <code className="rounded bg-pb-hover px-1 text-xs">{node}</code>;
  if (leaf.bold) node = <strong>{node}</strong>;
  if (leaf.italic) node = <em>{node}</em>;
  return <span {...props.attributes}>{node}</span>;
}

// SlateElement / Text 只用作类型引用，避免 tree-shake 报错。
void SlateElement; void Text;
