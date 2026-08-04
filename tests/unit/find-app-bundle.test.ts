import { describe, it, expect } from 'vitest';
import { findAppBundle } from '../../electron/system/process-lookup';

/**
 * 回归：Electron 类应用的 helper（Google Chrome Helper.app、Code Helper.app、企业微信 Helper.app）
 * 的 icon 应该走**最外层主 bundle**——因为 helper.app 通常只带默认空白图标，UI 上会显示为空白框。
 * 归到主 app 后既能拿到正经的应用 icon，也能把这些 helper 聚合成一条 app 分组。
 */
describe('findAppBundle: helper 归并到最外层主 app', () => {
  it('Google Chrome Helper → Google Chrome.app', () => {
    const p = '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/150.0.7871.188/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper';
    expect(findAppBundle(p)).toBe('/Applications/Google Chrome.app');
  });

  it('VS Code Helper → Visual Studio Code.app', () => {
    const p = '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper';
    expect(findAppBundle(p)).toBe('/Applications/Visual Studio Code.app');
  });

  it('企业微信 Helper → 企业微信.app（unicode 路径）', () => {
    const p = '/Applications/企业微信.app/Contents/Frameworks/企业微信 Helper.app/Contents/MacOS/企业微信 Helper';
    expect(findAppBundle(p)).toBe('/Applications/企业微信.app');
  });

  it('普通单层 app（cmux）保持不变', () => {
    const p = '/Applications/cmux.app/Contents/MacOS/cmux';
    expect(findAppBundle(p)).toBe('/Applications/cmux.app');
  });

  it('WorkBuddy Helper → WorkBuddy.app', () => {
    const p = '/Applications/WorkBuddy.app/Contents/Frameworks/WorkBuddy Helper.app/Contents/MacOS/WorkBuddy Helper';
    expect(findAppBundle(p)).toBe('/Applications/WorkBuddy.app');
  });

  it('.xpc 保持最近层（不与 .app 合并）', () => {
    const p = '/Applications/Foo.app/Contents/XPCServices/bar.xpc/Contents/MacOS/bar';
    // .app 优先且最外层 → 拿到 Foo.app（xpc 与 helper 一样属于子 bundle，聚到主 app）
    expect(findAppBundle(p)).toBe('/Applications/Foo.app');
  });

  it('孤立的 .xpc（无外层.app）取自身', () => {
    const p = '/System/Library/XPCServices/foo.xpc/Contents/MacOS/foo';
    expect(findAppBundle(p)).toBe('/System/Library/XPCServices/foo.xpc');
  });

  it('守护进程 /usr/libexec/... 返回 undefined', () => {
    expect(findAppBundle('/usr/libexec/rapportd')).toBeUndefined();
  });

  it('node 可执行文件（非 bundle）返回 undefined', () => {
    expect(findAppBundle('/Users/x/.nvm/versions/node/v24.16.0/bin/node')).toBeUndefined();
  });
});
