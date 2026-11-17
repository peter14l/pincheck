export const GALLERY_PAGE_SIZE = 12;
export const MAX_GALLERY_PAGE = 10_000;
export const GALLERY_QUERY_MAX_LENGTH = 100;

export type GallerySearchParams = {
  q?: string | string[];
  page?: string | string[];
};

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Trim the search term and keep it within a safe length. */
export function normalizeGalleryQuery(
  value: string | string[] | undefined,
): string {
  return firstValue(value).trim().slice(0, GALLERY_QUERY_MAX_LENGTH);
}

/**
 * Parse a page search param without trusting it. Missing, malformed,
 * negative, and oversized values fall back to (or are capped at) safe
 * bounds. The final upper bound is applied once the total count is known.
 */
export function parseGalleryPage(value: string | string[] | undefined): number {
  const raw = firstValue(value);
  if (!raw) return 1;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;

  return Math.min(parsed, MAX_GALLERY_PAGE);
}

export function galleryPageCount(totalCount: number): number {
  if (!Number.isFinite(totalCount) || totalCount <= 0) return 1;
  return Math.max(1, Math.ceil(totalCount / GALLERY_PAGE_SIZE));
}

/** Clamp a requested page to the range that actually contains results. */
export function clampGalleryPage(page: number, totalCount: number): number {
  const safePage = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(safePage, 1), galleryPageCount(totalCount));
}

/** Build a gallery URL while preserving the active search query. */
export function galleryHref({
  page = 1,
  query = "",
}: {
  page?: number;
  query?: string;
}): string {
  const params = new URLSearchParams();
  const normalizedQuery = query.trim().slice(0, GALLERY_QUERY_MAX_LENGTH);

  if (normalizedQuery) params.set("q", normalizedQuery);
  if (page > 1) params.set("page", String(page));

  const search = params.toString();
  return search ? `/gallery?${search}` : "/gallery";
}
