'use server';

import { revalidatePath } from 'next/cache';
import { requireMerchant, describeAuthError } from '@/modules/auth/session-server';
import { parseImportFile } from '@/modules/merchants/import';
import { createCatalogItem } from '@/modules/merchants/content';
import { primarySlugFor } from '@/modules/merchants/slugs';
import { parseMoneyToMinor } from '@/modules/core/money';

export type DraftRow = { name: string; price: string; description: string; priceUnit: string };

export type ImportFormState = {
  error?: string;
  success?: string;
  rows?: DraftRow[];
  skipped?: number;
  sourceLabel?: string;
};

async function revalidateMerchant(tenantId: string): Promise<void> {
  const slug = await primarySlugFor(tenantId);
  revalidatePath('/app/catalog');
  if (slug) revalidatePath(`/m/${slug}`);
}

const SOURCE_LABEL = {
  spreadsheet: 'spreadsheet',
  pdf: 'PDF',
  docx: 'Word document',
  image: 'photo (read with text recognition — double-check these carefully)',
} as const;

/** Step 1: upload a file, get back an editable draft - nothing is saved yet. */
export async function parseImportAction(_prev: ImportFormState, formData: FormData): Promise<ImportFormState> {
  await requireMerchant('catalog:write');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' };

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { rows, skipped, kind } = await parseImportFile(buffer, file.name, file.type);
    if (rows.length === 0) {
      return {
        error:
          'Could not find any items with a price in that file. Try a clearer file, or add items manually below.',
      };
    }
    return {
      skipped,
      sourceLabel: SOURCE_LABEL[kind],
      rows: rows.map((r) => ({
        name: r.name,
        price: r.priceMinor != null ? (r.priceMinor / 100).toString() : '',
        description: r.description ?? '',
        priceUnit: r.priceUnit ?? '',
      })),
    };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

/** Step 2: the merchant has reviewed/edited the draft - save whichever rows they kept. */
export async function confirmImportAction(
  kind: 'service' | 'product',
  rows: DraftRow[],
): Promise<{ error?: string; success?: string }> {
  const { tenantId } = await requireMerchant('catalog:write');

  let created = 0;
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    await createCatalogItem(tenantId, {
      kind,
      name,
      description: row.description.trim() || null,
      priceMinor: row.price.trim() ? parseMoneyToMinor(row.price.trim()) : null,
      priceMaxMinor: null,
      priceUnit: row.priceUnit.trim() || null,
    });
    created++;
  }

  if (created === 0) return { error: 'Nothing was kept to import.' };

  await revalidateMerchant(tenantId);
  return { success: `Added ${created} item${created === 1 ? '' : 's'} to your menu.` };
}
