(function (root) {
  "use strict";
  const KEY = "creativeArcana.library.v3";
  const LEGACY_KEY = "creativeArcana.history.v2";
  const RECOVERY_KEY = "creativeArcana.recovery.original.v1";
  const YEAR = 365 * 24 * 60 * 60 * 1000;
  const GROUPS = ["general", "romance", "dark", "adult"];
  const cardKey = card => JSON.stringify([card.deckId, card.number, card.prompt]);
  const validCard = card => card && typeof card.deckId === "string" && typeof card.prompt === "string" && typeof card.source === "string" && GROUPS.includes(card.group) && Number.isFinite(card.number);
  const validEntry = entry => entry && typeof entry.id === "string" && Number.isFinite(Date.parse(entry.date)) && Array.isArray(entry.cards) && entry.cards.length > 0 && entry.cards.every(validCard);
  const copy = value => JSON.parse(JSON.stringify(value));
  const validLibrary = value => value &&
    Array.isArray(value.history) && value.history.every(validEntry) &&
    Array.isArray(value.prompts) && value.prompts.every(validCard) &&
    Array.isArray(value.sets) && value.sets.every(validEntry) &&
    Array.isArray(value.decks) && value.decks.every(deck => deck && typeof deck.id === "string" && typeof deck.title === "string" && GROUPS.includes(deck.group) && Array.isArray(deck.items) && deck.items.every(item => item && Number.isFinite(item.number) && typeof item.prompt === "string")) &&
    Array.isArray(value.groups) && value.groups.every(group => GROUPS.includes(group));

  const skyloomId = id => typeof id === "string" && /^c(0[1-9]|1[0-7])$/.test(id);
  function recoverMixedLibrary(value) {
    if (!value || !Array.isArray(value.groups) ||
        !value.groups.every(group => GROUPS.includes(group) || skyloomId(group)) ||
        !validLibrary({ ...value, groups: [] })) throw new Error("Invalid library");
    const hasForeign = value.groups.some(skyloomId) ||
      [...value.history, ...value.sets].some(entry => entry.cards.some(card => skyloomId(card.deckId))) ||
      value.prompts.some(card => skyloomId(card.deckId)) || value.decks.some(deck => skyloomId(deck.id));
    if (!hasForeign) return null;
    function owner(id, categoryId) {
      if (typeof id === "string" && /^deck-\d{3}$/.test(id) && categoryId === undefined) return "ca";
      if (skyloomId(id) && (categoryId === undefined || categoryId === id)) return "sl";
      throw new Error("Unknown source");
    }
    const cardOwner = card => owner(card.deckId, card.categoryId);
    function entryOwner(entry) {
      const owners = new Set(entry.cards.map(cardOwner));
      if (owners.size !== 1) throw new Error("Mixed draw");
      return [...owners][0];
    }
    // Inspect every item before removing anything, including foreign items.
    const historyOwners = value.history.map(entryOwner);
    const promptOwners = value.prompts.map(cardOwner);
    const setOwners = value.sets.map(entryOwner);
    const deckOwners = value.decks.map(deck => owner(deck.id, deck.categoryId));
    const mixed = value.groups.some(skyloomId) ||
      [historyOwners, promptOwners, setOwners, deckOwners].some(owners => owners.includes("sl"));
    if (!mixed) return null;
    return {
      ...value,
      history: value.history.filter((_, i) => historyOwners[i] === "ca"),
      prompts: value.prompts.filter((_, i) => promptOwners[i] === "ca"),
      sets: value.sets.filter((_, i) => setOwners[i] === "ca"),
      decks: value.decks.filter((_, i) => deckOwners[i] === "ca"),
      groups: value.groups.some(skyloomId) ? ["general", "romance"] : [...value.groups],
      recoveryVersion: 1
    };
  }

  function readBackup(text) {
    let backup;
    try { backup = JSON.parse(text.replace(/^\uFEFF/, "")); }
    catch { throw new Error("無法讀取 JSON 備份檔，請確認檔案內容完整。"); }
    // Older raw library exports may contain Skyloom category selections.
    // Accept only the observed category IDs; all collection data still uses
    // the same strict validation as a native backup.
    const raw = backup && typeof backup === "object" && !Array.isArray(backup) &&
      !Object.prototype.hasOwnProperty.call(backup, "format") &&
      !Object.prototype.hasOwnProperty.call(backup, "version") &&
      !Object.prototype.hasOwnProperty.call(backup, "library");
    let library = raw ? backup : backup?.library;
    if (raw) {
      try { library = recoverMixedLibrary(library) || library; }
      catch { throw new Error("備份格式不符或包含無法安全分離的資料，沒有匯入任何內容。"); }
    }
    if ((!raw && (!backup || backup.format !== "creative-arcana" || backup.version !== 1)) || !validLibrary(library)) {
      throw new Error("備份格式不符或版本不支援，請選擇 Creative Arcana 匯出的 JSON 檔。");
    }
    return copy(library);
  }

  function createStore(storage, now = () => Date.now()) {
    let state;
    let loadError = false;
    let recovered = false;
    const empty = () => ({ history: [], prompts: [], sets: [], decks: [], groups: ["general", "romance"] });
    try {
      const saved = storage.getItem(KEY);
      if (saved !== null) {
        state = JSON.parse(saved);
        const next = recoverMixedLibrary(state);
        if (next) {
          // Never overwrite the first original. Verify backup persistence before repair.
          const original = storage.getItem(RECOVERY_KEY);
          if (original === null) {
            storage.setItem(RECOVERY_KEY, saved);
            if (storage.getItem(RECOVERY_KEY) !== saved) throw new Error("Backup failed");
          } else if (original !== saved) {
            // A different mixed library needs separate review; preserve both originals.
            throw new Error("Recovery backup already exists for different data");
          }
          storage.setItem(KEY, JSON.stringify(next));
          state = next;
          recovered = true;
        }
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
      snapshot, loadError, recovered,
      exportBackup() {
        if (loadError) throw new Error("原有資料無法讀取，無法匯出完整備份。請先確認瀏覽器儲存設定。");
        return JSON.stringify({ format: "creative-arcana", version: 1, exportedAt: new Date(now()).toISOString(), library: snapshot() }, null, 2);
      },
      previewBackup(text) { return readBackup(text); },
      importBackup(text) {
        const incoming = readBackup(text);
        const counts = {};
        commit(next => {
          for (const name of ["history", "prompts", "sets", "decks"]) {
            const key = name === "prompts" ? cardKey : item => item.id;
            const known = new Set(next[name].map(key));
            counts[name] = 0;
            for (const item of incoming[name]) {
              if (name === "history" && Date.parse(item.date) < now() - YEAR) continue;
              if (known.has(key(item))) continue;
              known.add(key(item)); next[name].push(copy(item)); counts[name]++;
            }
          }
          next.history.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
        });
        return counts;
      },
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
  const api = { createStore, cardKey, deckCards, poolFor, sample, KEY, LEGACY_KEY, RECOVERY_KEY, YEAR };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ArcanaStore = api;
})(typeof window !== "undefined" ? window : globalThis);
