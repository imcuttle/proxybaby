/**
 * 根 CA 与叶子证书签发。
 *
 * - 首次启动生成根 CA（RSA 2048），保存到 userData/ca.pem + ca-key.pem
 * - 每个目标域名动态签发叶子证书（LRU 缓存，避免每连接重复签发）
 */
import forge from 'node-forge';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const CA_SUBJECT = [
  { name: 'commonName', value: 'ProxyBaby CA' },
  { name: 'organizationName', value: 'ProxyBaby' },
  { name: 'organizationalUnitName', value: 'ProxyBaby Root' },
];

export interface CA {
  cert: forge.pki.Certificate;
  privateKey: forge.pki.rsa.PrivateKey;
  certPem: string;
  keyPem: string;
  certPath: string;
  keyPath: string;
}

let cachedCA: CA | null = null;

function caPaths() {
  const dir = app.getPath('userData');
  return {
    certPath: path.join(dir, 'proxybaby-ca.pem'),
    keyPath: path.join(dir, 'proxybaby-ca-key.pem'),
  };
}

export async function ensureRootCA(): Promise<CA> {
  if (cachedCA) return cachedCA;
  const { certPath, keyPath } = caPaths();
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const certPem = fs.readFileSync(certPath, 'utf8');
    const keyPem = fs.readFileSync(keyPath, 'utf8');
    cachedCA = {
      cert: forge.pki.certificateFromPem(certPem),
      privateKey: forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey,
      certPem,
      keyPem,
      certPath,
      keyPath,
    };
    return cachedCA;
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  cert.setSubject(CA_SUBJECT);
  cert.setIssuer(CA_SUBJECT);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  fs.writeFileSync(certPath, certPem);
  fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });

  cachedCA = { cert, privateKey: keys.privateKey, certPem, keyPem, certPath, keyPath };
  return cachedCA;
}

// -------- 叶子证书签发 --------
const leafCache = new Map<string, { keyPem: string; certPem: string }>();
const LEAF_LIMIT = 512;

export function issueLeaf(host: string): { keyPem: string; certPem: string } {
  const cached = leafCache.get(host);
  if (cached) return cached;
  if (!cachedCA) throw new Error('CA not initialized');

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff).toString(16)}`;
  // Chrome / Safari 强制 TLS 叶子证书有效期 ≤ 398 天（RFC 5280 & CA/Browser Forum BR）。
  // 超过一律拒绝：ERR_CERT_VALIDITY_TOO_LONG / -9814。所以设成 397 天。
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(cert.validity.notBefore.getTime() + 397 * 24 * 60 * 60 * 1000);

  const subject = [
    { name: 'commonName', value: host },
    { name: 'organizationName', value: 'ProxyBaby' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(cachedCA.cert.subject.attributes);

  const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const altNames = isIP
    ? [{ type: 7, ip: host }]
    : [{ type: 2, value: host }];

  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    { name: 'subjectAltName', altNames },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(cachedCA.privateKey, forge.md.sha256.create());

  const result = {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };

  if (leafCache.size >= LEAF_LIMIT) {
    const firstKey = leafCache.keys().next().value;
    if (firstKey) leafCache.delete(firstKey);
  }
  leafCache.set(host, result);
  return result;
}
