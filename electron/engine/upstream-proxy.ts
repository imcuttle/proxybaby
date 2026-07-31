/**
 * 上游代理配置（App 出站流量走的外部代理）。
 * 支持 HTTP CONNECT 与 SOCKS5（后者最简实现，未含鉴权时的完整握手仅作占位）。
 *
 * 存储：`<userData>/lists/upstream.json`
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { UpstreamProxyConfig } from '../../shared/types';

const DIR = 'lists';
const FILE = 'upstream.json';

const DEFAULT: UpstreamProxyConfig = { kind: 'off' };

export class UpstreamProxyStore {
  private dir: string;
  private file: string;
  private cfg: UpstreamProxyConfig = { ...DEFAULT };

  constructor() {
    this.dir = path.join(app.getPath('userData'), DIR);
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, FILE);
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (parsed && ['off', 'http', 'socks5'].includes(parsed.kind)) {
          this.cfg = {
            kind: parsed.kind,
            host: typeof parsed.host === 'string' ? parsed.host : undefined,
            port: Number.isFinite(parsed.port) ? Number(parsed.port) : undefined,
            username: typeof parsed.username === 'string' ? parsed.username : undefined,
            password: typeof parsed.password === 'string' ? parsed.password : undefined,
          };
        }
      }
    } catch {}
  }

  private save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.cfg, null, 2), 'utf8'); } catch {}
  }

  get(): UpstreamProxyConfig { return { ...this.cfg }; }

  set(cfg: UpstreamProxyConfig): UpstreamProxyConfig {
    this.cfg = {
      kind: cfg.kind,
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
    };
    this.save();
    return this.get();
  }
}

let ref: UpstreamProxyStore | null = null;
export function setUpstreamProxyStore(s: UpstreamProxyStore | null) { ref = s; }
export function getUpstreamProxy(): UpstreamProxyConfig | null {
  const cfg = ref?.get();
  if (!cfg || cfg.kind === 'off') return null;
  if (!cfg.host || !cfg.port) return null;
  return cfg;
}
