# 已知问题：市值展示单位错误（偏小 100 万倍）

**严重程度**：高（数据错误）  
**状态**：已知，未修复  
**影响文件**：`src/services/stockApi.ts` → `getProfile()`，`src/utils/format.ts` → `formatMarketCap()`，`src/pages/Analysis.tsx`

---

## 问题描述

`Analysis.tsx` 的 Details 标签页中展示的市值数字偏小 100 万倍。

**具体表现**：
- 苹果公司（AAPL）实际市值约 3 万亿美元
- Finnhub `getProfile()` 返回 `marketCapitalization: 3000000`（单位：百万美元，即 3,000,000 × 1,000,000 = 3 万亿美元）
- `formatMarketCap(3000000)` 将 3000000 当作美元处理，输出 `$3.00M`
- 正确结果应为 `$3.00T`

---

## 根本原因

两处实现之间存在单位不匹配：

**`src/services/stockApi.ts` `getProfile()` 中**：
```typescript
return {
  symbol,
  name: data.name || symbol,
  marketCap: data.marketCapitalization,  // Finnhub 单位：百万美元
  description: `${data.country} - ${data.industry}`,
};
```

**`src/utils/format.ts` `formatMarketCap()` 中**：
```typescript
export const formatMarketCap = (cap: number): string => {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`;  // 假设输入单位是美元
  if (cap >= 1e9)  return `$${(cap / 1e9).toFixed(2)}B`;
  if (cap >= 1e6)  return `$${(cap / 1e6).toFixed(2)}M`;
  if (cap >= 1e3)  return `$${(cap / 1e3).toFixed(2)}K`;
  return `$${cap.toFixed(2)}`;
};
```

`formatMarketCap` 假设输入单位是美元，但实际传入的是百万美元，导致结果偏小 100 万倍。

---

## 对 agent 的约束

**禁止**：
- 基于 `Stock.marketCap` 做任何数值比较或业务计算（如"市值超过 1 万亿的股票"筛选）
- 在修复此 Bug 前，将 `marketCap` 存入 `electron-store` 持久化

---

## 修复方案（二选一）

### 方案 A：在 `getProfile()` 中做单位转换（推荐）

修改 `src/services/stockApi.ts`：

```typescript
return {
  symbol,
  name: data.name || symbol,
  marketCap: data.marketCapitalization * 1_000_000,  // 百万美元 → 美元
  description: `${data.country} - ${data.industry}`,
};
```

优点：`formatMarketCap` 无需修改，语义清晰（`Stock.marketCap` 单位统一为美元）。

### 方案 B：修改 `formatMarketCap()` 接受百万美元输入

修改 `src/utils/format.ts`：

```typescript
// 注意：cap 单位为百万美元（million USD），来自 Finnhub API
export const formatMarketCap = (capInMillions: number): string => {
  const capInDollars = capInMillions * 1_000_000;
  if (capInDollars >= 1e12) return `$${(capInDollars / 1e12).toFixed(2)}T`;
  if (capInDollars >= 1e9)  return `$${(capInDollars / 1e9).toFixed(2)}B`;
  if (capInDollars >= 1e6)  return `$${(capInDollars / 1e6).toFixed(2)}M`;
  if (capInDollars >= 1e3)  return `$${(capInDollars / 1e3).toFixed(2)}K`;
  return `$${capInDollars.toFixed(2)}`;
};
```

缺点：`formatMarketCap` 的语义变得特殊（只能接受百万美元输入），与函数名不符，容易引起混淆。

**推荐方案 A**，修改后需执行 `npx tsc --noEmit` 验证类型无误。
