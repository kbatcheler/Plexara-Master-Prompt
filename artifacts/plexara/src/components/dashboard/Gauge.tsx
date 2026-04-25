import { motion } from "framer-motion";
import { useMode } from "../../context/ModeContext";
import { Gauge as GaugeType } from "@workspace/api-client-react";
import { ArrowUpIcon, ArrowRightIcon, ArrowDownIcon } from "lucide-react";

interface GaugeProps {
  gauge: GaugeType;
}

// PostgreSQL `numeric` columns are returned as strings by node-postgres,
// so values reaching the client may be `string | number | null`. Normalise
// before using them in arithmetic or `.toFixed(...)`.
function toNum(v: unknown, fallback: number | null = null): number | null {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function ArcGauge({ gauge }: GaugeProps) {
  const { mode } = useMode();
  const domain = gauge.domain;
  const trend = gauge.trend;
  const confidence = gauge.confidence;
  const lensAgreement = gauge.lensAgreement;

  const currentValue = toNum(gauge.currentValue);
  const clinicalRangeLow = toNum(gauge.clinicalRangeLow, 0) ?? 0;
  const clinicalRangeHigh = toNum(gauge.clinicalRangeHigh, 100) ?? 100;
  const optimalRangeLow = toNum(gauge.optimalRangeLow, 20) ?? 20;
  const optimalRangeHigh = toNum(gauge.optimalRangeHigh, 80) ?? 80;

  // SVG parameters
  const size = 200;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  
  // Angle calculations (240 degree sweep from 210 to 330, but wait, standard is 210 to 330? 
  // Let's use 150 to 390 for a 240 degree sweep starting bottom left to bottom right.
  const startAngle = 150;
  const endAngle = 390;
  const sweepAngle = endAngle - startAngle;

  const valueToAngle = (val: number) => {
    // Normalize value between 0 and 120 (assuming range is 0-120 for now, or use max of ranges)
    const min = Math.min(0, clinicalRangeLow || 0);
    const max = Math.max(120, clinicalRangeHigh || 100) * 1.1; // Add 10% padding
    const normalized = Math.max(0, Math.min(1, (val - min) / (max - min)));
    return startAngle + normalized * sweepAngle;
  };

  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY + radius * Math.sin(angleInRadians),
    };
  };

  const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", start.x, start.y,
      "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
    ].join(" ");
  };

  const getStatusColor = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "hsl(var(--muted))";
    if (val >= (optimalRangeLow || 0) && val <= (optimalRangeHigh || 100)) return "hsl(142, 71%, 45%)"; // Green
    if (val >= (clinicalRangeLow || 0) && val <= (clinicalRangeHigh || 100)) return "hsl(38, 92%, 50%)"; // Amber
    return "hsl(0, 84%, 60%)"; // Red
  };

  const currentAngle = valueToAngle(currentValue || 0);
  const needlePos = polarToCartesian(center, center, radius - 20, currentAngle);
  const color = getStatusColor(currentValue);

  return (
    <div className="flex flex-col items-center relative bg-card/50 p-4 rounded-xl border border-border/50">
      <div className="flex w-full justify-between items-start mb-2">
        <h3 className="font-heading font-medium text-sm text-muted-foreground">{domain}</h3>
        {lensAgreement && (
          <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">
            {lensAgreement}
          </span>
        )}
      </div>

      <div className="relative w-[200px] h-[120px] overflow-hidden">
        <svg width={size} height={size} className="absolute top-0 left-0">
          {/* Background Arc */}
          <path
            d={describeArc(center, center, radius, startAngle, endAngle)}
            fill="none"
            stroke="hsl(var(--secondary))"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          
          {/* Clinical Range Arc */}
          {clinicalRangeLow !== null && clinicalRangeHigh !== null && (
            <path
              d={describeArc(center, center, radius, valueToAngle(clinicalRangeLow), valueToAngle(clinicalRangeHigh))}
              fill="none"
              stroke="hsl(var(--muted-foreground)/0.3)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          )}

          {/* Optimal Range Arc */}
          {optimalRangeLow !== null && optimalRangeHigh !== null && (
            <path
              d={describeArc(center, center, radius, valueToAngle(optimalRangeLow), valueToAngle(optimalRangeHigh))}
              fill="none"
              stroke="hsl(142, 71%, 45%/0.4)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          )}

          {/* Needle / Indicator */}
          <motion.circle
            cx={polarToCartesian(center, center, radius, currentAngle).x}
            cy={polarToCartesian(center, center, radius, currentAngle).y}
            r={strokeWidth / 1.5}
            fill={color}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 100, damping: 15 }}
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>

        <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center justify-end pb-2">
          {mode === "clinician" ? (
            <div className="flex flex-col items-center">
              <span className="font-mono text-2xl font-semibold leading-none text-foreground">{currentValue?.toFixed(1) || '--'}</span>
              <span className="text-[10px] text-muted-foreground mt-1 font-mono">
                {clinicalRangeLow}-{clinicalRangeHigh} (Opt: {optimalRangeLow}-{optimalRangeHigh})
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <span className="font-heading text-lg font-medium" style={{ color }}>
                {gauge.label || "Evaluating"}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between w-full mt-4 text-xs">
        <div className="flex items-center gap-1 text-muted-foreground">
          <span>Trend:</span>
          {trend === "improving" && <ArrowUpIcon className="w-3 h-3 text-green-500" />}
          {trend === "stable" && <ArrowRightIcon className="w-3 h-3 text-amber-500" />}
          {trend === "declining" && <ArrowDownIcon className="w-3 h-3 text-red-500" />}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Conf:</span>
          <div className="flex gap-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${confidence === 'low' || confidence === 'medium' || confidence === 'high' ? 'bg-primary' : 'bg-muted'}`} />
            <div className={`w-1.5 h-1.5 rounded-full ${confidence === 'medium' || confidence === 'high' ? 'bg-primary' : 'bg-muted'}`} />
            <div className={`w-1.5 h-1.5 rounded-full ${confidence === 'high' ? 'bg-primary' : 'bg-muted'}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
