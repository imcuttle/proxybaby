/**
 * 网络条件预设：模拟不同网络的延时/带宽。
 *
 * throttle:// 操作符接受一个 profile key（offline/gprs/2g/3g/4g/5g/wifi/custom:latency:kbps）。
 */

export interface NetworkProfile {
  kind: 'offline' | 'throttle';
  label: string;
  latencyMs: number;     // 每次请求的固定延时
  downloadBps: number;   // 字节/秒；0 表示不限速
  uploadBps: number;
}

export const NETWORK_PROFILES: Record<string, NetworkProfile> = {
  offline: { kind: 'offline', label: '离线', latencyMs: 0, downloadBps: 0, uploadBps: 0 },
  gprs:    { kind: 'throttle', label: 'GPRS',    latencyMs: 500, downloadBps: 50 * 1024 / 8, uploadBps: 20 * 1024 / 8 },
  '2g':    { kind: 'throttle', label: '2G',      latencyMs: 300, downloadBps: 250 * 1024 / 8, uploadBps: 50 * 1024 / 8 },
  '3g':    { kind: 'throttle', label: '3G',      latencyMs: 100, downloadBps: 750 * 1024 / 8, uploadBps: 250 * 1024 / 8 },
  '4g':    { kind: 'throttle', label: '4G',      latencyMs: 50,  downloadBps: 4 * 1024 * 1024 / 8, uploadBps: 1 * 1024 * 1024 / 8 },
  '5g':    { kind: 'throttle', label: '5G',      latencyMs: 10,  downloadBps: 25 * 1024 * 1024 / 8, uploadBps: 10 * 1024 * 1024 / 8 },
  wifi:    { kind: 'throttle', label: 'WiFi',    latencyMs: 2,   downloadBps: 0, uploadBps: 0 },
};

export function getNetworkProfile(key?: string): NetworkProfile | null {
  if (!key) return null;
  const k = key.toLowerCase().trim();
  if (NETWORK_PROFILES[k]) return NETWORK_PROFILES[k];
  // custom:latencyMs:kbps
  const m = /^custom:(\d+):(\d+)$/.exec(k);
  if (m) {
    const latency = Number(m[1]);
    const kbps = Number(m[2]);
    return { kind: 'throttle', label: `Custom ${latency}ms/${kbps}kbps`, latencyMs: latency, downloadBps: kbps * 1024 / 8, uploadBps: kbps * 1024 / 8 };
  }
  return null;
}

/**
 * 全局 throttle：作为顶层始终生效的中间件（不依赖用户规则）。
 * 通过 setGlobalThrottle 由 UI 或 IPC 修改。
 */
let globalThrottle: string | null = null;
export function setGlobalThrottle(key: string | null) { globalThrottle = key; }
export function getGlobalThrottle(): string | null { return globalThrottle; }
