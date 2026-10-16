(function (root) {
  "use strict";
  const KEY = "creativeArcana.library.v3";
  const LEGACY_KEY = "creativeArcana.history.v2";
  const YEAR = 365 * 24 * 60 * 60 * 1000;
  const GROUPS = ["general", "romance", "dark", "adult"];
  const cardKey = card => JSON.stringify([card.deckId, card.number, card.prompt]);
  const validCard = card => card && typeof card.deckId === "string" && typeof card.prompt === "string" && typeof card.source === "string" && GROUPS.includes(card.group) && Number.isFinite(card.number);
  const validEntry = entry => entry && typeof entry.id === "string" && Number.isFinite(Date.parse(entry.date)) && Array.isArray(entry.cards) && entry.cards.length > 0 && entry.cards.every(validCard);
  const copy = value => JSON.parse(JSON.stringify(value));

  function createStore(storage, now = () => Date.now()) {
    let state;
    let loadError = false;
    const empty = () => ({ history: [], prompts: [], sets: [], decks: [], groups: ["general", "romance"] });
    try {
      const saved = storage.getItem(KEY);
      if (saved !== null) {
        state = JSON.parse(saved);
        if (!state || !Array.isArray(state.history) || !state.history.every(validEntry) ||
            !Array.isArray(state.prompts) || !state.prompts.every(validCard) ||
            !Array.isArray(state.sets) || !state.sets.every(validEntry) ||
            !Array.isArray(state.decks) || !state.decks.every(deck => deck && typeof deck.id === "string" && typeof deck.title === "string" && GROUPS.includes(deck.group) && Array.isArray(deck.items) && deck.items.every(item => item && Number.isFinite(item.number) && typeof item.prompt === "string")) ||
            !Array.isArray(state.groups) || !state.groups.every(group => GROUPS.includes(group))) throw new Error("Invalid library");
      } else {
        const legacy = JSON.parse(storage.getItem(LEGACY_KEY) || "[]");
        if (!Array.isArray(legacy) || !legacy.every(validEntry)) throw new Error("Invalid history");
        state = empty();
        state.history = legacy;
        // Import saved sets before applying the one-year history limit.
        state.sets = legacy.filter(entry => entry.favorite);
      }
    } catch {
      state = empty();
      loadError = true;
    }
    function snapshot() {
      const result = copy(state);
      result.history = result.history.filter(entry => Date.parse(entry.date) >= now() - YEAR);
      return result;
    }
    function commit(change) {
      if (loadError) throw new Error("收藏資料無法讀取，為避免覆寫，請先確認瀏覽器的儲存設定或備份資料。");
      const next = snapshot();
      change(next);
      try { storage.setItem(KEY, JSON.stringify(next)); }
      catch { throw new Error("儲存失敗，可能是瀏覽器儲存空間不足或未開放儲存。這次變更尚未保存。"); }
      state = next;
    }
    function toggle(list, value, key) {
      const index = list.findIndex(item => key(item) === key(value));
      if (index === -1) list.unshift(copy(value));
      else list.splice(index, 1);
    }
    return {
      snapshot, loadError,
      record(entry) { commit(next => next.history.unshift(copy(entry))); },
      togglePrompt(card) { commit(next => toggle(next.prompts, card, cardKey)); },
      toggleSet(entry) { commit(next => toggle(next.sets, entry, item => item.id)); },
      toggleDeck(deck) { commit(next => toggle(next.decks, deck, item => item.id)); },
      setGroups(groups) { commit(next => { next.groups = [...groups]; }); },
      clearHistory() { commit(next => { next.history = []; }); }
    };
  }
  function deckCards(deck) {
    return deck.items.map(item => ({ deckId: deck.id, source: deck.title, group: deck.group, number: item.number, prompt: item.prompt }));
  }
  function poolFor(data, state, source) {
    const currentGroups = new Map(data.decks.map(deck => [deck.id, deck.group]));
    const cards = source === "favorites" ? state.prompts
      : source === "decks" ? state.decks.flatMap(deckCards)
      : data.decks.flatMap(deckCards);
    // Saved snapshots retain their content, but category corrections also apply to old favorites.
    const classified = cards.map(card => ({ ...card, group: currentGroups.get(card.deckId) || card.group }));
    return [...new Map(classified.filter(card => state.groups.includes(card.group)).map(card => [cardKey(card), card])).values()];
  }
  function sample(pool, count, random = Math.random) {
    const available = [...pool], cards = [];
    while (cards.length < count && available.length) cards.push(available.splice(Math.floor(random() * available.length), 1)[0]);
    return cards;
  }
  const api = { createStore, cardKey, deckCards, poolFor, sample, KEY, LEGACY_KEY, YEAR };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ArcanaStore = api;
})(typeof window !== "undefined" ? window : globalThis);
