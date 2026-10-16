"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createStore, cardKey, deckCards, poolFor, sample, sampleBalanced, seasonalGroups, KEY, LEGACY_KEY, YEAR } = require("../arcana-store.js");
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
test("balanced draws choose categories first and can require distinct categories", () => {
  const pool = [
    { ...card, categoryId: "c01", prompt: "A1" },
    { ...card, categoryId: "c01", prompt: "A2" },
    { ...card, categoryId: "c02", prompt: "B1" }
  ];
  assert.equal(sampleBalanced(pool, 1, false, () => 0.99)[0].categoryId, "c02");
  const values = [0, 0, 0, 0];
  const drawn = sampleBalanced(pool, 3, true, () => values.shift() ?? 0);
  assert.equal(drawn.length, 2);
  assert.deepEqual(new Set(drawn.map(item => item.categoryId)), new Set(["c01", "c02"]));
  assert.equal(new Set(drawn.map(cardKey)).size, 2);
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
test("old deck group settings migrate to all word-bank categories", () => {
  const previous = { history: [], prompts: [], sets: [], decks: [], groups: ["general", "romance"] };
  const store = createStore(memory({ [KEY]: JSON.stringify(previous) }), () => now, ["c01", "c02"]);
  assert.deepEqual(store.snapshot().groups, ["c01", "c02"]);
});
test("seasonal categories default on for their three calendar months only", () => {
  const categories = [
    { id: "c01", name: "物品" },
    { id: "c18", name: "春日風物詩" },
    { id: "c19", name: "夏日風物詩" },
    { id: "c20", name: "秋日風物詩" },
    { id: "c21", name: "冬日風物詩" }
  ];
  const selected = categories.map(category => category.id);
  for (const [months, expected] of [[ [3, 4, 5], "c18" ], [ [6, 7, 8], "c19" ], [ [9, 10, 11], "c20" ], [ [12, 1, 2], "c21" ]]) {
    for (const month of months) assert.deepEqual(seasonalGroups(categories, selected, month), ["c01", expected]);
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
test("the JSON word bank contains 840 unique words across 21 categories", () => {
  const bank = JSON.parse(fs.readFileSync(require.resolve("../everyday_prompt_bank_v3_zh_tw.json"), "utf8"));
  const categories = bank.categories.map(category => ({
    id: category.id, categoryId: category.id, title: category.name, group: "general",
    items: category.words.map((prompt, index) => ({ number: index + 1, prompt }))
  }));
  const words = categories.flatMap(deck => deck.items.map(item => item.prompt));
  assert.equal(categories.length, 21);
  assert.equal(words.length, 840);
  assert.equal(new Set(words).size, 840);
  const storage = memory(), store = createStore(storage, () => now, categories.map(category => category.id));
  for (const source of categories) store.toggleDeck(source);
  assert.equal(make(storage).loadError, false);
  const pool = poolFor({ decks: categories }, store.snapshot(), "all");
  assert.equal(pool.length, 840);
  const drawn = sample(pool, 3);
  assert.equal(new Set(drawn.map(cardKey)).size, 3);
  drawn.forEach(item => store.togglePrompt(item));
  assert.equal(make(storage).snapshot().prompts.length, 3);
});
