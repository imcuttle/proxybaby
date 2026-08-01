/**
 * OpenAI 兼容协议解析。
 *
 * 请求 body: { model, messages: [{role, content, tool_calls?, tool_call_id?, name?}], tools?, temperature? }
 * 响应：
 *   非流式：choices[0].message.{content, tool_calls}
 *   流式  ：SSE data: {"choices":[{"delta":{"content":"...", "tool_calls":[...], "reasoning_content":"..."}}]}
 *            结束帧 data: [DONE]
 */
import type { Flow, ChatSession, ChatMessage, ChatToolCall, ChatToolDefinition } from '../../shared/types';

export function parseOpenAI(flow: Flow): ChatSession {
  const messages: ChatMessage[] = [];
  let model: string | undefined;
  let temperature: number | undefined;
  let usage: ChatSession['usage'];
  let tools: ChatToolDefinition[] | undefined;

  // 请求侧消息
  if (flow.request.bodyText) {
    try {
      const req = JSON.parse(flow.request.bodyText);
      model = req.model;
      temperature = req.temperature;
      if (Array.isArray(req.tools)) {
        tools = req.tools
          .map((t: any): ChatToolDefinition | null => {
            // OpenAI 官方 tools: [{ type: 'function', function: { name, description, parameters } }]
            const fn = t?.function ?? t;
            if (!fn?.name) return null;
            return {
              name: fn.name,
              description: fn.description,
              parameters: fn.parameters,
            };
          })
          .filter(Boolean) as ChatToolDefinition[];
        if (tools.length === 0) tools = undefined;
      }
      if (Array.isArray(req.messages)) {
        for (let i = 0; i < req.messages.length; i++) {
          const m = req.messages[i];
          const msg = fromOpenAIMessage(m, `req-${i}`);
          msg.source = 'request';
          messages.push(msg);
        }
      }
    } catch {}
  }

  // 助手消息（流式增量拼装 或 完整响应）
  const asst: ChatMessage = {
    id: 'assistant-stream',
    role: 'assistant',
    content: '',
    streaming: true,
    source: 'response',
  };

  const isSSE = flow.response?.isSSE || flow.sseFrames.length > 0;
  let hasAsst = false;

  if (isSSE) {
    for (const frame of flow.sseFrames) {
      const data = frame.data?.trim();
      if (!data || data === '[DONE]') continue;
      let json: any;
      try { json = JSON.parse(data); } catch { continue; }
      if (json.usage) {
        usage = {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
          cachedTokens: json.usage.prompt_tokens_details?.cached_tokens,
        };
      }
      const choice = json.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.content) { asst.content += String(delta.content); hasAsst = true; }
      if (delta.reasoning_content) {
        asst.reasoning = (asst.reasoning || '') + String(delta.reasoning_content);
        hasAsst = true;
      }
      if (Array.isArray(delta.tool_calls)) {
        asst.toolCalls = asst.toolCalls || [];
        for (const tc of delta.tool_calls) {
          const idx: number = tc.index ?? asst.toolCalls.length;
          let existing = asst.toolCalls[idx];
          if (!existing) {
            existing = { id: tc.id, name: tc.function?.name || '', argumentsText: '' };
            asst.toolCalls[idx] = existing;
          }
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.argumentsText += tc.function.arguments;
        }
        hasAsst = true;
      }
      if (choice.finish_reason) {
        asst.finishReason = choice.finish_reason;
        asst.streaming = false;
      }
    }
    // 流式结束条件
    if (flow.status === 'completed' || flow.status === 'error') {
      asst.streaming = false;
    }
  } else if (flow.response?.bodyText) {
    try {
      const res = JSON.parse(flow.response.bodyText);
      if (res.usage) {
        usage = {
          promptTokens: res.usage.prompt_tokens,
          completionTokens: res.usage.completion_tokens,
          totalTokens: res.usage.total_tokens,
          cachedTokens: res.usage.prompt_tokens_details?.cached_tokens,
        };
      }
      const msg = res.choices?.[0]?.message;
      if (msg) {
        asst.content = msg.content || '';
        if (msg.reasoning_content) asst.reasoning = msg.reasoning_content;
        if (Array.isArray(msg.tool_calls)) {
          asst.toolCalls = msg.tool_calls.map((tc: any) => ({
            id: tc.id,
            name: tc.function?.name || '',
            argumentsText: tc.function?.arguments || '',
          }));
        }
        asst.streaming = false;
        asst.finishReason = res.choices?.[0]?.finish_reason;
        hasAsst = true;
      }
    } catch {}
  }

  if (hasAsst || flow.response) {
    // 尝试解析 tool_calls 参数为 JSON
    if (asst.toolCalls) {
      for (const tc of asst.toolCalls) tryParseArgs(tc);
    }
    messages.push(asst);
  }

  return {
    provider: 'openai',
    model,
    temperature,
    usage,
    messages,
    tools,
    streaming: asst.streaming,
  };
}

function fromOpenAIMessage(m: any, id: string): ChatMessage {
  const role = (m.role as ChatMessage['role']) || 'user';
  let content = '';
  if (typeof m.content === 'string') content = m.content;
  else if (Array.isArray(m.content)) {
    content = m.content
      .map((part: any) => {
        if (part.type === 'text') return part.text || '';
        if (part.type === 'image_url') return `![image](${part.image_url?.url || ''})`;
        return '';
      })
      .join('\n');
  }
  const msg: ChatMessage = { id, role, content, streaming: false };
  // OpenAI 兼容协议中，assistant 历史消息可能带有 reasoning_content / reasoning
  if (typeof m.reasoning_content === 'string') msg.reasoning = m.reasoning_content;
  else if (typeof m.reasoning === 'string') msg.reasoning = m.reasoning;
  if (Array.isArray(m.tool_calls)) {
    msg.toolCalls = m.tool_calls.map((tc: any) => {
      const call: ChatToolCall = {
        id: tc.id,
        name: tc.function?.name || '',
        argumentsText: tc.function?.arguments || '',
      };
      tryParseArgs(call);
      return call;
    });
  }
  if (m.tool_call_id) msg.toolCallId = m.tool_call_id;
  if (m.name) msg.toolName = m.name;
  return msg;
}

function tryParseArgs(tc: ChatToolCall) {
  try {
    tc.argumentsParsed = JSON.parse(tc.argumentsText);
  } catch {
    // JSON 还在流式拼接中，暂不设置
  }
}
