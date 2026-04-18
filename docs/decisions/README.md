# 架构决策记录（ADR）

本目录记录 StockerChef 项目中所有重要的架构决策，包括决策背景、备选方案、最终选择及其原因。

## 格式

每个 ADR 文件命名为 `NNN-topic.md`，包含以下字段：

- **状态**：已接受 / 已废弃 / 已替代
- **背景**：为什么需要做这个决策
- **决策**：我们选择了什么
- **备选方案**：考虑过但未选择的方案
- **后果**：这个决策带来的影响（正面和负面）

## 现有决策

| 编号 | 主题 | 状态 |
|------|------|------|
| [001](001-electron-context-isolation.md) | Electron contextIsolation 安全策略 | 已接受 |
| [002](002-finnhub-rate-limit-strategy.md) | Finnhub API 限流队列设计 | 已接受 |
