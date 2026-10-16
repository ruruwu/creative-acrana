"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createStore, cardKey, deckCards, poolFor, sample, KEY, LEGACY_KEY, YEAR } = require("../arcana-store.js");
const now = Date.parse("2026-10-03T12:00:00Z");
const card = { deckId: "deck-001", source: "希臘風三十題", group: "general", number: 1, prompt: "困獸之鬥" };
const other = { ...card, number: 2, prompt: "回聲" };
const entry = { id: "draw-1", date: new Date(now).toISOString(), cards: [card, other], mode: "triple" };
const deck = { id: card.deckId, title: card.source, group: card.group, items: [{ number: 1, prompt: card.prompt }, { number: 2, prompt: other.prompt }] };
function memory(values = {}) {
  const items = new Map(Object.entries(values));
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}
const make = storage => createStore(storage, () => now);

test("raw Skyloom-mixed imports keep CA data and leave the source backup intact", () => {
  const skyCard = { deckId: "c17", categoryId: "c17", source: "抽象概念", group: "general", number: 58, prompt: "勇氣" };
  const mixed = { history: [{ ...entry, id: "skyloom-draw", cards: [skyCard] }, entry], prompts: [], sets: [], decks: [deck], groups: Array.from({ length: 17 }, (_, i) => `c${String(i + 1).padStart(2, "0")}`) };
  const storage = memory(), store = make(storage);
  assert.deepEqual(store.importBackup(JSON.stringify(mixed)), { history: 1, prompts: 0, sets: 0, decks: 1 });
  assert.deepEqual(store.snapshot().groups, ["general", "romance"]);
  assert.deepEqual(make(storage).snapshot().history[0].cards, entry.cards);
  assert.deepEqual(make(storage).snapshot().decks, [deck]);
  const restored = make(memory());
  restored.importBackup(store.exportBackup());
  assert.deepEqual(restored.snapshot(), store.snapshot());
  assert.deepEqual(store.importBackup(JSON.stringify(mixed)), { history: 0, prompts: 0, sets: 0, decks: 0 });
  assert.throws(() => store.importBackup(JSON.stringify({ ...mixed, groups: ["unknown"] })));
  assert.throws(() => store.importBackup(JSON.stringify({ ...mixed, history: [{ ...entry, cards: [{}] }] })));
  assert.throws(() => store.importBackup(JSON.stringify({ format: "other", version: 1, library: mixed })));
});

test("backup round trip merges all collections, preserves settings, and is idempotent", () => {
  const source = make(memory());
  source.record(entry); source.togglePrompt(card); source.toggleSet(entry); source.toggleDeck(deck);
  source.setGroups(["adult"]);
  const storage = memory(), target = make(storage);
  target.togglePrompt(other);
  const backup = source.exportBackup();
  assert.deepEqual(JSON.parse(backup).library.groups, ["adult"]);
  assert.deepEqual(target.importBackup(backup), { history: 1, prompts: 1, sets: 1, decks: 1 });
  assert.deepEqual(target.importBackup(backup), { history: 0, prompts: 0, sets: 0, decks: 0 });
  const restored = make(storage).snapshot();
  assert.deepEqual(restored.groups, ["general", "romance"]);
  assert.deepEqual(restored.prompts, [other, card]);
  assert.deepEqual(restored.history, [entry]);
  assert.deepEqual(restored.sets, [entry]);
  assert.deepEqual(restored.decks, [deck]);
});
test("invalid backups and failed writes cannot alter existing data", () => {
  const storage = memory(), store = make(storage);
  store.togglePrompt(card);
  const before = storage.getItem(KEY), backup = JSON.parse(store.exportBackup());
  const invalid = ["broken", "null", "{}", JSON.stringify({ ...backup, version: 99 }), JSON.stringify({ ...backup, library: { ...backup.library, decks: [{}] } })];
  for (const text of invalid) {
    assert.throws(() => store.importBackup(text));
    assert.equal(storage.getItem(KEY), before);
  }
  const source = make(memory()); source.togglePrompt(other);
  storage.setItem = () => { throw new Error("QuotaExceeded"); };
  assert.throws(() => store.importBackup(source.exportBackup()), /儲存失敗/);
  assert.deepEqual(store.snapshot().prompts, [card]);
});
test("import skips expired history while retaining old saved sets and accepts a BOM", () => {
  const source = make(memory()); source.record(entry); source.toggleSet(entry);
  const backup = JSON.parse(source.exportBackup());
  backup.library.history[0].date = new Date(now - YEAR - 1).toISOString();
  backup.library.sets[0].date = backup.library.history[0].date;
  const target = make(memory());
  assert.deepEqual(target.importBackup("\uFEFF" + JSON.stringify(backup)), { history: 0, prompts: 0, sets: 1, decks: 0 });
  assert.equal(target.snapshot().sets.length, 1);
  const broken = make(memory({ [KEY]: "broken" }));
  assert.throws(() => broken.exportBackup(), /無法讀取/);
  assert.throws(() => broken.importBackup(source.exportBackup()), /避免覆寫/);
});

test("legacy saved sets survive the one-year limit and migration does not modify old data", () => {
  const recent = { ...entry, favorite: true };
  const expired = { ...entry, id: "old-saved", date: new Date(now - YEAR - 1).toISOString(), favorite: true };
  const storage = memory({ [LEGACY_KEY]: JSON.stringify([recent, expired]) });
  const store = make(storage);
  assert.equal(store.snapshot().history.length, 1);
  assert.equal(store.snapshot().sets.length, 2);
  assert.equal(store.snapshot().prompts.length, 0);
  store.togglePrompt(card);
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_KEY)), [recent, expired]);
  assert.equal(make(storage).snapshot().sets.length, 2);
});
test("single prompt, whole draw, and whole deck collections stay independent after reload", () => {
  const storage = memory(), store = make(storage);
  store.record(entry); store.togglePrompt(card); store.toggleSet(entry); store.toggleDeck(deck);
  let reloaded = make(storage);
  assert.deepEqual(reloaded.snapshot().prompts, [card]);
  assert.deepEqual(reloaded.snapshot().sets, [entry]);
  assert.deepEqual(reloaded.snapshot().decks, [deck]);
  reloaded.toggleSet(entry); reloaded.toggleDeck(deck);
  assert.deepEqual(reloaded.snapshot().prompts, [card]);
  assert.equal(reloaded.snapshot().history.length, 1);
});
test("clearing history retains all three types of collections, including after reload", () => {
  const storage = memory(), store = make(storage);
  store.record(entry); store.togglePrompt(card); store.toggleSet(entry); store.toggleDeck(deck);
  store.clearHistory();
  const state = make(storage).snapshot();
  assert.equal(state.history.length, 0);
  for (const key of ["prompts", "sets", "decks"]) assert.equal(state[key].length, 1);
});
test("removing a migrated saved set does not reimport it on next load", () => {
  const storage = memory({ [LEGACY_KEY]: JSON.stringify([{ ...entry, favorite: true }]) });
  make(storage).toggleSet(entry);
  assert.equal(make(storage).snapshot().sets.length, 0);
});
test("favorite draw pool respects categories, excludes unstarred prompts, and persists settings", () => {
  const storage = memory(), store = make(storage);
  const dark = { ...other, deckId: "deck-dark", group: "dark" };
  store.togglePrompt(card); store.togglePrompt(dark); store.toggleDeck(deck);
  assert.deepEqual(poolFor({ decks: [deck] }, store.snapshot(), "favorites"), [card]);
  store.setGroups(["dark"]);
  assert.deepEqual(poolFor({ decks: [deck] }, make(storage).snapshot(), "favorites"), [dark]);
  store.setGroups([]);
  assert.deepEqual(poolFor({ decks: [deck] }, store.snapshot(), "all"), []);
});
test("three-card draw from a small favorite pool returns available cards without repetition", () => {
  const pool = [card, other];
  assert.deepEqual(sample(pool, 3, () => 0), [card, other]);
  assert.equal(pool.length, 2);
  assert.deepEqual(sample([], 3), []);
  assert.equal(sample(pool, 1).length, 1);
});
test("saved-deck draws use complete saved snapshots, exclude other decks, and survive reload", () => {
  const storage = memory(), store = make(storage);
  const secondDeck = { ...deck, id: "deck-second", items: [{ number: 1, prompt: "另一份題庫" }] };
  const unsavedDeck = { ...deck, id: "deck-unsaved" };
  const data = { decks: [unsavedDeck] };
  assert.deepEqual(poolFor(data, store.snapshot(), "decks"), []);
  store.toggleDeck(deck); store.toggleDeck(secondDeck);
  const state = make(storage).snapshot();
  assert.equal(state.prompts.length, 0);
  const pool = poolFor(data, state, "decks");
  assert.deepEqual(pool, [...deckCards(secondDeck), ...deckCards(deck)]);
  assert.equal(sample(pool, 1).length, 1);
  assert.equal(new Set(sample(pool, 3).map(cardKey)).size, 3);
  store.toggleDeck(secondDeck);
  assert.deepEqual(poolFor(data, store.snapshot(), "decks"), deckCards(deck));
  assert.equal(sample(poolFor(data, store.snapshot(), "decks"), 3).length, 2);
  store.toggleDeck(deck);
  assert.deepEqual(poolFor(data, store.snapshot(), "decks"), []);
});
test("saved-deck draws honor category settings without changing the collection", () => {
  const store = make(memory());
  const darkDeck = { ...deck, id: "deck-dark", group: "dark" };
  store.toggleDeck(deck); store.toggleDeck(darkDeck);
  assert.deepEqual(poolFor({ decks: [] }, store.snapshot(), "decks"), deckCards(deck));
  store.setGroups(["dark"]);
  assert.deepEqual(poolFor({ decks: [] }, store.snapshot(), "decks"), deckCards(darkDeck));
  store.setGroups([]);
  assert.deepEqual(poolFor({ decks: [] }, store.snapshot(), "decks"), []);
  assert.equal(store.snapshot().decks.length, 2);
});
test("category corrections apply to existing favorites and saved decks without changing their contents", () => {
  const store = make(memory());
  store.togglePrompt(card); store.toggleDeck(deck);
  const data = { decks: [{ ...deck, group: "adult" }] };
  for (const source of ["favorites", "decks"]) {
    assert.deepEqual(poolFor(data, store.snapshot(), source), []);
  }
  store.setGroups(["adult"]);
  assert.deepEqual(poolFor(data, store.snapshot(), "favorites"), [{ ...card, group: "adult" }]);
  assert.deepEqual(poolFor(data, store.snapshot(), "decks"), deckCards(data.decks[0]));
  assert.deepEqual(store.snapshot().decks, [deck]);
  assert.deepEqual(store.snapshot().prompts, [card]);
});
test("duplicate numbering in source decks does not merge different prompts", () => {
  assert.notEqual(cardKey(card), cardKey({ ...card, prompt: "另一道題目" }));
  const state = { prompts: [card, card, { ...card, prompt: "另一道題目" }], groups: ["general"] };
  assert.equal(poolFor({ decks: [] }, state, "favorites").length, 2);
});
test("storage write failures leave in-memory collection state unchanged", () => {
  const storage = memory(), store = make(storage);
  store.togglePrompt(card);
  storage.setItem = () => { throw new Error("QuotaExceeded"); };
  assert.throws(() => store.togglePrompt(other), /儲存失敗/);
  assert.deepEqual(store.snapshot().prompts, [card]);
  assert.deepEqual(make(storage).snapshot().prompts, [card]);
});
test("malformed existing data is not silently overwritten", () => {
  for (const raw of ["broken", "null", "{}", JSON.stringify({ history: [], prompts: [], sets: [], decks: [{}], groups: [] })]) {
    const storage = memory({ [KEY]: raw }), store = make(storage);
    assert.equal(store.loadError, true);
    assert.throws(() => store.togglePrompt(card), /避免覆寫/);
    assert.equal(storage.getItem(KEY), raw);
  }
});
test("blocked storage is reported without crashing initialization", () => {
  const store = make({ getItem() { throw new Error("SecurityError"); } });
  assert.equal(store.loadError, true);
  assert.throws(() => store.record(entry), /無法讀取/);
});
test("saved snapshots cannot be mutated by their callers", () => {
  const store = make(memory());
  const source = structuredClone(deck);
  store.toggleDeck(source); source.items[0].prompt = "changed";
  store.snapshot().decks[0].items.length = 0;
  assert.deepEqual(store.snapshot().decks, [deck]);
});
test("the real dataset is compatible with storage, deck previews, and unique draws", () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../prompts.js"), "utf8"), context);
  const data = JSON.parse(JSON.stringify(context.window.CREATIVE_ARCANA_DATA));
  const storage = memory(), store = make(storage);
  assert.equal(data.decks.length, 173);
  assert.equal(data.decks.flatMap(deckCards).length, 5325);
  for (const source of data.decks) store.toggleDeck(source);
  assert.equal(make(storage).loadError, false);
  const pool = poolFor(data, store.snapshot(), "all");
  assert.ok(pool.every(item => ["general", "romance"].includes(item.group)));
  const drawn = sample(pool, 3);
  assert.equal(new Set(drawn.map(cardKey)).size, 3);
  drawn.forEach(item => store.togglePrompt(item));
  assert.equal(make(storage).snapshot().prompts.length, 3);
});

for (const filename of ["onlygroupmix.json", "allmixtogether.json"]) {
  test(filename + ": recovery preserves CA collections and original data, and runs once", () => {
    const raw = fs.readFileSync(require.resolve("../" + filename), "utf8");
    const storage = memory({ [KEY]: raw, "skyloom.library.v1": "untouched" });
    const store = make(storage);
    assert.equal(store.loadError, false);
    assert.equal(store.recovered, true);
    const state = store.snapshot();
    for (const name of ["history", "prompts", "sets", "decks"]) assert.equal(state[name].length, 1);
    const input = JSON.parse(raw);
    assert.deepEqual(state.history, input.history.filter(entry => entry.cards.every(card => card.deckId.startsWith("deck-"))));
    assert.deepEqual(state.prompts, input.prompts.filter(card => card.deckId.startsWith("deck-")));
    assert.deepEqual(state.sets, input.sets.filter(entry => entry.cards.every(card => card.deckId.startsWith("deck-"))));
    assert.deepEqual(state.decks, input.decks.filter(deck => deck.id.startsWith("deck-")));
    assert.deepEqual(state.groups, ["general", "romance"]);
    const backupKey = "creativeArcana.recovery.original.v1";
    assert.equal(storage.getItem(backupKey), raw);
    assert.equal(storage.getItem("skyloom.library.v1"), "untouched");
    const repaired = storage.getItem(KEY);
    assert.equal(make(storage).recovered, false);
    assert.equal(storage.getItem(KEY), repaired);
    assert.equal(storage.getItem(backupKey), raw);
    store.togglePrompt(other);
    assert.equal(make(storage).loadError, false);
  });
}
test("recovery refuses unknown sources, mixed draws, and malformed data without writing", () => {
  const base = JSON.parse(fs.readFileSync(require.resolve("../allmixtogether.json"), "utf8"));
  const unknown = structuredClone(base); unknown.prompts[0].deckId = "unknown";
  const combined = structuredClone(base); combined.sets[0].cards.push(combined.sets[1].cards[0]);
  const broken = structuredClone(base); broken.decks[0].items[0].number = "one";
  for (const value of [unknown, combined, broken]) {
    const raw = JSON.stringify(value), storage = memory({ [KEY]: raw });
    let writes = 0; storage.setItem = () => { writes++; };
    assert.equal(make(storage).loadError, true);
    assert.equal(writes, 0);
    assert.equal(storage.getItem(KEY), raw);
  }
});
test("recovery failures preserve the active data and first backup", () => {
  const raw = fs.readFileSync(require.resolve("../onlygroupmix.json"), "utf8");
  const backupKey = "creativeArcana.recovery.original.v1";
  for (const failedKey of [backupKey, KEY]) {
    const storage = memory({ [KEY]: raw });
    const write = storage.setItem;
    storage.setItem = (key, value) => { if (key === failedKey) throw new Error("QuotaExceeded"); write(key, value); };
    assert.equal(make(storage).loadError, true);
    assert.equal(storage.getItem(KEY), raw);
    assert.equal(storage.getItem(backupKey), failedKey === KEY ? raw : null);
    storage.setItem = write;
    assert.equal(make(storage).recovered, true);
  }
  const storage = memory({ [KEY]: raw, [backupKey]: "first original" });
  assert.equal(make(storage).loadError, true);
  assert.equal(storage.getItem(KEY), raw);
  assert.equal(storage.getItem(backupKey), "first original");
});
