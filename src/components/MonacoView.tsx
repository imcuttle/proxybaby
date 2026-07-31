/**
 * 只读/可读写的 Monaco 视图（VS Code 同源编辑器）。
 * 各处代码/请求原文视图共用，替代原来的 <pre> 渲染。
 */
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import TSWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import JSONWorker from 'monaco-editor/language/json/json.worker.js?worker';
import CSSWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HTMLWorker from 'monaco-editor/language/html/html.worker.js?worker';

// 仅初始化一次
let inited = false;
function initMonaco() {
  if (inited) return;
  inited = true;
  if (typeof self !== 'undefined' && !(self as any).MonacoEnvironment) {
    (self as any).MonacoEnvironment = {
      // 按语言分派对应 worker：TS/JS 用 ts.worker（提供 IntelliSense 与诊断），
      // JSON/CSS/HTML 各自单独，其他退化到 editor.worker。
      getWorker(_workerId: string, label: string) {
        switch (label) {
          case 'typescript':
          case 'javascript':
            return new TSWorker();
          case 'json':
            return new JSONWorker();
          case 'css':
          case 'scss':
          case 'less':
            return new CSSWorker();
          case 'html':
          case 'handlebars':
          case 'razor':
            return new HTMLWorker();
          default:
            return new EditorWorker();
        }
      },
    };
  }
  loader.config({ monaco });
  // 暴露给 e2e：读取所有 model 的文本内容
  if (typeof window !== 'undefined') (window as any).monaco = monaco;
  try {
    monaco.editor.defineTheme('proxybaby-dark', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'ff7b72' },
        { token: 'string', foreground: 'a5d6ff' },
      ],
      colors: { 'editor.background': '#1e1e1e' },
    });
  } catch {}

  // 为 Script 编辑器注入 pb API 的类型定义，实现 IntelliSense。
  // JS 编辑器需要开启 checkJs 才会应用 lib；这里仅注册 extraLib，
  // Monaco 会以 JSDoc/lib 形式提供补全。
  try {
    const pbDts = `
/** ProxyBaby 脚本 API：在 onRequest / onResponse 中通过参数 pb 使用。 */
declare interface PBHeader { name: string; value: string; }
declare interface PBRequest {
  method: string;
  url: string;
  host: string;
  path: string;
  headers: PBHeader[];
  bodyText?: string;
}
declare interface PBResponse {
  status: number;
  statusText: string;
  headers: PBHeader[];
  bodyText?: string;
}
declare interface PB {
  request: PBRequest;
  response?: PBResponse;
  /** 设置请求头（存在则覆盖，不存在则新增）。 */
  setReqHeader(name: string, value: string): void;
  /** 删除请求头（大小写不敏感）。 */
  removeReqHeader(name: string): void;
  /** 设置响应头（存在则覆盖，不存在则新增）。 */
  setResHeader(name: string, value: string): void;
  /** 删除响应头（大小写不敏感）。 */
  removeResHeader(name: string): void;
  /** 立即中断请求。 */
  abort(reason?: string): void;
  /** 直接返回响应给客户端，不发上游。 */
  respond(response: {
    status: number;
    statusText?: string;
    headers?: PBHeader[];
    bodyText: string;
  }): void;
}
declare interface PBScriptModule {
  onRequest?(pb: PB): void | Promise<void>;
  onResponse?(pb: PB): void | Promise<void>;
}
declare const module: { exports: PBScriptModule };
`;
    const ts: any = (monaco.languages as any).typescript;
    if (ts) {
      ts.javascriptDefaults?.addExtraLib(pbDts, 'file:///pb.d.ts');
      ts.typescriptDefaults?.addExtraLib(pbDts, 'file:///pb.d.ts');
      ts.javascriptDefaults?.setDiagnosticsOptions?.({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });
      const commonOpts = {
        target: ts.ScriptTarget?.ES2020,
        lib: ['es2020', 'dom'],
        module: ts.ModuleKind?.CommonJS,
        allowNonTsExtensions: true,
      };
      ts.javascriptDefaults?.setCompilerOptions?.({ ...commonOpts, allowJs: true, checkJs: false });
      ts.typescriptDefaults?.setCompilerOptions?.({ ...commonOpts, strict: false });
    }
  } catch {}
}

initMonaco();

export interface MonacoViewProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (v: string) => void;
  height?: string;
  className?: string;
  testId?: string;
  /** 指定模型路径，用于跟 extraLib 的类型定义关联（例如脚本编辑器传 `file:///scripts/xxx.js`）。 */
  path?: string;
}

export function MonacoView({
  value,
  language = 'plaintext',
  readOnly = false,
  onChange,
  height = '100%',
  className,
  testId,
  path,
}: MonacoViewProps) {
  return (
    <div className={className} data-testid={testId} style={{ height, minHeight: 180 }}>
      <Editor
        height={height}
        theme="proxybaby-dark"
        language={language}
        value={value}
        path={path}
        onChange={(v) => onChange?.(v ?? '')}
        options={{
          readOnly,
          fontSize: 12,
          fontFamily: 'ui-monospace, Menlo, Monaco, "SF Mono", monospace',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          lineNumbers: 'on',
          wordWrap: 'on',
          tabSize: 2,
          renderWhitespace: 'boundary',
          quickSuggestions: { other: true, comments: false, strings: true },
          suggestOnTriggerCharacters: true,
          // 关闭 Monaco 默认的"歧义 Unicode 字符高亮"横幅：curl / 请求体里经常包含
          // 中文/全角标点，本应正常显示，不需要提示。
          unicodeHighlight: {
            ambiguousCharacters: false,
            invisibleCharacters: false,
            nonBasicASCII: false,
          },
        }}
      />
    </div>
  );
}

/** 根据 content-type 猜 Monaco language id */
export function guessMonacoLanguage(ct?: string, urlPath?: string): string {
  const c = (ct || '').toLowerCase();
  if (/json/.test(c)) return 'json';
  if (/xml/.test(c)) return 'xml';
  if (/html/.test(c)) return 'html';
  if (/css/.test(c)) return 'css';
  if (/javascript|ecmascript/.test(c)) return 'javascript';
  if (/typescript/.test(c)) return 'typescript';
  if (/yaml|yml/.test(c)) return 'yaml';
  if (/graphql/.test(c) || /\/graphql/.test(urlPath || '')) return 'graphql';
  if (/^text\//.test(c)) return 'plaintext';
  return 'plaintext';
}
