/**
 * CLI 控制通道配置：目前只有端口一个字段（默认 8898）。
 *
 * 存储：`<userData>/lists/control.json`
 * 端口来源优先级：环境变量 PROXYBABY_CTRL_PORT > 持久化配置 > 默认 8898
 * 环境变量优先便于 e2e/开发时临时覆盖，不污染磁盘配置。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const DIR = 'lists';
const FILE = 'control.json';
export const DEFAULT_CTRL_PORT = 8898;

export interface ControlConfig {
  port: number;
}

export class ControlConfigStore {
  private dir: string;
  private file: string;
  private cfg: ControlConfig = { port: DEFAULT_CTRL_PORT };

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
        if (parsed && Number.isInteger(parsed.port) && parsed.port >= 1 && parsed.port <= 65535) {
          this.cfg = { port: parsed.port };
        }
      }
    } catch {}
  }

  private save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.cfg, null, 2), 'utf8'); } catch {}
  }

  /** 环境变量优先，便于 e2e 覆盖 */
  effectivePort(): number {
    const env = Number(process.env.PROXYBABY_CTRL_PORT);
    if (Number.isInteger(env) && env >= 1 && env <= 65535) return env;
    return this.cfg.port;
  }

  get(): ControlConfig { return { ...this.cfg }; }

  set(cfg: ControlConfig): ControlConfig {
    if (Number.isInteger(cfg.port) && cfg.port >= 1 && cfg.port <= 65535) {
      this.cfg = { port: cfg.port };
      this.save();
    }
    return this.get();
  }
}
