/**
 * 证书信任状态检测与自动安装（macOS）。
 *
 * 策略选择：安装到 **login keychain**（无需 sudo），信任策略同时设置 ssl + basic。
 * 这与 mkcert 的做法一致，可满足 Chrome / Safari / curl 等常见客户端。
 *
 * 检测：security verify-cert -p ssl，成功即视为已信任。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureRootCA } from './ca';
import type { CertStatus } from '../../shared/types';

const pexec = promisify(execFile);

const CERT_NAME = 'ProxyBaby CA';
const SYSTEM_KEYCHAIN = '/Library/Keychains/System.keychain';

function loginKeychain(): string {
  return path.join(os.homedir(), 'Library/Keychains/login.keychain-db');
}

export async function isCertTrusted(): Promise<boolean> {
  try {
    const ca = await ensureRootCA();
    // 使用 SSL 策略校验（TLS server 场景）
    await pexec('security', ['verify-cert', '-c', ca.certPath, '-p', 'ssl'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 优先安装到 login keychain（无需管理员密码）。若已存在旧的同名证书先删掉。
 * 若 login keychain 路径不存在（罕见），退回到写入系统钥匙串（需要 sudo 授权）。
 */
export async function installAndTrustCert(): Promise<CertStatus> {
  const ca = await ensureRootCA();
  const alreadyTrusted = await isCertTrusted();
  if (alreadyTrusted) {
    return { generated: true, trusted: true, caPath: ca.certPath };
  }

  const login = loginKeychain();
  const useLogin = fs.existsSync(login);
  if (useLogin) {
    try {
      // 清理同名旧证书（可能是之前失败的残留），忽略错误
      try {
        await pexec('security', ['delete-certificate', '-c', CERT_NAME, login], { timeout: 5000 });
      } catch {}
      // 安装并信任（SSL 策略 + basic）
      // -r trustRoot: 视为根 CA；-p ssl -p basic：TLS Server / 基本 X.509 都信任
      await pexec('security', [
        'add-trusted-cert',
        '-r', 'trustRoot',
        '-p', 'ssl',
        '-p', 'basic',
        '-k', login,
        ca.certPath,
      ], { timeout: 60000 });
      const trusted = await isCertTrusted();
      if (trusted) return { generated: true, trusted: true, caPath: ca.certPath };
      // 若 login 域安装成功却仍 verify 失败，很可能是 Chrome/Safari 尚未刷新缓存；
      // 继续尝试系统钥匙串，覆盖策略。
    } catch {
      // 落入下面的系统钥匙串安装
    }
  }

  // 回退：写入系统钥匙串（需要管理员密码；策略同上）
  const shellPath = ca.certPath.replace(/'/g, "'\\''");
  const inner = [
    `security delete-certificate -c '${CERT_NAME}' ${SYSTEM_KEYCHAIN} 2>/dev/null; true`,
    `security add-trusted-cert -d -r trustRoot -p ssl -p basic -k ${SYSTEM_KEYCHAIN} '${shellPath}'`,
  ].join('; ');
  const script = `do shell script "${inner.replace(/"/g, '\\"')}" with administrator privileges`;
  try {
    await pexec('osascript', ['-e', script], { timeout: 60000 });
  } catch {
    return { generated: true, trusted: false, caPath: ca.certPath };
  }
  const trusted = await isCertTrusted();
  return { generated: true, trusted, caPath: ca.certPath };
}

export async function getCertStatus(): Promise<CertStatus> {
  const ca = await ensureRootCA();
  const trusted = await isCertTrusted();
  return { generated: true, trusted, caPath: ca.certPath };
}
