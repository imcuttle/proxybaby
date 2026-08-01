/**
 * Anthropic (Claude) 协议解析。
 *
 * 请求：{ model, system, messages: [{role, content: string | Array<{type, text?, tool_use_id?, tool_result?, input?}>}], tools?, temperature? }
 * 流式响应 SSE：
 *   event: message_start        data: {message: {id, model, usage}}
 *   event: content_block_start  data: {index, content_block: {type: 'text' | 'tool_use', ...}}
 *   event: content_block_delta  data: {index, delta: {type: 'text_delta'|'input_json_delta', text? | partial_json?}}
 *   event: content_block_stop
 *   event: message_delta        data: {delta: {stop_reason}, usage}
 *   event: message_stop
 */
import type { Flow, ChatSession, ChatMessage, ChatToolCall } from '../../shared/types';

interface Block {
  type: 'text' | 'tool_use' | 'thinking';
  text: string;
  toolCall?: ChatToolCall;
}

export function parseAnthropic(flow: Flow): ChatSession {
  const messages: ChatMessage[] = [];
  let model: string | undefined;
  let temperature: number | undefined;
  let usage: ChatSession['usage'];

  // 请求
  if (flow.request.bodyText) {
    try {
      const req = JSON.parse(flow.request.bodyText);
      model = req.model;
      temperature = req.temperature;
      if (req.system) {
        messages.push({
          id: 'system',
          role: 'system',
          content: typeof req.system === 'string' ? req.system : JSON.stringify(req.system),
          streaming: false,
          source: 'request',
        });
      }
      if (Array.isArray(req.messages)) {
        for (let i = 0; i < req.messages.length; i++) {
          const msgs = fromAnthropicMessage(req.messages[i], `req-${i}`);
          for (const m of msgs) m.source = 'request';
          messages.push(...msgs);
        }
      }
    } catch {}
  }

  // 响应
  const isSSE = flow.response?.isSSE || flow.sseFrames.length > 0;
  const asst: ChatMessage = {
    id: 'assistant-stream',
    role: 'assistant',
    content: '',
    streaming: true,
    source: 'response',
  };
  const blocks: Block[] = [];

  if (isSSE) {
    for (const frame of flow.sseFrames) {
      const evt = frame.event;
      let data: any;
      try { data = JSON.parse(frame.data); } catch { continue; }
      if (evt === 'message_start') {
        model = data?.message?.model || model;
      } else if (evt === 'content_block_start') {
        const cb = data.content_block;
        if (cb?.type === 'text') blocks[data.index] = { type: 'text', text: '' };
        else if (cb?.type === 'tool_use') {
          blocks[data.index] = {
            type: 'tool_use',
            text: '',
            toolCall: { id: cb.id, name: cb.name, argumentsText: '' },
          };
        } else if (cb?.type === 'thinking') {
          blocks[data.index] = { type: 'thinking', text: '' };
        }
      } else if (evt === 'content_block_delta') {
        const b = blocks[data.index];
        if (!b) continue;
        const delta = data.delta || {};
        if (delta.type === 'text_delta' && b.type === 'text') b.text += delta.text || '';
        else if (delta.type === 'input_json_delta' && b.type === 'tool_use' && b.toolCall) {
          b.toolCall.argumentsText += delta.partial_json || '';
        } else if (delta.type === 'thinking_delta' && b.type === 'thinking') {
          b.text += delta.thinking || '';
        }
      } else if (evt === 'message_delta') {
        if (data.usage) {
          usage = {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
            cachedTokens: data.usage.cache_read_input_tokens,
            cacheCreationTokens: data.usage.cache_creation_input_tokens,
          };
        }
        if (data.delta?.stop_reason) asst.finishReason = data.delta.stop_reason;
      } else if (evt === 'message_stop') {
        asst.streaming = false;
      }
    }
    if (flow.status === 'completed' || flow.status === 'error') asst.streaming = false;
  } else if (flow.response?.bodyText) {
    // 非流式：完整 message
    try {
      const res = JSON.parse(flow.response.bodyText);
      if (res.usage) {
        usage = {
          promptTokens: res.usage.input_tokens,
          completionTokens: res.usage.output_tokens,
          totalTokens: (res.usage.input_tokens || 0) + (res.usage.output_tokens || 0),
          cachedTokens: res.usage.cache_read_input_tokens,
          cacheCreationTokens: res.usage.cache_creation_input_tokens,
        };
      }
      if (Array.isArray(res.content)) {
        for (const b of res.content) {
          if (b.type === 'text') blocks.push({ type: 'text', text: b.text });
          else if (b.type === 'tool_use') {
            blocks.push({
              type: 'tool_use',
              text: '',
              toolCall: {
                id: b.id,
                name: b.name,
                argumentsText: JSON.stringify(b.input || {}),
                argumentsParsed: b.input,
              },
            });
          }
        }
      }
      asst.streaming = false;
      asst.finishReason = res.stop_reason;
    } catch {}
  }

  // 把 blocks 汇聚到 assistant message
  const textParts: string[] = [];
  const toolCalls: ChatToolCall[] = [];
  const thinkingParts: string[] = [];
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === 'text') textParts.push(b.text);
    else if (b.type === 'thinking') thinkingParts.push(b.text);
    else if (b.type === 'tool_use' && b.toolCall) {
      try { b.toolCall.argumentsParsed = JSON.parse(b.toolCall.argumentsText); } catch {}
      toolCalls.push(b.toolCall);
    }
  }
  asst.content = textParts.join('');
  if (thinkingParts.length) asst.reasoning = thinkingParts.join('');
  if (toolCalls.length) asst.toolCalls = toolCalls;

  if (blocks.length || flow.response) messages.push(asst);

  return {
    provider: 'anthropic',
    model,
    temperature,
    usage,
    messages,
    streaming: asst.streaming,
  };
}

function fromAnthropicMessage(m: any, idBase: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  const role = m.role || 'user';
  if (typeof m.content === 'string') {
    out.push({ id: idBase, role, content: m.content, streaming: false });
    return out;
  }
  if (!Array.isArray(m.content)) return out;

  const textParts: string[] = [];
  const toolCalls: ChatToolCall[] = [];

  for (let i = 0; i < m.content.length; i++) {
    const c = m.content[i];
    if (c.type === 'text') textParts.push(c.text || '');
    else if (c.type === 'tool_use') {
      toolCalls.push({
        id: c.id,
        name: c.name,
        argumentsText: JSON.stringify(c.input || {}),
        argumentsParsed: c.input,
      });
    } else if (c.type === 'tool_result') {
      // 输出成独立 tool message
      let text = '';
      if (typeof c.content === 'string') text = c.content;
      else if (Array.isArray(c.content)) text = c.content.map((x: any) => x.text || '').join('\n');
      out.push({
        id: `${idBase}-toolres-${i}`,
        role: 'tool',
        content: text,
        toolCallId: c.tool_use_id,
        streaming: false,
      });
    }
  }
  const base: ChatMessage = { id: idBase, role, content: textParts.join('\n'), streaming: false };
  if (toolCalls.length) base.toolCalls = toolCalls;
  out.unshift(base);
  return out;
}
