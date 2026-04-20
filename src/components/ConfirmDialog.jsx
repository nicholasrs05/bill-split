import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({
  open,
  title,
  description,
  warning,
  confirmLabel,
  cancelLabel = 'Cancel',
  onCancel,
  onConfirm,
  ariaLabel,
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink/45 backdrop-blur-[1px]"
        onClick={onCancel}
        aria-label={ariaLabel ?? 'Close confirmation dialog'}
      />

      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-red-200 bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <div className="rounded-lg bg-red-100 p-2 text-red-700">
            <AlertTriangle size={16} />
          </div>
          <h3 className="font-display text-2xl text-ink">{title}</h3>
        </div>

        <p className="text-sm text-ink/80">{description}</p>
        {warning ? (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{warning}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-ink/20 px-4 py-2 font-mono text-sm"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-red-600 px-4 py-2 font-mono text-sm text-white transition hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
