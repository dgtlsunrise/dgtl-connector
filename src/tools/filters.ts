import { ToolError } from "../errors.js";

/**
 * Closed FilterExpression subset (D9). additionalProperties false at schema layer;
 * unknown keys here are INVALID_ARGUMENT, never passed through to Google.
 */

type Json = Record<string, unknown>;

const STRING_MATCH = new Set([
  "EXACT",
  "BEGINS_WITH",
  "ENDS_WITH",
  "CONTAINS",
  "FULL_REGEXP",
  "PARTIAL_REGEXP",
]);

const NUMERIC_OP = new Set([
  "EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
]);

function asObj(v: unknown, ctx: string): Json {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new ToolError("INVALID_ARGUMENT", `${ctx} must be an object`);
  }
  return v as Json;
}

export function compileFilterExpression(input: unknown): unknown {
  if (input === undefined || input === null) return undefined;
  return compile(input, "filter");
}

function compile(input: unknown, ctx: string): unknown {
  const obj = asObj(input, ctx);
  const keys = Object.keys(obj);
  if (keys.length === 1 && keys[0] === "and") {
    const arr = obj.and;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new ToolError("INVALID_ARGUMENT", `${ctx}.and must be a non-empty array`);
    }
    return { andGroup: { expressions: arr.map((x, i) => compile(x, `${ctx}.and[${i}]`)) } };
  }
  if (keys.length === 1 && keys[0] === "or") {
    const arr = obj.or;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new ToolError("INVALID_ARGUMENT", `${ctx}.or must be a non-empty array`);
    }
    return { orGroup: { expressions: arr.map((x, i) => compile(x, `${ctx}.or[${i}]`)) } };
  }
  if (keys.length === 1 && keys[0] === "not") {
    return { notExpression: compile(obj.not, `${ctx}.not`) };
  }
  if ("string_filter" in obj || "in_list" in obj || "numeric_filter" in obj) {
    const field = obj.field;
    if (typeof field !== "string" || !field) {
      throw new ToolError("INVALID_ARGUMENT", `${ctx} leaf filter requires field`);
    }
    const extra = keys.filter((k) => !["field", "string_filter", "in_list", "numeric_filter"].includes(k));
    if (extra.length) {
      throw new ToolError("INVALID_ARGUMENT", `${ctx} unknown keys: ${extra.join(", ")}`);
    }
    if (obj.string_filter) {
      const sf = asObj(obj.string_filter, `${ctx}.string_filter`);
      const match = String(sf.match_type ?? "EXACT");
      if (!STRING_MATCH.has(match)) {
        throw new ToolError("INVALID_ARGUMENT", `unknown string_filter.match_type ${match}`);
      }
      if (typeof sf.value !== "string") {
        throw new ToolError("INVALID_ARGUMENT", "string_filter.value is required");
      }
      return {
        filter: {
          fieldName: field,
          stringFilter: {
            matchType: match,
            value: sf.value,
            caseSensitive: Boolean(sf.case_sensitive),
          },
        },
      };
    }
    if (obj.in_list) {
      const il = asObj(obj.in_list, `${ctx}.in_list`);
      if (!Array.isArray(il.values) || il.values.length === 0) {
        throw new ToolError("INVALID_ARGUMENT", "in_list.values required");
      }
      return {
        filter: {
          fieldName: field,
          inListFilter: {
            values: il.values.map(String),
            caseSensitive: Boolean(il.case_sensitive),
          },
        },
      };
    }
    if (obj.numeric_filter) {
      const nf = asObj(obj.numeric_filter, `${ctx}.numeric_filter`);
      const op = String(nf.operation ?? "EQUAL");
      if (!NUMERIC_OP.has(op)) {
        throw new ToolError("INVALID_ARGUMENT", `unknown numeric_filter.operation ${op}`);
      }
      const value = compileNumericValue(nf.value, `${ctx}.numeric_filter.value`);
      return {
        filter: {
          fieldName: field,
          numericFilter: { operation: op, value },
        },
      };
    }
  }
  throw new ToolError(
    "INVALID_ARGUMENT",
    `${ctx} is not a closed FilterExpression (and/or/not/string_filter/in_list/numeric_filter)`,
  );
}

function compileNumericValue(v: unknown, ctx: string): { int64Value?: string; doubleValue?: number } {
  if (v === undefined || v === null) {
    throw new ToolError("INVALID_ARGUMENT", `${ctx} required`);
  }
  if (typeof v === "number") {
    return Number.isInteger(v) ? { int64Value: String(v) } : { doubleValue: v };
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Json;
    if (typeof o.int64 === "string" || typeof o.int64 === "number") return { int64Value: String(o.int64) };
    if (typeof o.double === "number") return { doubleValue: o.double };
  }
  if (typeof v === "string" && /^-?\d+$/.test(v)) return { int64Value: v };
  throw new ToolError("INVALID_ARGUMENT", `${ctx} must be int64 or double`);
}

export function compileOrderBys(input: unknown): unknown[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) {
    throw new ToolError("INVALID_ARGUMENT", "order_bys must be an array");
  }
  return input.map((item, i) => {
    const obj = asObj(item, `order_bys[${i}]`);
    const extra = Object.keys(obj).filter((k) => !["field", "kind", "desc"].includes(k));
    if (extra.length) {
      throw new ToolError("INVALID_ARGUMENT", `order_bys[${i}] unknown keys: ${extra.join(", ")}`);
    }
    if (typeof obj.field !== "string" || !obj.field) {
      throw new ToolError("INVALID_ARGUMENT", `order_bys[${i}].field required`);
    }
    const kind = obj.kind === "metric" ? "metric" : "dimension";
    const desc = Boolean(obj.desc);
    if (kind === "metric") {
      return { metric: { metricName: obj.field }, desc };
    }
    return { dimension: { dimensionName: obj.field }, desc };
  });
}
