/**
 * markdown ↔ Slate 转换（用于消息渲染 + 输入框序列化）
 *
 * 只支持我们需要的最小子集：
 *   - 段落 / 换行
 *   - 内联代码
 *   - 粗体 / 斜体
 *   - 代码块 ```lang
 *   - 特殊 mention 语法：`kind:id`（kind ∈ flow|file|rule|plugin|skill）
 *
 * 不引入完整 remark 依赖以减小 bundle，且我们的语法很窄。
 */

export type MentionKind = 'flow' | 'file' | 'rule' | 'plugin' | 'skill';

export type TextLeaf = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

export type MentionNode = {
  type: 'mention';
  kind: MentionKind;
  refId: string;
  children: [{ text: '' }]; // Slate inline void 必须有空 text 子节点
};

export type InlineNode = TextLeaf | MentionNode;

export type ParagraphNode = {
  type: 'paragraph';
  children: InlineNode[];
};

export type CodeBlockNode = {
  type: 'code-block';
  lang?: string;
  children: [{ text: string }];
};

export type ImageBlockNode = {
  type: 'image';
  url: string;
  alt?: string;
  children: [{ text: '' }];
};

export type BlockNode = ParagraphNode | CodeBlockNode | ImageBlockNode;

const MENTION_KINDS: readonly MentionKind[] = ['flow', 'file', 'rule', 'plugin', 'skill'] as const;

function isMentionKind(x: string): x is MentionKind {
  return (MENTION_KINDS as readonly string[]).includes(x);
}

/** 检查 inline code 内容是否是 `kind:id` mention 形态。 */
export function parseMentionText(inner: string): { kind: MentionKind; refId: string } | null {
  const idx = inner.indexOf(':');
  if (idx <= 0) return null;
  const kind = inner.slice(0, idx);
  const refId = inner.slice(idx + 1);
  if (!isMentionKind(kind)) return null;
  if (!refId) return null;
  return { kind, refId };
}

/**
 * 将一行文本解析为 inline 节点数组。
 * 支持 **bold** / *italic* / `code`（含 mention 语法特化）。
 */
export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;
  let buf = '';
  const flushText = (leaf?: Omit<TextLeaf, 'text'>) => {
    if (!buf) return;
    out.push({ text: buf, ...(leaf || {}) });
    buf = '';
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '`') {
      // inline code：找下一个 `
      const end = text.indexOf('`', i + 1);
      if (end < 0) {
        buf += ch;
        i++;
        continue;
      }
      const inner = text.slice(i + 1, end);
      // 先 flush 普通文本
      flushText();
      // 尝试识别 mention
      const m = parseMentionText(inner);
      if (m) {
        out.push({ type: 'mention', kind: m.kind, refId: m.refId, children: [{ text: '' }] });
      } else {
        out.push({ text: inner, code: true });
      }
      i = end + 1;
      continue;
    }
    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end < 0) {
        buf += ch;
        i++;
        continue;
      }
      flushText();
      out.push({ text: text.slice(i + 2, end), bold: true });
      i = end + 2;
      continue;
    }
    if (ch === '*') {
      const end = text.indexOf('*', i + 1);
      if (end < 0) {
        buf += ch;
        i++;
        continue;
      }
      flushText();
      out.push({ text: text.slice(i + 1, end), italic: true });
      i = end + 1;
      continue;
    }
    buf += ch;
    i++;
  }
  flushText();
  if (!out.length) out.push({ text: '' });
  return out;
}

/** markdown 文本 → Slate 树（块级） */
export function mdToSlate(md: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fenceM = /^```(\w*)\s*$/.exec(line);
    if (fenceM) {
      const lang = fenceM[1] || undefined;
      const start = i + 1;
      let end = start;
      while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
      const code = lines.slice(start, end).join('\n');
      blocks.push({ type: 'code-block', lang, children: [{ text: code }] });
      i = end + 1;
      continue;
    }
    // 图片行：整行为 ![alt](url)
    const imgM = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
    if (imgM) {
      blocks.push({ type: 'image', alt: imgM[1] || undefined, url: imgM[2], children: [{ text: '' }] });
      i++;
      continue;
    }
    // 段落：连续非空 → 用 \n 拼接成一个 paragraph
    if (!line.trim()) {
      i++;
      continue;
    }
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^```/.test(lines[i]) && !/^!\[[^\]]*\]\([^)]+\)\s*$/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    const inline = parseInline(paraLines.join('\n'));
    blocks.push({ type: 'paragraph', children: inline });
  }
  if (!blocks.length) blocks.push({ type: 'paragraph', children: [{ text: '' }] });
  return blocks;
}

/** Slate 树 → markdown 文本（发送前用） */
export function slateToMd(blocks: BlockNode[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'code-block') {
      parts.push('```' + (b.lang || '') + '\n' + b.children[0].text + '\n```');
      continue;
    }
    if (b.type === 'image') {
      parts.push('![' + (b.alt || '') + '](' + b.url + ')');
      continue;
    }
    const inline = b.children.map(inlineToMd).join('');
    parts.push(inline);
  }
  return parts.join('\n\n');
}

function inlineToMd(n: InlineNode): string {
  if ('type' in n && n.type === 'mention') {
    return '`' + n.kind + ':' + n.refId + '`';
  }
  const leaf = n as TextLeaf;
  let t = leaf.text;
  if (leaf.code) return '`' + t + '`';
  if (leaf.bold) t = '**' + t + '**';
  if (leaf.italic) t = '*' + t + '*';
  return t;
}

/** 空 paragraph（Composer 初始值 / 清空后使用） */
export function emptyDoc(): BlockNode[] {
  return [{ type: 'paragraph', children: [{ text: '' }] }];
}
