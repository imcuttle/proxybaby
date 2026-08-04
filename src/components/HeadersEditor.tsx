/**
 * HeadersEditor：Monaco 编辑器 + HTTP header 补全。
 *
 * 用于 Composer / BreakpointModal / RuleDebugView 三处 headers 编辑，替换原来 textarea。
 * 语法：每行一个 `Name: Value`；`#` 开头为注释；语法高亮 + 名/值 IntelliSense。
 *
 * 补全：
 *   - 行首（还没打冒号）：suggest 常见 header 名，插入后自动跟 `: ` + 触发下一轮 suggest
 *   - 冒号后：按 header 名查 HTTP_HEADER_VALUE_SUGGESTIONS，suggest 常见值
 */
import { useEffect, useRef } from 'react';
import Editor, { loader, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import {
  HTTP_HEADER_NAMES,
  HTTP_HEADER_VALUE_SUGGESTIONS,
  normalizeHeaderName,
} from '../lib/http-headers';

// Monaco worker：headers 语言仅需 editor.worker
if (typeof self !== 'undefined' && !(self as any).MonacoEnvironment) {
  (self as any).MonacoEnvironment = { getWorker: () => new EditorWorker() };
}
loader.config({ monaco });

const LANG_ID = 'http-headers';

let registered = false;
function registerHeadersLang(m: Monaco) {
  if (registered) return;
  registered = true;

  m.languages.register({ id: LANG_ID });
  m.languages.setLanguageConfiguration(LANG_ID, {
    comments: { lineComment: '#' },
    autoClosingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
  m.languages.setMonarchTokensProvider(LANG_ID, {
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        // Header名：行首非空白到冒号
        [/^[A-Za-z][A-Za-z0-9-]*(?=\s*:)/, 'keyword'],
        [/:/, 'delimiter'],
        [/.+$/, 'string'],
      ],
    },
  });

  m.languages.registerCompletionItemProvider(LANG_ID, {
    // 字母触发 name 补全；`:` 和空格触发 value 补全
    triggerCharacters: [':', ' ',
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
      'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
      'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    ],
    provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
      const line = model.getLineContent(position.lineNumber);
      const beforeCursor = line.slice(0, position.column - 1);
      const colonIdx = beforeCursor.indexOf(':');

      // ---- Value 补全：光标在冒号之后 ----
      if (colonIdx >= 0) {
        const headerName = beforeCursor.slice(0, colonIdx).trim().toLowerCase();
        const values = HTTP_HEADER_VALUE_SUGGESTIONS[headerName];
        if (!values || values.length === 0) return { suggestions: [] };

        // 用当前 word 的位置作为 range，避免把前置空格吞掉
        const word = model.getWordUntilPosition(position);
        const startCol = word.startColumn;
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: startCol,
          endColumn: position.column,
        };
        const suggestions: monaco.languages.CompletionItem[] = values.map((v) => ({
          label: v,
          kind: m.languages.CompletionItemKind.Value,
          insertText: v,
          range,
        }));
        return { suggestions };
      }

      // ---- Name 补全：还没打冒号 ----
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions: monaco.languages.CompletionItem[] = HTTP_HEADER_NAMES.map((h) => ({
        label: h.name,
        kind: m.languages.CompletionItemKind.Field,
        detail: h.doc,
        documentation: h.doc,
        // 插入 "Name: " 并把光标停在冒号后，然后触发下一轮 suggest 提示常见值
        insertText: `${h.name}: `,
        range,
        command: { id: 'editor.action.triggerSuggest', title: '' },
      }));
      return { suggestions };
    },
  });
}

/** 规范化 headers 文本每行的 name 大小写（Title-Case）。仅对已经带冒号的行生效。 */
export function normalizeHeadersText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx <= 0) return line;
      const name = normalizeHeaderName(line.slice(0, idx).trim());
      const value = line.slice(idx + 1).replace(/^\s+/, '');
      return `${name}: ${value}`;
    })
    .join('\n');
}

export interface HeadersEditorProps {
  value: string;
  onChange: (v: string) => void;
  /** 编辑器高度，默认 h-40 */
  height?: string;
  className?: string;
  testId?: string;
  placeholder?: string;
}

export function HeadersEditor({
  value,
  onChange,
  height = '160px',
  className,
  testId,
  placeholder,
}: HeadersEditorProps) {
  // placeholder：Monaco 没有原生 placeholder；用 domNodeAttribute 的 aria-placeholder 语义占位（可选）
  const monacoRef = useRef<Monaco | null>(null);

  useEffect(() => {
    return () => {
      // 保留 language 注册（模块级），无需在卸载时清理
    };
  }, []);

  return (
    <div
      className={className}
      data-testid={testId}
      style={{ height, minHeight: 80 }}
      data-placeholder={placeholder}
    >
      <Editor
        height={height}
        theme="proxybaby-dark"
        language={LANG_ID}
        value={value}
        beforeMount={(m) => {
          monacoRef.current = m;
          registerHeadersLang(m);
        }}
        onChange={(v) => onChange(v ?? '')}
        options={{
          fontSize: 12,
          fontFamily: 'ui-monospace, Menlo, Monaco, "SF Mono", monospace',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          lineNumbers: 'off',
          wordWrap: 'on',
          tabSize: 2,
          folding: false,
          glyphMargin: false,
          renderLineHighlight: 'none',
          quickSuggestions: { other: true, comments: false, strings: true },
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: 'on',
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
