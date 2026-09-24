export type MintedGrant = {
  v: 1;
  grant_id: string;
  created_at: string;
  status: "active";
  google: null;
};

export type Mint = {
  token: string;
  hash: string;
  grant: MintedGrant;
  putCommand: string;
};

export function createMint(now?: Date): Mint;

export function formatMint(minted: Mint): string;
