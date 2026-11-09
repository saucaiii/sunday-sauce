import { test } from "node:test";
import assert from "node:assert/strict";
import { price, pctSigned, pctArrow, pctMagnitude } from "../src/lib/format.js";

/**
 * The two surfaces must round identically and may present the sign
 * differently. Asserting the strings are equal would be wrong — Telegram
 * renders "+1.42%" into a monospaced column and the overlay renders "▲ 1.42%"
 * for a viewer ten feet from a screen. What must never diverge is the number.
 */

const CASES = [
  { n: 94231.5,   price: "$94,232" },
  { n: 3182.4444, price: "$3,182" },
  { n: 1000,      price: "$1,000" },
  { n: 999.994,   price: "$999.99" },
  { n: 188.215,   price: "$188.22" },
  { n: 1,         price: "$1.00" },
  { n: 0.9999,    price: "$0.9999" },
  { n: 0.0314159, price: "$0.0314" },
  { n: 0.01,      price: "$0.0100" },
  // The branch the overlay used to be missing entirely: below a cent it
  // rendered four decimals where the Telegram post rendered six.
  { n: 0.0099999, price: "$0.010000" },
  { n: 0.00004231, price: "$0.000042" },
];

for (const c of CASES) {
  test(`price ${c.n} renders ${c.price}`, () => {
    assert.equal(price(c.n), c.price);
  });
}

const PCTS = [1.42, -1.42, 0, 0.004, -0.004, 12.5, -99.999, 100];

for (const n of PCTS) {
  test(`both surfaces round ${n} to the same magnitude`, () => {
    const telegram = pctSigned(n);
    const overlay = pctArrow(n);
    const magnitude = pctMagnitude(n);

    // Each renderer contains the shared magnitude verbatim.
    assert.ok(telegram.includes(magnitude), `${telegram} lacks ${magnitude}`);
    assert.ok(overlay.includes(magnitude), `${overlay} lacks ${magnitude}`);

    // And they agree on direction.
    const telegramUp = !telegram.startsWith("-");
    const overlayUp = overlay.startsWith("▲");
    assert.equal(telegramUp, overlayUp, `${telegram} vs ${overlay} disagree on sign`);
  });
}

test("telegram signs positives explicitly so a column lines up", () => {
  assert.equal(pctSigned(1.42), "+1.42%");
  assert.equal(pctSigned(-1.42), "-1.42%");
});

test("overlay uses arrows and never a minus sign", () => {
  assert.equal(pctArrow(1.42), "▲ 1.42%");
  assert.equal(pctArrow(-1.42), "▼ 1.42%");
  assert.ok(!pctArrow(-1.42).includes("-"));
});

test("zero counts as up on both, rather than rendering a bare 0", () => {
  assert.equal(pctSigned(0), "+0.00%");
  assert.equal(pctArrow(0), "▲ 0.00%");
});
