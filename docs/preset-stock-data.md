# 预置股票数据说明

## 概述

本项目使用预置的 JSON 文件存储全市场股票列表，用于本地快速搜索，提升用户体验。

## 数据文件

三个市场的股票数据分别存储在 `data/` 目录下：

| 文件 | 市场 | 数据量 | 数据源 |
|------|------|--------|--------|
| `stocks-cn.json` | A股 | ~5,500 只 | AKShare stock_info_a_code_name() |
| `stocks-hk.json` | 港股 | ~2,700 只 | AKShare stock_hk_spot() |
| `stocks-us.json` | 美股 | ~100 只（热门） | 手动维护的热门股票列表 |

## 数据格式

每个 JSON 文件包含一个数组，每条记录格式如下：

**A股和港股**：
```json
{
  "symbol": "000001",
  "name": "平安银行",
  "pinyinInitials": "payh",
  "market": "A股"
}
```

**美股**：
```json
{
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "market": "美股"
}
```

**字段说明**：
- `symbol`: 股票代码（A股为 6 位数字，港股为 XXXXX.HK 格式，美股为大写字母）
- `name`: 股票名称（中文或英文）
- `pinyinInitials`: 拼音首字母（仅 A股和港股，小写，如 "payh"）
- `market`: 市场标识（"A股" / "港股" / "美股"）

**pinyinInitials 生成规则**：
- 仅保留中文字符的拼音首字母
- 忽略所有非中文字符（英文字母、数字、特殊符号、全角字符等）
- 示例：
  - "平安银行" → "payh"
  - "深振业Ａ" → "szy"（忽略全角 A）
  - "*ST国华" → "gh"（忽略 *ST）

## 更新数据

### 自动更新（推荐）

运行预取脚本即可更新所有市场数据：

```bash
python3 scripts/stock_prefetch.py
```

脚本会自动：
1. 从 AKShare 获取最新 A股和港股列表
2. 使用内置的美股热门列表
3. 保存到 `data/` 目录下的对应 JSON 文件

### 手动更新

如需单独更新某个市场，可以：

1. **A股/港股**：直接运行脚本（脚本会同时更新三个市场）
2. **美股**：编辑 `scripts/stock_prefetch.py` 中的 `us_stocks_raw` 数组，添加新的热门股票

### 更新频率建议

- **A股/港股**：建议每周或每月更新一次（股票列表变化不频繁）
- **美股**：按需手动更新（当前为手动维护的热门列表）

## 搜索机制

### 搜索优先级

Dashboard 的搜索功能使用以下优先级：

1. **预置数据搜索**（本地，即时响应）
   - 在 `presetStocks` 中模糊匹配：
     - 股票代码前缀匹配（如 "000001"）
     - 股票名称关键词匹配（如 "平安"）
     - **拼音首字母匹配**（如 "payh" → 平安银行）
   - 零网络延迟，用户体验最佳

2. **降级搜索**（网络，备用方案）
   - A股：AKShare 实时搜索（当预置数据未找到时）
   - 港股：格式识别 + 预置数据名称补充
   - 美股：Finnhub API 搜索（需要 API Key）

### 拼音搜索示例

用户输入拼音首字母即可快速找到股票：

| 输入 | 匹配示例 | 说明 |
|------|---------|------|
| `payh` | 平安银行 | 完整拼音首字母 |
| `szy` | 深振业Ａ | 忽略全角 A |
| `gh` | *ST国华 | 忽略特殊符号和英文 |
| `wk` | 万科Ａ | 忽略全角 A |

### 搜索性能

- **预置数据加载**：应用启动时一次性加载到内存（约 700KB 数据）
- **搜索速度**：本地内存搜索，响应时间 < 10ms
- **内存占用**：约 1-2 MB（三个市场数据缓存）

## 打包说明

在 `package.json` 的 `build.files` 中已配置包含 `data/` 目录：

```json
{
  "build": {
    "files": [
      "dist/**/*",
      "dist-electron/**/*",
      "resources/**/*",
      "data/**/*",
      "scripts/**/*"
    ]
  }
}
```

打包后数据文件会位于：
- **开发模式**：`项目根目录/data/`
- **生产模式**：`Contents/Resources/data/`（macOS .app 包内）

## 扩展美股数据

当前美股数据为手动维护的热门列表（约 100 只）。如需扩展：

### 方案一：扩展手动列表（当前方案）

编辑 `scripts/stock_prefetch.py` 中的 `us_stocks_raw` 数组，添加更多股票：

```python
us_stocks_raw = [
    ("AAPL", "Apple Inc."),
    ("MSFT", "Microsoft Corporation"),
    # ... 添加更多
]
```

### 方案二：接入 Finnhub 全量搜索（需要 API Key）

修改 `stock_prefetch.py`，使用 Finnhub API 获取完整美股列表：

```python
def fetch_us_stocks_via_finnhub() -> list[dict]:
    import requests
    # 需要 Finnhub API Key
    # 调用 https://finnhub.io/api/v1/stock/symbol?exchange=US&token=YOUR_KEY
    # 注意：Finnhub 免费层有 rate limit，需要分页获取
    pass
```

### 方案三：使用其他数据源

考虑使用 yfinance、Alpha Vantage 或其他免费 API 获取美股列表。

## 故障排查

### 数据文件不存在

如果启动时提示数据文件不存在：

1. 检查 `data/` 目录是否存在
2. 运行 `python3 scripts/stock_prefetch.py` 重新生成
3. 检查打包时是否正确包含了 `data/` 目录

### 搜索无结果

1. 确认预置数据已正确加载（检查控制台日志）
2. 尝试搜索已知股票代码（如 "000001" 或 "AAPL"）
3. 检查预置数据文件是否为有效 JSON

### 数据过期

如果发现股票列表缺少新上市的股票：

1. 运行更新脚本：`python3 scripts/stock_prefetch.py`
2. 重新构建应用：`npm run build`

## 技术架构

```
用户输入搜索关键词
    ↓
Dashboard.handleSearch()
    ↓
searchPresetStocks() — 本地内存搜索（优先）
    ├── 找到 → 立即返回结果
    └── 未找到 → 降级为网络搜索
         ├── A股 → searchCNSymbol() (AKShare)
         ├── 港股 → 格式识别 + 预置名称
         └── 美股 → searchSymbol() (Finnhub)
```

## 注意事项

1. **数据文件大小**：
   - A股：~440 KB
   - 港股：~240 KB
   - 美股：~8 KB
   - 总计：~688 KB（压缩后更小）

2. **更新时机**：
   - 建议在非交易时段更新数据
   - 更新后需要重新打包应用

3. **数据准确性**：
   - 预置数据仅用于搜索，不用于实时报价
   - 实时报价仍通过网络 API 获取
   - 股票名称和代码以预置数据为准

4. **内存管理**：
   - 数据在应用启动时加载到内存
   - 使用 JSON.parse() 解析，性能良好
   - 不需要手动清理，应用关闭时自动释放
