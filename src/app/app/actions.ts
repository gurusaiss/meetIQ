'use server';

import { revalidatePath } from 'next/cache';
import { requireMerchant, describeAuthError } from '@/modules/auth/session-server';
import {
  createCatalogGroup,
  createCatalogItem,
  createOffer,
  deleteCatalogGroup,
  deleteCatalogItem,
  deleteMedia,
  deleteOffer,
  getCatalogItem,
  getOffer,
  renameCatalogGroup,
  replaceHours,
  updateAiConfig,
  updateCatalogItem,
  updateOffer,
  updateProfile,
  updateQrPrintPrefs,
} from '@/modules/merchants/content';
import { publishTenant, unpublishTenant } from '@/modules/merchants/tenants';
import { primarySlugFor } from '@/modules/merchants/slugs';
import { parseMoneyToMinor } from '@/modules/core/money';
import { acknowledgeDomainChange } from '@/modules/platform/settings';
import { ingestImage } from '@/modules/media/upload';

export type FormState = { error?: string; success?: string };

/**
 * Every action re-derives the tenant from the session. Nothing here reads a
 * tenant id from the submitted form.
 */
async function revalidateMerchant(tenantId: string): Promise<void> {
  const slug = await primarySlugFor(tenantId);
  revalidatePath('/app');
  if (slug) revalidatePath(`/m/${slug}`);
}

function optional(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

/**
 * Photo upload is optional everywhere it appears (catalog items, offers): a
 * merchant may add one, replace one, remove one, or leave it alone entirely.
 * Returns `{}` (no key at all) when nothing changed, so a partial `update*`
 * call never accidentally wipes an existing photo just because this form
 * submission didn't touch it.
 */
async function resolvePhotoPatch(
  tenantId: string,
  formData: FormData,
  kind: 'catalog' | 'offer',
  altText: string,
): Promise<{ mediaId?: string | null }> {
  const file = formData.get('photo');
  if (file instanceof File && file.size > 0) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { mediaId } = await ingestImage({ tenantId, buffer, kind, altText });
    return { mediaId };
  }
  if (formData.get('removePhoto') === 'on') return { mediaId: null };
  return {};
}

/** The discount's own "price" (how much off, or what %) - independent of the free-text title/description. */
function resolveDiscount(formData: FormData): {
  discountType: 'percent' | 'flat' | 'bogo' | 'custom';
  discountValueMinor: number | null;
  discountPercent: number | null;
} {
  const raw = String(formData.get('discountType') ?? 'custom');
  const discountType = (['percent', 'flat', 'bogo', 'custom'] as const).includes(raw as never)
    ? (raw as 'percent' | 'flat' | 'bogo' | 'custom')
    : 'custom';
  const valueText = String(formData.get('discountValue') ?? '');
  const percentText = String(formData.get('discountPercent') ?? '');
  return {
    discountType,
    discountValueMinor: discountType === 'flat' && valueText ? parseMoneyToMinor(valueText) : null,
    discountPercent: discountType === 'percent' && percentText ? Number(percentText) : null,
  };
}

export async function saveProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('profile:write');
    await updateProfile(tenantId, {
      displayName: String(formData.get('displayName') ?? '').trim(),
      tagline: optional(formData.get('tagline')),
      description: optional(formData.get('description')),
      phone: optional(formData.get('phone')),
      whatsapp: optional(formData.get('whatsapp')),
      email: optional(formData.get('email')),
      websiteUrl: optional(formData.get('websiteUrl')),
      addressLine1: optional(formData.get('addressLine1')),
      addressLine2: optional(formData.get('addressLine2')),
      city: optional(formData.get('city')),
      state: optional(formData.get('state')),
      pincode: optional(formData.get('pincode')),
      googleMapsUrl: optional(formData.get('googleMapsUrl')),
      gbpReviewUrl: optional(formData.get('gbpReviewUrl')),
      accentColor: optional(formData.get('accentColor')),
    });
    await revalidateMerchant(tenantId);
    return { success: 'Saved. Your page is updated.' };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function saveHoursAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('hours:write');
    const rows = [];
    for (let day = 0; day < 7; day++) {
      const closed = formData.get(`closed_${day}`) === 'on';
      const opensAt = String(formData.get(`opens_${day}`) ?? '');
      const closesAt = String(formData.get(`closes_${day}`) ?? '');
      if (closed || !opensAt || !closesAt) {
        rows.push({ dayOfWeek: day, opensAt: null, closesAt: null, isClosed: true });
      } else {
        rows.push({ dayOfWeek: day, opensAt, closesAt, isClosed: false });
      }
    }
    await replaceHours(tenantId, rows);
    await revalidateMerchant(tenantId);
    return { success: 'Opening hours saved.' };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function createCatalogItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('catalog:write');
    const priceText = String(formData.get('price') ?? '');
    const maxPriceText = String(formData.get('priceMax') ?? '');
    const duration = String(formData.get('durationMinutes') ?? '');
    const minQty = String(formData.get('minOrderQty') ?? '');
    const kind = formData.get('kind') === 'product' ? 'product' : 'service';
    const name = String(formData.get('name') ?? '').trim();
    const priceOnRequest = formData.get('priceOnRequest') === 'on';
    const groupId = optional(formData.get('groupId'));
    // Name and price are the only two things every item truly needs - a price
    // is skippable only via the explicit "price on request" toggle, never by
    // silently leaving the field blank.
    if (!priceOnRequest && !priceText) {
      return { error: 'Enter a price, or turn on "Price on request".' };
    }
    const photoPatch = await resolvePhotoPatch(tenantId, formData, 'catalog', name);

    await createCatalogItem(tenantId, {
      kind,
      name,
      description: optional(formData.get('description')),
      priceMinor: !priceOnRequest && priceText ? parseMoneyToMinor(priceText) : null,
      priceMaxMinor: !priceOnRequest && maxPriceText ? parseMoneyToMinor(maxPriceText) : null,
      priceUnit: optional(formData.get('priceUnit')),
      durationMinutes: kind === 'service' && duration ? Number(duration) : null,
      minOrderQty: minQty ? Number(minQty) : null,
      groupId,
      ...photoPatch,
    });
    await revalidateMerchant(tenantId);
    return { success: 'Added to your page.' };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function updateCatalogItemAction(
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('catalog:write');
    const existing = await getCatalogItem(tenantId, itemId);
    if (!existing) return { error: 'That item was not found - it may have been removed.' };

    const priceText = String(formData.get('price') ?? '');
    const maxPriceText = String(formData.get('priceMax') ?? '');
    const duration = String(formData.get('durationMinutes') ?? '');
    const minQty = String(formData.get('minOrderQty') ?? '');
    const stockStatus = String(formData.get('stockStatus') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const priceOnRequest = formData.get('priceOnRequest') === 'on';
    const groupId = optional(formData.get('groupId'));
    if (!priceOnRequest && !priceText) {
      return { error: 'Enter a price, or turn on "Price on request".' };
    }
    const photoPatch = await resolvePhotoPatch(tenantId, formData, 'catalog', name);

    await updateCatalogItem(tenantId, itemId, {
      name,
      description: optional(formData.get('description')),
      priceMinor: !priceOnRequest && priceText ? parseMoneyToMinor(priceText) : null,
      priceMaxMinor: !priceOnRequest && maxPriceText ? parseMoneyToMinor(maxPriceText) : null,
      priceUnit: optional(formData.get('priceUnit')),
      durationMinutes: existing.kind === 'service' && duration ? Number(duration) : null,
      minOrderQty: existing.kind === 'product' && minQty ? Number(minQty) : null,
      stockStatus: (['in_stock', 'low', 'out', 'made_to_order'] as const).includes(stockStatus as never)
        ? (stockStatus as 'in_stock' | 'low' | 'out' | 'made_to_order')
        : null,
      groupId,
      ...photoPatch,
    });
    await revalidateMerchant(tenantId);
    return { success: 'Saved.' };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function toggleCatalogItemAction(itemId: string, isAvailable: boolean): Promise<void> {
  const { tenantId } = await requireMerchant('catalog:toggle');
  await updateCatalogItem(tenantId, itemId, { isAvailable });
  await revalidateMerchant(tenantId);
}

export async function deleteCatalogItemAction(itemId: string): Promise<void> {
  const { tenantId } = await requireMerchant('catalog:write');
  await deleteCatalogItem(tenantId, itemId);
  await revalidateMerchant(tenantId);
}

export async function createCatalogGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('catalog:write');
    const name = String(formData.get('name') ?? '').trim();
    await createCatalogGroup(tenantId, { name });
    await revalidateMerchant(tenantId);
    return { success: 'Category added.' };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function renameCatalogGroupAction(
  groupId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('catalog:write');
    const name = String(formData.get('name') ?? '').trim();
    await renameCatalogGroup(tenantId, groupId, { name });
    await revalidateMerchant(tenantId);
    return { success: 'Saved.' };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function deleteCatalogGroupAction(groupId: string): Promise<void> {
  const { tenantId } = await requireMerchant('catalog:write');
  await deleteCatalogGroup(tenantId, groupId);
  await revalidateMerchant(tenantId);
}

export async function createOfferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('offers:write');
    const preset = String(formData.get('preset') ?? 'custom');
    const now = new Date();

    let startsAt: Date | null = null;
    let endsAt: Date | null = null;
    if (preset === 'today') {
      startsAt = now;
      endsAt = new Date(now.getTime() + 86_400_000);
    } else if (preset === 'week') {
      startsAt = now;
      endsAt = new Date(now.getTime() + 7 * 86_400_000);
    } else if (preset === 'month') {
      startsAt = now;
      endsAt = new Date(now.getTime() + 30 * 86_400_000);
    } else {
      const from = String(formData.get('startsAt') ?? '');
      const to = String(formData.get('endsAt') ?? '');
      startsAt = from ? new Date(from) : null;
      endsAt = to ? new Date(to) : null;
    }

    const weekendOnly = formData.get('weekendOnly') === 'on';
    const title = String(formData.get('title') ?? '').trim();
    const photoPatch = await resolvePhotoPatch(tenantId, formData, 'offer', title);

    await createOffer(tenantId, {
      title,
      description: optional(formData.get('description')),
      terms: optional(formData.get('terms')),
      couponCode: optional(formData.get('couponCode')),
      ...resolveDiscount(formData),
      startsAt,
      endsAt,
      activeWeekdays: weekendOnly ? [0, 6] : null,
      isPublished: formData.get('isPublished') === 'on',
      ctaType: 'call',
      ...photoPatch,
    });
    await revalidateMerchant(tenantId);
    return { success: 'Offer created.' };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function updateOfferAction(offerId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('offers:write');
    const existing = await getOffer(tenantId, offerId);
    if (!existing) return { error: 'That offer was not found - it may have been removed.' };

    const preset = String(formData.get('preset') ?? 'custom');
    const now = new Date();
    let startsAt: Date | null = null;
    let endsAt: Date | null = null;
    if (preset === 'today') {
      startsAt = now;
      endsAt = new Date(now.getTime() + 86_400_000);
    } else if (preset === 'week') {
      startsAt = now;
      endsAt = new Date(now.getTime() + 7 * 86_400_000);
    } else if (preset === 'month') {
      startsAt = now;
      endsAt = new Date(now.getTime() + 30 * 86_400_000);
    } else {
      const from = String(formData.get('startsAt') ?? '');
      const to = String(formData.get('endsAt') ?? '');
      startsAt = from ? new Date(from) : null;
      endsAt = to ? new Date(to) : null;
    }
    const weekendOnly = formData.get('weekendOnly') === 'on';
    const title = String(formData.get('title') ?? '').trim();
    const photoPatch = await resolvePhotoPatch(tenantId, formData, 'offer', title);

    await updateOffer(tenantId, offerId, {
      title,
      description: optional(formData.get('description')),
      terms: optional(formData.get('terms')),
      couponCode: optional(formData.get('couponCode')),
      ...resolveDiscount(formData),
      startsAt,
      endsAt,
      activeWeekdays: weekendOnly ? [0, 6] : null,
      isPublished: formData.get('isPublished') === 'on',
      ...photoPatch,
    });
    await revalidateMerchant(tenantId);
    return { success: 'Saved.' };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function toggleOfferAction(offerId: string, isPublished: boolean): Promise<void> {
  const { tenantId } = await requireMerchant('offers:write');
  await updateOffer(tenantId, offerId, { isPublished });
  await revalidateMerchant(tenantId);
}

export async function deleteOfferAction(offerId: string): Promise<void> {
  const { tenantId } = await requireMerchant('offers:write');
  await deleteOffer(tenantId, offerId);
  await revalidateMerchant(tenantId);
}

export async function publishAction(): Promise<void> {
  const { tenantId, session } = await requireMerchant('profile:write');
  await publishTenant(tenantId, session.userId);
  await revalidateMerchant(tenantId);
}

export async function unpublishAction(): Promise<void> {
  const { tenantId, session } = await requireMerchant('profile:write');
  await unpublishTenant(tenantId, session.userId);
  await revalidateMerchant(tenantId);
}

/** Several photos can be picked in one go; each is ingested on its own so one bad file doesn't block the rest. */
export async function uploadPhotoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('media:write');
    const files = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: 'Choose a photo to upload.' };

    const altText = optional(formData.get('altText'));
    const failures: string[] = [];
    let succeeded = 0;
    for (const file of files) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        await ingestImage({ tenantId, buffer, kind: 'gallery', altText });
        succeeded += 1;
      } catch (error) {
        failures.push(`${file.name || 'a photo'}: ${describeAuthError(error)}`);
      }
    }
    await revalidateMerchant(tenantId);

    if (failures.length === 0) {
      return { success: succeeded === 1 ? 'Photo added to your page.' : `${succeeded} photos added to your page.` };
    }
    if (succeeded === 0) return { error: failures.join('; ') };
    return { success: `${succeeded} photo(s) added. Some failed: ${failures.join('; ')}` };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function deletePhotoAction(mediaId: string): Promise<void> {
  const { tenantId } = await requireMerchant('media:write');
  await deleteMedia(tenantId, mediaId);
  await revalidateMerchant(tenantId);
}

export async function saveAiConfigAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('ai:configure');
    await updateAiConfig(tenantId, {
      isEnabled: formData.get('isEnabled') === 'on',
      extraInstructions: optional(formData.get('extraInstructions')),
    });
    await revalidateMerchant(tenantId);
    return { success: 'Saved.' };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function saveQrPrefsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenantId } = await requireMerchant('qr:download');
    await updateQrPrintPrefs(tenantId, {
      showName: formData.get('showName') === 'on',
      showTagline: formData.get('showTagline') === 'on',
      showAddress: formData.get('showAddress') === 'on',
      showPhone: formData.get('showPhone') === 'on',
      callToAction: optional(formData.get('callToAction')),
    });
    return { success: 'Saved. Your next download will use these.' };
  } catch (error) {
    return { error: describeAuthError(error) };
  }
}

export async function acknowledgeDomainChangeAction(): Promise<void> {
  const { tenantId } = await requireMerchant('profile:read');
  await acknowledgeDomainChange(tenantId);
  await revalidateMerchant(tenantId);
}
