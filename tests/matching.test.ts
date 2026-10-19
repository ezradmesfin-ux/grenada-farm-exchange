import { expect, test } from "bun:test";
import { computeMatches, pairKey, type ListingIn, type NeedIn } from "../src/matching.ts";

const TODAY = "2026-10-19";
const need = (o: Partial<NeedIn> & { id: number }): NeedIn => ({ product: "Tomatoes", qty: 100, maxPrice: null, neededBy: null, createdAt: o.id, ...o });
const lot = (o: Partial<ListingIn> & { id: number }): ListingIn => ({ product: "Tomatoes", qty: 100, price: null, availableUntil: null, ...o });

test("fills a need from the cheapest listing first", () => {
  const r = computeMatches([need({ id: 1, qty: 150 })], [lot({ id: 10, price: 3 }), lot({ id: 11, price: 2 })], TODAY);
  expect(r.allocs).toEqual([
    { needId: 1, listingId: 11, qty: 100 },
    { needId: 1, listingId: 10, qty: 50 },
  ]);
  expect(r.gap.get(1)).toBe(0);
  expect(r.leftover.get(10)).toBe(50);
});

test("earliest deadline is served first when supply is short", () => {
  const r = computeMatches(
    [need({ id: 1, neededBy: "2026-12-01" }), need({ id: 2, neededBy: "2026-11-01" })],
    [lot({ id: 10, qty: 100 })],
    TODAY,
  );
  expect(r.allocs).toEqual([{ needId: 2, listingId: 10, qty: 100 }]);
  expect(r.gap.get(1)).toBe(100);
  expect(r.gap.get(2)).toBe(0);
});

test("needs without a deadline go last", () => {
  const r = computeMatches([need({ id: 1 }), need({ id: 2, neededBy: "2027-01-01" })], [lot({ id: 10 })], TODAY);
  expect(r.allocs[0]!.needId).toBe(2);
});

test("respects the maximum price but allows unpriced listings", () => {
  const r = computeMatches(
    [need({ id: 1, qty: 50, maxPrice: 2.5 })],
    [lot({ id: 10, price: 3 }), lot({ id: 11, price: null }), lot({ id: 12, price: 2 })],
    TODAY,
  );
  expect(r.allocs.map((a) => a.listingId)).toEqual([12]);
  expect(r.gap.get(1)).toBe(0);
});

test("unpriced listings are used after priced ones", () => {
  const r = computeMatches([need({ id: 1, qty: 150 })], [lot({ id: 10, price: null }), lot({ id: 11, price: 4 })], TODAY);
  expect(r.allocs.map((a) => a.listingId)).toEqual([11, 10]);
});

test("ignores other products, expired listings and past deadlines", () => {
  const r = computeMatches(
    [need({ id: 1, product: "Cabbage" }), need({ id: 2, neededBy: "2026-10-01" })],
    [lot({ id: 10 }), lot({ id: 11, availableUntil: "2026-10-18" })],
    TODAY,
  );
  expect(r.allocs).toEqual([]);
  expect(r.gap.get(1)).toBe(100);
  expect(r.leftover.has(11)).toBe(false);
});

test("a blocked pair is not suggested again", () => {
  const r = computeMatches([need({ id: 1, qty: 80 })], [lot({ id: 10, price: 1 }), lot({ id: 11, price: 2 })], TODAY, new Set([pairKey(1, 10)]));
  expect(r.allocs).toEqual([{ needId: 1, listingId: 11, qty: 80 }]);
});

test("handles decimal kilograms without drift", () => {
  const r = computeMatches([need({ id: 1, qty: 0.3 }), need({ id: 2, qty: 0.2 })], [lot({ id: 10, qty: 0.5 })], TODAY);
  expect(r.gap.get(1)).toBe(0);
  expect(r.gap.get(2)).toBe(0);
  expect(r.leftover.get(10)).toBe(0);
});

test("no supply leaves every need as a gap", () => {
  const r = computeMatches([need({ id: 1 }), need({ id: 2, qty: 40 })], [], TODAY);
  expect(r.allocs).toEqual([]);
  expect(r.gap.get(2)).toBe(40);
});
