/**
 * UpdaterView — 独立子窗口内容体（hash '#updater'）。
 *
 * 数据来源：
 *   - 挂载时先调window.proxybaby.updaterGetLast() 读上次检查结果（快）
 *   - 也订阅 'updater:info' 事件，如果主进程稍后发过来更新则替换（也用于 e2e 注入）
 *
 * 用户操作：
 *   - 跳过此版本 → updaterSkip → 关窗
 *   - 稍后提醒 → updaterRemindLater → 关窗
 *   - 查看Release 页 → updaterOpenRelease(url)（shell.openExternal）
 */
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UpdateInfo } from '../../shared/types';

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export function UpdaterView() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.proxybaby.updaterGetLast().then((r) => {
      if (!cancelled) {
        setInfo(r);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    const off = window.proxybaby.onEvent('updater:info', (payload) => {
      if (cancelled) return;
      setInfo(payload as UpdateInfo);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const notes = useMemo(() => {
    const s = info?.releaseNotes ?? '';
    return s.trim() || '_（本次发布没有提供changelog）_';
  }, [info]);

  const closeSelf = () => window.proxybaby.closeSelfWindow();

  const onSkip = async () => {
    if (info?.latestVersion) await window.proxybaby.updaterSkip(info.latestVersion);
    closeSelf();
  };
  const onLater = async () => {
    await window.proxybaby.updaterRemindLater();
    closeSelf();
  };
  const onOpen = async () => {
    if (info?.htmlUrl) await window.proxybaby.updaterOpenRelease(info.htmlUrl);
  };

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-pb-muted text-sm">
        正在检查更新…
      </div>
    );
  }

  if (!info || !info.hasUpdate) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-pb-text">
        <div className="text-base">已是最新版本</div>
        <div className="text-xs text-pb-muted">当前版本 {info?.currentVersion ?? '-'}</div>
        <button className="pb-btn px-3 py-1 text-sm" onClick={closeSelf} data-testid="updater-close">关闭</button>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col text-pb-text" data-testid="updater-view">
      <div className="px-6 pt-4 pb-3 border-b border-pb-border">
        <div className="text-base font-semibold" data-testid="updater-title">
          ProxyBaby {info.latestVersion} 可用
        </div>
        <div className="text-xs text-pb-muted mt-1">
          当前版本 {info.currentVersion}
          {info.publishedAt ? ` · 发布于 ${formatDate(info.publishedAt)}` : ''}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-scroll px-6 py-4 text-sm leading-relaxed">
        <div className="pb-markdown" data-testid="updater-notes">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
        </div>
      </div>
      <div className="px-6 py-3 border-t border-pb-border flex items-center gap-2">
        <button
          className="pb-btn px-3 py-1 text-sm"
          onClick={onSkip}
          data-testid="updater-skip"
        >跳过此版本</button>
        <button
          className="pb-btn px-3 py-1 text-sm"
          onClick={onLater}
          data-testid="updater-later"
        >稍后提醒</button>
        <div className="flex-1" />
        <button
          className="pb-btn pb-btn-primary px-3 py-1 text-sm"
          onClick={onOpen}
          data-testid="updater-open-release"
        >前往下载 →</button>
      </div>
    </div>
  );
}
