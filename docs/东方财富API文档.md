# 东方财富 API 文档

> 本文档汇总 StockerChef 项目实际使用的全部东方财富开放接口，按数据源 × 市场 × 用途三个维度组织。所有接口可在 Node.js（Electron 主进程）中直接 HTTP 访问，**渲染进程禁止直连**（CORS 限制，详见 [§9 集成规约](#9-本项目集成规约)）。
>
> 实现入口：`src/services/eastmoney.ts`

---

## 目录

1. [总览](#1-总览)
2. [通用基础](#2-通用基础)
3. [批量行情：push2 ulist](#3-批量行情push2-ulist)
4. [单股扩展行情：push2 stockget](#4-单股扩展行情push2-stockget)
5. [历史 K 线：push2his](#5-历史-k-线push2his)
6. [公司基本面：emweb F10](#6-公司基本面emweb-f10)
7. [财务 / 板块：datacenter-web](#7-财务--板块datacenter-web)
8. [资讯：search-api-web](#8-资讯search-api-web)
9. [本项目集成规约](#9-本项目集成规约)
10. [字段速查表](#10-字段速查表)
11. [已知陷阱与最佳实践](#11-已知陷阱与最佳实践)

---

## 1. 总览

### 1.1 数据源全景

| 数据源（域名） | 用途 | 鉴权 | 访问方式 | 本项目使用接口 |
|--------------|------|------|--------|--------------|
| `push2.eastmoney.com`           | 实时行情 / 单股扩展 | `ut` token | HTTP GET | `ulist.np` / `ulist` / `stock/get` |
| `push2his.eastmoney.com`        | 历史 K 线           | `ut` token | HTTP GET | `stock/kline/get` |
| `emweb.eastmoney.com`           | 公司 F10 基本面     | 无         | HTTP GET | HSF10 / HKF10 / USF10 各子接口 |
| `datacenter-web.eastmoney.com`  | 财务报表 / 板块归类 | 无         | HTTP GET | `RPT_F10_FINANCE_MAINFINADATA` / `RPT_F10_CORETHEME_BOARDTYPE` |
| `search-api-web.eastmoney.com`  | 资讯搜索            | 无         | HTTP GET（**JSONP**） | `/search/jsonp` |

### 1.2 三市场对照

| 市场 | symbol 格式 | 行情 secid 前缀 | F10 入口 | 字段完整度 |
|------|------------|----------------|---------|-----------|
| A 股 | 6 位代码（如 `600519`） | `1.` 上交所 / `0.` 深交所 / `0.` 北交所 | HSF10 + datacenter-web | ⭐⭐⭐⭐⭐ |
| 港股 | `XXXXX.HK`（如 `09988.HK`） | `116.` | HKF10 | ⭐⭐⭐ 缺概念 / 财务 |
| 美股 | ticker（如 `AAPL`） | `105.` NASDAQ / `106.` NYSE | USF10 | ⭐⭐ 仅基础 + 简介 |

### 1.3 调用链路

```
渲染进程组件 (Dashboard / Analysis)
    │
    │ window.electronAPI.getXxx(...)            ← preload.ts contextBridge
    ▼
Electron IPC                                    ── stock-get-quotes
                                                ── stock-get-indices
                                                ── stock-get-company-detail
                                                ── stock-get-news
                                                ── stock-get-history
    ▼
主进程 ipcMain.handle (src/electron/main.ts)
    │
    │ 调用 src/services/eastmoney.ts 的 fetchXxx()
    ▼
node:https GET → 东方财富域名
    │
    ▼
返回 JSON 字符串 → 渲染进程 setState
```

---

## 2. 通用基础

### 2.1 secid 格式

`secid = {市场代码}.{股票/指数代码}`

| 市场代码 | 含义 | 示例 |
|---------|------|------|
| `0`   | 深交所 / 北交所 A 股 | `0.000001`（平安银行）/ `0.430090`（北交所） |
| `1`   | 上交所 A 股          | `1.600519`（贵州茅台） |
| `90`  | 港股（旧）           | `90.HSI`（恒生指数旧式写法） |
| `100` | 美股 / 全球指数      | `100.NDX`（纳斯达克）/ `100.HSI`（恒生指数 push2 实测走 100） |
| `105` | 美股 NASDAQ          | `105.AAPL` / `105.TSLA` / `105.GOOGL` |
| `106` | 美股 NYSE            | `106.BABA` / `106.JPM` |
| `116` | 港股                 | `116.00700`（腾讯）/ `116.09988`（阿里-W） |
| `124` | 港股专属指数         | `124.HSTECH`（恒生科技） |

**派发规则（实现见 `toEastMoneySecid` / `toHKSecid` / `toUSSecid`）**：
- A 股：6 开头 → `1.`，其他 → `0.`
- 港股：去掉 `.HK` 后左补零至 5 位 → `116.{code}`
- 美股：按 ticker 白名单先选 `105.`（NASDAQ），未命中则尝试 `106.`（NYSE）

### 2.2 ut Token

`ut` 是行情接口的鉴权参数，社区固定值有效期较长。本项目维护 token 池，失败自动轮换：

| 优先级 | 值 |
|------|------|
| 主用   | `b2884a393a59ad64002292a3e90d46a5` |
| 备用 1 | `bd1d9ddb04089700cf9c27f6f7426281` |
| 备用 2 | `fa617be9e8966c902622023f04936795` |

**轮换逻辑**：响应 `rc !== 0` 时切换到下一个备用值并重试，最多尝试所有 token。

### 2.3 fltt 参数（**关键**）

`fltt` 决定数值格式，本项目两种用法泾渭分明：

| 取值 | 含义 | 本项目使用场景 |
|------|------|--------------|
| `1` | 整数模式（价格/估值已 ×100） | **已废弃**，曾经在 `ulist` 批量接口用过 |
| `2` | 浮点模式（直接是真实数值） | **当前所有 push2 接口统一使用** |

> ⚠️ **历史 Bug**：早期 `stock/get` 用 fltt=1 时，代码错误地把 PE / PB / EPS / ROE 也当价格 ÷100，导致估值字段全部偏小 100 倍。**统一切到 fltt=2 后，全部不再做 ÷100，价格直接是元、估值直接是浮点、振幅/换手率直接是百分比数值。**

### 2.4 通用响应包络

```jsonc
{
  "rc": 0,            // 0 = 成功；非 0 = ut 失效，需轮换
  "rt": 11,           // 响应时间（ms）
  "svr": 177617563,   // 服务器 ID（无需关心）
  "data": { ... }     // 业务数据
}
```

### 2.5 请求头

```http
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Referer:    https://www.eastmoney.com/        ← 行情接口
Referer:    https://so.eastmoney.com/         ← 资讯接口（不带会返回空 result）
Accept:     application/json, text/plain, */*
```

---

## 3. 批量行情：push2 ulist

一次请求批量返回多只股票 / 指数的实时报价。本项目用于 Dashboard 自选股列表 + 关键指数卡片。

### 3.1 接口

| 接口 | URL | 分页 | 本项目用途 |
|------|-----|------|----------|
| `ulist.np` | `https://push2.eastmoney.com/api/qt/ulist.np/get` | ❌ | **当前主用**，一次返回所有 secids |
| `ulist`    | `https://push2.eastmoney.com/api/qt/ulist/get`    | ✅ `pi`/`pz` | 备用，大量股票时分页 |

### 3.2 请求参数

| 参数 | 必填 | 示例 | 说明 |
|------|------|------|------|
| `ut` | ✅ | `b2884a3...` | token，参见 [§2.2](#22-ut-token) |
| `fltt` | ✅ | `2` | 浮点模式 |
| `invt` | ✅ | `2` | 反转标志，固定 |
| `np` | ✅ | `1` | 响应格式，固定 |
| `fields` | ✅ | `f2,f3,f4,f12,f14` | 字段集合 |
| `secids` | ✅ | `1.000001,100.NDX,...` | 多个 secid 逗号分隔 |
| `pi` | ⚠️ | `0` | 仅 `ulist` 需要 |
| `pz` | ⚠️ | `8` | 仅 `ulist` 需要 |

### 3.3 常用字段

| 字段 | 含义 | 单位（fltt=2） |
|------|------|--------------|
| `f2`  | 最新价     | 元（浮点） |
| `f3`  | 涨跌幅     | %（如 0.49 表示 +0.49%） |
| `f4`  | 涨跌额     | 元 |
| `f5`  | 成交量     | 手 |
| `f6`  | 成交额     | 元 |
| `f12` | 代码（不含市场前缀） | 字符串 |
| `f14` | 中文名     | 字符串 |
| `f15` | 当日最高   | 元 |
| `f16` | 当日最低   | 元 |
| `f17` | 今开       | 元 |
| `f18` | 昨收       | 元 |

### 3.4 示例 — 8 个关键指数

```
GET https://push2.eastmoney.com/api/qt/ulist.np/get
  ?fltt=2&invt=2&np=1
  &fields=f2,f3,f4,f12,f14
  &secids=1.000001,0.399001,0.399006,100.NDX,100.SPX,100.DJIA,100.HSI,124.HSTECH
  &ut=b2884a393a59ad64002292a3e90d46a5
```

```jsonc
{
  "rc": 0,
  "data": {
    "total": 8,
    "diff": [
      { "f2": 4071.41,  "f3": 0.49,  "f4": 19.98,  "f12": "000001", "f14": "上证指数" },
      { "f2": 14920.48, "f3": 0.24,  "f4": 35.06,  "f12": "399001", "f14": "深证成指" },
      { "f2": 24468.48, "f3": 1.52,  "f4": 365.78, "f12": "NDX",    "f14": "纳斯达克" }
      // ...
    ]
  }
}
```

### 3.5 关键指数 secid 映射

> 与 `src/services/eastmoney.ts` 中 `INDEX_SECID_MAP` 完全一致。

| secid | 应用内 symbol | 名称 | 说明 |
|-------|--------------|------|------|
| `1.000001`   | `000001.SH` | 上证指数 | 上交所 |
| `0.399001`   | `399001.SZ` | 深证成指 | 深交所 |
| `0.399006`   | `399006.SZ` | 创业板指 | 深交所 |
| `100.NDX`    | `.IXIC`     | 纳斯达克 | 美股 |
| `100.SPX`    | `.INX`      | 标普 500 | 美股 |
| `100.DJIA`   | `.DJI`      | 道琼斯   | 美股 |
| `100.HSI`    | `HSI`       | 恒生指数 | **走市场代码 100，不是港股的 116** |
| `124.HSTECH` | `HSTECH`    | 恒生科技 | **港股专属市场代码 124** |

⚠️ HSI 与 HSTECH 市场代码**不一致**，必须分别配置，曾踩过坑。

---

## 4. 单股扩展行情：push2 stock/get

一次只查一只股票，但能拿到批量接口没有的**估值字段**（PE / PB / 总市值 / 流通市值 / EPS / ROE 等）。本项目用于 Analysis 页面 Company Details Tab。

### 4.1 接口

| 项 | 值 |
|----|----|
| URL | `https://push2.eastmoney.com/api/qt/stock/get` |
| Method | GET |
| 鉴权 | `ut`（与批量接口共用 token 池） |
| 数值模式 | `fltt=2`（直接浮点，**不要 ÷100**） |

### 4.2 请求参数

| 参数 | 必填 | 示例 | 说明 |
|------|------|------|------|
| `ut` | ✅ | `b2884a3...` | token |
| `invt` | ✅ | `2` | 固定 |
| `fltt` | ✅ | `2` | **必须 2**，避免估值字段被错误 ÷100 |
| `fields` | ✅ | 见下表 | 字段集合 |
| `secid` | ✅ | `1.600519` | 单股，不是 secids |

### 4.3 当前请求的 27 个字段（fltt=2）

| 分组 | 字段 | 含义 | 单位 |
|------|------|------|------|
| **价格** | `f43` | 当前价 | 元 |
|         | `f44` | 当日最高 | 元 |
|         | `f45` | 当日最低 | 元 |
|         | `f46` | 今开 | 元 |
|         | `f60` | 昨收 | 元 |
| **量额** | `f47` | 成交量 | 手 |
|         | `f48` | 成交额 | 元 |
|         | `f57` | 代码 | 字符串 |
|         | `f58` | 中文简称 | 字符串 |
|         | `f86` | 时间戳 | Unix 秒 |
| **股本** | `f84` | 总股本 | 股 |
|         | `f85` | 流通股本 | 股 |
| **市值** | `f116` | 总市值 | 元 |
|         | `f117` | 流通市值 | 元 |
| **估值** | `f55` | EPS | 元（**fltt=2 直接浮点**） |
|         | `f130` | 市销率 PS | 倍 |
|         | `f162` | PE-TTM | 倍 |
|         | `f167` | PB | 倍 |
|         | `f173` | ROE | %（已是百分比数值） |
| **分类** | `f127` | 所属行业（仅 A 股） | 字符串 |
|         | `f128` | 所属地域板块（仅 A 股） | 字符串，如「贵州板块」 |
| **波动** | `f7`  | 振幅 | %（直接百分比） |
|         | `f8`  | 换手率 | %（直接百分比） |
|         | `f9`  | PE（动态） | 倍 |
|         | `f10` | 量比 | 倍 |
| **52 周** | `f350` | 52 周最高 | 元（**实测部分股票不返回**） |
|          | `f351` | 52 周最低 | 元（同上） |

### 4.4 示例响应（贵州茅台 600519）

```jsonc
{
  "rc": 0,
  "data": {
    "f43": 1450.32,           // 现价
    "f57": "600519",
    "f58": "贵州茅台",
    "f116": 1823450000000,    // 总市值（元）
    "f117": 1823450000000,    // 流通市值
    "f162": 25.43,            // PE-TTM
    "f167": 8.18,             // PB
    "f173": 32.5,             // ROE %
    "f55": 58.21,             // EPS
    "f127": "白酒",
    "f128": "贵州板块"
  }
}
```

### 4.5 三市场字段差异

| 字段 | A 股 | 港股 | 美股 | 备注 |
|------|------|------|------|------|
| `f127` 行业 | ✅ | ❌ | ❌ | 港美股需走 emweb F10 |
| `f128` 地域板块 | ✅ | ❌ | ❌ | A 股专有 |
| `f350/f351` 52 周 | ⚠️ 部分缺失 | ⚠️ | ⚠️ | 不可强依赖 |
| 其余字段 | ✅ | ✅ | ✅ | 三市场通用 |

---

## 5. 历史 K 线：push2his

### 5.1 接口

| 项 | 值 |
|----|----|
| URL | `https://push2his.eastmoney.com/api/qt/stock/kline/get` |
| Method | GET |
| 鉴权 | `ut`（与 push2 共用） |
| 复权方式 | 前复权（`fqt=1`） |

### 5.2 请求参数

| 参数 | 必填 | 示例 | 说明 |
|------|------|------|------|
| `secid` | ✅ | `1.600519` | secid，单股 |
| `fields1` | ✅ | `f1,f2,f3,f4,f5,f6` | 元数据字段（代码/名称等） |
| `fields2` | ✅ | `f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` | K 线字段（OHLCV + 涨跌幅等） |
| `klt` | ✅ | `101` | 周期：101=日 K，102=周 K，103=月 K |
| `fqt` | ✅ | `1` | 复权：0=不复权，1=前复权，2=后复权 |
| `beg` | ✅ | `20240101` | 起始日期 YYYYMMDD |
| `end` | ✅ | `20260418` | 结束日期 YYYYMMDD |

### 5.3 fields2 字段（K 线日线）

| 字段 | 含义 |
|------|------|
| `f51` | 日期 `YYYY-MM-DD` |
| `f52` | 开盘价 |
| `f53` | 收盘价 |
| `f54` | 最高价 |
| `f55` | 最低价 |
| `f56` | 成交量（手） |
| `f57` | 成交额（元） |
| `f58` | 振幅 % |
| `f59` | 涨跌幅 % |
| `f60` | 涨跌额 |
| `f61` | 换手率 % |

### 5.4 响应（截断）

```jsonc
{
  "rc": 0,
  "data": {
    "code": "600519",
    "name": "贵州茅台",
    "klines": [
      "2024-01-02,1685.00,1709.31,1715.00,1685.00,29856,5.07e9,1.78,1.31,22.31,0.24"
    ]
  }
}
```

每根 K 线是 `,` 分隔的字符串，按 `fields2` 顺序解析。本项目实现见 `fetchKLineData()`。

---

## 6. 公司基本面：emweb F10

`emweb.eastmoney.com` 提供 PC 端 F10 公司资料页的后端接口，按市场分三套（HSF10 / HKF10 / USF10），返回 JSON 但**不带 CORS 头**，必须走主进程。

### 6.1 三市场入口对照

| 市场 | URL 模板 | code 格式 | 主要字段 |
|------|----------|----------|---------|
| A 股 | `https://emweb.eastmoney.com/PC_HSF10/{Module}/PageAjax?code={MARKET}{6位}` | `SH600519` / `SZ000001` / `BJ430090` | 公司全名、行业、董事长、员工、简介 |
| 港股 | `https://emweb.eastmoney.com/PC_HKF10/CompanyProfile/PageAjax?code={5位}` | `00700` / `09988`（**不带 .HK**） | 公司名、注册地、董事长、员工 |
| 美股 | `https://emweb.eastmoney.com/pc_usf10/CompanyAndIssueProfile/PageAjax?code={TICKER}{后缀}` | `AAPL.O`（NASDAQ）/ `BABA.N`（NYSE） | 公司名、行业、CEO、简介 |

### 6.2 A 股 HSF10 子接口

A 股聚合 2 个子接口（财务接口已迁移到 datacenter-web，参见 [§7](#7-财务--板块datacenter-web)）：

| Module | 用途 | 关键返回字段 |
|--------|------|------------|
| `CompanySurvey` | 基础资料 | `jbzl[0]`：公司名、行业、董事长、员工、简介；`fxxg[0]`：上市日期 |
| `CompanyManagement` | 高管列表 | `gglb[]`：人员 + POSITION 多职位串 |

#### CompanySurvey 响应（生益电子 688183）

```jsonc
{
  "jbzl": [{
    "ORG_NAME": "生益电子股份有限公司",
    "SECURITY_NAME_ABBR": "生益电子",
    "EM2016": "电子设备-电子设备制造-电子设备制造",
    "INDUSTRYCSRC1": "制造业-计算机、通信和其他电子设备制造业",
    "TRADE_MARKET": "上海证券交易所",
    "CHAIRMAN": "邓春华",
    "PRESIDENT": "张恭敬",
    "ADDRESS": "广东省东莞市东城区(同沙)科技工业园同振路33号",
    "REG_ADDRESS": "东莞市东城区(同沙)科技工业园同振路33号",
    "EMP_NUM": 7647,
    "ORG_WEB": "www.sye.com.cn",
    "ORG_PROFILE": "..."
  }],
  "fxxg": [{
    "FOUND_DATE":   "1985-08-02 00:00:00",
    "LISTING_DATE": "2021-02-25 00:00:00"
  }]
}
```

#### CompanyManagement 响应

```jsonc
{
  "gglb": [{
    "PERSON_NAME": "邓春华",
    "POSITION": "董事长,法定代表人,非独立董事",
    "AGE": "55"
  }]
}
```

> 注：POSITION 是逗号分隔多职位串，需按 `/[,，、]/` 拆分匹配「董事长 / 总经理 / CEO」等关键词。

### 6.3 港股 HKF10

| 项 | 值 |
|----|----|
| URL | `https://emweb.eastmoney.com/PC_HKF10/CompanyProfile/PageAjax?code=00700` |
| code | 5 位代码（不带 .HK） |

港股顶级 keys 与字段命名与 A 股完全不同：

```jsonc
{
  "zqzl": {
    "zqdm":  "00700",
    "zqjc":  "腾讯控股",
    "ssrq":  "2004-06-16",
    "jys":   "香港交易所",
    "bk":    "资讯科技业",
    "mgmz":  "0.0001"
  },
  "gszl": {
    "gsmc":   "腾讯控股有限公司",
    "ywmc":   "Tencent Holdings Limited",
    "zcd":    "Cayman Islands",
    "bgdz":   "香港湾仔皇后大道东 1 号太古广场三座 29 楼",
    "gsclrq": "1998-11-11",
    "dsz":    "马化腾",
    "gswz":   "www.tencent.com",
    "gsms":   "梁慧玲",
    "ygrs":   "108436",
    "gsjs":   "...",
    "sshy":   "媒体及娱乐"
  }
}
```

> ⚠️ 港股**没有**财务摘要 / 概念列表接口，相关字段保持 `undefined`。

### 6.4 美股 USF10

| 项 | 值 |
|----|----|
| URL | `https://emweb.eastmoney.com/pc_usf10/CompanyAndIssueProfile/PageAjax?code=AAPL.O` |
| code | `{TICKER}.O`（NASDAQ）/ `{TICKER}.N`（NYSE） |

返回结构类 A 股 jbzl 风格，主要字段：`ORG_NAME` / `BELONG_INDUSTRY` / `CEO` / `ADDRESS` / `EMP_NUM` / `LISTING_DATE` / `ORG_PROFILE` / `ORG_WEB`。**没有**总经理 / 概念 / 财务摘要。

---

## 7. 财务 / 板块：datacenter-web

`datacenter-web.eastmoney.com` 是开放数据中心，emweb F10 老接口逐步迁移到这里。本项目用于 **A 股财务报表**和**A 股板块/概念归类**，港美股暂不支持。

### 7.1 主要财务指标（MainFinaData）

| 项 | 值 |
|----|----|
| URL | `https://datacenter-web.eastmoney.com/api/data/v1/get` |
| 必需参数 | `reportName=RPT_F10_FINANCE_MAINFINADATA`<br>`columns=ALL`<br>`filter=(SECUCODE%3D%22600519.SH%22)` |
| 可选参数 | `pageSize=4&pageNumber=1`<br>`sortColumns=REPORT_DATE&sortTypes=-1`（按报告期倒序） |

**SECUCODE 格式**：`{6位代码}.{SH|SZ|BJ}`（注意与 emweb 的 `SH600519` **顺序相反**）

#### 完整 URL 示例

```
https://datacenter-web.eastmoney.com/api/data/v1/get
  ?reportName=RPT_F10_FINANCE_MAINFINADATA
  &columns=ALL
  &filter=(SECUCODE%3D%22600519.SH%22)
  &pageSize=4&pageNumber=1
  &sortColumns=REPORT_DATE&sortTypes=-1
```

#### 响应（取最近 4 期，按 REPORT_DATE 倒序）

```jsonc
{
  "success": true,
  "code": 0,
  "result": {
    "data": [{
      "REPORT_DATE":             "2025-12-31 00:00:00",
      "TOTALOPERATEREVE":        9493763839.18,
      "PARENTNETPROFIT":         1473148860.35,
      "XSMLL":                   31.16,
      "ROEJQ":                   29.74,
      "EPSJB":                   1.80,
      "BPS":                     12.43,
      "MGJYXJJE":                3.21,
      "ZCFZL":                   42.18,
      "YYZSRTBZZ":               12.50,
      "PARENTNETPROFITTBZZ":     8.90
    }]
  }
}
```

> ⚠️ emweb 老接口 `NewFinanceAnalysis/MainTargetAjax` 已 **302 失效**，必须走 datacenter-web。

### 7.2 板块 / 概念归类（CoreThemeBoardType）

| 项 | 值 |
|----|----|
| URL | `https://datacenter-web.eastmoney.com/api/data/v1/get` |
| 必需参数 | `reportName=RPT_F10_CORETHEME_BOARDTYPE`<br>`columns=ALL`<br>`filter=(SECUCODE%3D%22600519.SH%22)` |

#### 响应（贵州茅台示例）

```jsonc
{
  "result": {
    "data": [
      {
        "BOARD_TYPE":             "行业",
        "BOARD_NAME":             "白酒",
        "BOARD_CODE":             "BK0438"
      },
      {
        "BOARD_TYPE":             "板块",
        "BOARD_NAME":             "贵州板块",
        "BOARD_CODE":             "BK0140"
      },
      {
        "BOARD_TYPE":             "概念",
        "BOARD_NAME":             "白酒概念",
        "BOARD_CODE":             "BK0480",
        "SELECTED_BOARD_REASON":  "公司是高端白酒龙头..."
      },
      {
        "BOARD_TYPE":             "题材",
        "BOARD_NAME":             "HS300_",
        "BOARD_CODE":             "BK0500"
      }
    ]
  }
}
```

#### 应用层分类规则（实现见 `fetchCNBoards`）

| 应用层 boardType | 映射规则 |
|-----------------|---------|
| `industry` | `BOARD_TYPE === '行业'` |
| `region`   | `BOARD_TYPE === '板块'`（地域板块如「贵州板块」） |
| `concept`  | `BOARD_TYPE === '概念'`，附带 `reason = SELECTED_BOARD_REASON` |
| `theme`    | `BOARD_TYPE === '题材'` |
| `index`    | `BOARD_TYPE === '指数成分'` |
| `other`    | 其他 |

---

## 8. 资讯：search-api-web

为 Analysis 页面「最新消息」Tab 提供个股资讯。**JSONP 协议**，必须剥包装。

### 8.1 接口

| 项 | 值 |
|----|----|
| URL | `https://search-api-web.eastmoney.com/search/jsonp` |
| Method | GET |
| 协议 | **JSONP**，响应是 `jQuery({...JSON})` |
| 鉴权 | 无 |
| 必需 Header | `Referer: https://so.eastmoney.com/` |

### 8.2 请求参数

| 参数 | 必填 | 示例 | 说明 |
|------|------|------|------|
| `cb`    | ✅ | `jQuery` | JSONP 回调名，本项目固定 `jQuery` |
| `param` | ✅ | URL-encoded JSON 串 | 见下方 |

`param` 内嵌 JSON 结构：

```jsonc
{
  "uid": "",
  "keyword": "300059",
  "type": ["cmsArticleWebOld"],
  "client": "web",
  "clientType": "web",
  "clientVersion": "curr",
  "param": {
    "cmsArticleWebOld": {
      "searchScope": "default",
      "sort": "default",
      "pageIndex": 1,
      "pageSize": 20,
      "preTag": "<em>",
      "postTag": "</em>"
    }
  }
}
```

### 8.3 keyword 与 symbol 映射（实现见 `symbolToNewsKeyword`）

| symbol | keyword | 示例 |
|--------|---------|------|
| A 股 6 位 | 原样 | `600519` → `600519` |
| 港股 `XXXXX.HK` | 去 `.HK` 后 5 位 | `09988.HK` → `09988` |
| 美股 ticker | 原样大写 | `AAPL` → `AAPL` |

### 8.4 响应（剥 JSONP 后）

```jsonc
{
  "code": 0,
  "msg": "OK",
  "hitsTotal": 317,
  "result": {
    "cmsArticleWebOld": [{
      "date":      "2026-04-24 19:26:11",
      "title":     "东方财富：一季度净利润同比增长<em>3</em>7.67%...",
      "content":   "4月24日，东方财富(<em>300059</em>.SZ)公告称...",
      "mediaName": "每日经济新闻",
      "url":       "http://finance.eastmoney.com/a/202604243718315929.html",
      "image":     ""
    }]
  }
}
```

### 8.5 字段映射（→ NewsItem）

| NewsItem | 来源 | 处理 |
|----------|------|------|
| `title`       | `title`     | 剥 `<em>` 标签 + trim |
| `source`      | `mediaName` | 空值兜底为 `'东方财富'` |
| `publishedAt` | `date`      | 拼 `+08:00` 时区后转 ISO |
| `url`         | `url`       | trim |
| `summary`     | `content`   | 剥 `<em>` 标签 + trim |

### 8.6 已知陷阱

- **必须带 `Referer: https://so.eastmoney.com/`**，缺失会返回空 `result.cmsArticleWebOld`
- **`search-api`（无 `-web`）的同名接口要求 POST 鉴权**，直接 GET 会 403；本项目用的是 `search-api-web` 子域名 + JSONP，无此限制
- **JSONP 包装必须剥**：用正则 `/^[^(]*\((.*)\);?\s*$/` 提取 JSON 体
- **时间无时区**：返回的 `date` 是上海本地时间但不带时区，前端 `new Date()` 会按 UTC 解析偏 8 小时；service 层补 `+08:00` 后再 ISO 化

---

## 9. 本项目集成规约

### 9.1 封装位置

| 文件 | 职责 |
|------|------|
| `src/services/eastmoney.ts` | 所有东方财富接口的 HTTP 封装、字段解析、降级处理 |
| `src/electron/main.ts`      | IPC handler 注册，调用 service 层并 JSON 序列化 |
| `src/electron/preload.ts`   | `contextBridge` 暴露 `window.electronAPI.getXxx` |
| `src/types/electron.d.ts`   | `ElectronAPI` 类型声明 |

### 9.2 IPC 通道清单

| 通道 | 输入 | 输出 | 调用 service |
|------|------|------|------------|
| `stock-get-quotes`         | `symbols: string`（混合市场逗号分隔） | `Quote[]`         | `fetchQuotes` |
| `stock-get-cn-quote`       | A 股 6 位代码                       | `Quote[]`         | `fetchCNQuotes` |
| `stock-get-hk-quote`       | `XXXXX.HK`                         | `Quote[]`         | `fetchHKQuotes` |
| `stock-get-indices`        | —                                  | `IndexQuote[]`    | `fetchIndices` |
| `stock-get-history`        | `symbol, startDate, endDate`       | `HistoricalDataResult` | `fetchKLineData` |
| `stock-get-company-detail` | `symbol`                           | `CompanyDetail`   | `fetchCompanyDetail` |
| `stock-get-news`           | `symbol`                           | `NewsItem[]`      | `fetchEastMoneyNews` |

### 9.3 CORS 规约（重要）

⚠️ **任何东方财富接口都必须走主进程 IPC，渲染进程禁止 `fetch`。**

原因：
1. `push2` / `emweb` / `search-api-web` 都不返回 `Access-Control-Allow-Origin` 头
2. dev 环境 `http://localhost:5173` origin 触发 CORS preflight，整个请求 reject
3. 打包后 `file://` 协议表现也不稳定

历史 Bug：`BUG-014` 自选股全部 `Failed to fetch` 就是因为渲染进程直连 `push2.eastmoney.com`，后续把所有数据接口统一搬到了主进程。

**唯一例外**：`fetchKLineData()` 当前仍在渲染进程跑（push2his 历史接口 dev 环境暂未触发 CORS）。如果未来出现 CORS 问题，按相同规约迁移到主进程。

### 9.4 降级策略

| 接口 | 失败时降级 |
|------|----------|
| 行情 / 指数 | Python Provider 链（`scripts/providers/`，tushare → akshare → yfinance） |
| 历史 K 线   | 同上 → 最终降级为随机模拟数据（UI 标注 `[SIMULATED DATA]`） |
| 公司详情    | 任一子接口失败不阻塞，缺失字段保持 `undefined`；全部失败抛 `无法获取公司详情` |
| 资讯        | 降级到 Finnhub `/company-news`（仅 Finnhub Key 已配置时尝试） |

### 9.5 超时

所有东方财富接口主进程统一 **8 秒超时**，超时后抛异常进入降级链。

---

## 10. 字段速查表

### 10.1 push2 ulist（批量行情，fltt=2）

| 字段 | 含义 | 单位 |
|------|------|------|
| f2/f3/f4 | 现价 / 涨跌幅 % / 涨跌额 | 元/%/元 |
| f5/f6 | 成交量 / 成交额 | 手/元 |
| f12/f14 | 代码（不含前缀）/ 中文名 | 字符串 |
| f15/f16/f17/f18 | 高/低/开/昨收 | 元 |

### 10.2 push2 stock/get（单股扩展，fltt=2）

| 字段 | 含义 | 单位 | CompanyDetail 字段 |
|------|------|------|-------------------|
| f43 | 现价 | 元 | — |
| f44/f45 | 当日高/低 | 元 | dayHigh/dayLow |
| f46/f60 | 今开/昨收 | 元 | openPrice/previousClose |
| f47/f48 | 成交量/成交额 | 手/元 | volume/turnover |
| f55  | EPS | 元 | eps（财报口径已覆盖） |
| f57/f58 | 代码/中文名 | 字符串 | shortName |
| f7/f8 | 振幅/换手率 | % | amplitude/turnoverRate |
| f84/f85 | 总股本/流通股 | 股 | totalShares/floatShares |
| f116/f117 | 总市值/流通市值 | 元 | marketCap/floatMarketCap |
| f127 | 行业（仅 A 股） | 字符串 | industry |
| f128 | 地域板块（仅 A 股） | 字符串 | （boards 中 region 类型） |
| f130 | 市销率 PS | 倍 | ps |
| f162 | PE-TTM | 倍 | peTTM |
| f167 | PB | 倍 | pb |
| f173 | ROE | % | roe（财报口径已覆盖） |
| f350/f351 | 52 周高/低 | 元 | yearHigh/yearLow（部分缺失） |

### 10.3 datacenter-web MainFinaData（A 股财务）

| 字段 | 含义 | 单位 | CompanyDetail 字段 |
|------|------|------|-------------------|
| REPORT_DATE          | 报告期 | 字符串 | reportDate |
| TOTALOPERATEREVE     | 营业总收入 | 元 | revenue |
| PARENTNETPROFIT      | 归母净利润 | 元 | netProfit |
| XSMLL                | 销售毛利率 | % | grossMargin |
| ROEJQ                | 加权 ROE | % | roe |
| EPSJB                | 基本 EPS | 元 | eps |
| BPS                  | 每股净资产 | 元 | bps |
| MGJYXJJE             | 每股经营现金流 | 元 | cashFlowPerShare |
| ZCFZL                | 资产负债率 | % | debtAssetRatio |
| YYZSRTBZZ            | 营收同比 | % | revenueYoY |
| PARENTNETPROFITTBZZ  | 归母净利同比 | % | netProfitYoY |

### 10.4 emweb HSF10（A 股 CompanySurvey.jbzl）

| 字段 | 含义 | CompanyDetail 字段 |
|------|------|-------------------|
| ORG_NAME              | 公司全名 | companyName |
| SECURITY_NAME_ABBR    | 简称 | shortName |
| EM2016                | 行业（细分到三级） | industry |
| INDUSTRYCSRC1         | 证监会行业 | industry（次选） |
| TRADE_MARKET          | 交易所 | exchange |
| CHAIRMAN              | 董事长 | chairman |
| PRESIDENT             | 总经理 | ceo |
| ADDRESS               | 办公地址 | officeAddress |
| REG_ADDRESS           | 注册地址 | registeredAddress |
| EMP_NUM               | 员工数 | employees |
| ORG_WEB               | 官网 | website |
| ORG_PROFILE           | 公司简介 | description |

### 10.5 emweb HKF10（港股 gszl + zqzl）

| 字段 | 含义 | CompanyDetail 字段 |
|------|------|-------------------|
| gszl.gsmc   | 公司名 | companyName |
| gszl.ywmc   | 英文名 | — |
| gszl.zcd    | 注册地 | registeredAddress |
| gszl.bgdz   | 办公地址 | officeAddress |
| gszl.gsclrq | 成立日期 | — |
| gszl.dsz    | 董事长 | chairman |
| gszl.gswz   | 官网 | website |
| gszl.ygrs   | 员工数 | employees |
| gszl.gsjs   | 公司简介 | description |
| gszl.sshy   | 所属行业 | industry |
| zqzl.zqjc   | 证券简称 | shortName |
| zqzl.ssrq   | 上市日期 | listingDate |
| zqzl.jys    | 交易所 | exchange |
| zqzl.bk     | 板块 | industry（次选） |

---

## 11. 已知陷阱与最佳实践

### 11.1 fltt 模式必须固定为 2

⚠️ 历史 Bug：早期 push2 stock/get 用 fltt=1 时，代码错误地把 PE / PB / EPS / ROE 也当价格 ÷100，导致估值字段全部偏小 100 倍。**统一切到 fltt=2 后所有字段直接是真实数值，不再做任何 ÷100 操作。**

### 11.2 secid 派发的 5 个边界

| 场景 | 错误派发 | 正确派发 |
|------|---------|---------|
| 北交所（4/8 开头）| `1.430090` | `0.430090`（北交所归在市场代码 0） |
| 港股 4 位代码 `700.HK` | `116.700` | `116.00700`（必须左补零至 5 位） |
| 美股 ticker 大小写 | `105.aapl` | `105.AAPL`（API 区分大小写） |
| 恒生指数 HSI | `116.HSI` | `100.HSI`（push2 接口走 100，不是港股 116） |
| 恒生科技 HSTECH | `100.HSTECH` | `124.HSTECH`（港股专属市场代码） |

### 11.3 emweb 字段命名陷阱

| 陷阱 | 应对 |
|------|------|
| 同含义字段多种命名（`ORG_NAME` / `ORG_NAME_CN` / `COMPANY_NAME`） | 用 `pickFirstRow(obj, [...keys])` 多 key 兜底 |
| A 股 `SH600519` vs datacenter-web `600519.SH` 顺序相反 | 区分使用 `toEmwebHSCode` 和 `${code}.${market}` |
| 港股 keys 是中文拼音（`zqzl` / `gszl` / `gsmc`）  | 不要套 A 股的 `ORG_NAME` 这套 |
| 高管 POSITION 是逗号串「董事长,法定代表人」 | 按 `/[,，、]/` 拆分匹配 |
| emweb 老接口 `MainTargetAjax` 已 302 失效 | 财务统一走 datacenter-web `RPT_F10_FINANCE_MAINFINADATA` |

### 11.4 资讯接口的 4 个坑

1. 必须带 `Referer: https://so.eastmoney.com/`，否则返回空
2. **必须用 `search-api-web`**（带 `-web`），无 `-web` 的同名接口要 POST 鉴权
3. JSONP 包装必须剥（正则提取）
4. 时间无时区，需补 `+08:00` 再 ISO 化

### 11.5 渲染进程禁止直连

参见 [§9.3 CORS 规约](#93-cors-规约重要)。一句话：**任何东方财富域名的 fetch 都必须走主进程 IPC**，渲染进程直连必报 CORS。

### 11.6 in-flight 去重

push2 / emweb 接口在 dev 模式下会被 React.StrictMode 双调，又会被定时轮询和手动刷新撞同帧，必须在 service / store 层做 in-flight Promise 去重：

```typescript
let inFlightFetchIndices: Promise<void> | null = null;

fetchIndices: async () => {
  if (inFlightFetchIndices) return inFlightFetchIndices;
  const task = (async () => {
    try { /* fetch + setState */ }
    finally { inFlightFetchIndices = null; }
  })();
  inFlightFetchIndices = task;
  return task;
}
```

详见 AGENTS.md `BUG-013`。`fetchAllQuotes` / `getProfile` 同模式。

### 11.7 ut Token 失效

接口连续返回 `rc !== 0` 时，先轮换备用 token；3 个 token 全部失败再降级到 Python Provider 链。**不要把 token 硬编码到组件**，统一从 `getEastMoneyUt()` 取，方便集中维护。

---

## 附录：实现入口速查

| 功能 | service 函数 | 文件位置 |
|------|------------|---------|
| 批量行情（混合市场） | `fetchQuotes(symbols)`              | `src/services/eastmoney.ts` |
| A 股专用行情         | `fetchCNQuotes(symbols)`            | 同上 |
| 港股专用行情         | `fetchHKQuotes(symbols)`            | 同上 |
| 美股专用行情         | `fetchUSQuotes(symbols)`            | 同上 |
| 关键指数             | `fetchIndices()`                    | 同上 |
| 历史 K 线            | `fetchKLineData(symbol, beg, end)`  | 同上 |
| 公司详情（聚合）     | `fetchCompanyDetail(symbol)`        | 同上 |
| A 股财务             | `fetchCNFinance(code, market)`      | 同上 |
| A 股板块             | `fetchCNBoards(code, market)`       | 同上 |
| 资讯                 | `fetchEastMoneyNews(symbol)`        | 同上 |
| ut token 取值        | `getEastMoneyUt()` / `rotateEastMoneyUt()` | 同上 |
| secid 派发           | `toEastMoneySecid` / `toHKSecid` / `toUSSecid` | 同上 |
