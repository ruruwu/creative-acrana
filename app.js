"use strict";
function loadPromptBank() {
  return fetch("everyday_prompt_bank_v3_zh_tw.json").then(response => {
    if (!response.ok) throw new Error("無法載入日常靈感詞庫 JSON。");
    return response.json();
  }).then(bank => {
    if (!Array.isArray(bank.categories) || bank.categories.some(category => !Array.isArray(category.words))) {
      throw new Error("題庫 JSON 格式不正確，請確認 categories 與 words 欄位。");
    }
    return {
      ...bank,
      decks: bank.categories.map(category => ({
        id: category.id,
        categoryId: category.id,
        title: category.name,
        group: "general",
        items: category.words.map((prompt, index) => ({ number: index + 1, prompt }))
      }))
    };
  });
}
loadPromptBank().then(DATA => {
const { createStore, cardKey, deckCards, poolFor, sample, sampleBalanced, seasonalGroups } = window.ArcanaStore;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
// Access storage lazily so restricted browser contexts produce a useful error.
const today = new Date();
const currentMonth = today.getMonth() + 1;
const currentSeasonId = seasonalGroups(DATA.categories, [], currentMonth)[0];
const defaultGroups = seasonalGroups(DATA.categories, DATA.categories.map(category => category.id), currentMonth);
const store = createStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, undefined, defaultGroups);
const seasonalCycle = `${today.getFullYear() + (currentMonth === 12 ? 1 : 0)}-${currentSeasonId}`;
try {
  if (!store.loadError && currentSeasonId && localStorage.getItem("creativeArcana.seasonalDefaults.v1") !== seasonalCycle) {
    store.setGroups(seasonalGroups(DATA.categories, store.snapshot().groups, currentMonth));
    localStorage.setItem("creativeArcana.seasonalDefaults.v1", seasonalCycle);
  }
} catch (error) { console.error(error); }
let drawSource = "all", drawMode = "random", collectionTab = "prompts", currentEntry = null, currentDeck = null;
let lastRemovedSet = null;
const groupNames = { general: "General", romance: "Romance", dark: "Dark", adult: "Adult" };
const categoryNames = new Map(DATA.categories.map(category => [category.id, category.name]));
const currentGroups = new Map(DATA.decks.map(deck => [deck.id, deck.group]));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(className, text, action) {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function announce(message, error = false) {
  $("#statusMessage").textContent = message;
  $("#statusMessage").classList.toggle("error", error);
}
function change(action, message) {
  try { action(); refresh(); announce(message); return true; }
  catch (error) { announce(error.message, true); alert(error.message); return false; }
}
function roman(n) {
  let out = "";
  for (const [value, symbol] of [[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]]) {
    while (n >= value) { out += symbol; n -= value; }
  }
  return out || "0";
}
function promptButton(card, compact = false) {
  const node = button(compact ? "prompt-star" : "favorite-button", "", () => {
    const saved = store.snapshot().prompts.some(item => cardKey(item) === cardKey(card));
    change(() => store.togglePrompt(card), saved ? "已從最愛移除此詞。" : "★ 已加入最愛詞彙，可從最愛再次抽取。");
  });
  node.dataset.promptKey = cardKey(card);
  node.dataset.promptTitle = card.prompt;
  node.dataset.compact = String(compact);
  return node;
}
function sourceButton(card) { return button("source-link", card.source, () => openDeck(card.deckId)); }
function renderDraw(entry) {
  currentEntry = entry;
  const stage = $("#cardsStage");
  stage.replaceChildren();
  entry.cards.forEach((card, index) => {
    const article = element("article", "tarot-card drawn-card");
    article.style.animationDelay = `${index * 80}ms`;
    for (const corner of ["tl", "tr", "bl", "br"]) {
      const ornament = element("div", `corner corner-${corner}`, "✦");
      ornament.setAttribute("aria-hidden", "true"); article.append(ornament);
    }
    article.append(element("p", "card-number", `${roman(card.number)} · ${String(card.number).padStart(2, "0")}`));
    article.append(element("div", "card-symbol", ({general:"✦", romance:"♡", dark:"☾", adult:"◇"})[currentGroups.get(card.deckId) || card.group]));
    article.append(element("h3", "card-title", card.prompt));
    const source = element("div", "card-source");
    source.append(sourceButton(card), element("span", "source-caption", "查看分類"));
    article.append(source, promptButton(card)); stage.append(article);
  });
  $("#setSaveArea").hidden = false;
  syncButtons();
}
function syncButtons() {
  const state = store.snapshot();
  const favorites = new Set(state.prompts.map(cardKey));
  $$("[data-prompt-key]").forEach(node => {
    const saved = favorites.has(node.dataset.promptKey);
    node.textContent = node.dataset.compact === "true" ? (saved ? "★" : "☆") : (saved ? "★ 已加入最愛" : "☆ 加入最愛");
    node.classList.toggle("saved", saved);
    node.setAttribute("aria-pressed", String(saved));
    node.setAttribute("aria-label", `${saved ? "取消最愛" : "加入最愛"}：${node.dataset.promptTitle}`);
    node.title = saved ? "取消這道題目的最愛" : "將這道題目加入最愛";
  });
  if (currentEntry) {
    const saved = state.sets.some(entry => entry.id === currentEntry.id);
    $("#saveSet").textContent = `${saved ? "★ 已收藏本次牌組" : "☆ 收藏本次牌組"}（${currentEntry.cards.length} 張）`;
    $("#saveSet").setAttribute("aria-pressed", String(saved));
    $("#saveSet").classList.toggle("saved", saved);
    $("#setSaveHint").textContent = saved ? "已存入「我的收藏 → 收藏牌組」" : `將這 ${currentEntry.cards.length} 張一起保存`;
  }
  if (currentDeck) {
    const saved = state.decks.some(deck => deck.id === currentDeck.id);
    $("#saveDeck").textContent = `${saved ? "★ 已收藏此分類" : "☆ 收藏此分類"}（${currentDeck.items.length} 個詞）`;
    $("#saveDeck").setAttribute("aria-pressed", String(saved));
  }
}
function refresh() {
  const state = store.snapshot();
  const favoritePool = poolFor(DATA, state, "favorites");
  const count = poolFor(DATA, state, drawSource).length;
  const modeHint = drawMode === "random" ? "全部詞彙等機率" : "先等機率選分類";
  $("#poolHint").textContent = (drawSource === "favorites" ? `最愛共 ${state.prompts.length} 題 · 可抽 ${count} 詞`
    : drawSource === "decks" ? `合併 ${state.decks.length} 個收藏分類 · 可抽 ${count} 詞`
    : `可抽 ${count.toLocaleString()} 個詞彙`) + ` · ${modeHint}`;
  $("#drawCount").textContent = `最近一年抽了 ${state.history.reduce((sum, entry) => sum + entry.cards.length, 0)} 張牌`;
  $("#favoriteCount").textContent = `${state.prompts.length} 道最愛 · ${state.sets.length} 組牌組 · ${state.decks.length} 個分類`;
  $$("[data-source]").forEach(node => node.setAttribute("aria-pressed", String(node.dataset.source === drawSource)));
  $("#drawFavorite").disabled = !favoritePool.length;
  $("#drawSavedDecks").disabled = !poolFor(DATA, state, "decks").length;
  if ($("#collectionsDialog").open) renderCollections();
  if ($("#archiveDialog").open) renderArchive();
  syncButtons();
}
function setSource(source) { drawSource = source; refresh(); }
function doDraw(count) {
  const state = store.snapshot();
  const pool = poolFor(DATA, state, drawSource);
  if (!pool.length) {
    announce(drawSource === "favorites"
      ? (state.prompts.length ? "目前分類中沒有可抽的最愛題目，請調整 Deck Settings。" : "還沒有最愛題目。先抽牌，再按卡片上的 ☆ 加入最愛。")
      : drawSource === "decks"
        ? (state.decks.length ? "目前分類設定中沒有可抽的收藏分類詞彙，請調整 Deck Settings。" : "還沒有收藏分類。點卡片上的分類名稱，再按「收藏此分類」。")
      : "請在 Deck Settings 至少開啟一種題目分類。", true);
    return false;
  }
  const distinctCategories = drawMode === "balanced" && count === 3 && $("#distinctCategories").checked;
  const cards = drawMode === "balanced"
    ? sampleBalanced(pool, count, distinctCategories)
    : sample(pool, count);
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, date: new Date().toISOString(), mode: cards.length === 1 ? "single" : "triple", cards };
  try { store.record(entry); }
  catch (error) { announce(error.message, true); return false; }
  renderDraw(entry); refresh();
  const sourceName = { all: "全部詞彙", favorites: "最愛詞彙", decks: "收藏分類" }[drawSource];
  const shortage = distinctCategories
    ? `目前只有 ${cards.length} 個可用分類，已各抽出一詞。`
    : `目前只有 ${cards.length} 個可抽詞彙，已全部抽出；同次抽牌不重複。`;
  announce(cards.length < count ? shortage : `已從${sourceName}抽出 ${cards.length} 張牌。`);
  return true;
}
const dialogOpeners = new Map();
function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog.open) {
    dialogOpeners.set(id, document.activeElement);
    dialog.showModal();
  }
}
function openDeck(id) {
  currentDeck = store.snapshot().decks.find(deck => deck.id === id) || DATA.decks.find(deck => deck.id === id);
  if (!currentDeck) { announce("找不到這份題庫。", true); return; }
  currentDeck = { ...currentDeck, group: currentGroups.get(currentDeck.id) || currentDeck.group };
  $("#deckTitle").textContent = currentDeck.title;
  $("#deckMeta").textContent = `共 ${currentDeck.items.length} 個詞彙`;
  const list = $("#deckList"); list.replaceChildren();
  deckCards(currentDeck).forEach(card => {
    const row = element("article", "deck-prompt-row");
    row.append(element("span", "prompt-number", String(card.number).padStart(2, "0")), element("p", "deck-prompt-text", card.prompt), promptButton(card, true));
    list.append(row);
  });
  list.scrollTop = 0; syncButtons(); openDialog("deckDialog");
}
function preserveListFocus(list, build) {
  const active = list.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = active?.dataset.focusKey;
  const position = [...list.querySelectorAll("button")].indexOf(active);
  const scroll = list.scrollTop;
  list.replaceChildren(); build();
  if (active) {
    const next = [...list.querySelectorAll("button")];
    const match = next.find(node => focusKey && node.dataset.focusKey === focusKey) || next[Math.min(position, next.length - 1)];
    (match || document.querySelector("[data-collection][aria-pressed='true']"))?.focus({ preventScroll: true });
  }
  list.scrollTop = scroll;
}
function renderCollections() {
  const state = store.snapshot(), list = $("#collectionList");
  $("#setUndoNotice").hidden = collectionTab !== "sets" || !lastRemovedSet;
  const pool = poolFor(DATA, state, "favorites");
  const deckPool = poolFor(DATA, state, "decks");
  $$("[data-collection]").forEach(node => node.setAttribute("aria-pressed", String(node.dataset.collection === collectionTab)));
  $("#drawFavorite").hidden = collectionTab !== "prompts";
  $("#drawFavorite").disabled = !pool.length;
  $("#drawSavedDecks").hidden = collectionTab !== "decks";
  $("#drawSavedDecks").disabled = !deckPool.length;
  $("#collectionCount").textContent = collectionTab === "prompts" ? `${state.prompts.length} 個最愛詞彙 · 可抽 ${pool.length} 詞` : collectionTab === "sets" ? `${state.sets.length} 組牌組` : `${state.decks.length} 個分類 · 可抽 ${deckPool.length} 詞`;
  preserveListFocus(list, () => {
    if (!state[collectionTab].length) {
      const hints = { prompts: "還沒有最愛詞彙。按卡片上的 ☆ 加入最愛，就能從這裡抽牌。", sets: "還沒有收藏牌組。抽牌後，按卡片下方的「收藏本次牌組」。", decks: "還沒有收藏分類。點卡片上的分類名稱，或從 Deck Settings 瀏覽分類。" };
      list.append(element("p", "empty", hints[collectionTab]));
    }
    if (collectionTab === "prompts") state.prompts.forEach(card => {
      const row = element("article", "collection-row"), text = element("div", "collection-copy");
      text.append(element("p", "archive-prompt", card.prompt), sourceButton(card));
      const star = promptButton(card, true); star.dataset.focusKey = cardKey(card);
      row.append(text, star); list.append(row);
    });
    if (collectionTab === "sets") state.sets.forEach(entry => {
      const row = element("article", "collection-row");
      const date = new Date(entry.date).toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" });
      const view = button("saved-set-view", "", () => {
        $("#collectionsDialog").close(); renderDraw(entry); refresh(); announce("已開啟收藏牌組，不會新增抽卡紀錄。"); $("#saveSet").focus();
      });
      view.dataset.focusKey = `view-${entry.id}`;
      const prompts = element("span", "saved-set-prompts");
      entry.cards.forEach((card, index) => {
        const line = element("span", "saved-set-prompt");
        const number = element("span", "saved-set-number", roman(index + 1));
        number.setAttribute("aria-hidden", "true");
        line.append(number, element("span", "saved-set-text", card.prompt));
        prompts.append(line);
      });
      view.append(prompts, element("span", "saved-set-date", `${date} · ${entry.cards.length} 張`), element("span", "saved-set-open", "展開牌組 →"));
      const remove = button("prompt-star saved", "★", () => {
        if (change(() => {
          store.toggleSet(entry);
          lastRemovedSet = entry;
        }, "已取消牌組收藏，可按「復原」恢復。")) $("#undoSetRemoval").focus({ preventScroll: true });
      });
      remove.dataset.focusKey = entry.id;
      remove.setAttribute("aria-label", `取消收藏牌組：${entry.cards[0].prompt}（${entry.cards.length} 張）`);
      remove.title = "取消整組收藏";
      row.append(view, remove); list.append(row);
    });
    if (collectionTab === "decks") state.decks.forEach(deck => {
      const row = element("article", "collection-row"), text = element("div", "collection-copy");
      const view = button("deck-title-link", deck.title, () => openDeck(deck.id)); view.dataset.focusKey = `view-${deck.id}`;
      text.append(view, element("p", "archive-meta", `${categoryNames.get(deck.categoryId || deck.id) || groupNames[currentGroups.get(deck.id) || deck.group]} · ${deck.items.length} 個詞 · 查看分類清單`));
      const remove = button("remove-button", "★ 取消收藏", () => change(() => store.toggleDeck(deck), "已取消題庫收藏，單題最愛仍會保留。"));
      remove.dataset.focusKey = deck.id;
      row.append(text, remove); list.append(row);
    });
  });
  syncButtons();
}
function renderArchive() {
  const list = $("#archiveList"); list.replaceChildren();
  const history = store.snapshot().history;
  if (!history.length) { list.append(element("div", "empty", "還沒有抽卡紀錄。收藏會另外保存在「我的收藏」。")); return; }
  const groups = new Map();
  history.forEach(entry => {
    const date = new Date(entry.date).toLocaleDateString("zh-TW");
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(entry);
  });
  groups.forEach((entries, date) => {
    const day = element("section", "archive-day"), rows = element("div");
    entries.forEach(entry => {
      const row = element("article", "archive-entry");
      row.append(element("p", "archive-prompt", entry.cards.map(card => card.prompt).join(" × ")));
      row.append(element("p", "archive-meta", `${new Date(entry.date).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} · ${entry.cards.length} 張`));
      row.append(button("source-link", "查看這次抽牌", () => { $("#archiveDialog").close(); renderDraw(entry); refresh(); $("#saveSet").focus(); }));
      rows.append(row);
    });
    day.append(element("div", "archive-date", date), rows); list.append(day);
  });
}

$("#drawOne").addEventListener("click", () => doDraw(1));
$("#drawThree").addEventListener("click", () => doDraw(3));
$$("[data-source]").forEach(node => node.addEventListener("click", () => setSource(node.dataset.source)));
$$("[data-source]").forEach(node => node.addEventListener("click", () => setSource(node.dataset.source)));
$$('[data-mode]').forEach(node => node.addEventListener("click", () => {
  drawMode = node.dataset.mode;
  $$('[data-mode]').forEach(modeButton => modeButton.setAttribute("aria-pressed", String(modeButton === node)));
  $("#distinctOption").hidden = drawMode !== "balanced";
  $("#drawModeHint").textContent = drawMode === "random" ? "目前可用詞彙混合抽取，每個詞機率相同。" : "先隨機選分類，再從分類中抽詞。";
  refresh();
}));
$("#distinctCategories").addEventListener("change", refresh);
$("#saveSet").addEventListener("click", () => {
  if (!currentEntry) return;
  const saved = store.snapshot().sets.some(entry => entry.id === currentEntry.id);
  change(() => store.toggleSet(currentEntry), saved ? "已取消本次牌組收藏。" : `★ 已一起收藏這 ${currentEntry.cards.length} 張牌。`);
});
$("#saveDeck").addEventListener("click", () => {
  if (!currentDeck) return;
  const saved = store.snapshot().decks.some(deck => deck.id === currentDeck.id);
  change(() => store.toggleDeck(currentDeck), saved ? "已取消分類收藏。" : `★ 已收藏此分類，共 ${currentDeck.items.length} 個詞。`);
});
$("#settingsButton").addEventListener("click", () => openDialog("settingsDialog"));
$("#archiveButton").addEventListener("click", () => { renderArchive(); openDialog("archiveDialog"); });
$("#collectionsButton").addEventListener("click", () => { renderCollections(); openDialog("collectionsDialog"); });
$$("[data-close]").forEach(node => node.addEventListener("click", () => document.getElementById(node.dataset.close).close()));
$("#deckDialog").addEventListener("close", () => {
  const opener = dialogOpeners.get("deckDialog");
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  else if ($("#collectionsDialog").open) $("[data-collection][aria-pressed='true']").focus({ preventScroll: true });
});
$$("[data-collection]").forEach(node => node.addEventListener("click", () => {
  collectionTab = node.dataset.collection; $("#collectionList").scrollTop = 0; renderCollections();
}));
$("#drawFavorite").addEventListener("click", () => {
  setSource("favorites");
  if (doDraw(1)) { $("#collectionsDialog").close(); $("#drawOne").focus(); }
});
$("#drawSavedDecks").addEventListener("click", () => {
  setSource("decks");
  if (doDraw(1)) { $("#collectionsDialog").close(); $("#drawOne").focus(); }
});
$("#undoSetRemoval").addEventListener("click", () => {
  const entry = lastRemovedSet;
  if (!entry) return;
  if (change(() => {
    if (!store.snapshot().sets.some(item => item.id === entry.id)) store.toggleSet(entry);
    lastRemovedSet = null;
  }, "★ 已復原牌組收藏。")) {
    const restored = $$(".saved-set-view").find(node => node.dataset.focusKey === `view-${entry.id}`);
    restored?.focus();
  }
});
$("#clearHistory").addEventListener("click", () => {
  if (confirm("確定清除所有抽卡紀錄？最愛詞彙、收藏牌組與收藏分類都會保留。")) change(() => store.clearHistory(), "已清除抽卡紀錄，所有收藏皆已保留。");
});
const categoryOptions = $("#categoryOptions");
DATA.categories.forEach(category => {
  const label = element("label", "deck-option");
  const input = element("input");
  input.type = "checkbox";
  input.value = category.id;
  const description = element("span");
  description.append(element("strong", "", category.name), element("small", "", `${category.words.length} 個詞彙`));
  label.append(input, description);
  categoryOptions.append(label);
});
$$("#settingsDialog input").forEach(node => {
  node.checked = store.snapshot().groups.includes(node.value);
  node.addEventListener("change", () => {
    const saved = change(() => store.setGroups($$("#settingsDialog input:checked").map(input => input.value)), "已保存題目分類設定。");
    if (!saved) $$("#settingsDialog input").forEach(input => { input.checked = store.snapshot().groups.includes(input.value); });
  });
});
DATA.decks.forEach(deck => {
  const option = element("option", "", `${deck.title}（${deck.items.length} 個詞彙）`);
  option.value = deck.id; $("#deckPicker").append(option);
});
$("#browseDeck").addEventListener("click", () => openDeck($("#deckPicker").value));
refresh();
if (store.loadError) announce("無法讀取瀏覽器儲存資料，目前暫停儲存以保護既有收藏。請檢查瀏覽器儲存設定。", true);
}).catch(error => {
  const status = document.querySelector("#statusMessage");
  if (status) {
    status.textContent = error.message || "題庫載入失敗，請使用 localhost 或 GitHub Pages 開啟。";
    status.classList.add("error");
  }
  console.error(error);
});
