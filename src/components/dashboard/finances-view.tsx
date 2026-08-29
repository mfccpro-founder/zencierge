"use client";

import { Suspense, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  Banknote,
  CalendarDays,
  Calculator,
  Download,
  Percent,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useListings } from "@/components/dashboard/listings-provider";
import { calendarToday, properties as seedProperties } from "@/lib/dashboard-data";
import {
  deltaPct,
  filterTransactions,
  ledgerToCsv,
  monthlySeries,
  previousMonthWindow,
  rangeFor,
  statusLabel,
  stayTransactions,
  summarizeLedger,
  usd,
  type FinanceRangeId,
  type StayTransaction,
} from "@/lib/financials";

const RANGE_OPTIONS: { id: FinanceRangeId; label: string }[] = [
  { id: "this_month", label: "This Month" },
  { id: "last_quarter", label: "Last Quarter" },
  { id: "ytd", label: "Year to Date" },
];

export function FinancesView() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Loading financials…</div>}>
      <FinancesViewInner />
    </Suspense>
  );
}

function FinancesViewInner() {
  const searchParams = useSearchParams();
  const { properties } = useListings();
  const [propertyId, setPropertyId] = useState<string | "all">("all");
  const [rangeId, setRangeId] = useState<FinanceRangeId>("this_month");
  const [hovered, setHovered] = useState<string | null>(null);

  const [quoteNights, setQuoteNights] = useState(22);
  const [quoteAdr, setQuoteAdr] = useState(220);
  const [quoteRate, setQuoteRate] = useState(18);
  const [quoteCleans, setQuoteCleans] = useState(4);
  const [quoteCleanFee, setQuoteCleanFee] = useState(165);
  const checkoutNote =
    searchParams.get("checkout") === "success"
      ? `Square checkout complete${searchParams.get("sandbox") === "1" ? " (sandbox mock)" : ""}: ${searchParams.get("plan") ?? "plan"} · ${searchParams.get("billing") === "annual" ? "annual" : "monthly"}.`
      : null;

  const propertyName = (id: string) =>
    properties.find((property) => property.id === id)?.name ?? id;

  const range = rangeFor(rangeId, calendarToday);
  const prevMonth = previousMonthWindow(calendarToday);
  const propertyCount = propertyId === "all" ? Math.max(properties.length, seedProperties.length, 1) : 1;

  const rows = useMemo(
    () =>
      filterTransactions(stayTransactions, propertyId, range.start, range.endExclusive).sort((a, b) =>
        b.check_in.localeCompare(a.check_in),
      ),
    [propertyId, range.start, range.endExclusive],
  );

  const prevRows = useMemo(
    () => filterTransactions(stayTransactions, propertyId, prevMonth.start, prevMonth.endExclusive),
    [propertyId, prevMonth.start, prevMonth.endExclusive],
  );

  const kpis = summarizeLedger(rows, range.start, range.endExclusive, propertyCount);
  const prevKpis = summarizeLedger(prevRows, prevMonth.start, prevMonth.endExclusive, propertyCount);
  const series = monthlySeries(stayTransactions, propertyId, calendarToday, 6);
  const maxBar = Math.max(...series.flatMap((point) => [point.gross, point.net]), 1);

  const quoteGross = quoteNights * quoteAdr;
  const quoteCommission = quoteGross * (quoteRate / 100);
  const quoteExpenses = quoteCleans * quoteCleanFee;
  const quoteNet = quoteGross - quoteCommission - quoteExpenses;

  const exportCsv = () => {
    const body = ledgerToCsv(rows, propertyName);
    const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zencierge-financial-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {checkoutNote ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200">
          {checkoutNote}
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Revenue Command Center · South Florida portfolio</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-slate-400">
            Property
            <select
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
              className="ml-2 rounded-full border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200"
            >
              <option value="all">All Properties</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setRangeId(option.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                rangeId === option.id
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                  : "border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi
          label="Total Net Revenue"
          value={usd(kpis.net)}
          hint={`${range.label} · vs prior month`}
          delta={deltaPct(kpis.net, prevKpis.net)}
          icon={<Banknote className="h-4 w-4 text-emerald-400" />}
        />
        <Kpi
          label="ADR"
          value={usd(kpis.adr)}
          hint="Average daily rate"
          delta={deltaPct(kpis.adr, prevKpis.adr)}
          icon={<CalendarDays className="h-4 w-4 text-sky-400" />}
        />
        <Kpi
          label="Occupancy Rate"
          value={`${Math.round(kpis.occupancy * 100)}%`}
          hint={`${kpis.nights} occupied nights`}
          delta={deltaPct(kpis.occupancy, prevKpis.occupancy)}
          icon={<Percent className="h-4 w-4 text-violet-400" />}
        />
        <Kpi
          label="Upcoming Payouts"
          value={usd(kpis.pending)}
          hint="Payouts in transit"
          delta={deltaPct(kpis.pending, prevKpis.pending)}
          icon={<Wallet className="h-4 w-4 text-amber-400" />}
        />
      </div>

      <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Gross Revenue vs Net Profit</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">Last 6 months · hover a month for detail</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-sky-400" /> Gross
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-emerald-400" /> Net
            </span>
          </div>
        </div>
        <div className="flex items-end gap-3 sm:gap-5 h-56">
          {series.map((point) => {
            const active = hovered === point.key;
            return (
              <button
                key={point.key}
                type="button"
                onMouseEnter={() => setHovered(point.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(point.key)}
                onBlur={() => setHovered(null)}
                className="flex-1 h-full flex flex-col items-center justify-end gap-2 rounded-xl outline-none"
              >
                <div
                  className={`text-[10px] font-medium transition-opacity ${
                    active ? "text-slate-100 opacity-100" : "text-slate-400 opacity-80"
                  }`}
                >
                  {active ? (
                    <span className="block text-center leading-tight">
                      {usd(point.gross)}
                      <br />
                      <span className="text-emerald-300">{usd(point.net)}</span>
                    </span>
                  ) : (
                    usd(point.net)
                  )}
                </div>
                <div className="w-full flex items-end justify-center gap-1 h-40">
                  <div
                    className={`w-[42%] max-w-[28px] rounded-t-md bg-sky-400/90 ${
                      active ? "shadow-[0_0_18px_rgb(56_189_248_/_0.45)]" : "opacity-80"
                    }`}
                    style={{ height: `${Math.max(6, (point.gross / maxBar) * 100)}%` }}
                  />
                  <div
                    className={`w-[42%] max-w-[28px] rounded-t-md bg-emerald-400 ${
                      active ? "shadow-[0_0_18px_rgb(52_211_153_/_0.45)]" : "opacity-90"
                    }`}
                    style={{ height: `${Math.max(6, (point.net / maxBar) * 100)}%` }}
                  />
                </div>
                <span className={`text-[11px] ${active ? "text-white font-semibold" : "text-slate-500"}`}>
                  {point.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Payout breakdown</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {range.label} · {rows.length} transactions
            </p>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV / Financial Report
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Property</th>
                <th className="px-4 py-3 font-semibold">Guest</th>
                <th className="px-4 py-3 font-semibold">Channel</th>
                <th className="px-4 py-3 font-semibold">Gross</th>
                <th className="px-4 py-3 font-semibold">Cleaning</th>
                <th className="px-4 py-3 font-semibold">Commission</th>
                <th className="px-4 py-3 font-semibold">Taxes</th>
                <th className="px-4 py-3 font-semibold">Net</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    No transactions in this range.
                  </td>
                </tr>
              ) : (
                rows.map((row) => <LedgerRow key={row.id} row={row} propertyName={propertyName} />)
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/80 p-5">
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

function LedgerRow({
  row,
  propertyName,
}: {
  row: StayTransaction;
  propertyName: (id: string) => string;
}) {
  const paid = row.status === "completed";
  const pending = row.status === "payout_pending";
  return (
    <tr className="border-b border-white/10 last:border-0">
      <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
        {row.check_in}
        <span className="block text-[10px] text-slate-500">{row.check_out}</span>
      </td>
      <td className="px-4 py-3 text-slate-200 font-medium">{propertyName(row.property_id)}</td>
      <td className="px-4 py-3 text-slate-300">{row.guest_name}</td>
      <td className="px-4 py-3">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            row.channel === "Airbnb"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
              : row.channel === "Vrbo"
                ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {row.channel}
        </span>
      </td>
      <td className="px-4 py-3 text-slate-200">{usd(row.gross_revenue)}</td>
      <td className="px-4 py-3 text-amber-200">{usd(row.cleaning_fee)}</td>
      <td className="px-4 py-3 text-sky-300">{usd(row.platform_fee)}</td>
      <td className="px-4 py-3 text-slate-400">{usd(row.taxes)}</td>
      <td className="px-4 py-3 text-emerald-300 font-semibold">{usd(row.net_profit)}</td>
      <td className="px-4 py-3">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            paid
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : pending
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-sky-500/30 bg-sky-500/10 text-sky-300"
          }`}
        >
          {statusLabel(row.status)}
        </span>
      </td>
    </tr>
  );
}

function Kpi({
  label,
  value,
  hint,
  delta,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  delta: number;
  icon: ReactNode;
}) {
  const up = delta >= 0;
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-extrabold text-white mt-3">{value}</div>
      <div className={`mt-2 flex items-center gap-1 text-xs font-medium ${up ? "text-emerald-400" : "text-rose-400"}`}>
        {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
        {up ? "+" : ""}
        {delta.toFixed(1)}% vs prior month
      </div>
      <div className="text-[11px] text-slate-500 mt-1">{hint}</div>
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
      <span className="mt-1 flex items-center rounded-xl border border-white/10 bg-slate-950">
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
    <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${accent ? "text-emerald-400" : "text-white"}`}>{value}</p>
    </div>
  );
}
