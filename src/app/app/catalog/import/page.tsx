import { requireMerchant } from '@/modules/auth/session-server';
import { PageHeader } from '@/components/ui';
import { ImportWizard } from './import-wizard';

export const metadata = { title: 'Import your menu' };

export default async function CatalogImportPage() {
  await requireMerchant('catalog:write');

  return (
    <div>
      <PageHeader
        title="Import your menu"
        description="Upload a spreadsheet, PDF, Word document, or a photo of your price list — we'll read it and fill in your menu for you."
      />
      <ImportWizard />
    </div>
  );
}
