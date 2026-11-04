'use client';

import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, SuccessText } from '@/components/ui';
import { confirmImportAction, parseImportAction, type DraftRow, type ImportFormState } from './actions';

const initial: ImportFormState = {};

type Row = DraftRow & { include: boolean };

export function ImportWizard() {
  const [state, action, parsing] = useActionState(parseImportAction, initial);
  const [kind, setKind] = useState<'service' | 'product'>('service');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [confirmPending, startConfirm] = useTransition();
  const [confirmResult, setConfirmResult] = useState<{ error?: string; success?: string }>({});

  // Only re-seed rows when the SERVER ACTION produced a genuinely new result
  // (a fresh upload), not merely because local `rows` was cleared by "Start
  // over" - useActionState's state otherwise stays around as stale data and
  // would silently undo "Start over" by re-populating from the old parse.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.rows) setRows(state.rows.map((r) => ({ ...r, include: true })));
  }

  function updateRow(index: number, patch: Partial<Row>): void {
    setRows((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev));
  }

  function startOver(): void {
    setRows(null);
    setConfirmResult({});
  }

  if (!rows) {
    return (
      <form action={action} className="card space-y-4 p-4">
        <ErrorText>{state.error}</ErrorText>

        <Field label="These are">
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as 'service' | 'product')}>
            <option value="service">Services (haircut, repair, consultation…)</option>
            <option value="product">Products (items you sell)</option>
          </Select>
        </Field>

        <Field
          label="Upload your price list"
          hint="Excel, CSV, PDF, Word, or a clear photo — up to 10 MB"
        >
          <Input
            name="file"
            type="file"
            accept=".xlsx,.xls,.csv,.pdf,.docx,image/*"
            required
          />
        </Field>

        <Button type="submit" disabled={parsing} className="w-full">
          {parsing ? 'Reading file…' : 'Read file'}
        </Button>

        <Link href="/app/catalog" className="block text-center text-[14px] text-ink-500 underline">
          Back to menu
        </Link>
      </form>
    );
  }

  const includedCount = rows.filter((r) => r.include).length;

  return (
    <div className="space-y-4">
      <ErrorText>{confirmResult.error}</ErrorText>
      <SuccessText>{confirmResult.success}</SuccessText>

      {!confirmResult.success && (
        <>
          <Card className="space-y-1 p-4">
            <p className="text-[14px] text-ink-700">
              Found <strong>{rows.length}</strong> item{rows.length === 1 ? '' : 's'}
              {state.sourceLabel ? ` from your ${state.sourceLabel}` : ''}.
              {state.skipped ? ` ${state.skipped} line${state.skipped === 1 ? '' : 's'} could not be read and were skipped.` : ''}
            </p>
            <p className="text-[13px] text-ink-500">
              Check each one below — fix anything that looks wrong, or uncheck a row to leave it out.
              Nothing is saved until you confirm.
            </p>
          </Card>

          <div className="space-y-2">
            {rows.map((row, i) => (
              <Card key={i} className={`p-3 ${row.include ? '' : 'opacity-50'}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={(e) => updateRow(i, { include: e.target.checked })}
                    className="mt-3 h-5 w-5 shrink-0"
                    aria-label={`Include ${row.name || 'this row'}`}
                  />
                  <div className="grid flex-1 grid-cols-2 gap-2">
                    <Input
                      value={row.name}
                      onChange={(e) => updateRow(i, { name: e.target.value })}
                      placeholder="Name"
                      className="col-span-2"
                      disabled={!row.include}
                    />
                    <Input
                      value={row.price}
                      onChange={(e) => updateRow(i, { price: e.target.value })}
                      placeholder="Price"
                      inputMode="decimal"
                      disabled={!row.include}
                    />
                    <Input
                      value={row.priceUnit}
                      onChange={(e) => updateRow(i, { priceUnit: e.target.value })}
                      placeholder="Unit (optional)"
                      disabled={!row.include}
                    />
                    <Input
                      value={row.description}
                      onChange={(e) => updateRow(i, { description: e.target.value })}
                      placeholder="Description (optional)"
                      className="col-span-2"
                      disabled={!row.include}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="sticky bottom-20 flex gap-2 rounded-[var(--radius-sm)] bg-[var(--surface)] p-2 shadow-[var(--shadow-card)]">
            <Button variant="secondary" className="flex-1" onClick={startOver} disabled={confirmPending}>
              Start over
            </Button>
            <Button
              className="flex-1"
              disabled={confirmPending || includedCount === 0}
              onClick={() =>
                startConfirm(async () => {
                  const result = await confirmImportAction(kind, rows.filter((r) => r.include));
                  setConfirmResult(result);
                })
              }
            >
              {confirmPending ? 'Adding…' : `Add ${includedCount} item${includedCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </>
      )}

      {confirmResult.success && (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={startOver}>
            Import more
          </Button>
          <Link href="/app/catalog" className="flex-1">
            <Button className="w-full">Go to my menu</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
