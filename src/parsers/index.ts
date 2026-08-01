/**
 * AI 协议识别与统一 chat session 构建。
 * 支持 openai / anthropic / acp，其他归为 unknown。
 */
import type { Flow, ChatSession } from '../../shared/types';
import { parseOpenAI } from './openai';
import { parseAnthropic } from './anthropic';
import { parseACP } from './acp';

export type Provider = 'openai' | 'anthropic' | 'acp' | 'unknown';

export function detectProvider(flow: Flow): Provider {
  const url = flow.request.url.toLowerCase();
  const reqCT = (flow.request.contentType || '').toLowerCase();

  // 尝试 body 判断（先看能否解析出 messages/anthropic 特征）
  let body: any = null;
  if (flow.request.bodyText) {
    try {
      body = JSON.parse(flow.request.bodyText);
    } catch {}
  }

  // 头部特征：anthropic 官方要求 anthropic-version header，代理/网关一般会透传
  const hasAnthropicHeader = flow.request.headers.some(
    (h) => /^(anthropic-version|x-api-key|anthropic-beta)$/i.test(h.name),
  );

  // ACP：url 含 acp 或 body 含 session/agent 字段；或 WS 消息里出现 ACP 方法名
  if (/\/acp[\/?]/.test(url) || /agent-client-protocol/.test(url) || /\bacp\b/.test(url)) return 'acp';
  if (flow.isWebSocket && flow.wsMessages?.length) {
    const sample = flow.wsMessages
      .filter((m) => m.type === 'text' && m.text)
      .slice(0, 8)
      .map((m) => m.text as string)
      .join(' ');
    if (/session\/(update|prompt)|agent\/(message|thought)|tool\/(call|result)/.test(sample)) {
      return 'acp';
    }
  }

  // URL 强特征：官方域名 / 标准路径
  if (/anthropic\.com/.test(url)) return 'anthropic';
  if (/openai\.com/.test(url)) return 'openai';
  if (/\/(v\d+\/)?chat\/completions/.test(url)) return 'openai';
  if (/\/v1\/messages(\b|\?|$)/.test(url)) return 'anthropic';

  // Body 结构鉴别（无强 URL 特征时按 body 判）：
  // 二者的 messages 数组结构接近，但顶级字段与 tools 结构可以稳定区分。
  if (body && typeof body === 'object') {
    const isAnthropicBody =
      hasAnthropicHeader ||
      typeof body.system === 'string' ||
      Array.isArray(body.system) ||
      typeof body.anthropic_version === 'string' ||
      // tools[].input_schema 是 anthropic 独有（openai 是 tools[].function.parameters）
      (Array.isArray(body.tools) && body.tools.some((t: any) => t && typeof t === 'object' && 'input_schema' in t)) ||
      // messages[].content 是数组且元素 type 为 anthropic 专属块
      (Array.isArray(body.messages) && body.messages.some((m: any) =>
        Array.isArray(m?.content) && m.content.some((c: any) =>
          c && typeof c === 'object' && (c.type === 'tool_use' || c.type === 'tool_result' || c.type === 'thinking'),
        ),
      ));
    if (isAnthropicBody) return 'anthropic';

    const isOpenAIBody =
      // tools[].function 是 openai 结构
      (Array.isArray(body.tools) && body.tools.some((t: any) => t && typeof t === 'object' && t.type === 'function' && t.function)) ||
      body.stream_options != null ||
      body.response_format != null ||
      body.frequency_penalty != null ||
      body.presence_penalty != null ||
      // messages 里含 openai 特有的 tool_call_id/tool_calls
      (Array.isArray(body.messages) && body.messages.some((m: any) =>
        m && typeof m === 'object' && (m.tool_call_id || Array.isArray(m.tool_calls)),
      ));
    if (isOpenAIBody) return 'openai';

    // 兜底：仅有 messages 数组，无法明确区分 → unknown（避免误判成 openai）
    // 曾经这里直接返回 'openai'，会把非标 URL 的 anthropic 请求误判成 openai。
  }

  return 'unknown';
}

export function parseSession(flow: Flow, provider: Provider): ChatSession {
  switch (provider) {
    case 'openai': return parseOpenAI(flow);
    case 'anthropic': return parseAnthropic(flow);
    case 'acp': return parseACP(flow);
    default: return { provider: 'unknown', messages: [], streaming: false };
  }
}
