// 测试用 electron mock：提供 app.getPath 指向临时目录。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.join(os.tmpdir(), 'proxybaby-test');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const app = {
  getPath: (_name: string) => dir,
  getVersion: () => '0.0.0-test',
  getFileIcon: async (_p: string, _opts?: unknown) => ({
    isEmpty: () => true,
    resize: () => ({ toDataURL: () => '' }),
    toDataURL: () => '',
  }),
};

export const shell = {
  openExternal: async (_url: string) => true,
};
