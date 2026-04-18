# 已知问题：API 限流触发时的行为与边界情况

**严重程度**：中  
**状态**：已知，部分处理  
**影响文件**：`src/services/stockApi.ts`、`src/pages/Dashboard.tsx`、`src/store/useStockStore.ts`

---

## 问题描述

### 问题 1：批量刷新时的队列积压

当用户添加了大量股票（如 15 只），每次 10 秒刷新周期触发 `fetchAllQuotes()` 时，会向队列中推入 15 个请求。由于队列间隔 ~2000ms，这 15 个请求需要 ~30 秒才能全部完成，而下一个 10 秒刷新周期已经开始，导致队列持续积压。

**表现**：自选股数量 > 5 只时，部分股票的报价更新会有明显延迟。

**当前状态**：未修复。README 中建议"减少 watchlist 中的股票数量"。

### 问题 2：rateLimited 状态的重置时机不准确

`Dashboard.tsx` 中，当检测到 429 错误时：
```typescript
setRateLimited(true);
setTimeout(() => setRateLimited(false), 60000); // 60 秒后重置
```

但 Finnhub 的实际限流窗口是滚动的 1 分钟，不是固定的 60 秒。在某些情况下，60 秒后仍可能继续触发 429。

**当前状态**：已知，可接受。用户看到 rateLimited 提示后等待 1-2 分钟即可。

### 问题 3：队列在组件卸载后继续执行

`requestQueue` 是模块级变量，不随 React 组件的生命周期重置。如果用户快速切换页面，已入队的请求仍会继续执行，但回调中的 `resolve/reject` 可能指向已卸载的组件状态。

**当前状态**：React 的 `useState` 在组件卸载后不会更新（会有 warning），但不会导致崩溃。已知问题，未修复。

---

## 规避方案

1. **控制 watchlist 大小**：建议不超过 10 只股票，以确保在 10 秒刷新周期内完成所有请求
2. **遇到限流提示时**：等待 1-2 分钟，不要频繁手动点击"Refresh All Quotes"
3. **开发时**：如果需要频繁测试，临时将 `MAX_REQUESTS_PER_MINUTE` 改为更小的值（如 10），避免消耗 API 配额

---

## 对 agent 的约束

**禁止**：
- 将 `MAX_REQUESTS_PER_MINUTE` 调高到超过 50（Finnhub 免费层硬限制是 60，超过 50 没有安全余量）
- 绕过 `apiRequest()` 队列来"加速"刷新

**允许**：
- 在 `MAX_REQUESTS_PER_MINUTE` 范围内调整参数
- 实现更智能的队列清空逻辑（如组件卸载时清空队列中属于该组件的请求）
