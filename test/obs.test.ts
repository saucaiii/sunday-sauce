import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRundown } from "../src/lib/broadcast.js";
import { resolveScene, nextReturnTo, authString } from "../src/lib/obs.js";

/**
 * The switcher's decisions, without an OBS to talk to. The WebSocket plumbing
 * is checked against the real thing; what matters here is that a press cuts to
 * the right scene and an ad ending never cuts the show somewhere surprising.
 */

const SCENES = [
  "01 Starting Soon", "03 Solo — Sony", "07 Screen + Host", "08 BRB",
  "11 Ad — Captain's Log", "12 Ad — Toy Shoppe",
];

test("rundown lines carry an @scene in any field after the minutes", () => {
  const items = parseRundown([
    "The Huddle | 10 | Pudgy World · Penguin of the Week | @07",
    "* Sauce Break: Toy Shoppe | 3 | @12",
    "Mailbag | 10 | a | b",
    "Welcome In | 10 | @03 | Week in review",
  ].join("\n"));

  assert.equal(items[0].scene, "07");
  assert.equal(items[0].sub, "Pudgy World · Penguin of the Week");
  assert.deepEqual([items[1].isBreak, items[1].minutes, items[1].scene, items[1].sub], [true, 3, "12", ""]);
  assert.equal(items[2].scene, "");
  assert.equal(items[2].sub, "a | b");
  assert.equal(items[3].scene, "03");
  assert.equal(items[3].sub, "Week in review");
});

test("a saved rundown without scenes still loads", () => {
  const [it] = parseRundown([{ title: "Welcome In", minutes: 10, sub: "", isBreak: false }]);
  assert.equal(it.scene, "");
});

test("scenes resolve by exact name or by a unique number prefix", () => {
  assert.equal(resolveScene("07", SCENES), "07 Screen + Host");
  assert.equal(resolveScene("08 brb", SCENES), "08 BRB");
  assert.equal(resolveScene("12 Ad — Toy Shoppe", SCENES), "12 Ad — Toy Shoppe");
  // "1" would be ambiguous and must not pick one at random.
  assert.equal(resolveScene("1", SCENES), null);
  assert.equal(resolveScene("99", SCENES), null);
  assert.equal(resolveScene("", SCENES), null);
});

test("entering an ad remembers where the show was", () => {
  assert.equal(nextReturnTo("03 Solo — Sony", false, true, ""), "03 Solo — Sony");
});

test("back-to-back ads return to the show, not to the first ad", () => {
  assert.equal(nextReturnTo("11 Ad — Captain's Log", true, true, "03 Solo — Sony"), "03 Solo — Sony");
});

test("cutting away by hand cancels the return", () => {
  assert.equal(nextReturnTo("12 Ad — Toy Shoppe", true, false, "03 Solo — Sony"), "");
});

test("auth string follows the obs-websocket v5 recipe", () => {
  const a = authString("pw", "salt", "challenge");
  assert.match(a, /^[A-Za-z0-9+/]{43}=$/);
  assert.notEqual(a, authString("pw", "salt", "other"));
});
