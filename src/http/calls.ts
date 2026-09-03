export type HttpCall = {
  method: string;
  host: string;
  path: string;
  search: string;
  headerNames: string[];
  hasAuthorization: boolean;
  hasDeveloperToken: boolean;
};

export function headerMap(headers?: Headers | Record<string, string> | string[][]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      const k = pair[0];
      const v = pair[1];
      if (k && v) out[k.toLowerCase()] = v;
    }
    return out;
  }
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}
