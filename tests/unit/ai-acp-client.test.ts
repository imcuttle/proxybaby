/**
 * AcpClient JSON-RPC 事件流单测。
 *
 * 用 disableSpawn 模式，通过 injectServerEvent 直接注入 ACP notification 形态，
 * 断言对外 EventEmitter 事件顺序与内容。
 */
import { describe, it, expect } from 'vitest';
import { AcpClient } from '../../electron/ai/acp-client';

function collect(client: AcpClient): Array<[string, any]> {
  const events: Array<[string, any]> = [];
  for (const name of ['message-start','text-delta','tool-call','tool-result','message-end','error'] as const) {
    client.on(name, (p) => events.push([name, p]));
  }
  return events;
}

describe('AcpClient (disableSpawn)', () => {
  it('注入 ACP session/update agent_message_chunk → text-delta，且首次自动 message-start', () => {
    const c = new AcpClient('local-1', { disableSpawn: true });
    c.start();
    const events = collect(c);
    c.injectServerEvent({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        _meta: { 'codebuddy.ai/messageId': 'mA' },
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } },
      },
    });
    c.injectServerEvent({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        _meta: { 'codebuddy.ai/messageId': 'mA' },
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } },
      },
    });
    expect(events.map(e => e[0])).toEqual(['message-start', 'text-delta', 'text-delta']);
    expect(events[0][1]).toEqual({ messageId: 'mA', role: 'assistant' });
    expect(events[1][1]).toEqual({ messageId: 'mA', delta: 'Hello ' });
    expect(events[2][1]).toEqual({ messageId: 'mA', delta: 'world' });
  });

  it('注入 ACP tool_call + tool_call_update(completed) → tool-call + tool-result', () => {
    const c = new AcpClient('local-2', { disableSpawn: true });
    c.start();
    const events = collect(c);
    c.injectServerEvent({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        _meta: { 'codebuddy.ai/messageId': 'mB' },
        update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Bash', rawInput: { command: 'ls' } },
      },
    });
    c.injectServerEvent({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        _meta: { 'codebuddy.ai/messageId': 'mB' },
        update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: { stdout: 'a b c' } },
      },
    });
    const kinds = events.map(e => e[0]);
    expect(kinds).toEqual(['message-start', 'tool-call', 'tool-result']);
    expect(events[1][1].toolCall).toMatchObject({ id: 't1', name: 'Bash', state: 'pending' });
    expect(events[2][1]).toMatchObject({ toolCallId: 't1', result: { stdout: 'a b c' } });
  });

  it('兼容老 schema（tests/e2e 在用）：type:text-delta 等仍能发出对外事件', () => {
    const c = new AcpClient('local-3', { disableSpawn: true });
    c.start();
    const events = collect(c);
    c.injectServerEvent({ type: 'message-start', messageId: 'a1', role: 'assistant' });
    c.injectServerEvent({ type: 'text-delta', messageId: 'a1', text: '好的' });
    c.injectServerEvent({ type: 'tool-call', messageId: 'a1', id: 'tc1', name: 'pb_rule_add', args: { x: 1 } });
    c.injectServerEvent({ type: 'tool-result', messageId: 'a1', tool_use_id: 'tc1', output: { ok: true } });
    c.injectServerEvent({ type: 'message-end', messageId: 'a1' });
    expect(events.map(e => e[0])).toEqual([
      'message-start', 'text-delta', 'tool-call', 'tool-result', 'message-end',
    ]);
    expect(events[1][1]).toEqual({ messageId: 'a1', delta: '好的' });
    expect(events[2][1].toolCall).toMatchObject({ id: 'tc1', name: 'pb_rule_add' });
    expect(events[3][1]).toMatchObject({ toolCallId: 'tc1', result: { ok: true } });
  });

  it('agent_thought_chunk 被忽略，不产生事件', () => {
    const c = new AcpClient('local-4', { disableSpawn: true });
    c.start();
    const events = collect(c);
    c.injectServerEvent({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '(想法)' } } },
    });
    expect(events).toEqual([]);
  });
});
