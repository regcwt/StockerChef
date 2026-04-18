# 已知问题与规避方案

本目录记录 StockerChef 中已知的、尚未修复的问题，以及当前的规避方案。

## 目的

防止 agent 重复踩坑，或在不了解背景的情况下"修复"实际上是有意为之的行为。

## 现有问题

| 文件 | 问题描述 | 严重程度 |
|------|----------|----------|
| [simulated-technical-analysis.md](simulated-technical-analysis.md) | 技术分析数据为随机模拟值 | 高（功能限制） |
| [rate-limit-behavior.md](rate-limit-behavior.md) | API 限流触发时的行为与边界情况 | 中 |
| [market-cap-unit-mismatch.md](market-cap-unit-mismatch.md) | 市值展示单位错误（偏小 100 万倍） | 高（数据错误） |
