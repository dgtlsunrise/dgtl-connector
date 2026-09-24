import { invalidRequest } from "./validate";

export const EMPTY_LIST_HINT =
  "Empty list is not an auth failure; check this Google account has access and the parent id.";

export function readPage(
  url: URL,
): { readonly pageSize: number; readonly pageToken: string | undefined } | Response {
  const rawSize = url.searchParams.get("page_size");
  let pageSize = 50;
  if (rawSize !== null && rawSize.length > 0) {
    if (!/^[0-9]+$/.test(rawSize)) {
      return invalidRequest("page_size must be an integer from 1 to 200.");
    }
    pageSize = Number(rawSize);
    if (pageSize < 1 || pageSize > 200) {
      return invalidRequest("page_size must be an integer from 1 to 200.");
    }
  }
  const rawToken = url.searchParams.get("page_token");
  if (rawToken === null || rawToken.length === 0) {
    return { pageSize, pageToken: undefined };
  }
  if (rawToken.length > 2048 || /[\u0000-\u001F]/.test(rawToken)) {
    return invalidRequest("page_token is not valid.");
  }
  return { pageSize, pageToken: rawToken };
}

export function slicePage<T>(
  items: readonly T[],
  pageSize: number,
  pageToken: string | undefined,
): { readonly items: readonly T[]; readonly next: string | undefined } | Response {
  let offset = 0;
  if (pageToken !== undefined) {
    if (!/^[0-9]+$/.test(pageToken)) {
      return invalidRequest("page_token must be a numeric offset for this list.");
    }
    offset = Number(pageToken);
  }
  const slice = items.slice(offset, offset + pageSize);
  const next = offset + slice.length < items.length ? String(offset + slice.length) : undefined;
  return { items: slice, next };
}

export function listBody(
  collection: string,
  items: readonly unknown[],
  next: string | undefined,
  hint: string | undefined,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { [collection]: [...items], ...extra };
  if (next !== undefined) {
    body["next_page_token"] = next;
  }
  if (hint !== undefined) {
    body["hint"] = hint;
  }
  return body;
}
