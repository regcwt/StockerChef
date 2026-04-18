# 模块间接口契约

本目录记录 StockerChef 各模块之间的接口契约，包括 IPC 通道规范、API 字段映射、数据格式约定等。

## 目的

当修改某个模块时，必须先查阅相关契约文档，确认改动不会破坏其他模块的预期。

## 现有契约

| 文件 | 描述 |
|------|------|
| [ipc-channels.md](ipc-channels.md) | Electron IPC 通道完整规范（main ↔ renderer） |
| [finnhub-api-mapping.md](finnhub-api-mapping.md) | Finnhub API 响应字段到应用内类型的映射关系 |
