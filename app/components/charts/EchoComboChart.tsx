"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

type Row = Record<string, any>;

const CSU_GREEN = "#1E54B3";
const CSU_ORANGE = "#94B0E3";
const CSU_BLUE = "#F58D0F";
const CSU_RED = "#C91CAD";

function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replace(/%/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function pickKey(keys: string[], candidates: string[]) {
  for (const c of candidates) if (keys.includes(c)) return c;
  return null;
}

function truncateLabel(s: string, max = 18) {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export default function EchoComboChart({
  moduleRows,
  studentsTotal,
  title,
}: {
  moduleRows: Row[];
  studentsTotal?: number;
  title?: string;
}) {
  const { data, viewersKey, overallKey, avgKey } = useMemo(() => {
    const rows = Array.isArray(moduleRows) ? moduleRows : [];
    const keys = Object.keys(rows[0] ?? {});

    const moduleKey =
      pickKey(keys, ["Module", "module", "Module Name", "module_name"]) ?? "Module";

    const viewersKey =
      pickKey(keys, [
        "# of Students Viewing",
        "# Students Viewing",
        "Students Viewing",
        "# of Unique Viewers",
      ]) ?? null;

    const overallKey =
      pickKey(keys, ["Overall View %", "% of Video Viewed Overall", "Overall % Viewed"]) ?? null;

    const avgKey =
      pickKey(keys, ["Average View %", "Avg View %", "Average % Viewed"]) ?? null;

    const data = rows.map((r) => {
      const viewers = viewersKey ? toNumber(r[viewersKey]) : null;
      const total =
        toNumber(r["# of Students"]) ??
        toNumber(r["# Students"]) ??
        (typeof studentsTotal === "number" ? studentsTotal : null);
      const notViewing =
        viewers !== null && total !== null ? Math.max(0, total - viewers) : null;
      const overallPct = overallKey ? toNumber(r[overallKey]) : null;
      const avgPct = avgKey ? toNumber(r[avgKey]) : null;

      return {
        __module: String(r[moduleKey] ?? ""),
        __viewers: viewers,
        __notViewing: notViewing,
        __overallPct: overallPct !== null ? overallPct * 100 : null,
        __avgPct: avgPct !== null ? avgPct * 100 : null,
      };
    });

    return { data, viewersKey, overallKey, avgKey };
  }, [moduleRows, studentsTotal]);

  const hasStack = data.some((d) => d.__viewers !== null && d.__notViewing !== null);
  const hasOverall = data.some((d) => d.__overallPct !== null);
  const hasAvg = data.some((d) => d.__avgPct !== null);

  return (
    <div className="w-full">
      {title && <div className="text-sm font-semibold text-slate-900 mb-2">{title}</div>}
      <div className="h-[520px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 28, right: 60, bottom: 24, left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="__module"
              interval={0}
              angle={-35}
              textAnchor="end"
              height={110}
              tickFormatter={(v) => truncateLabel(String(v), 26)}
              tick={{ fill: "#334155", fontSize: 11 }}
            />
            <YAxis
              yAxisId="count"
              allowDecimals={false}
              width={40}
              label={{ value: "# of Students", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fill: "#334155", fontSize: 12 } }}
            />
            <YAxis
              yAxisId="pct"
              orientation="right"
              domain={[0, 100]}
              ticks={[0, 20, 40, 60, 80, 100]}
              tickFormatter={(v) => `${v}%`}
              width={55}
              label={{ value: "View %", angle: 90, position: "insideRight", style: { textAnchor: "middle", fill: "#334155", fontSize: 12 } }}
            />
            <Tooltip
              formatter={(value: any, name: any) => {
                if (name?.toLowerCase?.().includes("%"))
                  return [`${value?.toFixed?.(1) ?? value}%`, name];
                return [value, name];
              }}
              labelFormatter={(label) => String(label)}
              contentStyle={{ backgroundColor: "#fff", border: "1px solid #ccc", color: "#000" }}
              labelStyle={{ color: "#000" }}
              itemStyle={{ color: "#000" }}
            />
            <Legend
              verticalAlign="top"
              align="left"
              wrapperStyle={{ paddingBottom: 8 }}
              formatter={(value) => <span style={{ color: "#0f172a" }}>{value}</span>}
            />
            {hasStack && (
              <>
                <Bar yAxisId="count" dataKey="__viewers" name={viewersKey ?? "Students Viewing"} stackId="a" fill={CSU_GREEN} />
                <Bar yAxisId="count" dataKey="__notViewing" name="Students Not Viewing" stackId="a" fill={CSU_ORANGE} />
              </>
            )}
            {hasOverall && (
              <Line yAxisId="pct" type="monotone" dataKey="__overallPct" name="Overall View %" stroke={CSU_BLUE} dot={false} strokeWidth={2} />
            )}
            {hasAvg && (
              <Line yAxisId="pct" type="monotone" dataKey="__avgPct" name="Average View %" stroke={CSU_RED} dot={false} strokeWidth={2} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!hasStack && (
        <div className="text-xs text-slate-500 mt-2">
          Note: stacked bars require both "# of Students Viewing" and "# of Students".
        </div>
      )}
    </div>
  );
}
