import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { HistoricalDataPoint } from '@/types';

interface KLineChartProps {
  data: HistoricalDataPoint[];
  /** 是否使用深色主题 */
  isDark?: boolean;
  height?: number;
}

const KLineChart = ({ data, isDark = false, height = 380 }: KLineChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // 持久化 chart 实例，避免每次 data 变化都销毁重建
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // 仅在挂载/卸载时创建/销毁 chart 实例
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#374151',
        fontSize: 11,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(0,0,0,0.05)' },
        horzLines: { color: 'rgba(0,0,0,0.05)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: {
        borderColor: 'rgba(0,0,0,0.08)',
        scaleMargins: { top: 0.1, bottom: 0.3 },
      },
      localization: {
        timeFormatter: (time: unknown) => String(time).replace(/-/g, ''),
      },
      timeScale: {
        borderColor: 'rgba(0,0,0,0.08)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: unknown) => String(time).replace(/-/g, ''),
      },
    });

    // K 线主图
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',
      downColor: '#22c55e',
      borderUpColor: '#ef4444',
      borderDownColor: '#22c55e',
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e',
    });

    // 成交量副图
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#94a3b8',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // 自适应宽度
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []); // 仅挂载时执行一次

  // height 变化时更新图表高度（不重建 chart）
  useEffect(() => {
    chartRef.current?.applyOptions({ height });
  }, [height]);

  // isDark 变化时更新主题色（不重建 chart）
  useEffect(() => {
    if (!chartRef.current) return;
    const backgroundColor = isDark ? '#0f1a2e' : '#ffffff';
    const textColor = isDark ? '#a8c4b4' : '#374151';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    chartRef.current.applyOptions({
      layout: { background: { type: ColorType.Solid, color: backgroundColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor },
    });
  }, [isDark]);

  // data 变化时仅更新 series 数据（不重建 chart）
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    if (data.length === 0) return;

    candleSeriesRef.current.setData(
      data.map((point) => ({
        time: point.date as `${number}-${number}-${number}`,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
      }))
    );

    volumeSeriesRef.current.setData(
      data.map((point) => ({
        time: point.date as `${number}-${number}-${number}`,
        value: point.volume,
        color: point.close >= point.open ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)',
      }))
    );

    chartRef.current?.timeScale().fitContent();
  }, [data]);

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
