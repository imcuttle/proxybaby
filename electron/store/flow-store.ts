/**
 * 内存中的 Flow 会话存储。
 * 上限保护：超过 MAX_FLOWS 时丢弃最早的（FIFO），避免长时间抓包内存爆炸。
 */
import type { Flow, SSEFrame, ResponseData, WSMessage } from '../../shared/types';

const MAX_FLOWS = 5000;

export class FlowStore {
  private flows: Flow[] = [];
  private byId = new Map<string, Flow>();

  add(flow: Flow) {
    this.flows.push(flow);
    this.byId.set(flow.id, flow);
    if (this.flows.length > MAX_FLOWS) {
      const removed = this.flows.shift();
      if (removed) this.byId.delete(removed.id);
    }
  }

  get(id: string): Flow | undefined {
    return this.byId.get(id);
  }

  all(): Flow[] {
    return this.flows;
  }

  clear() {
    this.flows = [];
    this.byId.clear();
  }

  updateRequestBody(id: string, bodyText?: string, bodyBase64?: string, bodySize?: number) {
    const f = this.byId.get(id);
    if (!f) return;
    if (bodyText !== undefined) f.request.bodyText = bodyText;
    if (bodyBase64 !== undefined) f.request.bodyBase64 = bodyBase64;
    if (bodySize !== undefined) f.request.bodySize = bodySize;
  }

  updateResponseHeaders(id: string, response: ResponseData) {
    const f = this.byId.get(id);
    if (!f) return;
    f.response = response;
    f.status = response.isSSE ? 'streaming' : 'headers';
  }

  appendSSEFrame(id: string, frame: SSEFrame) {
    const f = this.byId.get(id);
    if (!f) return;
    f.sseFrames.push(frame);
  }

  appendWSMessage(id: string, message: WSMessage) {
    const f = this.byId.get(id);
    if (!f) return;
    if (!f.wsMessages) f.wsMessages = [];
    f.wsMessages.push(message);
  }

  updateResponseBody(id: string, bodyText?: string, bodyBase64?: string, bodySize?: number) {
    const f = this.byId.get(id);
    if (!f || !f.response) return;
    if (bodyText !== undefined) f.response.bodyText = bodyText;
    if (bodyBase64 !== undefined) f.response.bodyBase64 = bodyBase64;
    if (bodySize !== undefined) f.response.bodySize = bodySize;
  }

  finalize(id: string, durationMs: number, status: Flow['status'], error?: string) {
    const f = this.byId.get(id);
    if (!f) return;
    f.durationMs = durationMs;
    f.status = status;
    if (error) f.errorMessage = error;
  }

  remove(id: string): boolean {
    const f = this.byId.get(id);
    if (!f) return false;
    this.byId.delete(id);
    const idx = this.flows.indexOf(f);
    if (idx >= 0) this.flows.splice(idx, 1);
    return true;
  }

  setNote(id: string, note: string): boolean {
    const f = this.byId.get(id);
    if (!f) return false;
    f.note = note;
    return true;
  }

  setHighlight(id: string, color: string | null): boolean {
    const f = this.byId.get(id);
    if (!f) return false;
    if (color) f.highlight = color; else delete f.highlight;
    return true;
  }
}
