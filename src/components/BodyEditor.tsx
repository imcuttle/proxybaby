/**
 * BodyEditor：请求/响应体的可写Monaco 编辑器。
 *
 * 用于 Composer / BreakpointModal / RuleDebugView / ScriptsPanel 测试面板等地方，
 * 替换原来纯 textarea 的 body 输入体验。
 *
 * 语言自动探测：优先按 content-type，其次 URL path结尾，最后落到 bodyText 内容嗅探
 * （首字符 `{`/`[` → json，`<` → xml/html）。
 */
import { useMemo } from 'react';
import { MonacoView, guessMonacoLanguage } from './MonacoView';

function sniffFromContent(text: string): string | undefined {
  const t = text.trimStart();
  if (!t) return undefined;
  if (t[0] === '{' || t[0] === '[') return 'json';
  if (t[0] === '<') return 'xml';
  return undefined;
}

export interface BodyEditorProps {
  value: string;
  onChange: (v: string) => void;
  /** content-type 优先决定语言 */
  contentType?: string;
  /** URL path，辅助识别（例如 /graphql） */
  urlPath?: string;
  /** 显式指定 language，覆盖自动探测 */
  language?: string;
  height?: string;
  className?: string;
  testId?: string;
  readOnly?: boolean;
  placeholder?: string;
}

export function BodyEditor({
  value,
  onChange,
  contentType,
  urlPath,
  language,
  height = '160px',
  className,
  testId,
  readOnly = false,
}: BodyEditorProps) {
  const lang = useMemo(() => {
    if (language) return language;
    const guessed = guessMonacoLanguage(contentType, urlPath);
    if (guessed !== 'plaintext') return guessed;
    return sniffFromContent(value) ||'plaintext';
  }, [language, contentType, urlPath, value]);

  return (
    <MonacoView
      value={value}
      language={lang}
      readOnly={readOnly}
      onChange={onChange}
      height={height}
      className={className}
      testId={testId}
      lineNumbers="off"
      folding={false}
    />
  );
}
