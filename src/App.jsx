import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Upload,
  Plus,
  Receipt,
  Trash2,
  Users,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  PencilLine,
  Share2,
  X,
} from 'lucide-react';
import ConfirmDialog from './components/ConfirmDialog';
import { APP_STORAGE_KEY, initialParticipants } from './config/billConfig';
import {
  buildBreakdown,
  buildNetDebtCalculationDetails,
  buildStructuredExportSheets,
  buildExpenseSheetRows,
  computeFinalAmountAfterAdjustments,
  computeDebts,
  computeSharedAllocations,
  createDefaultForm,
  createPersonEntries,
  formatExpenseDateTime,
  formatRupiah,
  getExpenseTimestamp,
  loadPersistedAppState,
  normalizeAdjustments,
  normalizeSharedItems,
  parseItemTokens,
  sanitizeNumber,
} from './utils/billHelpers';

export default function App() {
  const importInputRef = useRef(null);
  const persistedState = useMemo(() => loadPersistedAppState(), []);
  const [participants, setParticipants] = useState(persistedState.participants);
  const [expenses, setExpenses] = useState(persistedState.expenses);
  const [participantInput, setParticipantInput] = useState('');
  const [form, setForm] = useState(createDefaultForm());
  const [expandedExpenseIds, setExpandedExpenseIds] = useState({});
  const [showRawDebts, setShowRawDebts] = useState(true);
  const [validationError, setValidationError] = useState('');
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [participantToConfirmRemoval, setParticipantToConfirmRemoval] = useState(null);
  const [expenseToConfirmDeletion, setExpenseToConfirmDeletion] = useState(null);
  const [expenseSortOrder, setExpenseSortOrder] = useState('desc');
  const [selectedNetDebtRow, setSelectedNetDebtRow] = useState(null);
  const [isSharingNetDebtDetail, setIsSharingNetDebtDetail] = useState(false);
  const [netDebtShareFeedback, setNetDebtShareFeedback] = useState('');
  const netDebtDetailCaptureRef = useRef(null);

  const { rawRows, netRows } = useMemo(() => computeDebts(expenses), [expenses]);
  const expenseSheetRows = useMemo(() => buildExpenseSheetRows(expenses), [expenses]);
  const sortedExpenses = useMemo(() => {
    const list = [...expenses];
    list.sort((a, b) => {
      const diff = getExpenseTimestamp(a) - getExpenseTimestamp(b);
      return expenseSortOrder === 'asc' ? diff : -diff;
    });
    return list;
  }, [expenses, expenseSortOrder]);
  const formSharedAllocations = useMemo(
    () => computeSharedAllocations(form.sharedItems ?? [], form.selectedParticipants ?? []),
    [form.sharedItems, form.selectedParticipants]
  );
  const normalizedFormDiscounts = useMemo(() => normalizeAdjustments(form.discounts ?? []), [form.discounts]);
  const normalizedFormExtraFees = useMemo(() => normalizeAdjustments(form.extraFees ?? []), [form.extraFees]);
  const expensePreviewBreakdown = useMemo(() => {
    const selectedParticipants = (form.selectedParticipants ?? []).filter((participant) => participants.includes(participant));
    const paidBy = form.paidBy;

    if (selectedParticipants.length === 0 || !paidBy || !selectedParticipants.includes(paidBy)) {
      return { rows: [], total: 0 };
    }

    const previewExpense = {
      id: 'preview',
      title: form.title || 'Preview',
      paidBy,
      taxPercent: Math.max(0, sanitizeNumber(form.taxPercent)),
      equalSplit: Boolean(form.equalSplit),
      equalSplitTotal: Math.max(0, sanitizeNumber(form.equalSplitTotal)),
      selectedParticipants,
      includedParticipants: selectedParticipants,
      discounts: normalizedFormDiscounts,
      extraFees: normalizedFormExtraFees,
    };

    if (previewExpense.equalSplit) {
      previewExpense.entries = [];
      previewExpense.sharedItems = [];
      return buildBreakdown(previewExpense);
    }

    previewExpense.entries = (form.personEntries ?? [])
      .map((entry) => ({
        participant: entry.participant,
        items: (entry.items ?? []).map((item) => Math.max(0, Math.round(sanitizeNumber(item)))).filter((item) => item > 0),
      }))
      .filter((entry) => selectedParticipants.includes(entry.participant));

    previewExpense.sharedItems = (form.sharedItems ?? [])
      .map((item) => ({
        id: item.id,
        label: item.label,
        amount: Math.max(0, Math.round(sanitizeNumber(item.amount))),
        weights: Object.fromEntries(
          selectedParticipants.map((participant) => [participant, Math.max(0, sanitizeNumber(item.weights?.[participant]))])
        ),
      }))
      .filter((item) => item.amount > 0);

    return buildBreakdown(previewExpense);
  }, [
    form.selectedParticipants,
    form.paidBy,
    form.title,
    form.taxPercent,
    form.equalSplit,
    form.equalSplitTotal,
    form.personEntries,
    form.sharedItems,
    normalizedFormDiscounts,
    normalizedFormExtraFees,
    participants,
  ]);
  const expensePreviewTotals = useMemo(
    () => ({
      subtotal: expensePreviewBreakdown.rows.reduce((sum, row) => sum + (row.subtotal ?? 0), 0),
      afterTax: expensePreviewBreakdown.rows.reduce((sum, row) => sum + (row.afterTax ?? 0), 0),
      final: expensePreviewBreakdown.rows.reduce((sum, row) => sum + (row.finalAmount ?? row.afterTax ?? 0), 0),
    }),
    [expensePreviewBreakdown]
  );
  const netDebtDetail = useMemo(() => {
    if (!selectedNetDebtRow) {
      return null;
    }
    return buildNetDebtCalculationDetails(expenses, selectedNetDebtRow.debtor, selectedNetDebtRow.creditor);
  }, [selectedNetDebtRow, expenses]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      APP_STORAGE_KEY,
      JSON.stringify({
        participants,
        expenses,
      })
    );
  }, [participants, expenses]);

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

  const applyRemoveParticipant = (name) => {
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

  const removeParticipant = (name) => {
    const used = expenses.some(
      (expense) =>
        expense.paidBy === name ||
        (expense.entries ?? []).some((entry) => entry.participant === name) ||
        (expense.includedParticipants ?? []).includes(name) ||
        (expense.selectedParticipants ?? []).includes(name)
    );

    if (used) {
      setParticipantToConfirmRemoval(name);
      return;
    }

    applyRemoveParticipant(name);
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

  const addAdjustment = (kind) => {
    setForm((prev) => ({
      ...prev,
      [kind]: [
        ...(prev[kind] ?? []),
        {
          id: crypto.randomUUID(),
          label: '',
          mode: 'nominal',
          value: '',
        },
      ],
    }));
  };

  const updateAdjustment = (kind, adjustmentId, key, value) => {
    setForm((prev) => ({
      ...prev,
      [kind]: (prev[kind] ?? []).map((item) => (item.id === adjustmentId ? { ...item, [key]: value } : item)),
    }));
  };

  const removeAdjustment = (kind, adjustmentId) => {
    setForm((prev) => ({
      ...prev,
      [kind]: (prev[kind] ?? []).filter((item) => item.id !== adjustmentId),
    }));
  };

  const submitExpense = (event) => {
    event.preventDefault();

    const errors = [];
    const title = form.title.trim();
    const expenseDateTime = form.expenseDateTime;
    const paidBy = form.paidBy;
    const selectedParticipants = form.selectedParticipants.filter((participant) => participants.includes(participant));
    const taxPercent = Math.max(0, sanitizeNumber(form.taxPercent));
    const discounts = normalizeAdjustments(form.discounts ?? []);
    const extraFees = normalizeAdjustments(form.extraFees ?? []);

    if (!title) {
      errors.push('Title is required.');
    }

    if (!expenseDateTime) {
      errors.push('Date and time are required.');
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
        expenseDateTime,
        paidBy,
        taxPercent,
        equalSplit: true,
        equalSplitTotal,
        selectedParticipants,
        includedParticipants: selectedParticipants,
        entries: [],
        sharedItems: [],
        discounts,
        extraFees,
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
        expenseDateTime,
        paidBy,
        taxPercent,
        equalSplit: false,
        equalSplitTotal: 0,
        selectedParticipants,
        includedParticipants: selectedParticipants,
        entries,
        sharedItems,
        discounts,
        extraFees,
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

  const applyDeleteExpense = (expenseId) => {
    setExpenses((prev) => prev.filter((expense) => expense.id !== expenseId));
  };

  const deleteExpense = (expenseId) => {
    setExpenseToConfirmDeletion(expenseId);
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
      expenseDateTime: target.expenseDateTime ?? createDefaultForm().expenseDateTime,
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
      discounts: target.discounts ?? [],
      extraFees: target.extraFees ?? [],
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

    const sheets = buildStructuredExportSheets(participants, expenses, rawRows, netRows, expenseSheetRows);
    const wb = XLSX.utils.book_new();
    sheets.forEach((sheet) => {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
    });
    XLSX.writeFile(wb, 'bill-split.xlsx');
  };

  const triggerImportExcel = () => {
    importInputRef.current?.click();
  };

  const importExcel = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    let XLSX;
    try {
      XLSX = await import('xlsx');
    } catch (error) {
      setValidationError('Excel import module failed to load. Please refresh and try again.');
      return;
    }

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });

      const getRows = (sheetName) => {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) {
          throw new Error(`Missing sheet: ${sheetName}`);
        }
        return XLSX.utils.sheet_to_json(sheet, { defval: '' });
      };

      const participantsRows = getRows('Participants');
      const expensesRows = getRows('Expenses');
      const expenseParticipantsRows = getRows('Expense Participants');
      const entriesRows = getRows('Entries');
      const sharedItemsRows = getRows('Shared Items');
      const sharedItemWeightsRows = getRows('Shared Item Weights');
      const adjustmentsRows = getRows('Adjustments');

      const participantSet = new Set(
        participantsRows
          .map((row) => String(row.Name ?? '').trim())
          .filter((name) => name.length > 0)
      );

      const selectedParticipantsByExpense = new Map();
      expenseParticipantsRows.forEach((row) => {
        const expenseId = String(row['Expense ID'] ?? '').trim();
        const participant = String(row.Participant ?? '').trim();
        if (!expenseId || !participant) {
          return;
        }
        if (!selectedParticipantsByExpense.has(expenseId)) {
          selectedParticipantsByExpense.set(expenseId, []);
        }
        selectedParticipantsByExpense.get(expenseId).push(participant);
        participantSet.add(participant);
      });

      const entriesByExpense = new Map();
      entriesRows.forEach((row) => {
        const expenseId = String(row['Expense ID'] ?? '').trim();
        const participant = String(row.Participant ?? '').trim();
        if (!expenseId || !participant) {
          return;
        }
        let items = [];
        try {
          const parsed = JSON.parse(String(row['Items JSON'] ?? '[]'));
          if (Array.isArray(parsed)) {
            items = parsed.map((item) => Math.max(0, Math.round(sanitizeNumber(item)))).filter((item) => item > 0);
          }
        } catch (error) {
          items = [];
        }

        if (!entriesByExpense.has(expenseId)) {
          entriesByExpense.set(expenseId, []);
        }
        entriesByExpense.get(expenseId).push({ participant, items });
        participantSet.add(participant);
      });

      const sharedItemWeightsByItem = new Map();
      sharedItemWeightsRows.forEach((row) => {
        const sharedItemId = String(row['Shared Item ID'] ?? '').trim();
        const participant = String(row.Participant ?? '').trim();
        if (!sharedItemId || !participant) {
          return;
        }
        if (!sharedItemWeightsByItem.has(sharedItemId)) {
          sharedItemWeightsByItem.set(sharedItemId, {});
        }
        sharedItemWeightsByItem.get(sharedItemId)[participant] = Math.max(0, sanitizeNumber(row.Weight));
        participantSet.add(participant);
      });

      const sharedItemsByExpense = new Map();
      sharedItemsRows.forEach((row) => {
        const sharedItemId = String(row['Shared Item ID'] ?? '').trim();
        const expenseId = String(row['Expense ID'] ?? '').trim();
        if (!sharedItemId || !expenseId) {
          return;
        }
        if (!sharedItemsByExpense.has(expenseId)) {
          sharedItemsByExpense.set(expenseId, []);
        }
        sharedItemsByExpense.get(expenseId).push({
          id: sharedItemId,
          label: String(row.Label ?? '').trim(),
          amount: Math.max(0, Math.round(sanitizeNumber(row.Amount))),
          weights: sharedItemWeightsByItem.get(sharedItemId) ?? {},
        });
      });

      const adjustmentsByExpense = new Map();
      adjustmentsRows.forEach((row) => {
        const expenseId = String(row['Expense ID'] ?? '').trim();
        if (!expenseId) {
          return;
        }
        if (!adjustmentsByExpense.has(expenseId)) {
          adjustmentsByExpense.set(expenseId, { discounts: [], extraFees: [] });
        }

        const item = {
          id: String(row['Adjustment ID'] ?? '').trim() || crypto.randomUUID(),
          label: String(row.Label ?? '').trim(),
          mode: String(row.Mode ?? '').trim() === 'percent' ? 'percent' : 'nominal',
          value: Math.max(0, sanitizeNumber(row.Value)),
        };

        const kind = String(row.Kind ?? '').trim();
        if (kind === 'discount') {
          adjustmentsByExpense.get(expenseId).discounts.push(item);
        } else if (kind === 'extraFee') {
          adjustmentsByExpense.get(expenseId).extraFees.push(item);
        }
      });

      const importedExpenses = expensesRows
        .map((row) => {
          const expenseId = String(row['Expense ID'] ?? '').trim() || crypto.randomUUID();
          const selectedParticipants = [...new Set(selectedParticipantsByExpense.get(expenseId) ?? [])];
          const paidBy = String(row['Paid By'] ?? '').trim();
          if (paidBy) {
            participantSet.add(paidBy);
          }

          const adjustments = adjustmentsByExpense.get(expenseId) ?? { discounts: [], extraFees: [] };
          return {
            id: expenseId,
            expenseDateTime: String(row['Date Time'] ?? '').trim(),
            title: String(row.Title ?? '').trim(),
            paidBy,
            taxPercent: Math.max(0, sanitizeNumber(row['Tax %'])),
            equalSplit:
              sanitizeNumber(row['Equal Split']) === 1 ||
              String(row['Equal Split'] ?? '').trim().toLowerCase() === 'true',
            equalSplitTotal: Math.max(0, sanitizeNumber(row['Equal Split Total'])),
            selectedParticipants,
            includedParticipants: selectedParticipants,
            entries: entriesByExpense.get(expenseId) ?? [],
            sharedItems: sharedItemsByExpense.get(expenseId) ?? [],
            discounts: normalizeAdjustments(adjustments.discounts),
            extraFees: normalizeAdjustments(adjustments.extraFees),
          };
        })
        .filter((expense) => expense.title && expense.paidBy);

      if (participantSet.size === 0 && importedExpenses.length === 0) {
        throw new Error('No usable data found in file');
      }

      const importedParticipants = [...participantSet];
      setParticipants(importedParticipants.length > 0 ? importedParticipants : initialParticipants);
      setExpenses(importedExpenses);
      setExpandedExpenseIds({});
      setShowRawDebts(true);
      setParticipantInput('');
      setForm(createDefaultForm());
      setEditingExpenseId(null);
      setIsExpenseModalOpen(false);
      setValidationError('');
    } catch (error) {
      setValidationError('Import failed. Please use a file generated by this app export format.');
    } finally {
      event.target.value = '';
    }
  };

  const resetAllContent = () => {
    setIsResetDialogOpen(true);
  };

  const confirmResetAllContent = () => {
    setIsResetDialogOpen(false);

    setParticipants(initialParticipants);
    setExpenses([]);
    setParticipantInput('');
    setForm(createDefaultForm());
    setExpandedExpenseIds({});
    setShowRawDebts(true);
    setValidationError('');
    setEditingExpenseId(null);
    setIsExpenseModalOpen(false);

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(APP_STORAGE_KEY);
    }
  };

  const closeResetDialog = () => {
    setIsResetDialogOpen(false);
  };

  const closeParticipantRemovalDialog = () => {
    setParticipantToConfirmRemoval(null);
  };

  const confirmParticipantRemoval = () => {
    if (participantToConfirmRemoval) {
      applyRemoveParticipant(participantToConfirmRemoval);
    }
    setParticipantToConfirmRemoval(null);
  };

  const closeExpenseDeletionDialog = () => {
    setExpenseToConfirmDeletion(null);
  };

  const confirmExpenseDeletion = () => {
    if (expenseToConfirmDeletion) {
      applyDeleteExpense(expenseToConfirmDeletion);
    }
    setExpenseToConfirmDeletion(null);
  };

  const openNetDebtDetail = (row) => {
    setNetDebtShareFeedback('');
    setSelectedNetDebtRow(row);
  };

  const closeNetDebtDetail = () => {
    setNetDebtShareFeedback('');
    setSelectedNetDebtRow(null);
  };

  const shareNetDebtDetailImage = async () => {
    if (!netDebtDetailCaptureRef.current || !selectedNetDebtRow || isSharingNetDebtDetail) {
      return;
    }

    setIsSharingNetDebtDetail(true);
    setNetDebtShareFeedback('');

    try {
      const { toBlob } = await import('html-to-image');
      const sourceNode = netDebtDetailCaptureRef.current;
      let blob;
      const sourceStyleBackup = sourceNode.style.cssText;
      const scrollableNodes = Array.from(sourceNode.querySelectorAll('[data-share-scrollable="true"]'));
      const scrollableStyleBackup = scrollableNodes.map((node) => node.style.cssText);

      sourceNode.style.maxHeight = 'none';
      sourceNode.style.height = 'auto';
      sourceNode.style.overflow = 'visible';

      scrollableNodes.forEach((node) => {
        node.style.maxHeight = 'none';
        node.style.height = 'auto';
        node.style.overflow = 'visible';
        node.style.paddingRight = '0';
      });

      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      try {
        // Keep image under browser canvas limits for very long proofs.
        const maxCanvasEdge = 16000;
        const longestEdge = Math.max(sourceNode.scrollHeight, sourceNode.scrollWidth, 1);
        const safePixelRatio = Math.max(0.75, Math.min(2, maxCanvasEdge / longestEdge));

        blob = await toBlob(sourceNode, {
          cacheBust: true,
          skipFonts: true,
          pixelRatio: safePixelRatio,
          backgroundColor: '#FAF7F2',
          filter: (node) => !(node instanceof Element && node.dataset?.shareExclude === 'true'),
        });
      } finally {
        sourceNode.style.cssText = sourceStyleBackup;
        scrollableNodes.forEach((node, index) => {
          node.style.cssText = scrollableStyleBackup[index];
        });
      }

      if (!blob) {
        throw new Error('Capture failed');
      }

      const safeDebtor = selectedNetDebtRow.debtor.replace(/[^a-zA-Z0-9-_]/g, '-');
      const safeCreditor = selectedNetDebtRow.creditor.replace(/[^a-zA-Z0-9-_]/g, '-');
      const fileName = `debt-proof-${safeDebtor}-to-${safeCreditor}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title: `Debt proof: ${selectedNetDebtRow.debtor} to ${selectedNetDebtRow.creditor}`,
          // text: `${selectedNetDebtRow.debtor} owes ${selectedNetDebtRow.creditor} ${formatRupiah(selectedNetDebtRow.amount)}`,
          // text: `Bayar utang`,
          files: [file],
        });
        setNetDebtShareFeedback('Shared successfully.');
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setNetDebtShareFeedback('Direct share is not supported here. Image downloaded so you can send it manually.');
    } catch (error) {
      setNetDebtShareFeedback('Failed to generate share image. Please try again.');
    } finally {
      setIsSharingNetDebtDetail(false);
    }
  };

  return (
    <div className="min-h-screen paper-noise px-4 py-6 sm:px-6 lg:px-8">
      <style>{`
        // .paper-noise {
        //   background-color: #FAF7F2;
        //   background-image:
        //     linear-gradient(120deg, rgba(255, 255, 255, 0.65), rgba(250, 247, 242, 0.95)),
        //     radial-gradient(circle at 16% 22%, rgba(245, 158, 11, 0.08) 0 18%, transparent 19%),
        //     radial-gradient(circle at 82% 14%, rgba(26, 26, 46, 0.06) 0 22%, transparent 23%),
        //     radial-gradient(circle at 42% 78%, rgba(245, 158, 11, 0.05) 0 16%, transparent 17%);
        //   background-size: 100% 100%, 520px 520px, 620px 620px, 460px 460px;
        //   background-position: 0 0, 0 0, 240px 120px, 120px 260px;
        //   background-repeat: no-repeat, repeat, repeat, repeat;
        //   position: relative;
        // }

        // .paper-noise::before {
        //   content: '';
        //   position: fixed;
        //   inset: 0;
        //   pointer-events: none;
        //   opacity: 0.12;
        //   background-image: radial-gradient(rgba(26, 26, 46, 0.22) 0.35px, transparent 0.35px);
        //   background-size: 3px 3px;
        // }

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
            <div className="flex flex-wrap items-center justify-end gap-2">
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={importExcel}
                className="hidden"
              />
              <button
                type="button"
                onClick={resetAllContent}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 font-mono text-sm text-red-700 transition hover:-translate-y-0.5 hover:bg-red-100"
              >
                <Trash2 size={16} /> Reset Content
              </button>
              <button
                type="button"
                onClick={triggerImportExcel}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-ink/20 bg-white px-4 py-2 font-mono text-sm text-ink transition hover:-translate-y-0.5 hover:bg-ink/5"
              >
                <Upload size={16} /> Import Excel
              </button>
              <button
                type="button"
                onClick={exportExcel}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-ink/20 bg-ink px-4 py-2 font-mono text-sm text-paper transition hover:-translate-y-0.5 hover:bg-ink/90"
              >
                <Download size={16} /> Export Excel
              </button>
            </div>
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
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl">Expenses</h2>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <label htmlFor="expenseSortOrder" className="text-xs text-ink/70">
                Sort
              </label>
              <select
                id="expenseSortOrder"
                value={expenseSortOrder}
                onChange={(event) => setExpenseSortOrder(event.target.value)}
                className="rounded-lg border border-ink/20 bg-white px-2 py-1.5 text-xs outline-none ring-accent transition focus:ring"
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
              <button
                type="button"
                onClick={openCreateExpenseModal}
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-accent/60 bg-accent px-3 py-2 font-mono text-xs text-ink"
              >
                <Plus size={14} /> Add Expense
              </button>
            </div>
          </div>

          {expenses.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink/25 bg-paper px-4 py-5 text-sm text-ink/65">
              No expenses added yet. Add your first expense to build the ledger.
            </p>
          ) : (
            <div className="space-y-3">
              {sortedExpenses.map((expense) => {
                const breakdown = buildBreakdown(expense);
                const expanded = Boolean(expandedExpenseIds[expense.id]);
                return (
                  <article
                    key={expense.id}
                    className="fade-in rounded-xl border border-ink/15 bg-white p-4 transition-colors duration-200 hover:border-accent/40 hover:bg-accent/[0.06]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => toggleExpenseExpanded(expense.id)}
                        className="flex flex-1 items-center justify-between gap-3 rounded-lg px-2 py-1 text-left transition-colors duration-200 hover:bg-accent/[0.06]"
                      >
                        <div>
                          <p className="font-medium text-ink">{expense.title}</p>
                          <p className="text-sm text-ink/65">
                            {formatExpenseDateTime(expense.expenseDateTime)} | paid by {expense.paidBy} | Total collected:{' '}
                            {formatRupiah(breakdown.total)}
                          </p>
                        </div>
                        <ChevronDown
                          size={18}
                          className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
                        />
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

                    <div
                      className={`grid transition-all duration-300 ease-out ${
                        expanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="min-w-full border-collapse text-left text-sm">
                            <thead>
                              <tr className="border-b border-ink/15 text-ink/70">
                                <th className="px-2 py-2 font-medium">Person</th>
                                <th className="px-2 py-2 font-medium">Subtotal</th>
                                <th className="px-2 py-2 font-medium">After Tax</th>
                                <th className="px-2 py-2 font-medium">Final</th>
                              </tr>
                            </thead>
                            <tbody>
                              {breakdown.rows.map((row) => (
                                <tr key={`${expense.id}-${row.participant}`} className="border-b border-ink/10">
                                  <td className="px-2 py-2">{row.participant}</td>
                                  <td className="px-2 py-2 font-mono">{formatRupiah(row.subtotal)}</td>
                                  <td className="px-2 py-2 font-mono">{formatRupiah(row.afterTax)}</td>
                                  <td className="px-2 py-2 font-mono">{formatRupiah(row.finalAmount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
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

              <form onSubmit={submitExpense} className="max-h-[80vh] overflow-y-auto pr-1">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-4">
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

                <div>
                  <label htmlFor="expenseDateTime" className="mb-1 block text-sm font-medium text-ink/80">
                    Date & Time
                  </label>
                  <input
                    id="expenseDateTime"
                    type="datetime-local"
                    value={form.expenseDateTime ?? ''}
                    onChange={(event) => setForm((prev) => ({ ...prev, expenseDateTime: event.target.value }))}
                    className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm outline-none ring-accent transition focus:ring"
                  />
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
                        const finalAmount = computeFinalAmountAfterAdjustments(
                          afterTax,
                          form.selectedParticipants.length,
                          normalizedFormDiscounts,
                          normalizedFormExtraFees
                        );
                        return (
                          <div key={entry.participant} className="fade-in rounded-xl border border-ink/15 bg-white p-3">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <p className="font-medium">{entry.participant}</p>
                              <p className="font-mono text-xs text-ink/70">
                                Own: {formatRupiah(ownSubtotal)} | Shared: {formatRupiah(sharedSubtotal)} | After tax:{' '}
                                {formatRupiah(afterTax)} | Final: {formatRupiah(finalAmount)}
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

                <div className="space-y-3 rounded-xl border border-ink/15 bg-paper/80 p-4">
                  <div>
                    <h3 className="font-medium text-ink">After-Tax Adjustments</h3>
                    <p className="text-xs text-ink/70">
                      Discounts and extra fees are applied after tax. Nominal values are split equally across selected participants.
                    </p>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-ink">Discounts</h4>
                        <button
                          type="button"
                          onClick={() => addAdjustment('discounts')}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-2 py-1 text-xs text-red-700"
                        >
                          <Plus size={12} /> Add Discount
                        </button>
                      </div>

                      {(form.discounts ?? []).length === 0 && (
                        <p className="rounded-lg bg-white px-3 py-2 text-xs text-ink/60">No discounts added.</p>
                      )}

                      {(form.discounts ?? []).map((item) => (
                        <div key={item.id} className="flex flex-wrap gap-2 rounded-lg border border-red-200 bg-white p-2">
                          <input
                            type="text"
                            value={item.label ?? ''}
                            onChange={(event) => updateAdjustment('discounts', item.id, 'label', event.target.value)}
                            placeholder="e.g. Voucher"
                            className="min-w-[160px] flex-1 rounded-md border border-ink/20 px-2 py-1.5 text-xs outline-none ring-accent transition focus:ring"
                          />
                          <select
                            value={item.mode ?? 'nominal'}
                            onChange={(event) => updateAdjustment('discounts', item.id, 'mode', event.target.value)}
                            className="w-[130px] rounded-md border border-ink/20 px-2 py-1.5 text-xs outline-none ring-accent transition focus:ring"
                          >
                            <option value="nominal">Nominal (Rp)</option>
                            <option value="percent">Percent (%)</option>
                          </select>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.value ?? ''}
                            onChange={(event) => updateAdjustment('discounts', item.id, 'value', event.target.value)}
                            placeholder={item.mode === 'percent' ? '5' : '5000'}
                            className="w-[110px] rounded-md border border-ink/20 px-2 py-1.5 text-xs outline-none ring-accent transition focus:ring"
                          />
                          <button
                            type="button"
                            onClick={() => removeAdjustment('discounts', item.id)}
                            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-red-200 text-red-700"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-ink">Extra Fees</h4>
                        <button
                          type="button"
                          onClick={() => addAdjustment('extraFees')}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-700"
                        >
                          <Plus size={12} /> Add Fee
                        </button>
                      </div>

                      {(form.extraFees ?? []).length === 0 && (
                        <p className="rounded-lg bg-white px-3 py-2 text-xs text-ink/60">No extra fees added.</p>
                      )}

                      {(form.extraFees ?? []).map((item) => (
                        <div key={item.id} className="flex flex-wrap gap-2 rounded-lg border border-emerald-200 bg-white p-2">
                          <input
                            type="text"
                            value={item.label ?? ''}
                            onChange={(event) => updateAdjustment('extraFees', item.id, 'label', event.target.value)}
                            placeholder="e.g. Platform fee"
                            className="min-w-[160px] flex-1 rounded-md border border-ink/20 px-2 py-1.5 text-xs outline-none ring-accent transition focus:ring"
                          />
                          <select
                            value={item.mode ?? 'nominal'}
                            onChange={(event) => updateAdjustment('extraFees', item.id, 'mode', event.target.value)}
                            className="w-[130px] rounded-md border border-ink/20 px-2 py-1.5 text-xs outline-none ring-accent transition focus:ring"
                          >
                            <option value="nominal">Nominal (Rp)</option>
                            <option value="percent">Percent (%)</option>
                          </select>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.value ?? ''}
                            onChange={(event) => updateAdjustment('extraFees', item.id, 'value', event.target.value)}
                            placeholder={item.mode === 'percent' ? '5' : '1000'}
                            className="w-[110px] rounded-md border border-ink/20 px-2 py-1.5 text-xs outline-none ring-accent transition focus:ring"
                          />
                          <button
                            type="button"
                            onClick={() => removeAdjustment('extraFees', item.id)}
                            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-red-200 text-red-700"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                  </div>

                  <aside className="h-fit rounded-xl border border-ink/15 bg-white/80 p-4 lg:sticky lg:top-0">
                    <h3 className="font-display text-xl text-ink">Calculation Preview</h3>
                    <p className="mt-1 text-xs text-ink/70">Live estimate from current form input.</p>

                    <div className="mt-3 space-y-2 rounded-lg border border-ink/10 bg-paper/70 p-3 text-xs text-ink/80">
                      <p>
                        Participants: <span className="font-mono">{form.selectedParticipants.length}</span>
                      </p>
                      <p>
                        Payer: <span className="font-mono">{form.paidBy || '-'}</span>
                      </p>
                      <p>
                        Tax: <span className="font-mono">{sanitizeNumber(form.taxPercent)}%</span>
                      </p>
                      <p>
                        Discounts: <span className="font-mono">{normalizedFormDiscounts.length}</span>
                      </p>
                      <p>
                        Extra fees: <span className="font-mono">{normalizedFormExtraFees.length}</span>
                      </p>
                    </div>

                    {expensePreviewBreakdown.rows.length === 0 ? (
                      <p className="mt-3 rounded-lg border border-dashed border-ink/20 bg-white px-3 py-2 text-xs text-ink/60">
                        Select participants and payer to preview calculations.
                      </p>
                    ) : (
                      <>
                        <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-ink/10 bg-white">
                          <table className="min-w-full border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b border-ink/10 text-ink/70">
                                <th className="px-2 py-1.5 font-medium">Person</th>
                                <th className="px-2 py-1.5 font-medium">Subtotal</th>
                                <th className="px-2 py-1.5 font-medium">After Tax</th>
                                <th className="px-2 py-1.5 font-medium">Final</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expensePreviewBreakdown.rows.map((row) => (
                                <tr key={`preview-${row.participant}`} className="border-b border-ink/10 last:border-b-0">
                                  <td className="px-2 py-1.5">{row.participant}</td>
                                  <td className="px-2 py-1.5 font-mono">{formatRupiah(row.subtotal)}</td>
                                  <td className="px-2 py-1.5 font-mono">{formatRupiah(row.afterTax)}</td>
                                  <td className="px-2 py-1.5 font-mono">{formatRupiah(row.finalAmount ?? row.afterTax)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="mt-3 rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-ink/70">Subtotal</span>
                            <span className="font-mono">{formatRupiah(expensePreviewTotals.subtotal)}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <span className="text-ink/70">After tax total</span>
                            <span className="font-mono">{formatRupiah(expensePreviewTotals.afterTax)}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between border-t border-accent/30 pt-1.5">
                            <span className="font-medium text-ink">Final owed total</span>
                            <span className="font-mono font-medium">{formatRupiah(expensePreviewTotals.final)}</span>
                          </div>
                        </div>
                      </>
                    )}
                  </aside>
                </div>

                {validationError && (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {validationError}
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2 border-t border-ink/10 pt-3 mt-3">
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

        <ConfirmDialog
          open={isResetDialogOpen}
          title="Reset All Content?"
          description="This will permanently erase all participants and expenses from this browser."
          warning="Recommended: Export to Excel first so you keep a backup before resetting."
          confirmLabel="Yes, Reset Everything"
          onCancel={closeResetDialog}
          onConfirm={confirmResetAllContent}
          ariaLabel="Close reset confirmation dialog"
        />

        <ConfirmDialog
          open={Boolean(participantToConfirmRemoval)}
          title="Remove Participant?"
          description={
            participantToConfirmRemoval
              ? `${participantToConfirmRemoval} appears in existing expenses.`
              : ''
          }
          warning="Continuing will remove this participant and also remove affected rows from existing expenses."
          confirmLabel="Yes, Remove Participant"
          onCancel={closeParticipantRemovalDialog}
          onConfirm={confirmParticipantRemoval}
          ariaLabel="Close participant removal confirmation dialog"
        />

        <ConfirmDialog
          open={Boolean(expenseToConfirmDeletion)}
          title="Delete Expense?"
          description="This expense will be permanently removed from your current ledger."
          warning="Recommended: Export to Excel first if you might need this record later."
          confirmLabel="Yes, Delete Expense"
          onCancel={closeExpenseDeletionDialog}
          onConfirm={confirmExpenseDeletion}
          ariaLabel="Close expense deletion confirmation dialog"
        />

        {selectedNetDebtRow && netDebtDetail && (
          <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:items-center">
            <button
              type="button"
              className="absolute inset-0 bg-ink/45 backdrop-blur-[1px]"
              onClick={closeNetDebtDetail}
              aria-label="Close net debt detail dialog"
            />

            <div
              ref={netDebtDetailCaptureRef}
              className="relative z-10 w-full max-w-5xl rounded-2xl border border-ink/15 bg-white p-5 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-2xl text-ink">Net Debt Calculation Detail</h3>
                  <p className="text-sm text-ink/70">
                    {selectedNetDebtRow.debtor} owes {selectedNetDebtRow.creditor} {formatRupiah(selectedNetDebtRow.amount)}
                  </p>
                </div>
                <div data-share-exclude="true" className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={shareNetDebtDetailImage}
                    disabled={isSharingNetDebtDetail}
                    className="inline-flex items-center gap-1 rounded-lg border border-accent/50 bg-accent/10 px-2.5 py-1.5 text-xs text-ink transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Share2 size={14} /> {isSharingNetDebtDetail ? 'Preparing...' : 'Share Proof'}
                  </button>
                  <button
                    type="button"
                    onClick={closeNetDebtDetail}
                    className="rounded-lg border border-ink/20 p-1.5 text-ink/70 transition hover:bg-ink/5"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {netDebtShareFeedback && (
                <p className="mb-3 rounded-lg border border-ink/10 bg-paper px-3 py-2 text-xs text-ink/75">{netDebtShareFeedback}</p>
              )}

              <div data-share-scrollable="true" className="max-h-[76vh] space-y-4 overflow-y-auto pr-1">
                <section className="rounded-xl border border-ink/15 bg-white p-3">
                  <h4 className="mb-2 font-medium text-ink">1. Expense Details</h4>
                  {netDebtDetail.expenseDetails.length === 0 ? (
                    <p className="text-sm text-ink/60">No matching expense details found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-ink/15 text-ink/70">
                            <th className="px-2 py-2 font-medium">Date</th>
                            <th className="px-2 py-2 font-medium">Expense</th>
                            <th className="px-2 py-2 font-medium">Direction</th>
                            <th className="px-2 py-2 font-medium">Subtotal</th>
                            <th className="px-2 py-2 font-medium">Tax %</th>
                            <th className="px-2 py-2 font-medium">After Tax</th>
                            <th className="px-2 py-2 font-medium">Discounts</th>
                            <th className="px-2 py-2 font-medium">Extra Fees</th>
                            <th className="px-2 py-2 font-medium">Final</th>
                          </tr>
                        </thead>
                        <tbody>
                          {netDebtDetail.expenseDetails.map((detail) => (
                            <tr
                              key={`${detail.expenseId}-${detail.participant}-${detail.direction}`}
                              className="border-b border-ink/10 last:border-b-0"
                            >
                              <td className="px-2 py-2">{formatExpenseDateTime(detail.expenseDateTime)}</td>
                              <td className="px-2 py-2">{detail.expenseTitle}</td>
                              <td className="px-2 py-2">{detail.direction}</td>
                              <td className="px-2 py-2 font-mono">{formatRupiah(detail.subtotal)}</td>
                              <td className="px-2 py-2 font-mono">{detail.taxPercent}%</td>
                              <td className="px-2 py-2 font-mono">{formatRupiah(detail.afterTax)}</td>
                              <td className="px-2 py-2 font-mono">- {formatRupiah(detail.discountImpact)}</td>
                              <td className="px-2 py-2 font-mono">+ {formatRupiah(detail.extraFeeImpact)}</td>
                              <td className="px-2 py-2 font-mono">{formatRupiah(detail.finalAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-ink/15 bg-white p-3">
                  <h4 className="mb-2 font-medium text-ink">2. Raw Debts</h4>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-ink/10 bg-paper/70 p-3">
                      <p className="mb-2 text-sm font-medium">
                        {selectedNetDebtRow.debtor} owes {selectedNetDebtRow.creditor}
                      </p>
                      {netDebtDetail.rawDebtsDebtorToCreditor.length === 0 ? (
                        <p className="text-xs text-ink/60">No entries.</p>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {netDebtDetail.rawDebtsDebtorToCreditor.map((detail) => (
                            <li key={`raw-a-${detail.expenseId}-${detail.participant}`} className="flex justify-between gap-2">
                              <span>{detail.expenseTitle}</span>
                              <span className="font-mono">{formatRupiah(detail.finalAmount)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-2 border-t border-ink/10 pt-2 text-sm font-medium">
                        Total: <span className="font-mono">{formatRupiah(netDebtDetail.totalDebtorToCreditor)}</span>
                      </p>
                    </div>

                    <div className="rounded-lg border border-ink/10 bg-paper/70 p-3">
                      <p className="mb-2 text-sm font-medium">
                        {selectedNetDebtRow.creditor} owes {selectedNetDebtRow.debtor}
                      </p>
                      {netDebtDetail.rawDebtsCreditorToDebtor.length === 0 ? (
                        <p className="text-xs text-ink/60">No entries.</p>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {netDebtDetail.rawDebtsCreditorToDebtor.map((detail) => (
                            <li key={`raw-b-${detail.expenseId}-${detail.participant}`} className="flex justify-between gap-2">
                              <span>{detail.expenseTitle}</span>
                              <span className="font-mono">{formatRupiah(detail.finalAmount)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-2 border-t border-ink/10 pt-2 text-sm font-medium">
                        Total: <span className="font-mono">{formatRupiah(netDebtDetail.totalCreditorToDebtor)}</span>
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-accent/30 bg-accent/10 p-3">
                  <h4 className="mb-2 font-medium text-ink">3. Final Debt</h4>
                  <p className="text-sm text-ink/80">
                    {selectedNetDebtRow.debtor} owes {selectedNetDebtRow.creditor}
                  </p>
                  <p className="mt-1 font-mono text-lg font-medium text-ink">{formatRupiah(netDebtDetail.finalNetAmount)}</p>
                  <p className="mt-1 text-xs text-ink/70">
                    Formula: {formatRupiah(netDebtDetail.totalDebtorToCreditor)} - {formatRupiah(netDebtDetail.totalCreditorToDebtor)}
                  </p>
                </section>
              </div>
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
              <ChevronDown size={14} className={`transition-transform duration-300 ${showRawDebts ? 'rotate-180' : ''}`} />
              Raw Debts
            </button>
          </div>

          <div
            className={`grid transition-all duration-300 ease-out ${
              showRawDebts ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="overflow-hidden">
              <div className="overflow-x-auto">
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
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-accent/30 bg-accent/10 p-3">
            <h3 className="mb-1 font-medium text-ink">Net Debts</h3>
            <p className="mb-1 max-w-2xl text-sm text-ink/70">
              Click row to see details and share.
            </p>
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-ink/15 text-ink/70">
                  <th className="px-2 py-2 font-medium">Person</th>
                  <th className="px-2 py-2 font-medium">Owes</th>
                  <th className="px-2 py-2 font-medium">Amount</th>
                  <th className="px-2 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {netRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-ink/70">
                      No net debts yet.
                    </td>
                  </tr>
                )}
                {netRows.map((row) => (
                  <tr
                    key={`${row.debtor}-${row.creditor}`}
                    className="group cursor-pointer border-b border-ink/10 transition hover:bg-white/75 hover:shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)]"
                    onClick={() => openNetDebtDetail(row)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openNetDebtDetail(row);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`View net debt detail for ${row.debtor} owing ${row.creditor}`}
                  >
                    <td className="px-2 py-2">{row.debtor}</td>
                    <td className="px-2 py-2">{row.creditor}</td>
                    <td className="px-2 py-2 font-mono">{formatRupiah(row.amount)}</td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-xs text-ink transition group-hover:bg-accent/25">
                        View details <ChevronRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </td>
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
