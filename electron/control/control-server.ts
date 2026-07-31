/**
 * 本地控制 HTTP server（127.0.0.1:8898），供官方 CLI 与外部脚本控制 app。
 *
 * 鉴权：启动时生成 token，写入 ~/.proxybaby/cli-token；CLI 读取并放入
 * `X-ProxyBaby-Token` 请求头。仅监听 loopback，最小暴露。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { ProxyStatus, CertStatus } from '../../shared/types';
import type { RuleEngine } from '../engine/rule-engine';
import type { PluginManager } from '../engine/plugins';

const CTRL_HOST = '127.0.0.1';
const CTRL_PORT = 8898;

export interface ControlDeps {
  getProxyStatus: () => ProxyStatus;
  getCertStatus: () => CertStatus;
  setRecording: (on: boolean) => Promise<ProxyStatus>;
  clearFlows: () => Promise<void>;
  setSystemProxy: (on: boolean) => Promise<ProxyStatus>;
  ruleEngine: () => RuleEngine | null;
  pluginManager: () => PluginManager | null;
  exportSession: (format: 'proxybaby' | 'har', filePath: string) => number;
  openWindow: () => void;
  quit: () => void;
}

let server: http.Server | null = null;
let token = '';

function tokenPath(): string {
  const dir = path.join(os.homedir(), '.proxybaby');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'cli-token');
}

function ensureToken(): string {
  const p = tokenPath();
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(p, t, { mode: 0o600 });
  return t;
}

export function startControlServer(deps: ControlDeps): void {
  if (server) return;
  token = ensureToken();
  server = http.createServer(async (req, res) => {
    // 只接受 loopback
    const ra = req.socket.remoteAddress;
    if (ra !== '127.0.0.1' && ra !== '::1' && ra !== '::ffff:127.0.0.1') {
      res.writeHead(403); return res.end('forbidden');
    }
    if ((req.headers['x-proxybaby-token'] || '') !== token) {
      res.writeHead(401); return res.end('unauthorized');
    }
    try {
      await route(req, res, deps);
    } catch (err: any) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  server.listen(CTRL_PORT, CTRL_HOST);
}

export function stopControlServer(): void {
  if (server) {
    try { server.close(); } catch {}
    server = null;
  }
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, d: ControlDeps) {
  const url = new URL(req.url || '/', `http://${CTRL_HOST}:${CTRL_PORT}`);
  const method = req.method || 'GET';
  const path = url.pathname;

  const ok = (obj: unknown) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const readBody = async (): Promise<any> => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
  };

  if (method === 'GET' && path === '/status') {
    return ok({
      proxy: d.getProxyStatus(),
      cert: d.getCertStatus(),
      rules: d.ruleEngine()?.list().map(({ rules, matcher: _m, ...meta }: any) => ({
        ...meta,
        rulesCount: rules.length,
      })) ?? [],
      plugins: d.pluginManager()?.list() ?? [],
    });
  }
  if (method === 'POST' && path === '/app/open') { d.openWindow(); return ok({ ok: true }); }
  if (method === 'POST' && path === '/app/quit') { d.quit(); return ok({ ok: true }); }
  if (method === 'POST' && path === '/proxy/on') { const s = await d.setSystemProxy(true); return ok(s); }
  if (method === 'POST' && path === '/proxy/off') { const s = await d.setSystemProxy(false); return ok(s); }
  if (method === 'POST' && path === '/record/on') { const s = await d.setRecording(true); return ok(s); }
  if (method === 'POST' && path === '/record/off') { const s = await d.setRecording(false); return ok(s); }
  if (method === 'POST' && path === '/record/clear') { await d.clearFlows(); return ok({ ok: true }); }
  if (method === 'POST' && path === '/session/export') {
    const body = await readBody();
    const format = body.format === 'har' ? 'har' : 'proxybaby';
    const filePath = body.filePath || `${process.env.HOME || '.'}/proxybaby-session.${format}`;
    const count = d.exportSession(format, filePath);
    return ok({ ok: true, filePath, count });
  }

  // Rules CRUD
  if (path === '/rules') {
    if (method === 'GET') return ok(d.ruleEngine()?.list() ?? []);
    if (method === 'POST') {
      const body = await readBody();
      const set = d.ruleEngine()?.add(body.name || 'unnamed', body.text || '', body.enabled !== false);
      return ok(set);
    }
  }
  const rm = path.match(/^\/rules\/([^/]+)(?:\/(enable|disable))?$/);
  if (rm) {
    const id = decodeURIComponent(rm[1]);
    if (method === 'GET') return ok(d.ruleEngine()?.get(id) || null);
    if (method === 'PUT') {
      const body = await readBody();
      return ok(d.ruleEngine()?.update(id, body) || null);
    }
    if (method === 'DELETE') return ok({ ok: d.ruleEngine()?.remove(id) });
    if (method === 'POST' && rm[2] === 'enable') return ok({ ok: d.ruleEngine()?.setEnabled(id, true) });
    if (method === 'POST' && rm[2] === 'disable') return ok({ ok: d.ruleEngine()?.setEnabled(id, false) });
  }

  // Plugins
  if (method === 'GET' && path === '/plugins') return ok(d.pluginManager()?.list() ?? []);
  const pm = path.match(/^\/plugins\/([^/]+)\/(enable|disable)$/);
  if (pm && method === 'POST') {
    return ok({ ok: d.pluginManager()?.setEnabled(decodeURIComponent(pm[1]), pm[2] === 'enable') });
  }

  res.writeHead(404); res.end('not found');
}
