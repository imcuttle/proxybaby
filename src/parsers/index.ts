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

  // Anthropic：URL 含 anthropic.com/v1/messages，或 body 有 anthropic-version/system 字段模式
  if (/anthropic\.com/.test(url) || /\/v1\/messages(\b|\?|$)/.test(url)) {
    if (body?.messages || body?.system !== undefined) return 'anthropic';
  }

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

  // OpenAI 兼容：chat/completions
  if (/\/(v\d+\/)?chat\/completions/.test(url)) return 'openai';
  if (/openai\.com/.test(url) && body?.messages) return 'openai';

  // 兜底：请求体像 OpenAI chat messages
  if (body && Array.isArray(body.messages) && body.messages.some((m: any) => m?.role)) {
    return 'openai';
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
