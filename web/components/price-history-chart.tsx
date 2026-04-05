"use client";

import * as React from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { formatPhp } from "@/lib/format";
import type { ListingVersion } from "@/lib/types";

function toPoints(versions: ListingVersion[]) {
  return versions
    .slice()
    .filter((v) => v.price_php != null && Number.isFinite(v.price_php))
    .sort((a, b) => String(a.snapshot_at).localeCompare(String(b.snapshot_at)))
    .map((v) => ({
      t: v.snapshot_at,
      price: v.price_php as number
    }));
}

export function PriceHistoryChart({ versions }: { versions: ListingVersion[] }) {
  const data = React.useMemo(() => toPoints(versions), [versions]);

  if (data.length < 2) {
    return <div className="text-sm text-muted-foreground">Not enough price history to chart yet.</div>;
  }

  return (
    <div className="h-44 w-full sm:h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <XAxis
            dataKey="t"
            tickFormatter={(v) => {
              const d = new Date(String(v));
              return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
            }}
            minTickGap={20}
            stroke="rgb(var(--muted-foreground))"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            width={72}
            tickFormatter={(v) => formatPhp(Number(v)).replace("₱", "")}
            stroke="rgb(var(--muted-foreground))"
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              background: "rgb(var(--card))",
              border: "1px solid rgb(var(--border))",
              borderRadius: 12
            }}
            labelFormatter={(v) => {
              const d = new Date(String(v));
              return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
            }}
            formatter={(v) => formatPhp(Number(v))}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="rgb(var(--primary))"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
