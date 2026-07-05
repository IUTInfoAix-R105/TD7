// app.js — interface du TP SQL en ligne.

import { initEngine, runQuery } from "./engine.js";
import { hashResult } from "./canon.js";
import { makeStore, buildExport, downloadText, exportFilename } from "./store.js";
import { highlightSQL } from "./highlight.js";

const MAX_DISPLAY_ROWS = 50;

let questions = null;
let store = null;
let state = { answers: {}, name: "" };
const cards = new Map(); // id -> { statusEl, resultEl, feedbackEl }

// ── Utilitaires DOM ─────────────────────────────────────────────────────────

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const c of children) node.appendChild(c);
  return node;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Rendu de l'en-tête ──────────────────────────────────────────────────────

function renderHeader(root) {
  const progress = el("span", { class: "progress", attrs: { id: "progress" }, text: "" });

  const nameInput = el("input", {
    class: "name-input",
    attrs: { type: "text", placeholder: "Votre nom (optionnel)", value: state.name },
  });
  nameInput.addEventListener("input", () => {
    state.name = nameInput.value;
    store.save(state);
  });

  const exportBtn = el("button", { class: "btn", text: "Exporter .sql" });
  exportBtn.addEventListener("click", () => {
    const sql = buildExport(questions, state);
    downloadText(exportFilename(questions.tdId, state.name), sql);
  });

  const resetBtn = el("button", { class: "btn btn-danger", text: "Tout effacer" });
  resetBtn.addEventListener("click", () => {
    if (!confirm("Effacer toutes vos réponses enregistrées dans ce navigateur ?")) return;
    store.clear();
    state = { answers: {}, name: "" };
    location.reload();
  });

  const actions = el("div", { class: "header-actions" }, [nameInput, exportBtn, resetBtn]);
  const titleRow = el("div", { class: "title-row" }, [
    el("h1", { text: `${questions.tdLabel} — ${questions.title}` }),
    progress,
  ]);

  const header = el("header", { class: "app-header" }, [titleRow]);
  if (questions.intro) header.appendChild(el("p", { class: "intro", text: questions.intro }));
  header.appendChild(actions);
  header.appendChild(el("p", {
    class: "hint",
    text: "Vos réponses sont enregistrées dans ce navigateur uniquement. La base est réinitialisée à chaque exécution.",
  }));
  root.appendChild(header);
}

// ── Panneau schéma ──────────────────────────────────────────────────────────

async function renderSchemaPanel(root) {
  const details = el("details", { class: "schema-panel" });
  details.appendChild(el("summary", { text: "Schéma de la base de données" }));
  const pre = el("pre", { class: "schema-sql", text: "Chargement…" });
  details.appendChild(pre);
  root.appendChild(details);
  try {
    const text = await fetch(questions.database.schemaFile).then((r) => r.text());
    pre.textContent = text.trim();
  } catch {
    pre.textContent = "(schéma indisponible)";
  }
}

// ── Rendu d'une table de résultat ───────────────────────────────────────────

function renderTable(result) {
  if (result.error) {
    return el("div", { class: "sql-error", text: "Erreur SQL : " + result.error });
  }
  const { cols, rows } = result;
  const table = el("table", { class: "result-table" });
  const thead = el("thead");
  thead.appendChild(el("tr", {}, cols.map((c) => el("th", { text: c }))));
  table.appendChild(thead);

  const tbody = el("tbody");
  const shown = rows.slice(0, MAX_DISPLAY_ROWS);
  for (const row of shown) {
    const tr = el("tr", {}, row.map((cell) => {
      if (cell === null || cell === undefined) {
        return el("td", { class: "cell-null" }, [el("span", { text: "NULL" })]);
      }
      return el("td", { text: String(cell) });
    }));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const wrap = el("div", { class: "table-wrap" }, [table]);
  if (rows.length > MAX_DISPLAY_ROWS) {
    wrap.appendChild(el("p", {
      class: "table-more",
      text: `… et ${rows.length - MAX_DISPLAY_ROWS} autres lignes (${rows.length} au total)`,
    }));
  } else if (rows.length === 0) {
    wrap.appendChild(el("p", { class: "table-more", text: "(aucune ligne)" }));
  }
  return wrap;
}

// ── Évaluation d'une réponse ────────────────────────────────────────────────

async function grade(question, result) {
  if (result.error) return { kind: "error", message: result.error };
  const ncols = result.cols.length;
  const nrows = result.rows.length;
  const colsOk = ncols === question.expectedCols;
  const rowsOk = nrows === question.expectedRows;

  let sortedHash, orderedHash = null;
  try {
    sortedHash = await hashResult(ncols, result.rows, false);
    if (question.orderSensitive) orderedHash = await hashResult(ncols, result.rows, true);
  } catch (e) {
    return { kind: "hashfail", message: String(e && e.message || e), colsOk, rowsOk, ncols, nrows };
  }
  const sortedMatch = question.hashesSorted.includes(sortedHash);

  let exact = sortedMatch;
  let orderWrong = false;
  if (question.orderSensitive) {
    const orderedMatch = orderedHash === question.hashOrdered;
    exact = sortedMatch && orderedMatch;
    orderWrong = sortedMatch && !orderedMatch;
  }

  let kind;
  if (exact) kind = "exact";
  else if (orderWrong) kind = "order";
  else kind = "wrong";
  return { kind, colsOk, rowsOk, ncols, nrows };
}

function chip(label, ok) {
  return el("span", { class: "chip " + (ok ? "chip-ok" : "chip-ko"), text: `${ok ? "✓" : "✗"} ${label}` });
}

function renderFeedback(question, g) {
  const box = el("div", { class: "feedback" });
  if (g.kind === "error") {
    box.classList.add("feedback-error");
    const msg = g.message ? "✗ Erreur SQL : " + g.message : "✗ Erreur SQL";
    box.appendChild(el("span", { class: "chip chip-ko", text: msg }));
    return box;
  }
  if (g.kind === "hashfail") {
    box.classList.add("feedback-error");
    box.appendChild(el("span", {
      class: "chip chip-ko",
      text: "✗ Vérification impossible (calcul du hash) : " + g.message,
    }));
    return box;
  }
  box.appendChild(chip(`Colonnes (attendu ${question.expectedCols}, obtenu ${g.ncols})`, g.colsOk));
  box.appendChild(chip(`Lignes (attendu ${question.expectedRows}, obtenu ${g.nrows})`, g.rowsOk));

  if (g.kind === "exact") {
    box.appendChild(el("span", { class: "chip chip-ok chip-strong", text: "✓ Résultat exact" }));
  } else if (g.kind === "order") {
    box.appendChild(el("span", { class: "chip chip-warn", text: "≈ Contenu correct, mais l'ordre demandé n'est pas respecté" }));
  } else if (g.colsOk && g.rowsOk) {
    box.appendChild(el("span", { class: "chip chip-ko", text: "✗ Bons nombres de colonnes/lignes, mais le contenu diffère" }));
  } else {
    box.appendChild(el("span", { class: "chip chip-ko", text: "✗ Résultat incorrect" }));
  }
  return box;
}

// ── Carte de question ───────────────────────────────────────────────────────

function difficultyStars(n) {
  if (n == null) return "";
  return "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

function renderQuestion(container, question) {
  const card = el("section", { class: "question-card", attrs: { id: question.id } });

  const titleBits = [el("span", { class: "q-num", text: "Q" + question.num })];
  if (question.difficulty != null) {
    titleBits.push(el("span", { class: "q-diff", attrs: { title: `difficulté ${question.difficulty}/5` }, text: difficultyStars(question.difficulty) }));
  }
  const status = el("span", { class: "q-status", text: "" });
  titleBits.push(status);
  card.appendChild(el("div", { class: "q-head" }, titleBits));

  card.appendChild(el("p", { class: "q-statement", text: question.statement }));
  if (question.expectedLabel) {
    card.appendChild(el("p", { class: "q-expected", text: "Attendu : " + question.expectedLabel }));
  }
  if (question.sameAs) {
    card.appendChild(el("p", { class: "q-sameas", text: "Même résultat que " + question.sameAs.toUpperCase() }));
  }

  // Éditeur : textarea transparent au-dessus d'un calque <pre> colorié.
  const textarea = el("textarea", {
    class: "q-input",
    attrs: { spellcheck: "false", rows: "4", placeholder: "Écrivez votre requête SQL ici…" },
  });
  textarea.value = state.answers[question.id] || "";
  const highlightCode = el("code");
  const highlightPre = el("pre", { class: "q-highlight", attrs: { "aria-hidden": "true" } }, [highlightCode]);
  const editor = el("div", { class: "q-editor" }, [highlightPre, textarea]);

  function syncHighlight() {
    // Ajoute un espace final pour qu'une ligne vide terminale s'affiche comme dans le textarea.
    highlightCode.innerHTML = highlightSQL(textarea.value + "\n");
    highlightPre.scrollTop = textarea.scrollTop;
    highlightPre.scrollLeft = textarea.scrollLeft;
  }

  const saveDebounced = debounce(() => store.save(state), 400);
  textarea.addEventListener("input", () => {
    state.answers[question.id] = textarea.value;
    syncHighlight();
    saveDebounced();
  });
  textarea.addEventListener("scroll", () => {
    highlightPre.scrollTop = textarea.scrollTop;
    highlightPre.scrollLeft = textarea.scrollLeft;
  });
  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const s = textarea.selectionStart, en = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, s) + "    " + textarea.value.slice(en);
      textarea.selectionStart = textarea.selectionEnd = s + 4;
      state.answers[question.id] = textarea.value;
      syncHighlight();
      saveDebounced();
    }
  });
  syncHighlight();

  const runBtn = el("button", { class: "btn btn-run", text: "Exécuter ▶" });
  const hint = el("span", { class: "run-hint", text: "Ctrl/Cmd + Entrée" });
  const resultEl = el("div", { class: "q-result" });
  const feedbackEl = el("div", { class: "q-feedback" });

  async function run() {
    const sql = textarea.value.trim();
    if (!sql) {
      resultEl.replaceChildren();
      feedbackEl.replaceChildren();
      status.textContent = "";
      return;
    }
    state.answers[question.id] = textarea.value;
    store.save(state);
    try {
      const result = runQuery(sql);
      resultEl.replaceChildren(renderTable(result));
      const g = await grade(question, result);
      feedbackEl.replaceChildren(renderFeedback(question, g));
      status.textContent = g.kind === "exact" ? "✓" : "";
      status.className = "q-status " + (g.kind === "exact" ? "ok" : "");
      updateProgress();
    } catch (e) {
      feedbackEl.replaceChildren(el("div", { class: "feedback feedback-error" }, [
        el("span", { class: "chip chip-ko", text: "✗ Erreur interne : " + String(e && e.message || e) }),
      ]));
    }
  }

  runBtn.addEventListener("click", run);

  card.appendChild(editor);
  card.appendChild(el("div", { class: "q-actions" }, [runBtn, hint]));
  card.appendChild(resultEl);
  card.appendChild(feedbackEl);
  container.appendChild(card);

  cards.set(question.id, { status });
}

// ── Progression ─────────────────────────────────────────────────────────────

let totalQuestions = 0;
const exactSet = new Set();

function updateProgress() {
  exactSet.clear();
  for (const [id, refs] of cards) {
    if (refs.status.textContent === "✓") exactSet.add(id);
  }
  const p = document.getElementById("progress");
  if (p) p.textContent = `Exactes : ${exactSet.size}/${totalQuestions}`;
}

// ── Amorçage ────────────────────────────────────────────────────────────────

async function main() {
  const root = document.getElementById("app");
  try {
    questions = await fetch("questions.json").then((r) => r.json());
  } catch {
    root.appendChild(el("p", { class: "fatal", text: "Impossible de charger questions.json." }));
    return;
  }
  store = makeStore(questions.tdId);
  state = store.load();

  renderHeader(root);
  await renderSchemaPanel(root);

  const main = el("main", { class: "sections" });
  for (const section of questions.sections) {
    if (section.name) main.appendChild(el("h2", { class: "section-title", text: section.name }));
    for (const item of section.items) {
      if (item.type === "instruction") main.appendChild(el("p", { class: "instruction", text: item.text }));
      else if (item.type === "text") main.appendChild(el("p", { class: "free-text", text: item.text }));
      else if (item.type === "question") { totalQuestions++; renderQuestion(main, item); }
    }
  }
  root.appendChild(main);

  const status = el("p", { class: "engine-status", text: "Chargement de SQLite (WASM)…" });
  root.appendChild(status);
  try {
    await initEngine(questions.database.schemaFile, questions.database.insertFile);
    status.remove();
  } catch (e) {
    status.className = "engine-status fatal";
    status.textContent = "Échec du chargement de SQLite : " + (e.message || e)
      + " (la page doit être servie en http(s), pas ouverte via file://).";
  }
  updateProgress();
}

main();
