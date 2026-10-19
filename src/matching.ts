// Pure matching logic. No database or network access, so it is easy to test.
//
// Rules
//  - Needs are served in order of earliest deadline, then oldest first. Needs with no deadline go last.
//  - A need takes the cheapest listings first. Listings with no price come after priced ones.
//  - A listing is skipped when its price is above the need's maximum price.
//  - Expired listings and needs past their deadline are ignored.
//  - A pair listed in `blocked` is never suggested again (used after a cancelled match).

export type NeedIn = {
  id: number;
  product: string;
  qty: number;            // kg still unfilled
  maxPrice: number | null;
  neededBy: string | null; // YYYY-MM-DD
  createdAt: number;       // epoch ms, for tie-breaking
};

export type ListingIn = {
  id: number;
  product: string;
  qty: number;            // kg still unsold
  price: number | null;
  availableUntil: string | null; // YYYY-MM-DD
};

export type Alloc = { needId: number; listingId: number; qty: number };

export type MatchResult = {
  allocs: Alloc[];
  gap: Map<number, number>;       // need id -> kg still unfilled
  leftover: Map<number, number>;  // listing id -> kg still unsold
};

export const pairKey = (needId: number, listingId: number) => `${needId}:${listingId}`;

export function computeMatches(
  needs: NeedIn[],
  listings: ListingIn[],
  today: string,
  blocked: Set<string> = new Set(),
): MatchResult {
  const left = new Map<number, number>();
  const byProduct = new Map<string, ListingIn[]>();
  for (const l of listings) {
    if (l.qty <= 0) continue;
    if (l.availableUntil && l.availableUntil < today) continue;
    left.set(l.id, l.qty);
    if (!byProduct.has(l.product)) byProduct.set(l.product, []);
    byProduct.get(l.product)!.push(l);
  }
  for (const list of byProduct.values()) {
    list.sort((a, b) => priceRank(a.price) - priceRank(b.price) || a.id - b.id);
  }

  const ordered = [...needs]
    .filter((n) => n.qty > 0 && !(n.neededBy && n.neededBy < today))
    .sort((a, b) => (a.neededBy ?? "9999-12-31").localeCompare(b.neededBy ?? "9999-12-31") || a.createdAt - b.createdAt || a.id - b.id);

  const allocs: Alloc[] = [];
  const gap = new Map<number, number>();
  for (const n of needs) gap.set(n.id, n.qty);

  for (const n of ordered) {
    let remaining = n.qty;
    for (const l of byProduct.get(n.product) ?? []) {
      if (remaining <= 0) break;
      if (blocked.has(pairKey(n.id, l.id))) continue;
      if (n.maxPrice != null && l.price != null && l.price > n.maxPrice) continue;
      const available = left.get(l.id) ?? 0;
      const take = Math.min(remaining, available);
      if (take <= 0) continue;
      left.set(l.id, round2(available - take));
      remaining = round2(remaining - take);
      allocs.push({ needId: n.id, listingId: l.id, qty: take });
    }
    gap.set(n.id, remaining);
  }
  return { allocs, gap, leftover: left };
}

const priceRank = (p: number | null) => (p == null ? Number.MAX_SAFE_INTEGER : p);
const round2 = (n: number) => Math.round(n * 100) / 100;
