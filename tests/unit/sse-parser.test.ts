import { describe, it, expect } from 'vitest';
import { SSEParser } from '../../electron/proxy/sse-parser';

describe('SSEParser', () => {
  it('半帧不产出，补全后产出', () => {
    const p = new SSEParser();
    expect(p.push('data: {"a":')).toHaveLength(0);
    const f = p.push('1}\n\n');
    expect(f).toHaveLength(1);
    expect(f[0].data).toBe('{"a":1}');
  });

  it('一次输入多帧（CRLF 分隔）', () => {
    const p = new SSEParser();
    const f = p.push('data: a\r\n\r\ndata: b\r\n\r\n');
    expect(f.map((x) => x.data)).toEqual(['a', 'b']);
  });

  it('多行 data 用 \\n 合并', () => {
    const p = new SSEParser();
    const f = p.push('data: line1\ndata: line2\n\n');
    expect(f[0].data).toBe('line1\nline2');
  });

  it('解析 event/id，忽略注释', () => {
    const p = new SSEParser();
    const f = p.push(': comment\nevent: ping\nid: 7\ndata: {}\n\n');
    expect(f[0].event).toBe('ping');
    expect(f[0].id).toBe('7');
  });

  it('flush 输出残余帧', () => {
    const p = new SSEParser();
    p.push('data: tail');
    const f = p.flush();
    expect(f).toHaveLength(1);
    expect(f[0].data).toBe('tail');
  });
});
