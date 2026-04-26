import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
  ReferenceArea, CartesianGrid, ComposedChart,
} from "recharts";
import { Loader2 } from "lucide-react";
import { api } from "../../lib/api";

interface SeriesResponse {
  biomarkerName: string;
  unit: string | null;
  optimalLow: number | null;
  optimalHigh: number | null;
  points: Array<{ date: string; value: number }>;
  regression: { slope: number; intercept: number; r2: number; firstT: number } | null;
}

const DAY_MS = 86400000;

function fmtTick(d: number) {
  return new Date(d).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export function TrendChart({ patientId, biomarkerName }: { patientId: number; biomarkerName: string }) {
  const q = useQuery<SeriesResponse>({
    queryKey: ["trend-series", patientId, biomarkerName],
    queryFn: () => api(`/patients/${patientId}/trends/series/${encodeURIComponent(biomarkerName)}`),
    enabled: !!patientId && !!biomarkerName,
  });

  if (q.isLoading) {
    return (
      <div className="h-44 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return <div className="h-44 flex items-center justify-center text-xs text-muted-foreground">Failed to load series.</div>;
  }

  const { points, regression, optimalLow, optimalHigh, unit } = q.data;

  if (points.length === 0) {
    return <div className="h-44 flex items-center justify-center text-xs text-muted-foreground">No data.</div>;
  }

  // Build chart rows: x axis is epoch ms; project the regression line across
  // the full data span so the user can see direction at a glance.
  const chartData = points.map((p) => {
    const t = new Date(p.date).getTime();
    let trend: number | null = null;
    if (regression) {
      const days = (t - regression.firstT) / DAY_MS;
      trend = regression.intercept + regression.slope * days;
    }
    return { t, value: p.value, trend };
  });

  // Y-axis padding so optimal range bands and points have headroom.
  const ys = points.map((p) => p.value);
  const minY = Math.min(...ys, optimalLow ?? Infinity);
  const maxY = Math.max(...ys, optimalHigh ?? -Infinity);
  const pad = (maxY - minY) * 0.15 || Math.max(1, Math.abs(maxY) * 0.1);
  const yDomain: [number, number] = [minY - pad, maxY + pad];

  const distinctDates = points.length;
  const slopeYr = regression ? regression.slope * 365 : null;

  return (
    <div className="space-y-3" data-testid={`trend-chart-${biomarkerName}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">{distinctDates}</span> distinct test date{distinctDates === 1 ? "" : "s"}
          {regression && ` · slope ${slopeYr! >= 0 ? "+" : ""}${slopeYr!.toFixed(2)}${unit ? ` ${unit}` : ""}/yr · r²=${regression.r2.toFixed(2)}`}
        </div>
        {(optimalLow !== null || optimalHigh !== null) && (
          <div>
            optimal {optimalLow ?? "—"}–{optimalHigh ?? "—"}{unit ? ` ${unit}` : ""}
          </div>
        )}
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeOpacity={0.15} vertical={false} />
            {optimalLow !== null && optimalHigh !== null && (
              <ReferenceArea
                y1={optimalLow}
                y2={optimalHigh}
                fill="hsl(var(--primary))"
                fillOpacity={0.06}
                stroke="hsl(var(--primary))"
                strokeOpacity={0.15}
                strokeDasharray="3 3"
                ifOverflow="extendDomain"
              />
            )}
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtTick}
              tick={{ fontSize: 10 }}
              minTickGap={40}
            />
            <YAxis
              type="number"
              domain={yDomain}
              tick={{ fontSize: 10 }}
              width={50}
              tickFormatter={(v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))}
            />
            <Tooltip
              contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
              labelFormatter={(t: number) => new Date(t).toLocaleDateString()}
              formatter={(v: number, key: string) => [
                `${typeof v === "number" ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : v}${unit ? ` ${unit}` : ""}`,
                key === "trend" ? "trend" : "value",
              ]}
            />
            {regression && (
              <Line
                type="linear"
                dataKey="trend"
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 3, fill: "hsl(var(--primary))" }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
