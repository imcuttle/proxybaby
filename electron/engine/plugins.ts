/**
 * 插件系统。
 * 每个插件导出 { id, name, matchers?, operators?, middlewares? }。
 * 目前提供内置官方插件；三方插件可后续通过读取磁盘目录扩展。
 */
import type { Middleware } from './context';
import type { OperatorFactory } from './operators';
import { RuleEngine } from './rule-engine';
import { getScriptStore, scriptMiddleware, SCRIPT_HINTS } from './scripts';
import { getGlobalThrottle, getNetworkProfile } from './network-conditions';
import { getAllowBlockStore } from './allow-block';

export interface Plugin {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  operators?: Record<string, OperatorFactory>;
  middlewaresForFlow?: (input: { url: string; scheme: 'http' | 'https'; hostPath: string; host?: string }) => {
    middlewares: Middleware[];
    matched: { ruleId: string; ruleName: string; pattern: string }[];
    hints?: { needsReqBodyBuffer: boolean; needsResBodyBuffer: boolean };
  };
  // 也可能提供不基于规则、总是生效的中间件（如 logger）
  alwaysMiddlewares?: Middleware[];
}

export class PluginManager {
  private plugins: Plugin[] = [];
  private ruleEngine: RuleEngine;

  constructor(ruleEngine: RuleEngine) {
    this.ruleEngine = ruleEngine;
    this.registerBuiltin();
  }

  private registerBuiltin() {
    // whistle-rules 插件：把规则引擎的输出作为 middlewares
    this.plugins.push({
      id: 'whistle-rules',
      name: 'Whistle Rules',
      description: '兼容 whistle 语法的文本规则集，支持请求/响应改写、mock、重定向、abort 等',
      enabled: true,
      middlewaresForFlow: ({ url, scheme, hostPath }) =>
        this.ruleEngine.buildMiddlewares(url, scheme, hostPath),
    });

    // logger 插件：结构化日志
    this.plugins.push({
      id: 'logger',
      name: 'Request Logger',
      description: '把每个请求的方法/URL/状态打印到主进程 stdout',
      enabled: false,   // 默认关闭，避免刷屏
      alwaysMiddlewares: [
        async (ctx, next) => {
          const t = Date.now();
          await next();
          const ms = Date.now() - t;
          console.log(`[flow] ${ctx.request.method} ${ctx.response?.status ?? '-'} ${ctx.request.url} (${ms}ms)`);
        },
      ],
    });

    // mock 插件：占位；file/mock 操作符已在 operators.ts 中提供，这里保留元信息
    this.plugins.push({
      id: 'mock',
      name: 'Mock Responder',
      description: '通过 file://、mock:// 操作符直接返回本地内容',
      enabled: true,
    });

    // breakpoint：配合规则里的 breakpoint 操作符使用
    this.plugins.push({
      id: 'breakpoint',
      name: 'Breakpoint',
      description: '启用后，命中带 breakpoint 操作符的规则时暂停请求/响应，弹窗手动编辑 headers/body/状态码后继续或中止',
      enabled: false,
    });

    // Scripts 插件：作为 whistle 规则的一等公民（`script://` 操作符），
    // 同时对所有"全局"启用的脚本，每个请求都注入一个 middleware。
    this.plugins.push({
      id: 'scripts',
      name: 'Scripts',
      description: '编写 JavaScript 修改请求/响应。规则里用 `script://<id-or-name>` 引用；或在脚本管理页勾选“全局”让它对所有请求生效。',
      enabled: true,
      middlewaresForFlow: () => {
        const store = getScriptStore();
        const middlewares: Middleware[] = [];
        const matched: { ruleId: string; ruleName: string; pattern: string }[] = [];
        if (!store) return { middlewares, matched };
        for (const s of store.list()) {
          if (!s.enabled) continue;
          // 只对显式启用了 "always" 的脚本做无差别注入。默认脚本仅在规则里 script:// 引用时生效。
          if ((s as any).always) {
            middlewares.push(scriptMiddleware(s.id));
            matched.push({ ruleId: `script:${s.id}`, ruleName: `脚本 · ${s.name}`, pattern: '*' });
          }
        }
        return {
          middlewares,
          matched,
          hints: middlewares.length ? SCRIPT_HINTS : { needsReqBodyBuffer: false, needsResBodyBuffer: false },
        };
      },
    });

    // Allow/Block 列表插件
    this.plugins.push({
      id: 'allow-block',
      name: 'Allow / Block List',
      description: '按 App / 域名 / URL 允许或阻止请求。命中黑名单直接 abort，或仅放行白名单。',
      enabled: true,
      alwaysMiddlewares: [
        async (ctx, next) => {
          const store = getAllowBlockStore();
          if (!store) return next();
          const d = store.decide({
            host: ctx.request.host,
            appName: ctx.appName,
            method: ctx.request.method,
            url: ctx.request.url,
          });
          if (!d.allow) { ctx.abort(d.reason); return; }
          await next();
        },
      ],
    });

    // 网络条件插件：应用全局 throttle
    this.plugins.push({
      id: 'network-conditions',
      name: 'Network Conditions',
      description: '模拟慢速网络（Offline / 2G / 3G / 4G / 5G / WiFi / 自定义）。',
      enabled: true,
      alwaysMiddlewares: [
        async (ctx, next) => {
          const key = getGlobalThrottle();
          const profile = getNetworkProfile(key || undefined);
          if (!profile) return next();
          if (profile.latencyMs > 0) await new Promise((r) => setTimeout(r, profile.latencyMs));
          if (profile.kind === 'offline') { ctx.abort('network:offline'); return; }
          await next();
          if (ctx.response && profile.downloadBps > 0) {
            const size = ctx.response.bodySize || 0;
            const extraMs = Math.min(60_000, Math.round((size / profile.downloadBps) * 1000));
            if (extraMs > 5) await new Promise((r) => setTimeout(r, extraMs));
          }
        },
      ],
    });
  }

  list(): { id: string; name: string; description?: string; enabled: boolean }[] {
    // 仅返回可结构化克隆的字段（去掉函数，避免 IPC 序列化失败）
    return this.plugins.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      enabled: p.enabled,
    }));
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const p = this.plugins.find((x) => x.id === id);
    if (!p) return false;
    p.enabled = enabled;
    return true;
  }

  collectMiddlewares(url: string, scheme: 'http' | 'https', hostPath: string, host?: string): {
    middlewares: Middleware[];
    matched: { ruleId: string; ruleName: string; pattern: string }[];
    hints: { needsReqBodyBuffer: boolean; needsResBodyBuffer: boolean };
  } {
    const middlewares: Middleware[] = [];
    const matched: { ruleId: string; ruleName: string; pattern: string }[] = [];
    let needsReqBodyBuffer = false;
    let needsResBodyBuffer = false;
    for (const p of this.plugins) {
      if (!p.enabled) continue;
      if (p.alwaysMiddlewares) middlewares.push(...p.alwaysMiddlewares);
      if (p.middlewaresForFlow) {
        const out = p.middlewaresForFlow({ url, scheme, hostPath, host });
        middlewares.push(...out.middlewares);
        matched.push(...out.matched);
        if (out.hints?.needsReqBodyBuffer) needsReqBodyBuffer = true;
        if (out.hints?.needsResBodyBuffer) needsResBodyBuffer = true;
      }
    }
    return { middlewares, matched, hints: { needsReqBodyBuffer, needsResBodyBuffer } };
  }
}
