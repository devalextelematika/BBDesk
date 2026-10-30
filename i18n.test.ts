import { test } from "node:test";
import assert from "node:assert/strict";
import { createTranslator, resolveLanguage } from "./i18n.ts";
import { en } from "./locales/en.ts";
import { ru } from "./locales/ru.ts";

test("English is the fallback, independently of browser language", () => {
  for (const value of [undefined, null, "", "de", "auto", "RU", 1]) assert.equal(resolveLanguage(value), "en");
  assert.equal(resolveLanguage("ru"), "ru");
  assert.equal(createTranslator(resolveLanguage(undefined))("chooseProjects"), "Choose projects to follow");
});

test("both catalogs cover the same messages and interpolation parameters", () => {
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    const english = en[key];
    const russian = ru[key];
    const texts = typeof russian === "string" ? [russian] : Object.values(russian);
    const reference = typeof english === "string" ? english : english.other;
    for (const text of texts) {
      assert.ok(text.trim(), key);
      assert.deepEqual(placeholders(text), placeholders(reference), key);
    }
  }
});

test("translations preserve user text literally and use locale-specific plurals", () => {
  const name = "Проект <b>Demo</b> {count} $&";
  assert.equal(createTranslator("en")("openAlongside", { name }), `Open ${name} alongside`);
  assert.equal(createTranslator("ru")("openAlongside", { name }), `Открыть ${name} рядом`);
  assert.equal(createTranslator("en")("pixels", { count: 1 }), "1 pixel");
  assert.equal(createTranslator("en")("pixels", { count: 21 }), "21 pixels");
  const tr = createTranslator("ru");
  for (const [count, text] of [[1, "1 пиксель"], [2, "2 пикселя"], [5, "5 пикселей"], [11, "11 пикселей"], [21, "21 пиксель"]] as const) {
    assert.equal(tr("pixels", { count }), text);
  }
});
