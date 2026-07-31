import { describe, it, expect } from 'vitest';
import { getNetworkProfile, setGlobalThrottle, getGlobalThrottle, NETWORK_PROFILES } from '../../electron/engine/network-conditions';

describe('network conditions', () => {
  it('返回内置预设', () => {
    for (const k of Object.keys(NETWORK_PROFILES)) {
      expect(getNetworkProfile(k)).toBeTruthy();
    }
  });

  it('大小写不敏感', () => {
    expect(getNetworkProfile('3G')?.label).toBe('3G');
  });

  it('custom:latency:kbps 解析', () => {
    const p = getNetworkProfile('custom:200:1000');
    expect(p).toBeTruthy();
    expect(p!.latencyMs).toBe(200);
    expect(p!.downloadBps).toBe(1000 * 1024 / 8);
  });

  it('无效 key 返回 null', () => {
    expect(getNetworkProfile('nope')).toBeNull();
    expect(getNetworkProfile('')).toBeNull();
  });

  it('全局 throttle 状态可读写', () => {
    setGlobalThrottle('3g');
    expect(getGlobalThrottle()).toBe('3g');
    setGlobalThrottle(null);
    expect(getGlobalThrottle()).toBeNull();
  });
});
