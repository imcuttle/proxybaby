import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock 必须在 import 之前（hoisted），factory 里不能用外部变量
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

import { revertSystemProxySync } from '../../electron/system/system-proxy';
import { execFileSync } from 'node:child_process';

const mockedExecFileSync = execFileSync as ReturnType<typeof vi.fn>;

describe('revertSystemProxySync', () => {
  beforeEach(() => {
    mockedExecFileSync.mockReset();
    // 默认让所有调用成功
    mockedExecFileSync.mockReturnValue('');
  });

  it('无参数且无已应用服务时，不调用 networksetup', () => {
    revertSystemProxySync();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('有 host:port 参数时扫描所有服务并关掉指向我们的代理', () => {
    // listallnetworkservices 返回 Wi-Fi
    mockedExecFileSync.mockImplementation((cmd: string, args: string[] | { timeout?: number; encoding?: string; stdio?: string }) => {
      const arr = Array.isArray(args) ? args : [];
      if (arr[0] === '-listallnetworkservices') return 'An asterisk (*) denotes that a network service is disabled.\n*Thunderbolt Bridge\nWi-Fi\niPhone USB';
      if (arr[0] === '-getwebproxy' || arr[0] === '-getsecurewebproxy') {
        return 'Enabled: Yes\nServer: 127.0.0.1\nPort: 9998\nAuthenticated Proxy Enabled: 0';
      }
      return '';
    });

    revertSystemProxySync('127.0.0.1', 9998);

    // 应该对 Wi-Fi 调用 setwebproxystate off 和 setsecurewebproxystate off
    const allCalls = mockedExecFileSync.mock.calls;
    // 提取所有命令参数
    const cmdArgs = allCalls.map((c: any[]) => (Array.isArray(c[1]) ? c[1][0] : null));
    expect(cmdArgs).toContain('-setwebproxystate');
    expect(cmdArgs).toContain('-setsecurewebproxystate');
    // 至少有 2 个 off 命令（Wi-Fi 的 web + secureweb）
    const offCount = cmdArgs.filter((a: string) => a === '-setwebproxystate' || a === '-setsecurewebproxystate').length;
    expect(offCount).toBeGreaterThanOrEqual(2);
  });

  it('host:port 不匹配时不会关掉代理', () => {
    mockedExecFileSync.mockImplementation((cmd: string, args: string[] | { timeout?: number; encoding?: string; stdio?: string }) => {
      const arr = Array.isArray(args) ? args : [];
      if (arr[0] === '-listallnetworkservices') return '\nWi-Fi\n';
      if (arr[0] === '-getwebproxy' || arr[0] === '-getsecurewebproxy') {
        return 'Enabled: Yes\nServer: 127.0.0.1\nPort: 8080\nAuthenticated Proxy Enabled: 0';
      }
      return '';
    });

    revertSystemProxySync('127.0.0.1', 9998);

    // 不应该有任何 setwebproxystate / setsecurewebproxystate 调用
    const offCalls = mockedExecFileSync.mock.calls.filter((c: any[]) =>
      Array.isArray(c[1]) && (c[1].includes('-setwebproxystate') || c[1].includes('-setsecurewebproxystate'))
    );
    expect(offCalls.length).toBe(0);
  });

  it('代理未启用时不会关掉', () => {
    mockedExecFileSync.mockImplementation((cmd: string, args: string[] | { timeout?: number; encoding?: string; stdio?: string }) => {
      const arr = Array.isArray(args) ? args : [];
      if (arr[0] === '-listallnetworkservices') return '\nWi-Fi\n';
      if (arr[0] === '-getwebproxy' || arr[0] === '-getsecurewebproxy') {
        return 'Enabled: No\nServer: \nPort: 0\nAuthenticated Proxy Enabled: 0';
      }
      return '';
    });

    revertSystemProxySync('127.0.0.1', 9998);

    const offCalls = mockedExecFileSync.mock.calls.filter((c: any[]) =>
      Array.isArray(c[1]) && (c[1].includes('-setwebproxystate') || c[1].includes('-setsecurewebproxystate'))
    );
    expect(offCalls.length).toBe(0);
  });

  it('单个命令失败不影响其他命令', () => {
    mockedExecFileSync.mockImplementation((cmd: string, args: string[] | { timeout?: number; encoding?: string; stdio?: string }) => {
      const arr = Array.isArray(args) ? args : [];
      if (arr[0] === '-listallnetworkservices') return '\nWi-Fi\n';
      if (arr[0] === '-getwebproxy') return 'Enabled: Yes\nServer: 127.0.0.1\nPort: 9998\n';
      if (arr[0] === '-getsecurewebproxy') return 'Enabled: Yes\nServer: 127.0.0.1\nPort: 9998\n';
      if (arr[0] === '-setwebproxystate') throw new Error('permission denied');
      return '';
    });

    // 不应抛出异常
    expect(() => revertSystemProxySync('127.0.0.1', 9998)).not.toThrow();

    // secureweb 的 off 应该仍然被调用
    const secCalls = mockedExecFileSync.mock.calls.filter((c: any[]) =>
      Array.isArray(c[1]) && c[1][0] === '-setsecurewebproxystate'
    );
    expect(secCalls.length).toBe(1);
  });
});
