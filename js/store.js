// store.js — persistance des réponses (localStorage) et export .sql.
//
// Les réponses restent dans le navigateur de l'étudiant : rien n'est envoyé à un
// serveur. La clé inclut l'identifiant du TD et une version de schéma (v1) : ne la
// changer que si le sens des identifiants de questions change.

const SCHEMA_VERSION = "v1";

export function makeStore(tdId) {
  const key = `webtd:${tdId}:${SCHEMA_VERSION}`;

  function load() {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { answers: {}, name: "" };
      const data = JSON.parse(raw);
      return { answers: data.answers || {}, name: data.name || "" };
    } catch {
      return { answers: {}, name: "" };
    }
  }

  function save(state) {
    try {
      localStorage.setItem(key, JSON.stringify({
        answers: state.answers,
        name: state.name,
        savedAt: new Date().toISOString(),
      }));
    } catch {
      /* quota plein ou stockage indisponible : on ignore silencieusement */
    }
  }

  function clear() {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  return { key, load, save, clear };
}

// Construit un fichier .sql : un bloc commenté par question + la réponse (ou un
// marqueur d'absence de réponse). L'énoncé est inséré en commentaire pour repérage.
export function buildExport(questions, state) {
  const lines = [];
  lines.push(`-- ${questions.tdLabel} : ${questions.title}`);
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`-- Export du ${today}${state.name ? ` — ${state.name}` : ""}`);
  lines.push("");

  for (const section of questions.sections) {
    for (const item of section.items) {
      if (item.type !== "question") continue;
      const stmt = (item.statement || "").replace(/\s+/g, " ").trim();
      lines.push(`-- Q${item.num} — ${stmt}`);
      const answer = (state.answers[item.id] || "").trim();
      if (answer) {
        lines.push(answer.endsWith(";") ? answer : answer + ";");
      } else {
        lines.push("-- (pas de réponse)");
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
