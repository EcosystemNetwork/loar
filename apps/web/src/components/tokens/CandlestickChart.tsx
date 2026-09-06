/**
 * CandlestickChart — interactive price chart with candles / line modes, moving
 * averages, a log-scale toggle, a buy/sell-split volume pane, timeframe
 * selection and hover crosshair. Pure SVG — no charting library.
 */
import { useState, useMemo, useCallback, useRef } from 'react';
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
  buyVolume: number;
  sellVolume: number;
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
        buyVolume: d.isBuy ? d.ethAmount : 0,
        sellVolume: d.isBuy ? 0 : d.ethAmount,
        timestamp: key,
        trades: 1,
      });
    } else {
      existing.high = Math.max(existing.high, d.price);
      existing.low = Math.min(existing.low, d.price);
      existing.close = d.price;
      existing.volume += d.ethAmount;
      if (d.isBuy) existing.buyVolume += d.ethAmount;
      else existing.sellVolume += d.ethAmount;
      existing.trades += 1;
    }
  }

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
          buyVolume: 0,
          sellVolume: 0,
          timestamp: t,
          trades: 0,
        });
        t += bucket;
        if (filled.length > 500) break;
      }
    }
  }

  return filled.slice(-120);
}

// Static SVG geometry — hoisted so hook deps stay stable.
const W = 700;
const H_CANDLE = 200;
const H_VOLUME = 50;
const H = H_CANDLE + H_VOLUME + 40;
const PAD = { top: 12, right: 64, bottom: 28, left: 4 };
const CHART_W = W - PAD.left - PAD.right;

/** Simple moving average of candle closes; null for the warm-up window. */
function sma(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function CandlestickChart({ data }: { data: TradePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const [logScale, setLogScale] = useState(false);
  const [showMA, setShowMA] = useState(true);

  const candles = useMemo(() => buildCandles(data, timeframe), [data, timeframe]);
  const ma7 = useMemo(() => sma(candles, 7), [candles]);
  const ma25 = useMemo(() => sma(candles, 25), [candles]);

  const chartW = CHART_W;

  const rawPrices = candles.length > 0 ? candles.flatMap((c) => [c.high, c.low]) : [1];
  // Log scale needs strictly positive values; fall back to linear if any <= 0.
  const canLog = logScale && rawPrices.every((p) => p > 0);
  const tf = (p: number) => (canLog ? Math.log10(p) : p);
  const prices = rawPrices.map(tf);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || Math.abs(minPrice) * 0.01 || 1;
  const pricePad = priceRange * 0.05;

  const maxVol = Math.max(...candles.map((c) => c.volume), 0.001);

  const candleW = candles.length > 0 ? chartW / candles.length : 1;
  const bodyW = Math.max(candleW * 0.6, 2);

  const toX = (i: number) => PAD.left + (i + 0.5) * candleW;
  const toY = (p: number) =>
    PAD.top + (1 - (tf(p) - (minPrice - pricePad)) / (priceRange + pricePad * 2)) * H_CANDLE;
  const volTop = PAD.top + H_CANDLE;
  const buyVolY = (v: number) => volTop + H_VOLUME - (v / maxVol) * (H_VOLUME - 4);

  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const frac = i / 4;
    const tfVal = minPrice + priceRange * frac;
    const price = canLog ? Math.pow(10, tfVal) : tfVal;
    return { price, y: PAD.top + (1 - frac) * H_CANDLE };
  });

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

  const linePath = useMemo(() => {
    if (!candles.length) return '';
    return candles.map((c, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(c.close)}`).join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, minPrice, priceRange, canLog]);

  const maPath = (series: (number | null)[]) => {
    let d = '';
    let started = false;
    series.forEach((v, i) => {
      if (v == null) return;
      d += `${started ? 'L' : 'M'} ${toX(i)} ${toY(v)} `;
      started = true;
    });
    return d;
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * W - PAD.left;
      const idx = Math.floor(mouseX / candleW);
      if (idx >= 0 && idx < candles.length) setHoverIndex(idx);
    },
    [candles.length, candleW]
  );

  if (candles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
        No trading data available
      </div>
    );
  }

  const hoverCandle = hoverIndex !== null ? candles[hoverIndex] : null;

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((t) => (
            <Button
              key={t}
              variant={timeframe === t ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2 font-mono text-[10px]"
              onClick={() => setTimeframe(t)}
            >
              {t}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={chartType === 'candles' ? 'default' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setChartType('candles')}
          >
            Candles
          </Button>
          <Button
            variant={chartType === 'line' ? 'default' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setChartType('line')}
          >
            Line
          </Button>
          <Button
            variant={showMA ? 'default' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setShowMA((v) => !v)}
            title="Moving averages (7 / 25)"
          >
            MA
          </Button>
          <Button
            variant={logScale ? 'default' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setLogScale((v) => !v)}
            title="Logarithmic price axis"
          >
            Log
          </Button>
        </div>
      </div>

      {/* OHLCV for hovered candle */}
      {hoverCandle && (
        <div className="flex flex-wrap gap-3 font-mono text-[10px] tabular-nums">
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
          {hoverCandle.trades > 0 && (
            <span className="text-muted-foreground">
              <span className="text-green-500">{hoverCandle.buyVolume.toFixed(3)}</span> /{' '}
              <span className="text-red-500">{hoverCandle.sellVolume.toFixed(3)}</span>
            </span>
          )}
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
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

        <line
          x1={PAD.left}
          y1={volTop}
          x2={W - PAD.right}
          y2={volTop}
          stroke="currentColor"
          strokeOpacity="0.1"
        />

        {/* Volume bars — split buy (green, from baseline) over sell (red, stacked) */}
        {candles.map((c, i) => {
          const total = c.buyVolume + c.sellVolume || c.volume;
          if (total <= 0) return null;
          const fullH = volTop + H_VOLUME - buyVolY(total);
          const buyFrac = total > 0 ? c.buyVolume / total : 0;
          const buyH = fullH * buyFrac;
          const sellH = fullH - buyH;
          const x = toX(i) - bodyW / 2;
          return (
            <g key={`vol-${i}`} opacity={hoverIndex === i ? 0.85 : 0.5}>
              <rect
                x={x}
                y={volTop + H_VOLUME - sellH}
                width={bodyW}
                height={sellH}
                fill="#ef4444"
              />
              <rect
                x={x}
                y={volTop + H_VOLUME - sellH - buyH}
                width={bodyW}
                height={buyH}
                fill="#22c55e"
              />
            </g>
          );
        })}

        {/* Price: candles or line */}
        {chartType === 'candles' ? (
          candles.map((c, i) => {
            const isGreen = c.close >= c.open;
            const color = isGreen ? '#22c55e' : '#ef4444';
            const bodyTop = toY(Math.max(c.open, c.close));
            const bodyBot = toY(Math.min(c.open, c.close));
            const bodyHeight = Math.max(bodyBot - bodyTop, 1);
            return (
              <g key={`candle-${i}`}>
                <line
                  x1={toX(i)}
                  y1={toY(c.high)}
                  x2={toX(i)}
                  y2={toY(c.low)}
                  stroke={color}
                  strokeWidth="1"
                />
                <rect
                  x={toX(i) - bodyW / 2}
                  y={bodyTop}
                  width={bodyW}
                  height={bodyHeight}
                  fill={color}
                  stroke={color}
                  strokeWidth="0.5"
                />
              </g>
            );
          })
        ) : (
          <path
            d={linePath}
            fill="none"
            stroke="#6366f1"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        )}

        {/* Moving averages */}
        {showMA && (
          <>
            <path d={maPath(ma7)} fill="none" stroke="#f59e0b" strokeWidth="1" opacity="0.9" />
            <path d={maPath(ma25)} fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.9" />
          </>
        )}

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

        {hoverIndex !== null && hoverCandle && (
          <>
            <line
              x1={toX(hoverIndex)}
              y1={PAD.top}
              x2={toX(hoverIndex)}
              y2={volTop + H_VOLUME}
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

      {showMA && (
        <div className="flex gap-3 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-amber-500" /> MA 7
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-sky-400" /> MA 25
          </span>
        </div>
      )}
    </div>
  );
}
