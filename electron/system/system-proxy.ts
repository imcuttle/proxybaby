/**
 * macOS 系统代理自动设置与还原。
 *
 * 使用 networksetup 命令：
 *   networksetup -listallnetworkservices
 *   networksetup -setwebproxy <service> <host> <port>
 *   networksetup -setsecurewebproxy <service> <host> <port>
 *   networksetup -setwebproxystate <service> off
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

async function listServices(): Promise<string[]> {
  const { stdout } = await pexec('networksetup', ['-listallnetworkservices']);
  return stdout
    .split('\n')
    .slice(1)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('*'));
}

async function isServiceActive(service: string): Promise<boolean> {
  try {
    const { stdout } = await pexec('networksetup', ['-getinfo', service]);
    // 若服务停用/无 IP，getinfo 会返回 "IP address: (null)" 或类似
    return !/IP address:\s*\(null\)/i.test(stdout) && /IP address:/.test(stdout);
  } catch {
    return false;
  }
}

let appliedServices: string[] = [];

export async function applySystemProxy(host: string, port: number): Promise<string[]> {
  const services = await listServices();
  const applied: string[] = [];
  for (const svc of services) {
    if (!(await isServiceActive(svc))) continue;
    try {
      await pexec('networksetup', ['-setwebproxy', svc, host, String(port)]);
      await pexec('networksetup', ['-setsecurewebproxy', svc, host, String(port)]);
      applied.push(svc);
    } catch {
      // 无权限时忽略某个服务
    }
  }
  appliedServices = applied;
  return applied;
}

export async function revertSystemProxy(): Promise<void> {
  for (const svc of appliedServices) {
    try {
      await pexec('networksetup', ['-setwebproxystate', svc, 'off']);
      await pexec('networksetup', ['-setsecurewebproxystate', svc, 'off']);
    } catch {
      // ignore
    }
  }
  appliedServices = [];
}

export function getAppliedServices(): string[] {
  return [...appliedServices];
}

/**
 * 启动自愈：扫描所有网络服务，找出**当前**系统代理仍指向 host:port 的（说明是上次残留），
 * 一次性关掉 web/secureweb 代理，避免上次崩溃/强杀后残留代理导致下次开机没网。
 *
 * 返回被清理的服务名列表（便于日志）。不影响 appliedServices —— 因为随后 applySystemProxy
 * 会重新设置并覆盖它。
 */
export async function cleanupStaleProxyPointingAt(host: string, port: number): Promise<string[]> {
  const cleaned: string[] = [];
  let services: string[] = [];
  try { services = await listServices(); } catch { return cleaned; }
  const target = `${host}:${port}`;
  for (const svc of services) {
    try {
      const web = await pexec('networksetup', ['-getwebproxy', svc]).catch(() => ({ stdout: '' }));
      const sec = await pexec('networksetup', ['-getsecurewebproxy', svc]).catch(() => ({ stdout: '' }));
      const hit = (out: string): boolean => {
        // networksetup 输出:
        //   Enabled: Yes
        //   Server: 127.0.0.1
        //   Port: 9998
        //   ...
        if (!/Enabled:\s*Yes/i.test(out)) return false;
        const server = /Server:\s*(\S+)/i.exec(out)?.[1];
        const p = /Port:\s*(\d+)/i.exec(out)?.[1];
        return `${server}:${p}` === target;
      };
      const webHit = hit(web.stdout);
      const secHit = hit(sec.stdout);
      if (webHit) {
        try { await pexec('networksetup', ['-setwebproxystate', svc, 'off']); } catch {}
      }
      if (secHit) {
        try { await pexec('networksetup', ['-setsecurewebproxystate', svc, 'off']); } catch {}
      }
      if (webHit || secHit) cleaned.push(svc);
    } catch {
      // ignore per-service failure
    }
  }
  return cleaned;
}

/**
 * 紧急同步还原：**只**在进程即将崩溃或收到致命信号时使用。
 * 直接对已知的 appliedServices 做同步 networksetup 调用，会短暂阻塞事件循环，但能保证
 * 在 process.exit() 之前完成 —— 换取代理配置一定被清掉。
 *
 * @param host - 可选：若提供，会额外扫描所有网络服务，关掉指向此 host:port 的残留代理，
 *               防御 appliedServices 未记录全的情况（如 apply 时部分失败、或运行时被外部改写）。
 * @param port - 可选：与 host 配合使用。
 */
export function revertSystemProxySync(host?: string, port?: number): void {
  // 1) 先按内存里的 appliedServices 清（快路径）
  const svcs = [...appliedServices];
  appliedServices = [];
  for (const svc of svcs) {
    try { execFileSync('networksetup', ['-setwebproxystate', svc, 'off'], { timeout: 1000, stdio: 'ignore' }); } catch {}
    try { execFileSync('networksetup', ['-setsecurewebproxystate', svc, 'off'], { timeout: 1000, stdio: 'ignore' }); } catch {}
  }

  // 2) 如果知道 host:port，再扫一遍所有服务，兜底关掉指向我们的残留代理
  if (host && port != null) {
    try {
      const out = execFileSync('networksetup', ['-listallnetworkservices'], { timeout: 1500, encoding: 'utf8' });
      const services = out.split('\n').slice(1).map((s) => s.trim()).filter((s) => s && !s.startsWith('*'));
      const target = `${host}:${port}`;
      for (const svc of services) {
        try {
          const web = execFileSync('networksetup', ['-getwebproxy', svc], { timeout: 800, encoding: 'utf8' });
          const sec = execFileSync('networksetup', ['-getsecurewebproxy', svc], { timeout: 800, encoding: 'utf8' });
          const hits = (o: string): boolean => {
            if (!/Enabled:\s*Yes/i.test(o)) return false;
            const s = /Server:\s*(\S+)/i.exec(o)?.[1];
            const p = /Port:\s*(\d+)/i.exec(o)?.[1];
            return `${s}:${p}` === target;
          };
          if (hits(web)) { try { execFileSync('networksetup', ['-setwebproxystate', svc, 'off'], { timeout: 800, stdio: 'ignore' }); } catch {} }
          if (hits(sec)) { try { execFileSync('networksetup', ['-setsecurewebproxystate', svc, 'off'], { timeout: 800, stdio: 'ignore' }); } catch {} }
        } catch { /* per-service ignore */ }
      }
    } catch { /* ignore */ }
  }
}

/**
 * 查询当前 macOS 系统代理配置。扫描所有活跃网络服务，返回第一个「secure web 或 web 代理已启用」的
 * 服务对应的 host:port（优先 secure，因为 HTTPS 更常用）。
 *
 * 用于检测：有没有其他抓包工具（如 Proxyman/Charles）把系统代理指向了自己 —— 此时如果 host:port
 * 与 ProxyBaby 自己的 host:port 不一致，就说明代理被抢走了。
 *
 * 返回 null 表示当前没有任何服务启用系统代理。
 */
export async function getCurrentSystemProxy(): Promise<{ host: string; port: number; service: string } | null> {
  let services: string[] = [];
  try { services = await listServices(); } catch { return null; }
  for (const svc of services) {
    if (!(await isServiceActive(svc))) continue;
    try {
      const sec = await pexec('networksetup', ['-getsecurewebproxy', svc]).catch(() => ({ stdout: '' }));
      const web = await pexec('networksetup', ['-getwebproxy', svc]).catch(() => ({ stdout: '' }));
      const parse = (out: string): { host: string; port: number } | null => {
        if (!/Enabled:\s*Yes/i.test(out)) return null;
        const host = /Server:\s*(\S+)/i.exec(out)?.[1];
        const p = /Port:\s*(\d+)/i.exec(out)?.[1];
        if (!host || !p) return null;
        const port = Number(p);
        if (!Number.isFinite(port) || port <= 0) return null;
        return { host, port };
      };
      const hit = parse(sec.stdout) || parse(web.stdout);
      if (hit) return { ...hit, service: svc };
    } catch {
      // ignore per-service failure
    }
  }
  return null;
}
