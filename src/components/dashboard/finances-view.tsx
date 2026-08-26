"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Banknote,
  Calculator,
  Download,
  Printer,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  financePeriods,
  properties,
  settlementCommission,
  settlementNet,
  type FinancePeriodId,
  type SettlementRow,
} from "@/lib/dashboard-data";

type PeriodChoice = FinancePeriodId | "custom";

const BAR_COLORS: Record<string, string> = {
  "prop-1": "bg-emerald-400",
  "prop-2": "bg-sky-400",
  "prop-3": "bg-violet-400",
  "prop-4": "bg-amber-400",
};

function usd(value: number) {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "-" : ""}$${abs}`;
}

function pct(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

function propertyName(id: string) {
  return properties.find((property) => property.id === id)?.name ?? id;
}

function utcDaysInclusive(fromIso: string, toIso: string) {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
  return Math.floor((to - from) / 86_400_000) + 1;
}

function scaleRows(rows: SettlementRow[], factor: number): SettlementRow[] {
  return rows.map((row) => ({
    ...row,
    nights: Math.max(0, Math.round(row.nights * factor)),
    gross: Math.round(row.gross * factor),
    expenses: Math.round(row.expenses * factor),
  }));
}

function summarize(rows: SettlementRow[]) {
  const gross = rows.reduce((sum, row) => sum + row.gross, 0);
  const commission = rows.reduce((sum, row) => sum + settlementCommission(row), 0);
  const expenses = rows.reduce((sum, row) => sum + row.expenses, 0);
  const net = rows.reduce((sum, row) => sum + settlementNet(row), 0);
  return { gross, commission, expenses, net };
}

function statementText(periodLabel: string, rows: SettlementRow[]) {
  const totals = summarize(rows);
  const lines = [
    "Zencierge · Owner statement",
    periodLabel,
    "South Florida co-hosting portfolio",
    "",
    "Property | Owner | Nights | ADR | Gross | Commission | Expenses | Net | Status",
    ...rows.map((row) =>
      [
        propertyName(row.propertyId),
        row.owner,
        row.nights,
        usd(row.adr),
        usd(row.gross),
        `${pct(row.commissionRate)} ${usd(settlementCommission(row))}`,
        usd(row.expenses),
        usd(settlementNet(row)),
        row.status,
      ].join(" | "),
    ),
    "",
    `Gross revenue: ${usd(totals.gross)}`,
    `Co-host commission: ${usd(totals.commission)}`,
    `Cleaning & maintenance: ${usd(totals.expenses)}`,
    `Net owner payouts: ${usd(totals.net)}`,
  ];
  return lines.join("\n");
}

export function FinancesView() {
  const [period, setPeriod] = useState<PeriodChoice>("august");
  const [customFrom, setCustomFrom] = useState("2026-08-01");
  const [customTo, setCustomTo] = useState("2026-08-26");
  const [quoteNights, setQuoteNights] = useState(22);
  const [quoteAdr, setQuoteAdr] = useState(220);
  const [quoteRate, setQuoteRate] = useState(18);
  const [quoteCleans, setQuoteCleans] = useState(4);
  const [quoteCleanFee, setQuoteCleanFee] = useState(165);

  const { rows, periodLabel } = useMemo(() => {
    if (period === "custom") {
      const days = utcDaysInclusive(customFrom, customTo);
      const factor = days / 31;
      return {
        rows: scaleRows(financePeriods.august.settlements, factor),
        periodLabel: `Custom · ${customFrom} to ${customTo}`,
      };
    }
    const pack = financePeriods[period];
    return { rows: pack.settlements, periodLabel: pack.label };
  }, [period, customFrom, customTo]);

  const totals = summarize(rows);
  const maxGross = Math.max(...rows.map((row) => row.gross), 1);

  const quoteGross = quoteNights * quoteAdr;
  const quoteCommission = quoteGross * (quoteRate / 100);
  const quoteExpenses = quoteCleans * quoteCleanFee;
  const quoteNet = quoteGross - quoteCommission - quoteExpenses;

  const exportStatement = (printAfter: boolean) => {
    const body = statementText(periodLabel, rows);
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zencierge-owner-statement.txt";
    link.click();
    URL.revokeObjectURL(url);

    if (!printAfter) return;
    const popup = window.open("", "_blank", "noopener,noreferrer,width=800,height=900");
    if (!popup) return;
    popup.document.write(
      `<pre style="font-family:ui-monospace,monospace;padding:24px;white-space:pre-wrap">${body.replace(/</g, "&lt;")}</pre>`,
    );
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Co-hosting reports · 18% default admin fee</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["august", financePeriods.august.label],
              ["ytd", financePeriods.ytd.label],
              ["custom", "Custom range"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriod(id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                period === id
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                  : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {period === "custom" ? (
        <div className="flex flex-wrap gap-3">
          <label className="text-xs text-slate-400">
            From
            <input
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="mt-1 block rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
          </label>
          <label className="text-xs text-slate-400">
            To
            <input
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
              className="mt-1 block rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
          </label>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi
          label="Gross Revenue"
          value={usd(totals.gross)}
          hint="Collected guest stay revenue"
          icon={<Banknote className="h-4 w-4 text-emerald-400" />}
        />
        <Kpi
          label="Co-Hosting Commission Earned"
          value={usd(totals.commission)}
          hint="18% management fee on gross"
          icon={<Sparkles className="h-4 w-4 text-sky-400" />}
        />
        <Kpi
          label="Cleaning & Maintenance Fees"
          value={usd(totals.expenses)}
          hint="Turnovers, tech visits, supplies"
          icon={<Wrench className="h-4 w-4 text-amber-400" />}
        />
        <Kpi
          label="Net Owner Payouts"
          value={usd(totals.net)}
          hint="Gross − commission − ops"
          icon={<Banknote className="h-4 w-4 text-violet-400" />}
        />
      </div>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Revenue by Florida property</h3>
        <div className="flex items-end gap-4 h-48">
          {rows.map((row) => {
            const height = Math.max(8, (row.gross / maxGross) * 100);
            return (
              <div key={row.propertyId} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                <span className="text-[11px] font-medium text-slate-300">{usd(row.gross)}</span>
                <div
                  className={`w-full max-w-[72px] rounded-t-lg ${BAR_COLORS[row.propertyId] ?? "bg-slate-500"}`}
                  style={{ height: `${height}%` }}
                  title={propertyName(row.propertyId)}
                />
                <span className="text-[10px] text-slate-500 text-center leading-tight px-1">
                  {propertyName(row.propertyId)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-white">Monthly settlements by unit</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">{periodLabel}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => exportStatement(false)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" />
              Export Owner Statement
            </button>
            <button
              type="button"
              onClick={() => exportStatement(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3 font-semibold">Property</th>
                <th className="px-4 py-3 font-semibold">Owner</th>
                <th className="px-4 py-3 font-semibold">Nights</th>
                <th className="px-4 py-3 font-semibold">Avg rate</th>
                <th className="px-4 py-3 font-semibold">Gross</th>
                <th className="px-4 py-3 font-semibold">Co-host %</th>
                <th className="px-4 py-3 font-semibold">Expenses</th>
                <th className="px-4 py-3 font-semibold">Net payout</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.propertyId} className="border-b border-slate-800/70 last:border-0">
                  <td className="px-4 py-3 text-slate-200 font-medium">{propertyName(row.propertyId)}</td>
                  <td className="px-4 py-3 text-slate-400">{row.owner}</td>
                  <td className="px-4 py-3 text-slate-300">{row.nights}</td>
                  <td className="px-4 py-3 text-slate-300">{usd(row.adr)}</td>
                  <td className="px-4 py-3 text-slate-200">{usd(row.gross)}</td>
                  <td className="px-4 py-3 text-sky-300">
                    {pct(row.commissionRate)} · {usd(settlementCommission(row))}
                  </td>
                  <td className="px-4 py-3 text-amber-200">{usd(row.expenses)}</td>
                  <td className="px-4 py-3 text-emerald-300 font-semibold">{usd(settlementNet(row))}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        row.status === "Paid"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Co-hosting commission calculator</h3>
        </div>
        <p className="text-xs text-slate-500">
          Quote a new Florida listing. Net owner payout = gross − your fee − estimated turnovers.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <NumberField label="Nights / month" value={quoteNights} onChange={setQuoteNights} />
          <NumberField label="Avg nightly rate" value={quoteAdr} onChange={setQuoteAdr} prefix="$" />
          <NumberField label="Commission %" value={quoteRate} onChange={setQuoteRate} />
          <NumberField label="Cleans / month" value={quoteCleans} onChange={setQuoteCleans} />
          <NumberField label="Fee per clean" value={quoteCleanFee} onChange={setQuoteCleanFee} prefix="$" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <QuoteStat label="Gross" value={usd(quoteGross)} />
          <QuoteStat label="Your commission" value={usd(quoteCommission)} />
          <QuoteStat label="Ops / cleaning" value={usd(quoteExpenses)} />
          <QuoteStat label="Owner net" value={usd(quoteNet)} accent />
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-extrabold text-white mt-3">{value}</div>
      <div className="text-xs text-slate-500 mt-2">{hint}</div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
}) {
  return (
    <label className="text-[11px] text-slate-400">
      {label}
      <span className="mt-1 flex items-center rounded-xl border border-slate-800 bg-slate-950">
        {prefix ? <span className="pl-3 text-slate-500 text-sm">{prefix}</span> : null}
        <input
          type="number"
          min={0}
          value={value}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
          className="w-full bg-transparent px-3 py-2 text-sm text-slate-200 outline-none"
        />
      </span>
    </label>
  );
}

function QuoteStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${accent ? "text-emerald-400" : "text-white"}`}>{value}</p>
    </div>
  );
}
