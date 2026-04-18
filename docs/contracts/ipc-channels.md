# IPC 通道规范

本文档记录 StockerChef 中所有 Electron IPC 通道的完整规范。

## 通道列表

### `store-get`

| 属性 | 值 |
|------|-----|
| **方向** | renderer → main |
| **注册位置** | `src/electron/main.ts` |
| **暴露位置** | `src/electron/preload.ts` → `window.electronAPI.getStore()` |
| **类型声明** | `src/types/electron.d.ts` |

**参数**：
- `key: string` — electron-store 的存储键名

**返回值**：
- `unknown` — 存储的值，调用方需自行做类型断言或类型守卫

**当前使用的 key**：
| Key | 类型 | 说明 |
|-----|------|------|
| `'watchlist'` | `string[]` | 自选股代码列表（大写） |

**调用示例**：
```typescript
const saved = await window.electronAPI.getStore('watchlist');
if (Array.isArray(saved)) {
  // 使用 saved
}
```

---

### `store-set`

| 属性 | 值 |
|------|-----|
| **方向** | renderer → main |
| **注册位置** | `src/electron/main.ts` |
| **暴露位置** | `src/electron/preload.ts` → `window.electronAPI.setStore()` |
| **类型声明** | `src/types/electron.d.ts` |

**参数**：
- `key: string` — electron-store 的存储键名
- `value: unknown` — 要存储的值（必须是可序列化的 JSON 值）

**返回值**：
- `true` — 写入成功（当前实现始终返回 true，不抛出异常）

**调用示例**：
```typescript
await window.electronAPI.setStore('watchlist', ['AAPL', 'TSLA']);
```

---

## 新增 IPC 通道的规范

新增通道时，必须**同时**修改以下三个文件，缺一不可：

1. **`src/electron/main.ts`**：注册 `ipcMain.handle('channel-name', handler)`
2. **`src/electron/preload.ts`**：在 `contextBridge.exposeInMainWorld` 中新增方法
3. **`src/types/electron.d.ts`**：在 `ElectronAPI` 接口中新增方法签名

**通道命名约定**：
- 使用 kebab-case：`store-get`、`store-set`
- 动词在后：`store-get`（不是 `get-store`）
- 语义清晰：避免使用 `do-thing`、`action` 等模糊名称

**禁止**：
- 在 renderer 中直接使用 `ipcRenderer`（必须通过 preload 的 contextBridge 暴露）
- 在 main 进程中使用 `ipcMain.on` 替代 `ipcMain.handle`（`handle` 支持异步返回值，`on` 不支持）
