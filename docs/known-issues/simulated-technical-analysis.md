# 技术分析数据来源说明（已升级为真实计算）

**严重程度**：已解决（有网络时使用真实数据，无网络时降级为模拟）  
**状态**：✅ 已修复（2026-04）  
**影响文件**：`src/pages/Analysis.tsx`、`scripts/stock_fetch.py`、`src/services/stockApi.ts`

---

## 当前实现

点击"Technical Analysis"按钮触发的分析流程：

1. 调用 `getHistoricalData(symbol, startDate, endDate)` 获取历史 K 线
2. Python 脚本 `scripts/stock_fetch.py` 优先使用 **AKShare**，降级到 **yfinance**
3. 基于真实收盘价序列计算：
   - **RSI(14)**：Wilder 平滑法
   - **SMA20 / SMA50 / SMA200**：简单移动平均
4. UI 标注数据来源：`[AKShare]` / `[yfinance]` / `[SIMULATED DATA]`

---

## 降级规则

| 场景 | 数据来源 | UI 标注 |
|------|---------|---------|
| AKShare 可用 | 真实历史 K 线 | `[AKShare]` |
| AKShare 不可用，yfinance 可用 | 真实历史 K 线 | `[yfinance]` |
| 两者均不可用（网络断开） | 随机模拟 | `[SIMULATED DATA]` |
| 历史数据少于 15 根 | 随机模拟 | `[SIMULATED DATA]` |

---

## 对 agent 的约束

**禁止**：
1. 将 `AnalysisResult` 中的 `rsi`、`sma20`、`sma50`、`sma200` 存入 `electron-store` 或任何持久化存储
2. 基于 `source === 'simulated'` 的数据做任何业务逻辑判断
3. 在 UI 上移除数据来源标注（`[AKShare]` / `[yfinance]` / `[SIMULATED DATA]`）

**允许**：
- 修改 RSI/SMA 的计算窗口参数
- 新增其他技术指标（在 `Analysis.tsx` 中扩展计算逻辑）

---

## 历史背景

初始版本（2026-03）使用 `Math.random()` 生成模拟值，原因是 Finnhub 免费层不提供历史 K 线。
2026-04 接入 AKShare + yfinance 双数据源后，升级为真实计算，模拟数据仅作网络不可用时的降级兜底。
