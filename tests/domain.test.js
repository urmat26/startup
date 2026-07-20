import test from 'node:test';
import assert from 'node:assert/strict';

await import('../app/domain.js');

const {
  calculateCogs,
  calculateInventory,
  calculateRevenue,
  findMissingIngredients,
  salesForPeriod,
} = globalThis.EsepDomain;

const ingredients = [
  { id: 'beans', name: 'Зёрна', stock: 20, cost: 1.5 },
  { id: 'cup', name: 'Стаканы', stock: 2, cost: 4 },
];
const products = [
  { id: 'esp', name: 'Эспрессо', price: 90, recipe: { beans: 18, cup: 1 } },
];
const sales = [
  { productId: 'esp', periodId: 1 },
  { productId: 'esp', periodId: 2 },
];

test('period metrics include only sales from the selected shift', () => {
  assert.equal(salesForPeriod(sales, 1).length, 1);
  assert.equal(calculateRevenue(sales, products, 1), 90);
  assert.equal(calculateCogs(sales, products, ingredients, 1), 31);
});

test('canceled sales are excluded from shift metrics', () => {
  const canceled = [
    ...sales,
    { productId: 'esp', periodId: 1, canceledAt: Date.now() },
  ];
  assert.equal(salesForPeriod(canceled, 1).length, 1);
  assert.equal(calculateRevenue(canceled, products, 1), 90);
  assert.equal(calculateCogs(canceled, products, ingredients, 1), 31);
});

test('sale is blocked when any recipe ingredient is missing', () => {
  const missing = findMissingIngredients(products[0], [
    { ...ingredients[0], stock: 17 },
    ingredients[1],
  ]);
  assert.deepEqual(missing.map(({ ingredient }) => ingredient.id), ['beans']);
});

test('inventory converts shortage into money and ignores surplus', () => {
  const result = calculateInventory(ingredients, { beans: 10, cup: 3 });
  assert.equal(result[0].leak, 15);
  assert.equal(result[1].leak, 0);
});

test('inventory rejects incomplete or negative actual stock', () => {
  assert.throws(() => calculateInventory(ingredients, { beans: 10 }), TypeError);
  assert.throws(() => calculateInventory(ingredients, { beans: -1, cup: 1 }), TypeError);
});
