/**
 * WebSocket 帧解析器（RFC 6455），增量友好。
 *
 * 从一个方向的 TCP 字节流中解析出完整 WS 帧。支持分片（continuation）、
 * mask、扩展长度。ping/pong/close 控制帧也上报。
 */
import type { WSMessage, WSDirection } from '../../shared/types';

interface Fragment {
  opcode: number;
  chunks: Buffer[];
}

export class WSParser {
  private buffer = Buffer.alloc(0);
  private fragment: Fragment | null = null;
  private direction: WSDirection;

  constructor(direction: WSDirection) {
    this.direction = direction;
  }

  push(chunk: Buffer): WSMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out: WSMessage[] = [];
    while (true) {
      const frame = this.tryReadFrame();
      if (!frame) break;
      const msg = this.handleFrame(frame);
      if (msg) out.push(msg);
    }
    return out;
  }

  private tryReadFrame(): { fin: boolean; opcode: number; payload: Buffer } | null {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < offset + 2) return null;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      len = Number(big);
      offset += 8;
    }

    let maskKey: Buffer | null = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + len) return null;
    let payload = buf.subarray(offset, offset + len);
    if (maskKey) {
      const unmasked = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
      payload = unmasked;
    } else {
      payload = Buffer.from(payload);
    }

    this.buffer = buf.subarray(offset + len);
    return { fin, opcode, payload };
  }

  private handleFrame(frame: { fin: boolean; opcode: number; payload: Buffer }): WSMessage | null {
    const { fin, opcode, payload } = frame;

    // 控制帧: 0x8 close, 0x9 ping, 0xA pong —— 不参与分片
    if (opcode === 0x8 || opcode === 0x9 || opcode === 0xa) {
      const type = opcode === 0x8 ? 'close' : opcode === 0x9 ? 'ping' : 'pong';
      return {
        direction: this.direction,
        type,
        text: payload.length ? payload.toString('utf8') : undefined,
        size: payload.length,
        receivedAt: Date.now(),
      };
    }

    // 数据帧: 0x1 text, 0x2 binary, 0x0 continuation
    if (opcode === 0x1 || opcode === 0x2) {
      this.fragment = { opcode, chunks: [payload] };
    } else if (opcode === 0x0 && this.fragment) {
      this.fragment.chunks.push(payload);
    } else {
      return null;
    }

    if (!fin) return null;

    const full = Buffer.concat(this.fragment.chunks);
    const isText = this.fragment.opcode === 0x1;
    this.fragment = null;
    return {
      direction: this.direction,
      type: isText ? 'text' : 'binary',
      text: isText ? full.toString('utf8') : undefined,
      base64: isText ? undefined : full.toString('base64'),
      size: full.length,
      receivedAt: Date.now(),
    };
  }
}
