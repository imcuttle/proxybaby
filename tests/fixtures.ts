import type { Flow, RequestData, SSEFrame } from '../shared/types';

export function mkReq(over: Partial<RequestData> = {}): RequestData {
  return {
    method: 'POST',
    url: 'https://api.x.com/v1/chat/completions',
    host: 'api.x.com',
    path: '/v1/chat/completions',
    scheme: 'https',
    httpVersion: '1.1',
    headers: [],
    bodySize: 0,
    startedAt: Date.now(),
    ...over,
  };
}

export function mkFlow(over: Partial<Flow> = {}): Flow {
  return { id: 'x', status: 'completed', isTLS: true, sseFrames: [], request: mkReq(), ...over };
}

export function sse(data: string, event?: string): SSEFrame {
  return { data, event, raw: '', receivedAt: 0 };
}
