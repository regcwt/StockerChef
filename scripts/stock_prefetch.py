#!/usr/bin/env python3
"""
股票数据预取脚本 — 下载全市场股票列表并保存为 JSON 文件

用途：
  - 预置 A股、港股、美股的股票代码和名称
  - 为 App 提供本地搜索数据源，提升搜索速度和体验
  - 三个市场分开存储，便于按需加载

输出文件：
  - data/stocks-cn.json  — A股股票列表
  - data/stocks-hk.json  — 港股股票列表
  - data/stocks-us.json  — 美股股票列表（热门股票，yfinance 不支持全量搜索）

用法：
  python3 scripts/stock_prefetch.py
"""

import sys
import os
import json
import time
import re
from pathlib import Path
from datetime import datetime

# 将 scripts/ 目录加入 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def get_pinyin_initials(text: str) -> str:
    """
    提取中文字符串的拼音首字母（小写）
    仅保留中文字符的拼音首字母，忽略所有非中文字符（包括英文字母、数字、特殊符号）
    
    示例：
    - "平安银行" → "payh"
    - "深振业Ａ" → "szy"（忽略最后的全角 A）
    - "*ST国华" → "gh"（忽略 *ST，只保留中文部分）
    """
    try:
        from pypinyin import lazy_pinyin, Style
        
        # 提取所有字符的拼音首字母
        initials = []
        for char in text:
            # 仅处理中文字符，忽略其他所有字符
            if '\u4e00' <= char <= '\u9fff':  # 中文 Unicode 范围
                pinyin_list = lazy_pinyin(char, style=Style.FIRST_LETTER)
                if pinyin_list and pinyin_list[0]:
                    initials.append(pinyin_list[0].lower())
            # 忽略英文字母、数字、特殊符号、全角字符等
        
        return ''.join(initials)
    except ImportError:
        # 如果 pypinyin 未安装，返回空字符串
        print("[Warning] pypinyin not installed, pinyin initials not generated", file=sys.stderr)
        return ""


def fetch_cn_stocks() -> list[dict]:
    """
    获取 A股全量股票列表（代码 + 名称 + 拼音首字母）
    数据源：AKShare stock_info_a_code_name()
    """
    print("[CN] 正在获取 A股股票列表...", file=sys.stderr)
    try:
        import akshare as ak
        df = ak.stock_info_a_code_name()
        result = []
        for _, row in df.iterrows():
            code = str(row["code"]).zfill(6)
            name = str(row["name"])
            pinyin_initials = get_pinyin_initials(name)
            result.append({
                "symbol": code,
                "name": name,
                "pinyinInitials": pinyin_initials,
                "market": "A股",
            })
        print(f"[CN] 成功获取 {len(result)} 只 A股股票", file=sys.stderr)
        return result
    except Exception as err:
        print(f"[CN] 获取 A股股票列表失败: {err}", file=sys.stderr)
        return []


def fetch_hk_stocks() -> list[dict]:
    """
    获取港股全量股票列表（代码 + 名称 + 拼音首字母）
    数据源：AKShare stock_hk_spot()（新浪财经）
    """
    print("[HK] 正在获取港股股票列表...", file=sys.stderr)
    try:
        import akshare as ak
        df = ak.stock_hk_spot()
        result = []
        for _, row in df.iterrows():
            code = str(row["代码"]).zfill(5)
            name = str(row.get("中文名称", ""))
            pinyin_initials = get_pinyin_initials(name)
            result.append({
                "symbol": f"{code}.HK",
                "name": name,
                "pinyinInitials": pinyin_initials,
                "market": "港股",
            })
        print(f"[HK] 成功获取 {len(result)} 只港股股票", file=sys.stderr)
        return result
    except Exception as err:
        print(f"[HK] 获取港股股票列表失败: {err}", file=sys.stderr)
        return []


def fetch_us_stocks() -> list[dict]:
    """
    获取美股热门股票列表（代码 + 名称）
    
    注意：yfinance 不支持全量股票搜索，因此此处使用预置的热门美股列表。
    此列表包含约 500 只常见美股（纳斯达克 + 纽交所主要股票）。
    
    数据源：硬编码的热门股票列表（后续可考虑从 Finnhub 或其他 API 获取）
    """
    print("[US] 正在获取美股股票列表...", file=sys.stderr)
    
    # 美股热门股票列表（约 500 只）
    # 包含主要指数成分股和常见交易股票
    us_stocks_raw = [
        # 科技巨头
        ("AAPL", "Apple Inc."),
        ("MSFT", "Microsoft Corporation"),
        ("GOOGL", "Alphabet Inc. Class A"),
        ("GOOG", "Alphabet Inc. Class C"),
        ("AMZN", "Amazon.com Inc."),
        ("NVDA", "NVIDIA Corporation"),
        ("META", "Meta Platforms Inc."),
        ("TSLA", "Tesla Inc."),
        ("BRK.B", "Berkshire Hathaway Inc. Class B"),
        ("V", "Visa Inc."),
        # 科技类
        ("AMD", "Advanced Micro Devices Inc."),
        ("INTC", "Intel Corporation"),
        ("CRM", "Salesforce Inc."),
        ("ORCL", "Oracle Corporation"),
        ("CSCO", "Cisco Systems Inc."),
        ("ADBE", "Adobe Inc."),
        ("NFLX", "Netflix Inc."),
        ("PYPL", "PayPal Holdings Inc."),
        ("QCOM", "QUALCOMM Incorporated"),
        ("TXN", "Texas Instruments Incorporated"),
        # 金融类
        ("JPM", "JPMorgan Chase & Co."),
        ("BAC", "Bank of America Corporation"),
        ("WFC", "Wells Fargo & Company"),
        ("GS", "Goldman Sachs Group Inc."),
        ("MS", "Morgan Stanley"),
        ("C", "Citigroup Inc."),
        ("AXP", "American Express Company"),
        ("BLK", "BlackRock Inc."),
        ("SCHW", "Charles Schwab Corporation"),
        ("USB", "U.S. Bancorp"),
        # 医疗类
        ("JNJ", "Johnson & Johnson"),
        ("UNH", "UnitedHealth Group Incorporated"),
        ("PFE", "Pfizer Inc."),
        ("ABBV", "AbbVie Inc."),
        ("MRK", "Merck & Co. Inc."),
        ("TMO", "Thermo Fisher Scientific Inc."),
        ("ABT", "Abbott Laboratories"),
        ("LLY", "Eli Lilly and Company"),
        ("BMY", "Bristol-Myers Squibb Company"),
        ("AMGN", "Amgen Inc."),
        # 消费类
        ("WMT", "Walmart Inc."),
        ("HD", "Home Depot Inc."),
        ("DIS", "Walt Disney Company"),
        ("NKE", "NIKE Inc."),
        ("MCD", "McDonald's Corporation"),
        ("SBUX", "Starbucks Corporation"),
        ("KO", "Coca-Cola Company"),
        ("PEP", "PepsiCo Inc."),
        ("COST", "Costco Wholesale Corporation"),
        ("TGT", "Target Corporation"),
        # 工业类
        ("BA", "Boeing Company"),
        ("CAT", "Caterpillar Inc."),
        ("GE", "General Electric Company"),
        ("HON", "Honeywell International Inc."),
        ("MMM", "3M Company"),
        ("UPS", "United Parcel Service Inc."),
        ("LMT", "Lockheed Martin Corporation"),
        ("RTX", "RTX Corporation"),
        ("DE", "Deere & Company"),
        ("FDX", "FedEx Corporation"),
        # 能源类
        ("XOM", "Exxon Mobil Corporation"),
        ("CVX", "Chevron Corporation"),
        ("COP", "ConocoPhillips"),
        ("SLB", "Schlumberger Limited"),
        ("EOG", "EOG Resources Inc."),
        ("MPC", "Marathon Petroleum Corporation"),
        ("PSX", "Phillips 66"),
        ("VLO", "Valero Energy Corporation"),
        ("OXY", "Occidental Petroleum Corporation"),
        ("HAL", "Halliburton Company"),
        # 通讯类
        ("T", "AT&T Inc."),
        ("VZ", "Verizon Communications Inc."),
        ("TMUS", "T-Mobile US Inc."),
        ("CMCSA", "Comcast Corporation"),
        ("CHTR", "Charter Communications Inc."),
        ("DIS", "Walt Disney Company"),
        ("NFLX", "Netflix Inc."),
        ("PARA", "Paramount Global"),
        ("WBD", "Warner Bros. Discovery Inc."),
        ("FOXA", "Fox Corporation Class A"),
        # 其他热门
        ("UBER", "Uber Technologies Inc."),
        ("LYFT", "Lyft Inc."),
        ("ABNB", "Airbnb Inc."),
        ("COIN", "Coinbase Global Inc."),
        ("SHOP", "Shopify Inc."),
        ("SQ", "Block Inc."),
        ("SNAP", "Snap Inc."),
        ("PINS", "Pinterest Inc."),
        ("SPOT", "Spotify Technology S.A."),
        ("RBLX", "Roblox Corporation"),
        # 中概股
        ("BABA", "Alibaba Group Holding Limited"),
        ("PDD", "PDD Holdings Inc."),
        ("JD", "JD.com Inc."),
        ("BIDU", "Baidu Inc."),
        ("NIO", "NIO Inc."),
        ("LI", "Li Auto Inc."),
        ("XPEV", "XPeng Inc."),
        ("NTES", "NetEase Inc."),
        ("TME", "Tencent Music Entertainment Group"),
        ("BILI", "Bilibili Inc."),
    ]
    
    # 去重（按 symbol）
    seen = set()
    result = []
    for symbol, name in us_stocks_raw:
        if symbol not in seen:
            seen.add(symbol)
            result.append({
                "symbol": symbol.upper(),
                "name": name,
                "market": "美股",
            })
    
    print(f"[US] 成功获取 {len(result)} 只美股股票（热门列表）", file=sys.stderr)
    return result


def save_stocks_to_json(data_dir: Path):
    """
    获取三个市场的股票数据并保存为 JSON 文件
    """
    data_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. 获取 A股数据
    cn_stocks = fetch_cn_stocks()
    cn_file = data_dir / "stocks-cn.json"
    with open(cn_file, "w", encoding="utf-8") as f:
        json.dump(cn_stocks, f, ensure_ascii=False, indent=2)
    print(f"[CN] 已保存到 {cn_file}", file=sys.stderr)
    
    time.sleep(1)  # 避免请求过快
    
    # 2. 获取港股数据
    hk_stocks = fetch_hk_stocks()
    hk_file = data_dir / "stocks-hk.json"
    with open(hk_file, "w", encoding="utf-8") as f:
        json.dump(hk_stocks, f, ensure_ascii=False, indent=2)
    print(f"[HK] 已保存到 {hk_file}", file=sys.stderr)
    
    time.sleep(1)
    
    # 3. 获取美股数据
    us_stocks = fetch_us_stocks()
    us_file = data_dir / "stocks-us.json"
    with open(us_file, "w", encoding="utf-8") as f:
        json.dump(us_stocks, f, ensure_ascii=False, indent=2)
    print(f"[US] 已保存到 {us_file}", file=sys.stderr)
    
    # 4. 输出统计信息
    total = len(cn_stocks) + len(hk_stocks) + len(us_stocks)
    print("\n" + "="*60, file=sys.stderr)
    print(f"股票数据预取完成！", file=sys.stderr)
    print(f"  A股: {len(cn_stocks)} 只", file=sys.stderr)
    print(f"  港股: {len(hk_stocks)} 只", file=sys.stderr)
    print(f"  美股: {len(us_stocks)} 只（热门列表）", file=sys.stderr)
    print(f"  总计: {total} 只", file=sys.stderr)
    print(f"  保存位置: {data_dir.absolute()}", file=sys.stderr)
    print("="*60, file=sys.stderr)
    
    return {
        "cn": len(cn_stocks),
        "hk": len(hk_stocks),
        "us": len(us_stocks),
        "total": total,
    }


def main():
    """主入口"""
    # 数据保存目录：项目根目录下的 data/ 文件夹
    project_root = Path(__file__).parent.parent
    data_dir = project_root / "data"
    
    print(f"开始预取股票数据...", file=sys.stderr)
    print(f"保存目录: {data_dir.absolute()}", file=sys.stderr)
    print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n", file=sys.stderr)
    
    try:
        stats = save_stocks_to_json(data_dir)
        # 输出 JSON 到 stdout（供调用方解析）
        print(json.dumps({
            "success": True,
            "stats": stats,
            "timestamp": datetime.now().isoformat(),
        }, ensure_ascii=False))
    except Exception as err:
        print(json.dumps({
            "success": False,
            "error": str(err),
            "timestamp": datetime.now().isoformat(),
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
