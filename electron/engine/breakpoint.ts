/**
 * 断点控制器。
 *
 * 中间件命中断点时调用 controller.pause(flowId, stage, ctx)，返回一个 Promise，
 * 挂起直到渲染层通过 IPC 提交 resume(...)。resume 可携带编辑后的
 * headers/body/status，或选择 abort。
 *
 * 代理引擎负责在 pause 前 emit 'flow:breakpoint' 事件（携带当前请求/响应快照），
 * 让 UI 弹出编辑面板。
 */
import type { BreakpointResume } from '../../shared/types';

interface Pending {
  resolve: (r: BreakpointResume) => void;
}

export class BreakpointController {
  private pending = new Map<string, Pending>();
  private enabled = true;

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) {
      // 关闭断点：放行所有挂起
      for (const [key, p] of this.pending) {
        const [id, stage] = key.split('::');
        p.resolve({ id, stage: stage as any, action: 'continue' });
      }
      this.pending.clear();
    }
  }

  isEnabled() {
    return this.enabled;
  }

  /** 挂起等待 UI 决策 */
  pause(flowId: string, stage: 'request' | 'response'): Promise<BreakpointResume> {
    if (!this.enabled) {
      return Promise.resolve({ id: flowId, stage, action: 'continue' });
    }
    const key = `${flowId}::${stage}`;
    return new Promise<BreakpointResume>((resolve) => {
      this.pending.set(key, { resolve });
    });
  }

  /** 渲染层提交决策 */
  resume(payload: BreakpointResume): boolean {
    const key = `${payload.id}::${payload.stage}`;
    const p = this.pending.get(key);
    if (!p) return false;
    this.pending.delete(key);
    p.resolve(payload);
    return true;
  }
}
