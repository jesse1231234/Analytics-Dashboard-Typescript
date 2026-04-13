"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

type Row = Record<string, any>;

const CSU_GREEN = "#1E4D2B";
const CSU_ORANGE = "#D9782D";

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

export default function GradebookComboChart({ rows, title }: { rows: Row[]; title?: string }) {
  const { data, lineAKey, lineBKey } = useMemo(() => {
    const safe = Array.isArray(rows) ? rows : [];
    const keys = Object.keys(safe[0] ?? {});
    const xKey = pickKey(keys, ["Module", "module", "Module Name", "module_name"]) ?? "Module";
    const lineAKey = pickKey(keys, ["Avg % Turned In", "Avg Turned In %", "% Turned In"]) ?? null;
    const lineBKey = pickKey(keys, ["Avg Average Excluding Zeros", "Avg Excluding Zeros", "Average Excluding Zeros"]) ?? null;
    const data = safe.map((r) => ({
      __x: String(r[xKey] ?? ""),
      __a: lineAKey ? toNumber(r[lineAKey]) : null,
      __b: lineBKey ? toNumber(r[lineBKey]) : null,
    }));
    return { data, lineAKey, lineBKey };
  }, [rows]);

  const hasA = data.some((d) => d.__a !== null);
  const hasB = data.some((d) => d.__b !== null);

  return (
    <div className="w-full">
      {title && <div className="text-sm font-semibold text-slate-900 mb-2">{title}</div>}
      <div className="h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 20, bottom: 90, left: 50 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="__x"
              interval={0}
              angle={-35}
              textAnchor="end"
              height={110}
              tickFormatter={(v) => truncateLabel(String(v), 26)}
              tick={{ fill: "#334155", fontSize: 11 }}
            />
            <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
            <Tooltip
              formatter={(value: any, name: any) => {
                const n = typeof value === "number" ? value : toNumber(value);
                if (n === null) return [value, name];
                return [`${(n * 100).toFixed(1)}%`, name];
              }}
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
            {hasA && <Line type="monotone" dataKey="__a" name={lineAKey ?? "Avg % Turned In"} stroke={CSU_GREEN} dot={false} strokeWidth={2} />}
            {hasB && <Line type="monotone" dataKey="__b" name={lineBKey ?? "Avg Average Excluding Zeros"} stroke={CSU_ORANGE} dot={false} strokeWidth={2} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {(!hasA || !hasB) && (
        <div className="text-xs text-slate-500 mt-2">
          Note: one or both gradebook series were not found in the module metrics rows.
        </div>
      )}
    </div>
  );
}
