# ADR-001：启用 Electron contextIsolation

**状态**：已接受  
**日期**：2024-01

---

## 背景

Electron 应用同时运行 main 进程（Node.js 环境）和 renderer 进程（Chromium 环境）。如果 renderer 可以直接访问 Node.js API，任何通过 XSS 注入的恶意脚本都能读取文件系统、执行系统命令。

## 决策

在 `src/electron/main.ts` 中启用：

```typescript
webPreferences: {
  contextIsolation: true,   // 隔离 renderer 的 JS 上下文
  nodeIntegration: false,   // 禁止 renderer 直接使用 Node.js
  preload: join(__dirname, 'preload.js'),
}
```

通过 `src/electron/preload.ts` 的 `contextBridge.exposeInMainWorld()` 暴露受控的 API 给 renderer。

## 备选方案

**方案 A（未选）**：`nodeIntegration: true`  
- 优点：renderer 可以直接 `require('fs')`，开发简单
- 缺点：严重安全漏洞，Electron 官方已不推荐，任何 XSS 即可获得文件系统访问权

**方案 B（未选）**：`contextIsolation: false` + `nodeIntegration: false`  
- 优点：比方案 A 稍安全
- 缺点：仍然允许 renderer 访问 Electron 内部对象，存在原型链污染风险

## 后果

**正面**：
- 符合 Electron 安全最佳实践
- renderer 进程被完全隔离，即使有 XSS 也无法访问系统资源

**负面**：
- 所有 main 进程能力都必须通过 IPC 通道暴露，增加了一定的开发复杂度
- 新增功能时需要同时修改 `main.ts`、`preload.ts`、`electron.d.ts` 三个文件

## 对 agent 的影响

**禁止**在 `src/` 下（除 `src/electron/` 外）的任何文件中：
- `import { app, ipcMain } from 'electron'`
- `import Store from 'electron-store'`
- `require('fs')` 或任何 Node.js 内置模块

违反此约束会导致运行时报错（模块找不到）或安全漏洞。
