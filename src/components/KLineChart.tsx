import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import type { HistoricalDataPoint } from '@/types';

interface KLineChartProps {
  data: HistoricalDataPoint[];
  /** 是否使用深色主题 */
  isDark?: boolean;
  height?: number;
}

const KLineChart = ({ data, isDark = false, height = 380 }: KLineChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const container = containerRef.current;

    const backgroundColor = isDark ? '#0f1a2e' : '#ffffff';
    const textColor = isDark ? '#a8c4b4' : '#374151';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor,
        fontSize: 11,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: 1, // CrosshairMode.Magnet
      },
      rightPriceScale: {
        borderColor,
        scaleMargins: { top: 0.1, bottom: 0.3 },
      },
      localization: {
        // crosshair 悬停时显示的日期格式：20260418
        // time 是 "YYYY-MM-DD" 字符串（setData 传入的格式），直接去掉 "-" 即可
        timeFormatter: (time: unknown) => String(time).replace(/-/g, ''),
      },
      timeScale: {
        borderColor,
        timeVisible: true,
        secondsVisible: false,
        // time 是 "YYYY-MM-DD" 字符串，直接去掉 "-" 即可
        tickMarkFormatter: (time: unknown) => String(time).replace(/-/g, ''),
      },
    });

    // ── K 线主图（lightweight-charts v5：chart.addSeries(SeriesDefinition, options)）
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',       // 涨：红色（A 股风格）
      downColor: '#22c55e',     // 跌：绿色
      borderUpColor: '#ef4444',
      borderDownColor: '#22c55e',
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e',
    });

    candleSeries.setData(
      data.map((point) => ({
        time: point.date as `${number}-${number}-${number}`,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
      }))
    );

    // ── 成交量副图 ────────────────────────────────────────────────────
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#94a3b8',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });

    volumeSeries.setData(
      data.map((point) => ({
        time: point.date as `${number}-${number}-${number}`,
        value: point.volume,
        color: point.close >= point.open ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)',
      }))
    );

    // 自适应宽度
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);

    chart.timeScale().fitContent();

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [data, isDark, height]);

  if (data.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: 13,
        }}
      >
        暂无 K 线数据
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />;
};

export default KLineChart;
