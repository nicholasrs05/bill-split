import React, { useMemo, useState } from 'react';
import {
  Download,
  Plus,
  Receipt,
  Trash2,
  Users,
  ChevronDown,
  ChevronUp,
  PencilLine,
  X,
} from 'lucide-react';

const initialParticipants = ['Alice', 'Bob', 'Charlie'];

function formatRupiah(value) {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  return `Rp ${rounded.toLocaleString('id-ID')}`;
}

function sanitizeNumber(input) {
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

function parseItemTokens(input) {
  if (!input) {
    return [];
  }
  return String(input)
    .split(/[\s,]+/)
    .map((token) => sanitizeNumber(token))
    .filter((n) => n > 0)
    .map((n) => Math.round(n));
}

function createPersonEntries(participants, paidBy, existing = []) {
  const map = new Map(existing.map((entry) => [entry.participant, entry]));
  return participants
    .filter((participant) => participant !== paidBy)
    .map((participant) => ({
      participant,
      items: map.get(participant)?.items ?? [],
      draft: '',
    }));
}

function normalizeSharedItems(sharedItems, selectedParticipants) {
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

function createDefaultForm() {
  return {
    title: '',
    selectedParticipants: [],
    paidBy: '',
    taxPercent: 0,
    equalSplit: false,
    equalSplitTotal: 0,
    personEntries: [],
    sharedItems: [],
  };
}

function computeSharedAllocations(sharedItems, selectedParticipants) {
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

function buildBreakdown(expense) {
  const taxPercent = sanitizeNumber(expense.taxPercent);
  const taxFactor = 1 + taxPercent / 100;
  const selectedParticipants = (expense.selectedParticipants ?? expense.includedParticipants ?? []).filter(Boolean);

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
      }));

    return {
      rows,
      total: rows.reduce((sum, row) => sum + row.afterTax, 0),
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
      return {
        participant,
        subtotal,
        afterTax,
      };
    })
    .filter((row) => row.afterTax > 0);

  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.afterTax, 0),
  };
}

function computeDebts(expenses) {
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
      const amount = Math.round(row.afterTax);
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

function buildExpenseSheetRows(expenses) {
  const rows = [['#', 'Title', 'Paid By', 'Tax %', 'Person', 'Items', 'Subtotal', 'After Tax']];

  expenses.forEach((expense, index) => {
    const tax = sanitizeNumber(expense.taxPercent);
    const selectedParticipants = (expense.selectedParticipants ?? expense.includedParticipants ?? []).filter(Boolean);

    if (expense.equalSplit) {
      const included = selectedParticipants;
      const total = sanitizeNumber(expense.equalSplitTotal);
      const share = included.length > 0 ? total / included.length : 0;
      included.forEach((participant) => {
        const afterTax = Math.round(share * (1 + tax / 100));
        rows.push([
          index + 1,
          expense.title,
          expense.paidBy,
          tax,
          participant,
          'equal share',
          Math.round(share),
          afterTax,
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
      const itemDetails = [];
      if (ownItems.length > 0) {
        itemDetails.push(ownItems.join(', '));
      }
      if (sharedSubtotal > 0) {
        itemDetails.push(`shared ${sharedSubtotal}`);
      }
      rows.push([
        index + 1,
        expense.title,
        expense.paidBy,
        tax,
        participant,
        itemDetails.join(' | '),
        subtotal,
        afterTax,
      ]);
    });
  });

  return rows;
}

export default function App() {
  const [participants, setParticipants] = useState(initialParticipants);
  const [expenses, setExpenses] = useState([]);
  const [participantInput, setParticipantInput] = useState('');
  const [form, setForm] = useState(createDefaultForm());
  const [expandedExpenseIds, setExpandedExpenseIds] = useState({});
  const [showRawDebts, setShowRawDebts] = useState(true);
  const [validationError, setValidationError] = useState('');
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);

  const { rawRows, netRows } = useMemo(() => computeDebts(expenses), [expenses]);
  const expenseSheetRows = useMemo(() => buildExpenseSheetRows(expenses), [expenses]);
  const formSharedAllocations = useMemo(
    () => computeSharedAllocations(form.sharedItems ?? [], form.selectedParticipants ?? []),
    [form.sharedItems, form.selectedParticipants]
  );

  const addParticipant = () => {
    const nextName = participantInput.trim();
    if (!nextName) {
      return;
    }

    const duplicate = participants.some((participant) => participant.toLowerCase() === nextName.toLowerCase());
    if (duplicate) {
      setValidationError('Participant already exists. Use a unique name.');
      return;
    }

    const nextParticipants = [...participants, nextName];
    setParticipants(nextParticipants);
    setParticipantInput('');
    setValidationError('');
  };

  const removeParticipant = (name) => {
    const used = expenses.some(
      (expense) =>
        expense.paidBy === name ||
        (expense.entries ?? []).some((entry) => entry.participant === name) ||
        (expense.includedParticipants ?? []).includes(name) ||
        (expense.selectedParticipants ?? []).includes(name)
    );

    if (used) {
      const confirmed = window.confirm(
        `${name} appears in existing expenses. Removing this participant will also remove affected rows from those expenses. Continue?`
      );
      if (!confirmed) {
        return;
      }
    }

    const nextParticipants = participants.filter((participant) => participant !== name);

    setExpenses((prev) =>
      prev
        .map((expense) => {
          if (expense.paidBy === name) {
            return null;
          }

          const selectedParticipants = (expense.selectedParticipants ?? expense.includedParticipants ?? []).filter(
            (participant) => participant !== name
          );
          if (selectedParticipants.length === 0) {
            return null;
          }

          if (expense.equalSplit) {
            const debtors = selectedParticipants.filter((participant) => participant !== expense.paidBy);
            if (debtors.length === 0) {
              return null;
            }
            return {
              ...expense,
              selectedParticipants,
              includedParticipants: selectedParticipants,
            };
          }

          const debtors = selectedParticipants.filter((participant) => participant !== expense.paidBy);
          if (debtors.length === 0) {
            return null;
          }

          return {
            ...expense,
            selectedParticipants,
            includedParticipants: selectedParticipants,
            entries: (expense.entries ?? []).filter((entry) => entry.participant !== name),
            sharedItems: normalizeSharedItems(expense.sharedItems ?? [], selectedParticipants),
          };
        })
        .filter(Boolean)
    );

    setParticipants(nextParticipants);
    setForm((prev) => {
      const selectedParticipants = prev.selectedParticipants.filter((participant) => participant !== name);
      const paidBy = selectedParticipants.includes(prev.paidBy) ? prev.paidBy : '';
      return {
        ...prev,
        selectedParticipants,
        paidBy,
        personEntries: createPersonEntries(selectedParticipants, paidBy, prev.personEntries),
        sharedItems: normalizeSharedItems(prev.sharedItems ?? [], selectedParticipants),
      };
    });
  };

  const openCreateExpenseModal = () => {
    setEditingExpenseId(null);
    setValidationError('');
    setForm(createDefaultForm());
    setIsExpenseModalOpen(true);
  };

  const closeExpenseModal = () => {
    setIsExpenseModalOpen(false);
    setEditingExpenseId(null);
    setValidationError('');
    setForm(createDefaultForm());
  };

  const toggleFormParticipant = (participant, checked) => {
    setForm((prev) => {
      const nextSet = new Set(prev.selectedParticipants);
      if (checked) {
        nextSet.add(participant);
      } else {
        nextSet.delete(participant);
      }
      const selectedParticipants = participants.filter((name) => nextSet.has(name));
      const paidBy = selectedParticipants.includes(prev.paidBy) ? prev.paidBy : '';
      return {
        ...prev,
        selectedParticipants,
        paidBy,
        personEntries: createPersonEntries(selectedParticipants, paidBy, prev.personEntries),
        sharedItems: normalizeSharedItems(prev.sharedItems ?? [], selectedParticipants),
      };
    });
  };

  const updatePaidBy = (paidBy) => {
    setForm((prev) => ({
      ...prev,
      paidBy,
      personEntries: createPersonEntries(prev.selectedParticipants, paidBy, prev.personEntries),
    }));
  };

  const updateDraft = (participant, draft) => {
    setForm((prev) => ({
      ...prev,
      personEntries: prev.personEntries.map((entry) =>
        entry.participant === participant
          ? {
              ...entry,
              draft,
            }
          : entry
      ),
    }));
  };

  const commitDraftItems = (participant) => {
    setForm((prev) => ({
      ...prev,
      personEntries: prev.personEntries.map((entry) => {
        if (entry.participant !== participant) {
          return entry;
        }
        const additions = parseItemTokens(entry.draft);
        return {
          ...entry,
          items: [...entry.items, ...additions],
          draft: '',
        };
      }),
    }));
  };

  const removeItem = (participant, index) => {
    setForm((prev) => ({
      ...prev,
      personEntries: prev.personEntries.map((entry) => {
        if (entry.participant !== participant) {
          return entry;
        }
        return {
          ...entry,
          items: entry.items.filter((_, itemIndex) => itemIndex !== index),
        };
      }),
    }));
  };

  const resetForm = () => {
    setForm(createDefaultForm());
    setEditingExpenseId(null);
  };

  const addSharedItem = () => {
    setForm((prev) => ({
      ...prev,
      sharedItems: [
        ...prev.sharedItems,
        {
          id: crypto.randomUUID(),
          label: '',
          amount: '',
          weights: Object.fromEntries(prev.selectedParticipants.map((participant) => [participant, 0])),
        },
      ],
    }));
  };

  const updateSharedItem = (itemId, key, value) => {
    setForm((prev) => ({
      ...prev,
      sharedItems: prev.sharedItems.map((item) => (item.id === itemId ? { ...item, [key]: value } : item)),
    }));
  };

  const updateSharedWeight = (itemId, participant, weight) => {
    setForm((prev) => ({
      ...prev,
      sharedItems: prev.sharedItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              weights: {
                ...item.weights,
                [participant]: weight,
              },
            }
          : item
      ),
    }));
  };

  const removeSharedItem = (itemId) => {
    setForm((prev) => ({
      ...prev,
      sharedItems: prev.sharedItems.filter((item) => item.id !== itemId),
    }));
  };

  const submitExpense = (event) => {
    event.preventDefault();

    const errors = [];
    const title = form.title.trim();
    const paidBy = form.paidBy;
    const selectedParticipants = form.selectedParticipants.filter((participant) => participants.includes(participant));
    const taxPercent = Math.max(0, sanitizeNumber(form.taxPercent));

    if (!title) {
      errors.push('Title is required.');
    }

    if (selectedParticipants.length === 0) {
      errors.push('Select participants for this expense first.');
    }

    if (!paidBy) {
      errors.push('Paid by is required.');
    }

    if (paidBy && !selectedParticipants.includes(paidBy)) {
      errors.push('Paid by must be one of the selected participants.');
    }

    const debtors = selectedParticipants.filter((participant) => participant !== paidBy);
    if (selectedParticipants.length > 0 && debtors.length === 0) {
      errors.push('Select at least one non-payer participant.');
    }

    let expensePayload = null;

    if (form.equalSplit) {
      const equalSplitTotal = Math.max(0, sanitizeNumber(form.equalSplitTotal));

      if (equalSplitTotal <= 0) {
        errors.push('Equal split total must be greater than zero.');
      }

      expensePayload = {
        id: editingExpenseId ?? crypto.randomUUID(),
        title,
        paidBy,
        taxPercent,
        equalSplit: true,
        equalSplitTotal,
        selectedParticipants,
        includedParticipants: selectedParticipants,
        entries: [],
        sharedItems: [],
      };
    } else {
      const sharedItemsWithPositiveAmount = (form.sharedItems ?? []).filter((item) => sanitizeNumber(item.amount) > 0);
      const invalidSharedItems = sharedItemsWithPositiveAmount.filter((item) => {
        const weightCount = selectedParticipants.filter((participant) => sanitizeNumber(item.weights?.[participant]) > 0).length;
        return weightCount < 2;
      });

      if (invalidSharedItems.length > 0) {
        errors.push('Every shared item must include at least two participants with weight greater than zero.');
      }

      const sharedItems = sharedItemsWithPositiveAmount.map((item) => ({
        id: item.id,
        label: item.label?.trim() || 'Shared item',
        amount: Math.round(Math.max(0, sanitizeNumber(item.amount))),
        weights: Object.fromEntries(
          selectedParticipants.map((participant) => [participant, Math.max(0, sanitizeNumber(item.weights?.[participant]))])
        ),
      }));

      const entries = form.personEntries
        .map((entry) => ({
          participant: entry.participant,
          items: entry.items.map((item) => Math.round(sanitizeNumber(item))).filter((item) => item > 0),
        }))
        .filter((entry) => entry.participant !== paidBy && selectedParticipants.includes(entry.participant));

      const entryMap = new Map(entries.map((entry) => [entry.participant, entry]));
      const sharedAllocations = computeSharedAllocations(sharedItems, selectedParticipants);

      const hasPositiveAmount = debtors.some((participant) => {
        const own = (entryMap.get(participant)?.items ?? []).reduce((sum, item) => sum + item, 0);
        const shared = sharedAllocations[participant] ?? 0;
        return own + shared > 0;
      });

      if (!hasPositiveAmount) {
        errors.push('Add at least one participant amount greater than zero (individual or shared).');
      }

      expensePayload = {
        id: editingExpenseId ?? crypto.randomUUID(),
        title,
        paidBy,
        taxPercent,
        equalSplit: false,
        equalSplitTotal: 0,
        selectedParticipants,
        includedParticipants: selectedParticipants,
        entries,
        sharedItems,
      };
    }

    if (errors.length > 0) {
      setValidationError(errors.join(' '));
      return;
    }

    setExpenses((prev) => {
      if (editingExpenseId) {
        return prev.map((expense) => (expense.id === editingExpenseId ? expensePayload : expense));
      }
      return [...prev, expensePayload];
    });
    closeExpenseModal();
    setValidationError('');
  };

  const deleteExpense = (expenseId) => {
    const confirmed = window.confirm('Delete this expense?');
    if (!confirmed) {
      return;
    }
    setExpenses((prev) => prev.filter((expense) => expense.id !== expenseId));
  };

  const editExpense = (expenseId) => {
    const target = expenses.find((expense) => expense.id === expenseId);
    if (!target) {
      return;
    }

    setEditingExpenseId(target.id);
    const selectedParticipants = participants.filter((participant) =>
      (target.selectedParticipants ?? target.includedParticipants ?? []).includes(participant)
    );
    const paidBy = selectedParticipants.includes(target.paidBy) ? target.paidBy : '';

    setForm({
      title: target.title,
      selectedParticipants,
      paidBy,
      taxPercent: target.taxPercent,
      equalSplit: target.equalSplit,
      equalSplitTotal: target.equalSplitTotal,
      personEntries: target.equalSplit
        ? createPersonEntries(selectedParticipants, paidBy)
        : createPersonEntries(
            selectedParticipants,
            paidBy,
            (target.entries ?? []).map((entry) => ({
              participant: entry.participant,
              items: entry.items,
              draft: '',
            }))
          ),
      sharedItems: normalizeSharedItems(target.sharedItems ?? [], selectedParticipants),
    });

    setValidationError('');
    setIsExpenseModalOpen(true);
  };

  const toggleExpenseExpanded = (expenseId) => {
    setExpandedExpenseIds((prev) => ({
      ...prev,
      [expenseId]: !prev[expenseId],
    }));
  };

  const exportExcel = async () => {
    let XLSX;
    try {
      XLSX = await import('xlsx');
    } catch (error) {
      setValidationError('Excel export module failed to load. Please refresh and try again.');
      return;
    }

    const rawSheetRows = [['Debtor', 'Creditor', 'Expense Title', 'Amount']];
    rawRows.forEach((row) => {
      rawSheetRows.push([row.debtor, row.creditor, row.expenseTitle, row.amount]);
    });

    const netSheetRows = [['Debtor', 'Creditor', 'Net Amount']];
    netRows.forEach((row) => {
      netSheetRows.push([row.debtor, row.creditor, row.amount]);
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expenseSheetRows), 'Expenses');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rawSheetRows), 'Raw Debts');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(netSheetRows), 'Net Debts');
    XLSX.writeFile(wb, 'bill-split.xlsx');
  };

  return (
    <div className="min-h-screen paper-noise px-4 py-6 sm:px-6 lg:px-8">
      <style>{`
        .paper-noise {
          background-color: #FAF7F2;
          background-image:
            radial-gradient(circle at 15% 20%, rgba(245, 158, 11, 0.08) 0 18%, transparent 19%),
            radial-gradient(circle at 80% 10%, rgba(26, 26, 46, 0.06) 0 22%, transparent 23%),
            radial-gradient(circle at 40% 80%, rgba(245, 158, 11, 0.05) 0 16%, transparent 17%),
            linear-gradient(120deg, rgba(255, 255, 255, 0.65), rgba(250, 247, 242, 0.95));
          position: relative;
        }

        .paper-noise::before {
          content: '';
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: 0.12;
          background-image: radial-gradient(rgba(26, 26, 46, 0.22) 0.35px, transparent 0.35px);
          background-size: 3px 3px;
        }

        .fade-in {
          animation: fade-in 220ms ease-out;
        }

        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-2xl border border-ink/10 bg-white/70 p-5 shadow-ledger backdrop-blur">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-ink/60">Shared Ledger</p>
              <h1 className="font-display text-4xl leading-tight text-ink">Bill Splitter</h1>
              <p className="mt-2 max-w-2xl text-sm text-ink/70">
                Track shared expenses, apply tax fairly, and settle with clean net debts.
              </p>
            </div>
            <button
              type="button"
              onClick={exportExcel}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-ink/20 bg-ink px-4 py-2 font-mono text-sm text-paper transition hover:-translate-y-0.5 hover:bg-ink/90"
            >
              <Download size={16} /> Export Excel
            </button>
          </div>
        </header>

        <section className="rounded-2xl border border-ink/10 bg-white/75 p-5 shadow-ledger backdrop-blur">
          <div className="mb-4 flex items-center gap-2">
            <Users size={18} className="text-accent" />
            <h2 className="font-display text-2xl">Participants</h2>
          </div>

          <div className="flex flex-wrap gap-2">
            {participants.length === 0 && <p className="text-sm text-ink/60">Add participants to begin splitting bills.</p>}
            {participants.map((participant) => (
              <span
                key={participant}
                className="fade-in inline-flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3 py-1.5 font-mono text-sm"
              >
                {participant}
                <button
                  type="button"
                  onClick={() => removeParticipant(participant)}
                  className="rounded-full p-0.5 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                  aria-label={`Remove ${participant}`}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="newParticipant" className="sr-only">
              Add participant
            </label>
            <input
              id="newParticipant"
              type="text"
              value={participantInput}
              onChange={(event) => setParticipantInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addParticipant();
                }
              }}
              placeholder="Add participant name"
              className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm outline-none ring-accent transition focus:ring"
            />
            <button
              type="button"
              onClick={addParticipant}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-accent/60 bg-accent px-4 py-2 font-mono text-sm text-ink"
            >
              <Plus size={16} /> Add
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-ink/10 bg-white/80 p-5 shadow-ledger backdrop-blur">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl">Expenses</h2>
            <button
              type="button"
              onClick={openCreateExpenseModal}
              className="inline-flex items-center gap-2 rounded-xl border border-accent/60 bg-accent px-3 py-2 font-mono text-xs text-ink"
            >
              <Plus size={14} /> Add Expense
            </button>
          </div>

          {expenses.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink/25 bg-paper px-4 py-5 text-sm text-ink/65">
              No expenses added yet. Add your first expense to build the ledger.
            </p>
          ) : (
            <div className="space-y-3">
              {expenses.map((expense) => {
                const breakdown = buildBreakdown(expense);
                const expanded = Boolean(expandedExpenseIds[expense.id]);
                return (
                  <article key={expense.id} className="fade-in rounded-xl border border-ink/15 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => toggleExpenseExpanded(expense.id)}
                        className="flex flex-1 items-center justify-between gap-3 text-left"
                      >
                        <div>
                          <p className="font-medium text-ink">{expense.title}</p>
                          <p className="text-sm text-ink/65">
                            paid by {expense.paidBy} | Total collected: {formatRupiah(breakdown.total)}
                          </p>
                        </div>
                        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => editExpense(expense.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-ink/20 px-2.5 py-1.5 text-xs"
                        >
                          <PencilLine size={14} /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteExpense(expense.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-700"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full border-collapse text-left text-sm">
                          <thead>
                            <tr className="border-b border-ink/15 text-ink/70">
                              <th className="px-2 py-2 font-medium">Person</th>
                              <th className="px-2 py-2 font-medium">Subtotal</th>
                              <th className="px-2 py-2 font-medium">After Tax</th>
                            </tr>
                          </thead>
                          <tbody>
                            {breakdown.rows.map((row) => (
                              <tr key={`${expense.id}-${row.participant}`} className="border-b border-ink/10">
                                <td className="px-2 py-2">{row.participant}</td>
                                <td className="px-2 py-2 font-mono">{formatRupiah(row.subtotal)}</td>
                                <td className="px-2 py-2 font-mono">{formatRupiah(row.afterTax)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {isExpenseModalOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:items-center">
            <button
              type="button"
              className="absolute inset-0 bg-ink/45 backdrop-blur-[1px]"
              onClick={closeExpenseModal}
              aria-label="Close add expense dialog"
            />

            <div className="relative z-10 w-full max-w-4xl rounded-2xl border border-ink/15 bg-white p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Receipt size={18} className="text-accent" />
                  <h2 className="font-display text-2xl">{editingExpenseId ? 'Edit Expense' : 'Add Expense'}</h2>
                </div>
                <button
                  type="button"
                  onClick={closeExpenseModal}
                  className="rounded-lg border border-ink/20 p-1.5 text-ink/70 transition hover:bg-ink/5"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={submitExpense} className="max-h-[80vh] space-y-4 overflow-y-auto pr-1">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <label htmlFor="expenseTitle" className="mb-1 block text-sm font-medium text-ink/80">
                      Title
                    </label>
                    <input
                      id="expenseTitle"
                      type="text"
                      value={form.title}
                      onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                      placeholder="Dinner at XX"
                      className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm outline-none ring-accent transition focus:ring"
                    />
                  </div>

                  <div>
                    <label htmlFor="taxPercent" className="mb-1 block text-sm font-medium text-ink/80">
                      Tax %
                    </label>
                    <input
                      id="taxPercent"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.taxPercent}
                      onChange={(event) => setForm((prev) => ({ ...prev, taxPercent: event.target.value }))}
                      className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm outline-none ring-accent transition focus:ring"
                    />
                  </div>
                </div>

                <fieldset className="rounded-xl border border-ink/15 bg-paper/70 p-3">
                  <legend className="px-1 text-sm font-medium text-ink/80">Participants in this expense</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {participants.map((participant) => (
                      <label key={participant} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.selectedParticipants.includes(participant)}
                          onChange={(event) => toggleFormParticipant(participant, event.target.checked)}
                          className="h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
                        />
                        {participant}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="paidBy" className="mb-1 block text-sm font-medium text-ink/80">
                      Paid By
                    </label>
                    <select
                      id="paidBy"
                      value={form.paidBy}
                      onChange={(event) => updatePaidBy(event.target.value)}
                      className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm outline-none ring-accent transition focus:ring"
                    >
                      <option value="">Select payer</option>
                      {form.selectedParticipants.map((participant) => (
                        <option key={participant} value={participant}>
                          {participant}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end rounded-xl border border-ink/15 bg-paper px-3 py-2">
                    <label htmlFor="equalSplit" className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink/80">
                      <input
                        id="equalSplit"
                        type="checkbox"
                        checked={form.equalSplit}
                        onChange={(event) => setForm((prev) => ({ ...prev, equalSplit: event.target.checked }))}
                        className="h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
                      />
                      Use equal split mode
                    </label>
                  </div>
                </div>

                {form.equalSplit ? (
                  <div className="space-y-2 rounded-xl border border-accent/30 bg-accent/10 p-4">
                    <label htmlFor="equalSplitTotal" className="mb-1 block text-sm font-medium text-ink/80">
                      Total Amount
                    </label>
                    <input
                      id="equalSplitTotal"
                      type="number"
                      min="0"
                      step="1"
                      value={form.equalSplitTotal}
                      onChange={(event) => setForm((prev) => ({ ...prev, equalSplitTotal: event.target.value }))}
                      className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm outline-none ring-accent transition focus:ring"
                    />
                    <p className="text-xs text-ink/70">
                      Equal split will use the selected participants above and exclude payer share from debt.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-3 rounded-xl border border-ink/15 bg-ink/[0.03] p-4">
                      <p className="text-sm text-ink/70">
                        Add personal item amounts for each non-payer participant. Use comma, space, or Enter to create chips.
                      </p>

                      {form.personEntries.length === 0 && (
                        <p className="rounded-lg bg-white px-3 py-2 text-sm text-ink/60">
                          Select participants and choose payer to start entering item amounts.
                        </p>
                      )}

                      {form.personEntries.map((entry) => {
                        const ownSubtotal = entry.items.reduce((sum, item) => sum + item, 0);
                        const sharedSubtotal = formSharedAllocations[entry.participant] ?? 0;
                        const subtotal = ownSubtotal + sharedSubtotal;
                        const afterTax = Math.round(subtotal * (1 + sanitizeNumber(form.taxPercent) / 100));
                        return (
                          <div key={entry.participant} className="fade-in rounded-xl border border-ink/15 bg-white p-3">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <p className="font-medium">{entry.participant}</p>
                              <p className="font-mono text-xs text-ink/70">
                                Own: {formatRupiah(ownSubtotal)} | Shared: {formatRupiah(sharedSubtotal)} | After tax:{' '}
                                {formatRupiah(afterTax)}
                              </p>
                            </div>

                            <div className="mb-2 flex flex-wrap gap-2">
                              {entry.items.map((item, index) => (
                                <span
                                  key={`${entry.participant}-${item}-${index}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-2.5 py-1 font-mono text-xs"
                                >
                                  {formatRupiah(item)}
                                  <button
                                    type="button"
                                    onClick={() => removeItem(entry.participant, index)}
                                    className="text-ink/60 hover:text-ink"
                                    aria-label="Remove item"
                                  >
                                    <X size={12} />
                                  </button>
                                </span>
                              ))}
                            </div>

                            <label htmlFor={`items-${entry.participant}`} className="sr-only">
                              Item amounts for {entry.participant}
                            </label>
                            <input
                              id={`items-${entry.participant}`}
                              type="text"
                              value={entry.draft}
                              placeholder="e.g. 145223, 281381"
                              onChange={(event) => updateDraft(entry.participant, event.target.value)}
                              onBlur={() => commitDraftItems(entry.participant)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
                                  event.preventDefault();
                                  commitDraftItems(entry.participant);
                                }
                              }}
                              className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm outline-none ring-accent transition focus:ring"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/10 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-medium text-ink">Shared Items</h3>
                          <p className="text-xs text-ink/70">Set amount and participant weights. Example: A=1, B=2 means 1/3 and 2/3.</p>
                        </div>
                        <button
                          type="button"
                          onClick={addSharedItem}
                          className="inline-flex items-center gap-1 rounded-lg border border-accent/60 bg-accent px-2.5 py-1.5 font-mono text-xs text-ink"
                        >
                          <Plus size={14} /> Add Shared Item
                        </button>
                      </div>

                      {form.sharedItems.length === 0 && (
                        <p className="rounded-lg bg-white px-3 py-2 text-sm text-ink/60">
                          No shared items yet. Add one if some items are shared unequally.
                        </p>
                      )}

                      {form.sharedItems.map((item) => {
                        const preview = computeSharedAllocations([item], form.selectedParticipants);
                        return (
                          <div key={item.id} className="rounded-xl border border-ink/15 bg-white p-3">
                            <div className="mb-3 grid gap-3 md:grid-cols-[1fr_140px_auto]">
                              <div>
                                <label htmlFor={`shared-label-${item.id}`} className="mb-1 block text-xs font-medium text-ink/75">
                                  Label
                                </label>
                                <input
                                  id={`shared-label-${item.id}`}
                                  type="text"
                                  value={item.label}
                                  onChange={(event) => updateSharedItem(item.id, 'label', event.target.value)}
                                  placeholder="Shared dish"
                                  className="w-full rounded-lg border border-ink/20 px-2.5 py-2 text-sm outline-none ring-accent transition focus:ring"
                                />
                              </div>
                              <div>
                                <label htmlFor={`shared-amount-${item.id}`} className="mb-1 block text-xs font-medium text-ink/75">
                                  Amount
                                </label>
                                <input
                                  id={`shared-amount-${item.id}`}
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={item.amount}
                                  onChange={(event) => updateSharedItem(item.id, 'amount', event.target.value)}
                                  className="w-full rounded-lg border border-ink/20 px-2.5 py-2 text-sm outline-none ring-accent transition focus:ring"
                                />
                              </div>
                              <div className="flex items-end">
                                <button
                                  type="button"
                                  onClick={() => removeSharedItem(item.id)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-2 text-xs text-red-700"
                                >
                                  <Trash2 size={12} /> Remove
                                </button>
                              </div>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {form.selectedParticipants.map((participant) => (
                                <label key={`${item.id}-${participant}`} className="rounded-lg border border-ink/10 bg-paper px-2.5 py-2">
                                  <span className="mb-1 block text-xs text-ink/75">{participant} weight</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={item.weights?.[participant] ?? 0}
                                    onChange={(event) => updateSharedWeight(item.id, participant, event.target.value)}
                                    className="w-full rounded-md border border-ink/20 px-2 py-1.5 text-sm outline-none ring-accent transition focus:ring"
                                  />
                                </label>
                              ))}
                            </div>

                            <p className="mt-2 font-mono text-xs text-ink/70">
                              Preview:{' '}
                              {form.selectedParticipants.map((participant) => `${participant} ${formatRupiah(preview[participant] ?? 0)}`).join(' | ')}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {validationError && (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {validationError}
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2 border-t border-ink/10 pt-3">
                  <button
                    type="button"
                    onClick={closeExpenseModal}
                    className="rounded-xl border border-ink/20 px-4 py-2 font-mono text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={participants.length === 0}
                    className="inline-flex items-center gap-2 rounded-xl border border-accent/60 bg-accent px-4 py-2 font-mono text-sm text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus size={16} /> {editingExpenseId ? 'Update Expense' : 'Add Expense'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <section className="rounded-2xl border border-ink/10 bg-white/85 p-5 shadow-ledger backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">Summary</h2>
            <button
              type="button"
              onClick={() => setShowRawDebts((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-lg border border-ink/20 px-3 py-1.5 text-xs"
            >
              {showRawDebts ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Raw Debts
            </button>
          </div>

          {showRawDebts && (
            <div className="mt-4 overflow-x-auto">
              <h3 className="mb-2 font-medium text-ink/80">Raw Debts</h3>
              <table className="min-w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-ink/15 text-ink/70">
                    <th className="px-2 py-2 font-medium">Debtor</th>
                    <th className="px-2 py-2 font-medium">Creditor</th>
                    <th className="px-2 py-2 font-medium">Expense</th>
                    <th className="px-2 py-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rawRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-4 text-ink/60">
                        No raw debts yet.
                      </td>
                    </tr>
                  )}
                  {rawRows.map((row, index) => (
                    <tr key={`${row.debtor}-${row.creditor}-${row.expenseTitle}-${index}`} className="border-b border-ink/10">
                      <td className="px-2 py-2">{row.debtor}</td>
                      <td className="px-2 py-2">{row.creditor}</td>
                      <td className="px-2 py-2">{row.expenseTitle}</td>
                      <td className="px-2 py-2 font-mono">{formatRupiah(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 overflow-x-auto rounded-xl border border-accent/30 bg-accent/10 p-3">
            <h3 className="mb-2 font-medium text-ink">Net Debts</h3>
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-ink/15 text-ink/70">
                  <th className="px-2 py-2 font-medium">Person</th>
                  <th className="px-2 py-2 font-medium">Owes</th>
                  <th className="px-2 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {netRows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2 py-4 text-ink/70">
                      No net debts yet.
                    </td>
                  </tr>
                )}
                {netRows.map((row) => (
                  <tr key={`${row.debtor}-${row.creditor}`} className="border-b border-ink/10">
                    <td className="px-2 py-2">{row.debtor}</td>
                    <td className="px-2 py-2">{row.creditor}</td>
                    <td className="px-2 py-2 font-mono">{formatRupiah(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
