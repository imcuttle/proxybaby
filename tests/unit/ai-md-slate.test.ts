import { describe, it, expect } from 'vitest';
import {
  mdToSlate,
  slateToMd,
  parseInline,
  parseMentionText,
} from '../../src/lib/ai/md-slate';

describe('md-slate', () => {
  it('parseMentionText 识别合法/非法 kind', () => {
    expect(parseMentionText('flow:f_a1')).toEqual({ kind: 'flow', refId: 'f_a1' });
    expect(parseMentionText('file:/tmp/user.json')).toEqual({ kind: 'file', refId: '/tmp/user.json' });
    expect(parseMentionText('rule:r_x')).toEqual({ kind: 'rule', refId: 'r_x' });
    expect(parseMentionText('plugin:whistle-rules')).toEqual({ kind: 'plugin', refId: 'whistle-rules' });
    expect(parseMentionText('skill:proxybaby')).toEqual({ kind: 'skill', refId: 'proxybaby' });

    expect(parseMentionText('nope:x')).toBeNull();
    expect(parseMentionText('flow:')).toBeNull();
    expect(parseMentionText('flow')).toBeNull();
    expect(parseMentionText('nocolon')).toBeNull();
  });

  it('parseInline: mention 语法 → inline void 节点', () => {
    const inline = parseInline('hi `flow:f_a1` world');
    expect(inline).toEqual([
      { text: 'hi ' },
      { type: 'mention', kind: 'flow', refId: 'f_a1', children: [{ text: '' }] },
      { text: ' world' },
    ]);
  });

  it('parseInline: 非 mention 的反引号仍作为普通 code', () => {
    const inline = parseInline('run `curl` here');
    expect(inline).toEqual([
      { text: 'run ' },
      { text: 'curl', code: true },
      { text: ' here' },
    ]);
  });

  it('parseInline: bold / italic', () => {
    expect(parseInline('a **b** c *d* e')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c ' },
      { text: 'd', italic: true },
      { text: ' e' },
    ]);
  });

  it('mdToSlate: 段落 + 代码块', () => {
    const md = '第一段\n有换行\n\n```js\nconsole.log(1)\n```\n\n第二段 `flow:f1`';
    const blocks = mdToSlate(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
    expect(blocks[1]).toMatchObject({ type: 'code-block', lang: 'js' });
    expect((blocks[1] as any).children[0].text).toBe('console.log(1)');
    // 第二段里应有 mention
    const inline2 = (blocks[2] as any).children;
    expect(inline2.some((n: any) => n.type === 'mention' && n.refId === 'f1')).toBe(true);
  });

  it('slateToMd: mention 反序列化为反引号语法', () => {
    const blocks = [
      {
        type: 'paragraph' as const,
        children: [
          { text: '请 mock ' },
          { type: 'mention' as const, kind: 'flow' as const, refId: 'f_x', children: [{ text: '' as const }] },
          { text: '' },
        ],
      },
    ];
    expect(slateToMd(blocks as any)).toBe('请 mock `flow:f_x`');
  });

  it('slateToMd + mdToSlate 往返（简单情况）', () => {
    const md = '你好 **粗体** `flow:f1` 和 `file:/tmp/a.json`';
    const round = slateToMd(mdToSlate(md));
    expect(round).toContain('**粗体**');
    expect(round).toContain('`flow:f1`');
    expect(round).toContain('`file:/tmp/a.json`');
  });
});
