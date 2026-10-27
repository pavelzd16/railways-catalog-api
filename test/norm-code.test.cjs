// Разбор номеров нормативных документов: примеры общие с сайтом (test/fixtures/norm-codes.json).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const examples = require('./fixtures/norm-codes.json');
const {
  codeToSlug,
  normalizeCode,
  parseGostField,
  matchProductsByCode,
  normDocsForGost,
} = require('../dist/src/normativ/norm-code');

test('codeToSlug: транслит в нижний регистр, всё прочее — один дефис', () => {
  for (const { code, slug } of examples.codeToSlug) assert.equal(codeToSlug(code), slug, code);
});

test('normalizeCode: регистр, ё, пробелы, тире, латиница в обозначении, «ГОСТ Р»', () => {
  for (const { input, output } of examples.normalizeCode) assert.equal(normalizeCode(input), output, input);
});

test('parseGostField режет по «;» и «,» вне скобок и вынимает «(заменён на …)»', () => {
  for (const { gost, items } of examples.parseGostField) {
    assert.deepEqual(parseGostField(gost).map((item) => ({ ...item })), items, String(gost));
  }
});

test('matchProductsByCode: совпадение по номеру или замене, без ложных подстрок', () => {
  for (const { code, gost, match } of examples.match) {
    const product = { id: 'p', gost };
    assert.deepEqual(matchProductsByCode(code, [product]), match ? [product] : [], `${code} ~ ${gost}`);
  }
});

test('matchProductsByCode сохраняет порядок товаров и отбрасывает чужие', () => {
  const products = [
    { id: 'a', gost: 'ГОСТ 4121-96' },
    { id: 'b', gost: 'ГОСТ 24741-2016' },
    { id: 'c', gost: 'ГОСТ 4121-96; ГОСТ Р 53866-2010' },
    { id: 'd', gost: null },
  ];
  assert.deepEqual(matchProductsByCode('ГОСТ 4121-96', products).map((p) => p.id), ['a', 'c']);
});

test('normDocsForGost: документы справочника из строки gost, по порядку, вместе с заменой, без повторов', () => {
  const docs = [
    { code: 'ГОСТ Р 52290-2024', slug: 'gost-r-52290-2024' },
    { code: 'ГОСТ 8442-65', slug: 'gost-8442-65' },
    { code: 'ГОСТ 4121-96', slug: 'gost-4121-96' },
  ];
  const gost = 'ГОСТ 8442-65; ГОСТ Р 52290-2004 (заменён на ГОСТ Р 52290-2024); ГОСТ 8442-65';
  assert.deepEqual(normDocsForGost(gost, docs), [
    { code: 'ГОСТ 8442-65', slug: 'gost-8442-65' },
    { code: 'ГОСТ Р 52290-2024', slug: 'gost-r-52290-2024' },
  ]);
  assert.deepEqual(normDocsForGost(null, docs), []);
  assert.deepEqual(normDocsForGost('ГОСТ 15812-2014', [{ code: 'ГОСТ 5812-2014', slug: 'x' }]), []);
});
