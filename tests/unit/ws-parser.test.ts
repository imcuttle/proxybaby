import { describe, it, expect } from 'vitest';
import { WSParser } from '../../electron/proxy/ws-parser';

function frame(opcode: number, payload: Buffer, masked: boolean, fin = true): Buffer {
  const b0 = (fin ? 0x80 : 0) | opcode;
  const len = payload.length;
  const head: number[] = [b0];
  if (len < 126) head.push((masked ? 0x80 : 0) | len);
  else head.push((masked ? 0x80 : 0) | 126, (len >> 8) & 0xff, len & 0xff);
  let out = Buffer.from(head);
  if (masked) {
    const k = Buffer.from([1, 2, 3, 4]);
    const mp = Buffer.alloc(len);
    for (let i = 0; i < len; i++) mp[i] = payload[i] ^ k[i % 4];
    out = Buffer.concat([out, k, mp]);
  } else {
    out = Buffer.concat([out, payload]);
  }
  return out;
}

describe('WSParser', () => {
  it('解析文本帧', () => {
    const p = new WSParser('recv');
    const r = p.push(frame(0x1, Buffer.from('hi'), false));
    expect(r[0]).toMatchObject({ type: 'text', text: 'hi', direction: 'recv' });
  });

  it('二进制帧转 base64', () => {
    const p = new WSParser('recv');
    const r = p.push(frame(0x2, Buffer.from([1, 2, 3]), false));
    expect(r[0].type).toBe('binary');
    expect(r[0].base64).toBeTruthy();
  });

  it('识别 ping/close 控制帧', () => {
    const p = new WSParser('recv');
    expect(p.push(frame(0x9, Buffer.alloc(0), false))[0].type).toBe('ping');
    expect(p.push(frame(0x8, Buffer.from('bye'), false))[0].type).toBe('close');
  });

  it('解 mask（客户端方向）', () => {
    const p = new WSParser('send');
    const r = p.push(frame(0x1, Buffer.from('masked-text'), true));
    expect(r[0].text).toBe('masked-text');
  });

  it('分片合并（fin=0 + continuation）', () => {
    const p = new WSParser('send');
    expect(p.push(frame(0x1, Buffer.from('Hel'), false, false))).toHaveLength(0);
    const r = p.push(frame(0x0, Buffer.from('lo'), false, true));
    expect(r[0].text).toBe('Hello');
  });

  it('扩展长度 126', () => {
    const p = new WSParser('recv');
    const big = Buffer.alloc(200, 65);
    const r = p.push(frame(0x1, big, false));
    expect(r[0].size).toBe(200);
  });

  it('跨 chunk 增量喂入', () => {
    const p = new WSParser('recv');
    const f = frame(0x1, Buffer.from('chunked'), false);
    expect(p.push(f.subarray(0, 3))).toHaveLength(0);
    const r = p.push(f.subarray(3));
    expect(r[0].text).toBe('chunked');
  });
});
