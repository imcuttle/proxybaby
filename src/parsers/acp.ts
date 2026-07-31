/**
 * Agent Client Protocol (ACP) 解析（SSE）。
 *
 * ACP 是较新的规范，事件常见形态：
 *   - session/update, agent/message, agent/thought, tool/call, tool/result
 * 由于官方仍在演进，这里做「宽松兼容」：优先按 event/type 字段分派，
 * 未识别的事件把原始 JSON 作为一条 assistant 增量文本追加，以便至少能看到内容。
 */
import type { Flow, ChatSession, ChatMessage, ChatToolCall } from '../../shared/types';

export function parseACP(flow: Flow): ChatSession {
  const messages: ChatMessage[] = [];
  const asst: ChatMessage = {
    id: 'assistant-stream',
    role: 'assistant',
    content: '',
    streaming: true,
    source: 'response',
  };
  const toolCalls = new Map<string, ChatToolCall>();

  // 请求侧：如果 body 含 messages/prompt/system 尽力提取
  if (flow.request.bodyText) {
    try {
      const req = JSON.parse(flow.request.bodyText);
      if (req.system) messages.push({ id: 'system', role: 'system', content: String(req.system), streaming: false, source: 'request' });
      if (typeof req.prompt === 'string') {
        messages.push({ id: 'user', role: 'user', content: req.prompt, streaming: false, source: 'request' });
      }
      if (Array.isArray(req.messages)) {
        req.messages.forEach((m: any, i: number) => {
          messages.push({
            id: `req-${i}`,
            role: m.role || 'user',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            streaming: false,
            source: 'request',
          });
        });
      }
    } catch {}
  }

  // 统一帧来源：SSE 帧 + WebSocket 文本消息（ACP over ws，JSON-RPC 风格）
  const frameList: { data: string; event?: string }[] = [
    ...flow.sseFrames.map((f) => ({ data: f.data, event: f.event })),
    ...(flow.wsMessages || [])
      .filter((m) => m.type === 'text' && m.text)
      .map((m) => ({ data: m.text as string, event: undefined })),
  ];

  for (const frame of frameList) {
    let data: any;
    try { data = JSON.parse(frame.data); } catch {
      asst.content += frame.data;
      continue;
    }
    // JSON-RPC 风格：{ method, params } → 归一到 type，params 提升为 data
    if (data.method && data.params) {
      const method = data.method;
      data = { ...data.params, type: method };
    }
    const type = data.type || data.event || frame.event;
    switch (type) {
      case 'agent/message':
      case 'session/update':
      case 'message':
      case 'text':
      case 'text_delta': {
        const t = data.text || data.delta?.text || data.content || '';
        asst.content += String(t);
        break;
      }
      case 'agent/thought':
      case 'thinking':
      case 'thinking_delta': {
        const t = data.text || data.thinking || data.delta || '';
        asst.reasoning = (asst.reasoning || '') + String(t);
        break;
      }
      case 'tool/call':
      case 'tool_use':
      case 'tool_call': {
        const id = data.id || data.call_id || String(toolCalls.size);
        let tc = toolCalls.get(id);
        if (!tc) {
          tc = { id, name: data.name || data.tool || '', argumentsText: '' };
          toolCalls.set(id, tc);
        }
        if (data.name) tc.name = data.name;
        if (data.input) {
          tc.argumentsParsed = data.input;
          tc.argumentsText = JSON.stringify(data.input);
        } else if (data.partial_input) {
          tc.argumentsText += String(data.partial_input);
        } else if (data.arguments) {
          tc.argumentsText += typeof data.arguments === 'string'
            ? data.arguments
            : JSON.stringify(data.arguments);
        }
        break;
      }
      case 'tool/result':
      case 'tool_result': {
        const content = data.content || data.result || data.output || '';
        messages.push({
          id: `toolres-${messages.length}`,
          role: 'tool',
          content: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
          toolCallId: data.id || data.call_id,
          toolName: data.name,
          streaming: false,
        });
        break;
      }
      case 'done':
      case 'stop':
      case 'session/end':
        asst.streaming = false;
        break;
      default:
        // 未知：把原始附加到 assistant，以便调试
        break;
    }
  }

  if (flow.status === 'completed' || flow.status === 'error') asst.streaming = false;

  const tcs = [...toolCalls.values()];
  if (tcs.length) {
    for (const t of tcs) {
      if (!t.argumentsParsed) {
        try { t.argumentsParsed = JSON.parse(t.argumentsText); } catch {}
      }
    }
    asst.toolCalls = tcs;
  }
  // assistant 位置：在 tool 结果消息之前（用户视觉上更合理）
  messages.push(asst);

  return {
    provider: 'acp',
    messages,
    streaming: asst.streaming,
  };
}
