import { json } from "./http";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function invalidRequest(message: string): Response {
  return json({ error: "invalid_request", message }, 400);
}

export function unsupportedDimension(message: string): Response {
  return json({ error: "unsupported_dimension", message }, 400);
}

export function unsupportedField(message: string): Response {
  return json({ error: "unsupported_field", message }, 400);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return invalidRequest("The body must be a JSON object.");
  }
  if (!isRecord(value)) {
    return invalidRequest("The body must be a JSON object.");
  }
  return value;
}

export function requireDigits(value: string | undefined, field: string): string | Response {
  if (value === undefined || !/^[0-9]{1,20}$/.test(value)) {
    return invalidRequest(`${field} must be digits.`);
  }
  return value;
}

export function extraKeys(record: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(record).filter((key) => !allowed.includes(key));
}

export function readInt(
  value: unknown,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number | Response {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return invalidRequest(`${field} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export function readNames(value: unknown, field: string, max: number): string[] | Response {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > max) {
    return invalidRequest(`${field} must be an array of at most ${max} names.`);
  }
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !/^[A-Za-z][A-Za-z0-9_:]{0,80}$/.test(item)) {
      return invalidRequest(`${field} names must be API identifiers.`);
    }
    names.push(item);
  }
  return names;
}

export function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
