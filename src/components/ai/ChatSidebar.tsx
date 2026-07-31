import { useAiStore } from '../../store/ai';
import { useFlowStore } from '../../store/flows';
import { SessionList } from './SessionList';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

/**
 * 右侧常驻 AI 侧边栏。主进程事件订阅在 App.tsx 顶层做一次，这里只做 UI 组合。
 */
export function ChatSidebar() {
  const currentId = useAiStore((s) => s.currentId);
  const setCurrent = useAiStore((s) => s.setCurrent);
  const appendUserMessage = useAiStore((s) => s.appendUserMessage);
  const selectedFlowId = useFlowStore((s) => s.selectedId);

  const send = async (md: string) => {
    let sid = currentId;
    if (!sid) {
      const s = await window.proxybaby.aiCreateSession();
      sid = s.id;
      setCurrent(sid);
    }
    let finalMd = md;
    if (selectedFlowId) finalMd = md + '\n\n`flow:' + selectedFlowId + '`';
    appendUserMessage(sid, finalMd);
    await window.proxybaby.aiSend(finalMd, selectedFlowId ? [selectedFlowId] : []);
  };

  return (
    <div className="h-full flex flex-col bg-pb-bg" data-testid="ai-panel">
      <div className="border-b border-pb-border bg-pb-panel px-2 py-1 text-xs text-pb-muted">
        AI 助手
      </div>
      <SessionList />
      <div className="flex-1 min-h-0 flex flex-col">
        <MessageList />
        <Composer onSend={send} />
      </div>
    </div>
  );
}
