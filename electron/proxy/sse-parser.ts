/**
 * SSE 帧解析器（增量友好）。
 * 输入一个持续 buffer，每次可能进来任意字节；输出已完整的帧列表和残余 buffer。
 * SSE 规范：以空行分帧；每行以 `field:value` 形式，data 行可多次出现（用 \n 连接）。
 */
import type { SSEFrame } from '../../shared/types';

export class SSEParser {
  private buffer = '';

  push(chunk: string): SSEFrame[] {
    this.buffer += chunk;
    const frames: SSEFrame[] = [];
    let idx: number;
    // 每帧以空行 (\n\n 或 \r\n\r\n) 结尾
    while (true) {
      const rn = this.buffer.indexOf('\r\n\r\n');
      const nn = this.buffer.indexOf('\n\n');
      let boundary = -1;
      let sepLen = 0;
      if (rn === -1 && nn === -1) break;
      if (rn === -1) { boundary = nn; sepLen = 2; }
      else if (nn === -1) { boundary = rn; sepLen = 4; }
      else if (rn < nn) { boundary = rn; sepLen = 4; }
      else { boundary = nn; sepLen = 2; }

      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + sepLen);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  flush(): SSEFrame[] {
    if (!this.buffer.trim()) return [];
    const frame = parseFrame(this.buffer);
    this.buffer = '';
    return frame ? [frame] : [];
  }
}

function parseFrame(raw: string): SSEFrame | null {
  const lines = raw.split(/\r?\n/);
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(':')) continue; // comment
    const colon = line.indexOf(':');
    let field: string;
    let value: string;
    if (colon === -1) { field = line; value = ''; }
    else { field = line.slice(0, colon); value = line.slice(colon + 1); if (value.startsWith(' ')) value = value.slice(1); }
    switch (field) {
      case 'event': event = value; break;
      case 'data': dataLines.push(value); break;
      case 'id': id = value; break;
      case 'retry': retry = Number(value) || undefined; break;
    }
  }
  if (dataLines.length === 0 && !event) return null;
  return {
    id,
    event,
    retry,
    data: dataLines.join('\n'),
    raw,
    receivedAt: Date.now(),
  };
}
