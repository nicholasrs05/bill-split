import { APP_STORAGE_KEY, initialParticipants } from '../config/billConfig';

export function loadPersistedAppState() {
  if (typeof window === 'undefined') {
    return {
      participants: initialParticipants,
      expenses: [],
    };
  }

  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) {
      return {
        participants: initialParticipants,
        expenses: [],
      };
    }

    const parsed = JSON.parse(raw);
    const participants = Array.isArray(parsed?.participants)
      ? parsed.participants.filter((name) => typeof name === 'string' && name.trim().length > 0)
      : initialParticipants;
    const expenses = Array.isArray(parsed?.expenses) ? parsed.expenses : [];

    return {
      participants: participants.length > 0 ? participants : initialParticipants,
      expenses,
    };
  } catch (error) {
    return {
      participants: initialParticipants,
      expenses: [],
    };
  }
}

export function formatRupiah(value) {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  return `Rp ${rounded.toLocaleString('id-ID')}`;
}

export function sanitizeNumber(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : 0;
  }
  const normalized = String(input ?? '')
    .trim()
    .replace(/\./g, '')
    .replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseItemTokens(input) {
  if (!input) {
    return [];
  }
  return String(input)
    .split(/[\s,]+/)
    .map((token) => sanitizeNumber(token))
    .filter((n) => n > 0)
    .map((n) => Math.round(n));
}

export function createPersonEntries(participants, paidBy, existing = []) {
  const map = new Map(existing.map((entry) => [entry.participant, entry]));
  return participants
    .filter((participant) => participant !== paidBy)
    .map((participant) => ({
      participant,
      items: map.get(participant)?.items ?? [],
      draft: '',
    }));
}

export function normalizeSharedItems(sharedItems, selectedParticipants) {
  return (sharedItems ?? []).map((item) => {
    const weights = {};
    selectedParticipants.forEach((participant) => {
      weights[participant] = sanitizeNumber(item.weights?.[participant]);
    });
    return {
      ...item,
      weights,
    };
  });
}

export function createDefaultForm() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);

  return {
    title: '',
    expenseDateTime: local.toISOString().slice(0, 16),
    selectedParticipants: [],
    paidBy: '',
    taxPercent: 0,
    equalSplit: false,
    equalSplitTotal: 0,
    personEntries: [],
    sharedItems: [],
    discounts: [],
    extraFees: [],
  };
}

export function getExpenseTimestamp(expense) {
  const raw = expense?.expenseDateTime;
  if (!raw) {
    return 0;
  }
  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

export function formatExpenseDateTime(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString('id-ID', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function normalizeAdjustments(adjustments = []) {
  return (adjustments ?? [])
    .map((item) => ({
      id: item.id ?? crypto.randomUUID(),
      label: (item.label ?? '').toString().trim(),
      mode: item.mode === 'percent' ? 'percent' : 'nominal',
      value: Math.max(0, sanitizeNumber(item.value)),
    }))
    .filter((item) => item.value > 0);
}

export function computeFinalAmountAfterAdjustments(afterTaxAmount, participantCount, discounts = [], extraFees = []) {
  const base = Math.max(0, sanitizeNumber(afterTaxAmount));
  const count = Math.max(1, sanitizeNumber(participantCount));

  const totalDiscount = normalizeAdjustments(discounts).reduce((sum, item) => {
    if (item.mode === 'percent') {
      return sum + (base * item.value) / 100;
    }
    return sum + item.value / count;
  }, 0);

  const totalExtraFee = normalizeAdjustments(extraFees).reduce((sum, item) => {
    if (item.mode === 'percent') {
      return sum + (base * item.value) / 100;
    }
    return sum + item.value / count;
  }, 0);

  return Math.max(0, Math.round(base - totalDiscount + totalExtraFee));
}

export function computeSharedAllocations(sharedItems, selectedParticipants) {
  const allocation = {};
  selectedParticipants.forEach((participant) => {
    allocation[participant] = 0;
  });

  (sharedItems ?? []).forEach((item) => {
    const amount = Math.max(0, sanitizeNumber(item.amount));
    if (amount <= 0) {
      return;
    }

    const participantsWithWeight = selectedParticipants
      .map((participant) => ({
        participant,
        weight: Math.max(0, sanitizeNumber(item.weights?.[participant])),
      }))
      .filter((entry) => entry.weight > 0);

    const totalWeight = participantsWithWeight.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0) {
      return;
    }

    participantsWithWeight.forEach((entry) => {
      const share = Math.round((amount * entry.weight) / totalWeight);
      allocation[entry.participant] = (allocation[entry.participant] ?? 0) + share;
    });
  });

  return allocation;
}

export function buildBreakdown(expense) {
  const taxPercent = sanitizeNumber(expense.taxPercent);
  const taxFactor = 1 + taxPercent / 100;
  const selectedParticipants = (expense.selectedParticipants ?? expense.includedParticipants ?? []).filter(Boolean);
  const participantCount = Math.max(1, selectedParticipants.length);
  const discounts = normalizeAdjustments(expense.discounts ?? []);
  const extraFees = normalizeAdjustments(expense.extraFees ?? []);

  if (expense.equalSplit) {
    const included = selectedParticipants;
    if (included.length === 0) {
      return { rows: [], total: 0 };
    }
    const total = sanitizeNumber(expense.equalSplitTotal);
    const shareBeforeTax = total / included.length;
    const shareAfterTax = Math.round(shareBeforeTax * taxFactor);

    const rows = included
      .filter((participant) => participant !== expense.paidBy)
      .map((participant) => ({
        participant,
        subtotal: Math.round(shareBeforeTax),
        afterTax: shareAfterTax,
        finalAmount: computeFinalAmountAfterAdjustments(shareAfterTax, participantCount, discounts, extraFees),
      }));

    return {
      rows,
      total: rows.reduce((sum, row) => sum + row.finalAmount, 0),
      payerShareAfterTax: shareAfterTax,
    };
  }

  const sharedAllocations = computeSharedAllocations(expense.sharedItems ?? [], selectedParticipants);
  const entryMap = new Map((expense.entries ?? []).map((entry) => [entry.participant, entry]));

  const rows = selectedParticipants
    .filter((participant) => participant !== expense.paidBy)
    .map((participant) => {
      const ownItems = entryMap.get(participant)?.items ?? [];
      const ownSubtotal = Math.round(ownItems.reduce((sum, item) => sum + sanitizeNumber(item), 0));
      const sharedSubtotal = Math.round(sharedAllocations[participant] ?? 0);
      const subtotal = ownSubtotal + sharedSubtotal;
      const afterTax = Math.round(subtotal * taxFactor);
      const finalAmount = computeFinalAmountAfterAdjustments(afterTax, participantCount, discounts, extraFees);
      return {
        participant,
        subtotal,
        afterTax,
        finalAmount,
      };
    })
    .filter((row) => row.finalAmount > 0);

  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.finalAmount, 0),
  };
}

export function computeDebts(expenses) {
  const rawRows = [];
  const matrix = {};

  const addToMatrix = (debtor, creditor, amount) => {
    if (!matrix[debtor]) {
      matrix[debtor] = {};
    }
    matrix[debtor][creditor] = (matrix[debtor][creditor] ?? 0) + amount;
  };

  expenses.forEach((expense) => {
    const breakdown = buildBreakdown(expense);
    breakdown.rows.forEach((row) => {
      const amount = Math.round(row.finalAmount ?? row.afterTax);
      if (amount <= 0) {
        return;
      }
      rawRows.push({
        debtor: row.participant,
        creditor: expense.paidBy,
        expenseTitle: expense.title,
        amount,
      });
      addToMatrix(row.participant, expense.paidBy, amount);
    });
  });

  const people = new Set();
  Object.keys(matrix).forEach((debtor) => {
    people.add(debtor);
    Object.keys(matrix[debtor]).forEach((creditor) => people.add(creditor));
  });
  const participants = [...people].sort();

  const netRows = [];
  for (let i = 0; i < participants.length; i += 1) {
    for (let j = i + 1; j < participants.length; j += 1) {
      const a = participants[i];
      const b = participants[j];
      const aToB = matrix[a]?.[b] ?? 0;
      const bToA = matrix[b]?.[a] ?? 0;

      if (aToB > bToA) {
        netRows.push({
          debtor: a,
          creditor: b,
          amount: Math.round(aToB - bToA),
        });
      } else if (bToA > aToB) {
        netRows.push({
          debtor: b,
          creditor: a,
          amount: Math.round(bToA - aToB),
        });
      }
    }
  }

  return { rawRows, netRows };
}

export function buildExpenseSheetRows(expenses) {
  const rows = [['#', 'Date Time', 'Title', 'Paid By', 'Tax %', 'Person', 'Items', 'Subtotal', 'After Tax', 'Final Amount']];

  expenses.forEach((expense, index) => {
    const tax = sanitizeNumber(expense.taxPercent);
    const selectedParticipants = (expense.selectedParticipants ?? expense.includedParticipants ?? []).filter(Boolean);
    const participantCount = Math.max(1, selectedParticipants.length);
    const discounts = normalizeAdjustments(expense.discounts ?? []);
    const extraFees = normalizeAdjustments(expense.extraFees ?? []);

    if (expense.equalSplit) {
      const included = selectedParticipants;
      const total = sanitizeNumber(expense.equalSplitTotal);
      const share = included.length > 0 ? total / included.length : 0;
      included.forEach((participant) => {
        const afterTax = Math.round(share * (1 + tax / 100));
        const finalAmount = computeFinalAmountAfterAdjustments(afterTax, participantCount, discounts, extraFees);
        rows.push([
          index + 1,
          expense.expenseDateTime ?? '',
          expense.title,
          expense.paidBy,
          tax,
          participant,
          'equal share',
          Math.round(share),
          afterTax,
          finalAmount,
        ]);
      });
      return;
    }

    const sharedAllocations = computeSharedAllocations(expense.sharedItems ?? [], selectedParticipants);
    const entryMap = new Map((expense.entries ?? []).map((entry) => [entry.participant, entry]));

    selectedParticipants.forEach((participant) => {
      const ownItems = entryMap.get(participant)?.items ?? [];
      const ownSubtotal = Math.round(ownItems.reduce((sum, item) => sum + sanitizeNumber(item), 0));
      const sharedSubtotal = Math.round(sharedAllocations[participant] ?? 0);
      const subtotal = ownSubtotal + sharedSubtotal;
      const afterTax = Math.round(subtotal * (1 + tax / 100));
      const finalAmount = computeFinalAmountAfterAdjustments(afterTax, participantCount, discounts, extraFees);
      const itemDetails = [];
      if (ownItems.length > 0) {
        itemDetails.push(ownItems.join(', '));
      }
      if (sharedSubtotal > 0) {
        itemDetails.push(`shared ${sharedSubtotal}`);
      }
      rows.push([
        index + 1,
        expense.expenseDateTime ?? '',
        expense.title,
        expense.paidBy,
        tax,
        participant,
        itemDetails.join(' | '),
        subtotal,
        afterTax,
        finalAmount,
      ]);
    });
  });

  return rows;
}
