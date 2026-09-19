import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as echarts from 'echarts';

export interface EChartHandle {
  download: (name?: string) => void;
}

/**
 * Thin React wrapper around Apache ECharts. Creates one chart instance per mount,
 * keeps it sized to its container, and re-applies the option (notMerge) whenever it
 * changes so switching chart type / metric fully replaces the previous option.
 * Exposes a `download` method (via ref) so a PNG button can live in the card header
 * instead of overlapping the chart.
 */
const EChart = forwardRef<EChartHandle, { option: any; height?: number | string; onEvents?: Record<string, (p: any) => void> }>(
  function EChart({ option, height = 320, onEvents }, ref) {
    const elRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);

    useImperativeHandle(ref, () => ({
      download(name = 'chart') {
        const chart = chartRef.current;
        if (!chart) return;
        const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      },
    }));

    useEffect(() => {
      if (!elRef.current) return;
      const chart = echarts.init(elRef.current, undefined, { renderer: 'canvas' });
      chartRef.current = chart;
      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(elRef.current);
      return () => {
        ro.disconnect();
        chart.dispose();
        chartRef.current = null;
      };
    }, []);

    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.setOption(option, true);
      chart.off('click');
      if (onEvents) {
        for (const [ev, fn] of Object.entries(onEvents)) chart.on(ev, fn);
      }
      chart.resize();
    }, [option]);

    return <div ref={elRef} style={{ width: '100%', height }} />;
  }
);

export default EChart;
