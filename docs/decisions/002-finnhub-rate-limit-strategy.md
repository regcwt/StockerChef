# ADR-002：Finnhub API 限流队列设计

**状态**：已接受  
**日期**：2024-01

---

## 背景

Finnhub 免费层限额为 60次/分钟。StockerChef 的 Dashboard 会对所有自选股并发请求报价（`Promise.all`），如果用户添加了超过 5 只股票，在 10 秒刷新周期内的并发请求很容易触发 429 限流。

## 决策

在 `src/services/stockApi.ts` 中实现一个**串行请求队列**：

```typescript
const MAX_REQUESTS_PER_MINUTE = 30; // 使用 50% 的限额，留出安全余量
const REQUEST_INTERVAL = 60000 / MAX_REQUESTS_PER_MINUTE; // ~2000ms

let requestQueue: Array<() => void> = [];
let isProcessing = false;
```

所有 API 调用必须通过 `apiRequest()` 函数包装，进入队列后按 ~2000ms 间隔串行出队执行。

## 备选方案

**方案 A（未选）**：直接并发，依赖 Finnhub 的限流响应  
- 优点：实现简单
- 缺点：触发 429 后需要等待 1 分钟，用户体验差；频繁触发可能导致 API Key 被封

**方案 B（未选）**：使用 WebSocket 实时推送  
- 优点：真正实时，无需轮询
- 缺点：Finnhub 免费层 WebSocket 连接数有限制；实现复杂度高；已列入 Future Enhancements

**方案 C（已选）**：客户端串行队列 + 50% 安全余量  
- 优点：简单可靠，不依赖服务端限流响应，用户体验平滑
- 缺点：多只股票时刷新延迟叠加（10只股票需要 ~20s 才能全部刷新完）

## 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `MAX_REQUESTS_PER_MINUTE` | 30 | Finnhub 限额的 50%，留出安全余量 |
| `REQUEST_INTERVAL` | ~2000ms | 相邻请求的最小间隔 |
| 新闻缓存时长 | 5 分钟 | 新闻更新不频繁，缓存可以减少 API 调用 |

## 后果

**正面**：
- 有效避免 429 错误
- 新闻缓存进一步减少 API 消耗

**负面**：
- 自选股数量多时，批量刷新完成时间较长
- 队列是模块级单例，应用重启后队列状态重置（可接受）

## 对 agent 的影响

**禁止**绕过队列直接调用 axios：
```typescript
// ❌ 禁止
await axios.get('https://finnhub.io/api/v1/quote', { params: { symbol, token: API_KEY } });

// ✅ 必须
await apiRequest(async () => axios.get(...));
// 或直接使用已封装的函数
await getQuote(symbol);
```

如需调整限流参数，只修改 `src/services/stockApi.ts` 顶部的 `MAX_REQUESTS_PER_MINUTE` 常量。
