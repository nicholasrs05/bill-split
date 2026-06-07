function normalizeAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function buildDebtSummation(participants, netRows, pivot) {
  const balances = new Map((participants ?? []).map((participant) => [participant, 0]));

  (netRows ?? []).forEach((row) => {
    const amount = normalizeAmount(row.amount);
    if (amount === 0 || !row.debtor || !row.creditor || row.debtor === row.creditor) {
      return;
    }

    balances.set(row.debtor, (balances.get(row.debtor) ?? 0) - amount);
    balances.set(row.creditor, (balances.get(row.creditor) ?? 0) + amount);
  });

  const balanceRows = [...balances.entries()]
    .map(([participant, balance]) => ({ participant, balance: Math.round(balance) }))
    .sort((a, b) => a.participant.localeCompare(b.participant));
  const debtors = balanceRows.filter((row) => row.balance < 0);
  const creditors = balanceRows.filter((row) => row.balance > 0);
  const settled = balanceRows.filter((row) => row.balance === 0);
  const activePivot = creditors.some((row) => row.participant === pivot) ? pivot : creditors[0]?.participant ?? '';
  const pivotBalance = creditors.find((row) => row.participant === activePivot)?.balance ?? 0;

  const incomingTransfers = debtors.map((row) => ({
    from: row.participant,
    to: activePivot,
    amount: Math.abs(row.balance),
  }));
  const outgoingTransfers = creditors
    .filter((row) => row.participant !== activePivot)
    .map((row) => ({
      from: activePivot,
      to: row.participant,
      amount: row.balance,
    }));

  return {
    debtors,
    creditors,
    settled,
    activePivot,
    pivotBalance,
    incomingTransfers,
    outgoingTransfers,
    totalCollected: incomingTransfers.reduce((sum, row) => sum + row.amount, 0),
    totalForwarded: outgoingTransfers.reduce((sum, row) => sum + row.amount, 0),
  };
}
