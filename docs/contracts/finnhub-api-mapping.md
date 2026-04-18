# Finnhub API 字段映射

本文档记录 Finnhub API 响应字段到应用内 TypeScript 类型的映射关系。

## Quote（实时报价）

**API 端点**：`GET https://finnhub.io/api/v1/quote`  
**参数**：`symbol`, `token`

| Finnhub 字段 | 含义 | 应用内字段 | 类型 |
|-------------|------|-----------|------|
| `c` | Current price（当前价） | `price` | `number` |
| `d` | Change（涨跌额） | `change` | `number` |
| `dp` | Percent change（涨跌幅%） | `changePercent` | `number` |
| `h` | High price of the day | `high` | `number?` |
| `l` | Low price of the day | `low` | `number?` |
| `o` | Open price of the day | `open` | `number?` |
| `pc` | Previous close price | `previousClose` | `number?` |
| `t` | Timestamp（Unix 秒） | 未使用，`timestamp` 由应用生成 | — |

**注意**：`timestamp` 字段是应用在接收响应时用 `new Date().toISOString()` 生成的，不是 Finnhub 返回的 `t` 字段。

---

## Company Profile（公司信息）

**API 端点**：`GET https://finnhub.io/api/v1/stock/profile2`  
**参数**：`symbol`, `token`

| Finnhub 字段 | 含义 | 应用内字段 | 说明 |
|-------------|------|-----------|------|
| `name` | 公司名称 | `Stock.name` | 直接使用 |
| `marketCapitalization` | 市值（**单位：百万美元**） | `Stock.marketCap` | ⚠️ 注意单位！`formatMarketCap` 函数假设输入单位是百万美元 |
| `country` | 国家 | 拼接到 `Stock.description` | `${country} - ${industry}` |
| `industry` | 行业 | 拼接到 `Stock.description` | `${country} - ${industry}` |
| `finnhubIndustry` | Finnhub 行业分类 | 未使用 | — |
| `exchange` | 交易所 | 未使用 | — |

**⚠️ 已知 Bug**：`marketCapitalization` 的单位是**百万美元（million USD）**，但 `formatMarketCap()` 将传入值当作美元处理（直接做 T/B/M/K 换算），导致展示值偏小 100 万倍。例如苹果公司市值约 3 万亿美元，Finnhub 返回 `3000000`（百万美元），`formatMarketCap(3000000)` 输出 `$3.00M` 而非 `$3.00T`。修复前不要在此值基础上做任何数值计算。

---

## Company News（公司新闻）

**API 端点**：`GET https://finnhub.io/api/v1/company-news`  
**参数**：`symbol`, `from`（YYYY-MM-DD）, `to`（YYYY-MM-DD）, `token`

当前实现：获取最近 7 天新闻，最多取前 20 条。

| Finnhub 字段 | 含义 | 应用内字段 | 说明 |
|-------------|------|-----------|------|
| `headline` | 新闻标题 | `NewsItem.title` | 直接使用 |
| `source` | 来源 | `NewsItem.source` | 直接使用 |
| `datetime` | 发布时间（Unix 秒） | `NewsItem.publishedAt` | 转换：`new Date(datetime * 1000).toISOString()` |
| `url` | 原文链接 | `NewsItem.url` | 直接使用 |
| `summary` | 摘要 | `NewsItem.summary` | 直接使用 |
| `image` | 图片 URL | 未使用 | — |
| `id` | 新闻 ID | 未使用 | — |

---

## Symbol Search（股票搜索）

**API 端点**：`GET https://finnhub.io/api/v1/search`  
**参数**：`q`（搜索词）, `token`

| Finnhub 字段 | 含义 | 应用内字段 |
|-------------|------|-----------|
| `symbol` | 股票代码 | `SearchResult.symbol` |
| `description` | 公司名称描述 | `SearchResult.description` |
| `displaySymbol` | 显示用代码（可能含 `.` 等） | `SearchResult.displaySymbol` |
| `type` | 证券类型（Common Stock 等） | `SearchResult.type` |

**注意**：搜索结果中 `symbol` 和 `displaySymbol` 可能不同（如 `AAPL` vs `AAPL`，或港股 `00700` vs `00700.HK`）。添加到 watchlist 时使用 `symbol`（不含后缀），这是 Finnhub 报价 API 接受的格式。
