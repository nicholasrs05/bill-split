import React, { useMemo, useState } from 'react';
import { ArrowRight, CircleCheck, GitMerge } from 'lucide-react';
import { formatRupiah } from '../utils/billHelpers';
import { buildDebtSummation } from '../utils/debtSummation';

function TransferTable({ title, description, rows, emptyMessage }) {
  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
      <div className="border-b border-ink/10 bg-paper/60 px-3 py-2">
        <h4 className="font-medium text-ink">{title}</h4>
        <p className="text-xs text-ink/60">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-ink/60">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-ink/60">
                <th className="px-3 py-2 font-medium">From</th>
                <th className="px-3 py-2 font-medium">To</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.from}-${row.to}`} className="border-b border-ink/10 last:border-b-0">
                  <td className="px-3 py-2">{row.from}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowRight size={13} className="text-accent" />
                      {row.to}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatRupiah(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DebtSummation({ participants, netRows }) {
  const [selectedPivot, setSelectedPivot] = useState('');
  const summation = useMemo(
    () => buildDebtSummation(participants, netRows, selectedPivot),
    [participants, netRows, selectedPivot]
  );

  if (netRows.length === 0 || summation.creditors.length === 0) {
    return (
      <div className="mt-5 rounded-xl border border-ink/15 bg-white/75 p-4">
        <div className="flex items-center gap-2">
          <GitMerge size={18} className="text-accent" />
          <h3 className="font-medium text-ink">Debt Summation</h3>
        </div>
        <p className="mt-2 text-sm text-ink/60">A settlement route will appear when there are net debts.</p>
      </div>
    );
  }

  const otherCreditors = summation.creditors.filter((row) => row.participant !== summation.activePivot);

  return (
    <div className="mt-5 rounded-xl border border-ink/15 bg-white/75 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GitMerge size={18} className="text-accent" />
            <h3 className="font-medium text-ink">Debt Summation</h3>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink/65">
            Route every debtor through one pivot. The pivot keeps the amount owed to them and forwards the rest to the
            other creditors.
          </p>
        </div>

        <label className="min-w-56 text-xs font-medium uppercase tracking-wide text-ink/60">
          Settlement pivot (B)
          <select
            value={summation.activePivot}
            onChange={(event) => setSelectedPivot(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            {summation.creditors.map((row) => (
              <option key={row.participant} value={row.participant}>
                {row.participant} ({formatRupiah(row.balance)})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-ink/10 bg-paper/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink/55">A - Debtors</p>
          <p className="mt-1 text-sm text-ink/70">Everyone here pays B.</p>
          <div className="mt-2 space-y-1.5">
            {summation.debtors.map((row) => (
              <div key={row.participant} className="flex justify-between gap-3 text-sm">
                <span>{row.participant}</span>
                <span className="font-mono">{formatRupiah(Math.abs(row.balance))}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-accent/40 bg-accent/10 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink/55">B - Pivot</p>
          <p className="mt-1 font-display text-xl text-ink">{summation.activePivot}</p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink/65">Collects</dt>
              <dd className="font-mono">{formatRupiah(summation.totalCollected)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink/65">Forwards</dt>
              <dd className="font-mono">{formatRupiah(summation.totalForwarded)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-accent/30 pt-1 font-medium">
              <dt>Keeps</dt>
              <dd className="font-mono">{formatRupiah(summation.pivotBalance)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-ink/10 bg-paper/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink/55">C - Other creditors</p>
          <p className="mt-1 text-sm text-ink/70">B forwards funds to everyone here.</p>
          <div className="mt-2 space-y-1.5">
            {otherCreditors.length === 0 ? (
              <p className="text-sm text-ink/55">No forwarding is needed.</p>
            ) : (
              otherCreditors.map((row) => (
                <div key={row.participant} className="flex justify-between gap-3 text-sm">
                  <span>{row.participant}</span>
                  <span className="font-mono">{formatRupiah(row.balance)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {summation.settled.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-ink/10 bg-paper/50 px-3 py-2 text-xs text-ink/65">
          <CircleCheck size={14} />
          <span>Already settled:</span>
          <span className="font-medium text-ink">{summation.settled.map((row) => row.participant).join(', ')}</span>
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <TransferTable
          title={`1. Collect into ${summation.activePivot}`}
          description="Each debtor makes one payment to the pivot."
          rows={summation.incomingTransfers}
          emptyMessage="There is nothing to collect."
        />
        <TransferTable
          title={`2. Distribute from ${summation.activePivot}`}
          description="The pivot forwards only the other creditors' shares."
          rows={summation.outgoingTransfers}
          emptyMessage={`${summation.activePivot} is the only creditor, so no forwarding is needed.`}
        />
      </div>
    </div>
  );
}
