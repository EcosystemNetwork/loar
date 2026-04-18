/**
 * CandlestickChart — Interactive price chart with candles, volume bars,
 * and timeframe selection for token detail pages.
 *
 * Renders a pure SVG chart with hover tooltips, price/time axes,
 * and volume overlay — no external charting library needed.
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface TradePoint {
  timestamp: number;
  price: number;
  isBuy: boolean;
  ethAmount: number;
}

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number; // bucket start
  trades: number;
}

type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

function buildCandles(data: TradePoint[], tf: Timeframe): Candle[] {
  if (!data.length) return [];
  const bucket = TIMEFRAME_SECONDS[tf];
  const candleMap = new Map<number, Candle>();

  for (const d of data) {
    const key = Math.floor(d.timestamp / bucket) * bucket;
    const existing = candleMap.get(key);
    if (!existing) {
      candleMap.set(key, {
        open: d.price,
        high: d.price,
        low: d.price,
        close: d.price,
        volume: d.ethAmount,
        timestamp: key,
        trades: 1,
      });
    } else {
      existing.high = Math.max(existing.high, d.price);
      existing.low = Math.min(existing.low, d.price);
      existing.close = d.price;
      existing.volume += d.ethAmount;
      existing.trades += 1;
    }
  }

  // Fill gaps with flat candles
  const sorted = Array.from(candleMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) return sorted;

  const filled: Candle[] = [];
  for (let i = 0; i < sorted.length; i++) {
    filled.push(sorted[i]);
    if (i < sorted.length - 1) {
      let t = sorted[i].timestamp + bucket;
      while (t < sorted[i + 1].timestamp) {
        filled.push({
          open: sorted[i].close,
          high: sorted[i].close,
          low: sorted[i].close,
          close: sorted[i].close,
          volume: 0,
          timestamp: t,
          trades: 0,
        });
        t += bucket;
        if (filled.length > 500) break; // safety
      }
    }
  }

  return filled.slice(-120); // max 120 candles
}

export function CandlestickChart({ data }: { data: TradePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const candles = useMemo(() => buildCandles(data, timeframe), [data, timeframe]);

  const W = 700;
  const H_CANDLE = 200;
  const H_VOLUME = 50;
  const H = H_CANDLE + H_VOLUME + 40; // + x-axis
  const PAD = { top: 12, right: 64, bottom: 28, left: 4 };
  const chartW = W - PAD.left - PAD.right;

  const prices = candles.length > 0 ? candles.flatMap((c) => [c.high, c.low]) : [0];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || minPrice * 0.01 || 1;
  const pricePad = priceRange * 0.05;

  const maxVol = Math.max(...candles.map((c) => c.volume), 0.001);

  const candleW = candles.length > 0 ? chartW / candles.length : 1;
  const bodyW = Math.max(candleW * 0.6, 2);

  const toX = (i: number) => PAD.left + (i + 0.5) * candleW;
  const toY = (p: number) =>
    PAD.top + (1 - (p - (minPrice - pricePad)) / (priceRange + pricePad * 2)) * H_CANDLE;
  const volY = (v: number) => PAD.top + H_CANDLE + H_VOLUME - (v / maxVol) * (H_VOLUME - 4);

  // Y-axis ticks
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const p = minPrice + (priceRange * i) / 4;
    return { price: p, y: toY(p) };
  });

  // X-axis ticks (every ~20 candles)
  const step = Math.max(Math.floor(candles.length / 6), 1);
  const xTicks = candles
    .filter((_, i) => i % step === 0)
    .map((c, idx) => ({ timestamp: c.timestamp, x: toX(idx * step) }));

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    if (timeframe === '1d') return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatPrice = (p: number) => (p < 0.001 ? p.toExponential(2) : p.toFixed(6));

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * W - PAD.left;
      const idx = Math.floor(mouseX / candleW);
      if (idx >= 0 && idx < candles.length) {
        setHoverIndex(idx);
      }
    },
    [candles.length, candleW]
  );

  if (candles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm">
        No trading data available
      </div>
    );
  }

  const hoverCandle = hoverIndex !== null ? candles[hoverIndex] : null;
  const lastCandle = candles[candles.length - 1];

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Timeframe selector */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => (
            <Button
              key={tf}
              variant={timeframe === tf ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-[10px] font-mono"
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </Button>
          ))}
        </div>
        {/* OHLCV display for hovered candle */}
        {hoverCandle && (
          <div className="flex gap-3 text-[10px] font-mono tabular-nums">
            <span className="text-muted-foreground">
              O <span className="text-foreground">{formatPrice(hoverCandle.open)}</span>
            </span>
            <span className="text-muted-foreground">
              H <span className="text-green-500">{formatPrice(hoverCandle.high)}</span>
            </span>
            <span className="text-muted-foreground">
              L <span className="text-red-500">{formatPrice(hoverCandle.low)}</span>
            </span>
            <span className="text-muted-foreground">
              C <span className="text-foreground">{formatPrice(hoverCandle.close)}</span>
            </span>
            <span className="text-muted-foreground">
              V <span className="text-foreground">{hoverCandle.volume.toFixed(4)}</span>
            </span>
          </div>
        )}
      </div>

      {/* Chart SVG */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* Grid */}
        {yTicks.map((tick, i) => (
          <line
            key={`gy-${i}`}
            x1={PAD.left}
            y1={tick.y}
            x2={W - PAD.right}
            y2={tick.y}
            stroke="currentColor"
            strokeOpacity="0.06"
            strokeDasharray="4 4"
          />
        ))}

        {/* Volume separator */}
        <line
          x1={PAD.left}
          y1={PAD.top + H_CANDLE}
          x2={W - PAD.right}
          y2={PAD.top + H_CANDLE}
          stroke="currentColor"
          strokeOpacity="0.1"
        />

        {/* Volume bars */}
        {candles.map((c, i) => (
          <rect
            key={`vol-${i}`}
            x={toX(i) - bodyW / 2}
            y={volY(c.volume)}
            width={bodyW}
            height={PAD.top + H_CANDLE + H_VOLUME - volY(c.volume)}
            fill={c.close >= c.open ? '#22c55e' : '#ef4444'}
            fillOpacity={hoverIndex === i ? 0.6 : 0.2}
            rx="0.5"
          />
        ))}

        {/* Candles */}
        {candles.map((c, i) => {
          const isGreen = c.close >= c.open;
          const color = isGreen ? '#22c55e' : '#ef4444';
          const bodyTop = toY(Math.max(c.open, c.close));
          const bodyBot = toY(Math.min(c.open, c.close));
          const bodyHeight = Math.max(bodyBot - bodyTop, 1);

          return (
            <g key={`candle-${i}`}>
              {/* Wick */}
              <line
                x1={toX(i)}
                y1={toY(c.high)}
                x2={toX(i)}
                y2={toY(c.low)}
                stroke={color}
                strokeWidth="1"
              />
              {/* Body */}
              <rect
                x={toX(i) - bodyW / 2}
                y={bodyTop}
                width={bodyW}
                height={bodyHeight}
                fill={isGreen ? color : color}
                stroke={color}
                strokeWidth="0.5"
                rx="0.5"
              />
            </g>
          );
        })}

        {/* Y-axis labels */}
        {yTicks.map((tick, i) => (
          <text
            key={`yl-${i}`}
            x={W - PAD.right + 4}
            y={tick.y + 3}
            fontSize="8"
            fill="currentColor"
            fillOpacity="0.5"
            fontFamily="monospace"
          >
            {formatPrice(tick.price)}
          </text>
        ))}

        {/* X-axis labels */}
        {xTicks.map((tick, i) => (
          <text
            key={`xl-${i}`}
            x={tick.x}
            y={H - 4}
            fontSize="8"
            fill="currentColor"
            fillOpacity="0.5"
            textAnchor="middle"
          >
            {formatTime(tick.timestamp)}
          </text>
        ))}

        {/* Hover crosshair */}
        {hoverIndex !== null && hoverCandle && (
          <>
            <line
              x1={toX(hoverIndex)}
              y1={PAD.top}
              x2={toX(hoverIndex)}
              y2={PAD.top + H_CANDLE + H_VOLUME}
              stroke="currentColor"
              strokeOpacity="0.3"
              strokeDasharray="3 3"
            />
            <line
              x1={PAD.left}
              y1={toY(hoverCandle.close)}
              x2={W - PAD.right}
              y2={toY(hoverCandle.close)}
              stroke="currentColor"
              strokeOpacity="0.3"
              strokeDasharray="3 3"
            />
            {/* Price label on Y axis */}
            <rect
              x={W - PAD.right}
              y={toY(hoverCandle.close) - 7}
              width={58}
              height={14}
              fill={hoverCandle.close >= hoverCandle.open ? '#22c55e' : '#ef4444'}
              rx="2"
            />
            <text
              x={W - PAD.right + 4}
              y={toY(hoverCandle.close) + 3}
              fontSize="8"
              fill="white"
              fontFamily="monospace"
            >
              {formatPrice(hoverCandle.close)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
