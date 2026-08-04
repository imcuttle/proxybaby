/**
 * 常用 HTTP header 补全数据源。
 *
 * 提供两类补全：
 *   - HEADER_NAMES：header 名单（补全 name 部分）
 *   - HEADER_VALUE_SUGGESTIONS：每个 header 常见值（冒号后补全 value）
 *
 * 目标：覆盖 Composer / 断点 / Rule Debug 三处 Headers 编辑体验；
 * header 名遵循标准的 Title-Case，输入后自动大小写规范化由调用方处理。
 */

export interface HttpHeaderInfo {
  /** 规范化的header 名（Title-Case） */
  name: string;
  /** 简短描述，用于 completion documentation */
  doc?: string;
}

/** 常见请求头 + 通用头 + 常见响应头（一起提供，Composer/断点/Debug 都能用） */
export const HTTP_HEADER_NAMES: HttpHeaderInfo[] = [
  // 内容
  { name: 'Content-Type', doc: '请求/响应体的 MIME 类型' },
  { name: 'Content-Length', doc: '请求/响应体字节数' },
  { name: 'Content-Encoding', doc: '内容编码（gzip/br/deflate 等）' },
  { name: 'Content-Language', doc: '内容语言' },
  { name: 'Content-Disposition', doc: '附件/内联展示方式' },
  { name: 'Content-Range', doc: '分片范围' },

  // 认证
  { name: 'Authorization', doc: '认证凭据（Bearer/Basic/...）' },
  { name: 'Proxy-Authorization', doc: '代理认证凭据' },
  { name: 'WWW-Authenticate', doc: '触发认证挑战' },

  // 客户端信息
  { name: 'User-Agent', doc: '客户端标识' },
  { name: 'Referer', doc: '来源页 URL' },
  { name: 'Origin', doc: '跨域请求来源' },
  { name: 'Host', doc: '目标主机' },

  // Accept 协商
  { name: 'Accept', doc: '客户端能处理的响应 MIME 类型' },
  { name: 'Accept-Encoding', doc: '客户端能处理的压缩编码' },
  { name: 'Accept-Language', doc: '客户端偏好语言' },
  { name: 'Accept-Charset', doc: '客户端支持的字符集' },

  // 缓存/ 条件
  { name: 'Cache-Control', doc: '缓存策略' },
  { name: 'ETag', doc: '资源版本标记' },
  { name: 'If-None-Match', doc: '条件请求：ETag 不匹配才返回' },
  { name: 'If-Modified-Since', doc: '条件请求：修改时间之后才返回' },
  { name: 'Last-Modified', doc: '资源最后修改时间' },
  { name: 'Expires', doc: '资源过期时间（HTTP/1.0）' },
  { name: 'Pragma', doc: 'HTTP/1.0缓存指令' },
  { name: 'Vary', doc: '响应因哪些请求头变化' },

  // Cookie
  { name: 'Cookie', doc: '请求携带 Cookie' },
  { name: 'Set-Cookie', doc: '响应下发 Cookie' },

  // 连接 / 传输
  { name: 'Connection', doc: '连接控制（keep-alive/close）' },
  { name: 'Keep-Alive', doc: '连接保持参数' },
  { name: 'Transfer-Encoding', doc: '传输编码（chunked等）' },
  { name: 'Upgrade', doc: '升级协议（如 WebSocket）' },
  { name: 'Range', doc: '请求资源分片' },

  // CORS
  { name: 'Access-Control-Allow-Origin', doc: 'CORS: 允许的来源' },
  { name: 'Access-Control-Allow-Methods', doc: 'CORS: 允许的方法' },
  { name: 'Access-Control-Allow-Headers', doc: 'CORS: 允许的请求头' },
  { name: 'Access-Control-Allow-Credentials', doc: 'CORS: 是否允许凭据' },
  { name: 'Access-Control-Expose-Headers', doc: 'CORS: 暴露给前端的响应头' },
  { name: 'Access-Control-Max-Age', doc: 'CORS: 预检结果缓存秒数' },
  { name: 'Access-Control-Request-Method', doc: 'CORS 预检: 目标方法' },
  { name: 'Access-Control-Request-Headers', doc: 'CORS 预检: 目标请求头' },

  // 定位/安全
  { name: 'Location', doc: '重定向目标 URL' },
  { name: 'Strict-Transport-Security', doc: 'HSTS 强制 HTTPS' },
  { name: 'X-Frame-Options', doc: '禁止被iframe 嵌入' },
  { name: 'X-Content-Type-Options', doc: 'MIME 嗅探关闭（nosniff）' },
  { name: 'X-XSS-Protection', doc: 'XSS 过滤（旧）' },
  { name: 'Content-Security-Policy', doc: 'CSP 策略' },
  { name: 'Referrer-Policy', doc: 'Referrer 发送策略' },
  { name: 'Permissions-Policy', doc: '权限策略（原 Feature-Policy）' },

  // 常见自定义
  { name: 'X-Requested-With', doc: '常见 AJAX 标识（XMLHttpRequest）' },
  { name: 'X-Forwarded-For', doc: '代理链客户端 IP' },
  { name: 'X-Forwarded-Proto', doc: '代理链原协议' },
  { name: 'X-Forwarded-Host', doc: '代理链原 Host' },
  { name: 'X-Real-IP', doc: 'Nginx 常见：真实客户端 IP' },
  { name: 'X-Request-Id', doc: '请求追踪 ID' },
  { name: 'X-Correlation-Id', doc: '关联 ID' },
  { name: 'X-Trace-Id', doc: '调用链Trace ID' },
  { name: 'X-Api-Key', doc: 'API Key 认证' },

  // WebSocket 握手
  { name: 'Sec-WebSocket-Key', doc: 'WebSocket 握手 key' },
  { name: 'Sec-WebSocket-Version', doc: 'WebSocket 协议版本' },
  { name: 'Sec-WebSocket-Protocol', doc: 'WebSocket 子协议' },
  { name: 'Sec-WebSocket-Accept', doc: 'WebSocket 握手 accept' },
  { name: 'Sec-WebSocket-Extensions', doc: 'WebSocket 扩展' },
];

/** 每个 header 的常见值（冒号后触发补全用）。key 为小写。 */
export const HTTP_HEADER_VALUE_SUGGESTIONS: Record<string, string[]> = {
  'content-type': [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'application/xml',
    'application/octet-stream',
    'application/pdf',
    'application/javascript',
    'text/plain',
    'text/html',
    'text/css',
    'text/csv',
    'text/event-stream',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
  ],
  'accept': [
    'application/json',
    '*/*',
    'text/plain',
    'text/html',
    'text/event-stream',
    'application/xml',
  ],
  'accept-encoding': ['gzip, deflate, br', 'gzip', 'br', 'identity'],
  'accept-language': ['en-US,en;q=0.9', 'zh-CN,zh;q=0.9,en;q=0.8', 'zh-CN', 'en'],
  'cache-control': [
    'no-cache',
    'no-store',
    'max-age=0',
    'max-age=3600',
    'public, max-age=31536000, immutable',
    'private, no-cache',
  ],
  'connection': ['keep-alive', 'close', 'Upgrade'],
  'transfer-encoding': ['chunked'],
  'content-encoding': ['gzip', 'br', 'deflate', 'identity'],
  'authorization': ['Bearer ', 'Basic ', 'Digest '],
  'x-requested-with': ['XMLHttpRequest'],
  'upgrade': ['websocket'],
  'sec-websocket-version': ['13'],
  'user-agent': [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'curl/8.0.0',
    'ProxyBaby/1.0',
  ],
  'access-control-allow-origin': ['*', 'https://example.com'],
  'access-control-allow-methods': [
    'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'GET, POST, OPTIONS',
  ],
  'access-control-allow-credentials': ['true'],
  'x-content-type-options': ['nosniff'],
  'x-frame-options': ['DENY', 'SAMEORIGIN'],
  'referrer-policy': [
    'no-referrer',
    'no-referrer-when-downgrade',
    'origin',
    'origin-when-cross-origin',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
    'unsafe-url',
  ],
};

/** 把 header 名规范化为 Title-Case（Content-Type / X-Api-Key）。 */
export function normalizeHeaderName(name: string): string {
  return name
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1).toLowerCase()))
    .join('-');
}
