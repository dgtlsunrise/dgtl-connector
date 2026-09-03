export type Flags = {
  gbpEnabled: boolean;
};

export function loadFlags(env: NodeJS.ProcessEnv = process.env): Flags {
  const raw = (env.DGTL_GBP_ENABLED || env.GBP_ENABLED || "false").toLowerCase();
  return { gbpEnabled: raw === "1" || raw === "true" || raw === "yes" };
}
