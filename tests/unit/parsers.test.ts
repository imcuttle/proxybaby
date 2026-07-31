import { describe, it, expect } from 'vitest';
import { parseOpenAI } from '../../src/parsers/openai';
import { parseAnthropic } from '../../src/parsers/anthropic';
import { parseACP } from '../../src/parsers/acp';
import { detectProvider } from '../../src/parsers';
import { mkFlow, mkReq, sse } from '../fixtures';

describe('OpenAI 解析', () => {
  it('流式 content + tool_calls 增量拼接', () => {
    const flow = mkFlow({
      request: mkReq({ bodyText: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }) }),
      response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: true },
      sseFrames: [
        sse('{"choices":[{"delta":{"content":"Hello"}}]}'),
        sse('{"choices":[{"delta":{"content":" world"}}]}'),
        sse('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"get_weather","arguments":"{\\"ci"}}]}}]}'),
        sse('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\\":\\"SF\\"}"}}]},"finish_reason":"tool_calls"}]}'),
      ],
    });
    const s = parseOpenAI(flow);
    expect(s.model).toBe('gpt-4o');
    const a = s.messages.at(-1)!;
    expect(a.content).toBe('Hello world');
    expect(a.toolCalls?.[0].name).toBe('get_weather');
    expect(a.toolCalls?.[0].argumentsText).toBe('{"city":"SF"}');
    expect(a.toolCalls?.[0].argumentsParsed).toEqual({ city: 'SF' });
  });

  it('非流式 message + usage + system', () => {
    const flow = mkFlow({
      request: mkReq({ bodyText: JSON.stringify({ model: 'gpt-4', temperature: 0.7, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] }) }),
      response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: false, bodyText: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }) },
    });
    const s = parseOpenAI(flow);
    expect(s.temperature).toBe(0.7);
    expect(s.usage?.totalTokens).toBe(8);
    expect(s.messages.some((m) => m.role === 'system')).toBe(true);
    expect(s.messages.at(-1)!.content).toBe('answer');
  });
});

describe('Anthropic 解析', () => {
  it('流式 text + tool_use(input_json_delta)', () => {
    const flow = mkFlow({
      request: mkReq({ url: 'https://api.anthropic.com/v1/messages', host: 'api.anthropic.com', path: '/v1/messages', bodyText: JSON.stringify({ model: 'claude', system: 'sys', messages: [{ role: 'user', content: 'find cats' }] }) }),
      response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: true },
      sseFrames: [
        sse('{"message":{"model":"claude-3"}}', 'message_start'),
        sse('{"index":0,"content_block":{"type":"text"}}', 'content_block_start'),
        sse('{"index":0,"delta":{"type":"text_delta","text":"Let me search"}}', 'content_block_delta'),
        sse('{"index":1,"content_block":{"type":"tool_use","id":"tu1","name":"search"}}', 'content_block_start'),
        sse('{"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}', 'content_block_delta'),
        sse('{"index":1,"delta":{"type":"input_json_delta","partial_json":"\\"cats\\"}"}}', 'content_block_delta'),
        sse('{"delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":10,"output_tokens":20}}', 'message_delta'),
        sse('{}', 'message_stop'),
      ],
    });
    expect(detectProvider(flow)).toBe('anthropic');
    const s = parseAnthropic(flow);
    const a = s.messages.at(-1)!;
    expect(a.content).toBe('Let me search');
    expect(a.toolCalls?.[0].name).toBe('search');
    expect(a.toolCalls?.[0].argumentsText).toBe('{"q":"cats"}');
    expect(s.usage?.totalTokens).toBe(30);
    expect(a.finishReason).toBe('tool_use');
  });
});

describe('ACP 解析', () => {
  it('SSE：agent/message + tool/call + tool/result', () => {
    const flow = mkFlow({
      request: mkReq({ url: 'https://host/acp/session', host: 'host', path: '/acp/session', bodyText: '{}' }),
      response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: true },
      sseFrames: [
        sse('{"type":"agent/message","text":"Working"}'),
        sse('{"type":"tool/call","id":"c1","name":"run","input":{"cmd":"ls"}}'),
        sse('{"type":"tool/result","id":"c1","content":"file1\\nfile2"}'),
        sse('{"type":"done"}'),
      ],
    });
    expect(detectProvider(flow)).toBe('acp');
    const s = parseACP(flow);
    expect(s.messages.some((m) => m.role === 'tool' && m.content.includes('file1'))).toBe(true);
    const a = s.messages.find((m) => m.role === 'assistant');
    expect(a?.content).toBe('Working');
    expect(a?.toolCalls?.[0].name).toBe('run');
  });

  it('over WebSocket：JSON-RPC method/params', () => {
    const flow = mkFlow({
      isWebSocket: true,
      sseFrames: [],
      request: mkReq({ url: 'wss://host/acp', host: 'host', path: '/acp' }),
      wsMessages: [
        { direction: 'recv', type: 'text', text: JSON.stringify({ method: 'agent/message', params: { text: 'Hello ' } }), size: 0, receivedAt: 0 },
        { direction: 'recv', type: 'text', text: JSON.stringify({ method: 'agent/message', params: { text: 'from ACP' } }), size: 0, receivedAt: 0 },
        { direction: 'recv', type: 'text', text: JSON.stringify({ method: 'tool/call', params: { id: 't1', name: 'search', input: { q: 'x' } } }), size: 0, receivedAt: 0 },
      ],
    });
    expect(detectProvider(flow)).toBe('acp');
    const s = parseACP(flow);
    const a = s.messages.at(-1)!;
    expect(a.content).toBe('Hello from ACP');
    expect(a.toolCalls?.[0].name).toBe('search');
  });
});

describe('Provider 识别', () => {
  it('body messages 兜底 openai', () => {
    const f = mkFlow({ request: mkReq({ url: 'https://custom/api', host: 'custom', path: '/api', bodyText: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }) }) });
    expect(detectProvider(f)).toBe('openai');
  });
  it('非 AI 请求 unknown', () => {
    const f = mkFlow({ request: mkReq({ url: 'https://x/y', host: 'x', path: '/y', bodyText: '{"foo":1}' }) });
    expect(detectProvider(f)).toBe('unknown');
  });
});
