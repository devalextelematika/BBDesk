import { readFile } from "node:fs/promises";

export const corruptText = /(?:Р[А-Яа-яЁёЀ-ӿ\u00A0-\u00BF]|С[Ђ-Џ\u0080-\u00BF\u2010-\u203F]){2,}|Рџ|Рњ|Рќ|РЎ|СЃ|С‚|вЂ[¦”–]|[ÐÑ][\u0080-\u00BF]|[\uFFFD\u0098]/u;
const sources = ["app.tsx", "launcher-navigation.tsx", "launcher-panel.tsx", "project-tabs.tsx", "server.ts", "state.ts", "package.json", "components/ui/icon.tsx", "components/thread-indicator.tsx"];
for (const name of sources) {
  const bytes = await readFile(new URL("../" + name, import.meta.url));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (corruptText.test(text)) throw new Error("Повреждённая кодировка в " + name);
}
const app = await readFile(new URL("../app.tsx", import.meta.url), "utf8");
for (const label of ["Рабочая область проектов", "На связи", "Приложения", "Требуют внимания", "Сохранить"]) {
  if (!app.includes(label)) throw new Error("Не найдена русская подпись: " + label);
}
console.log("UTF-8 и основные русские подписи проверены.");
