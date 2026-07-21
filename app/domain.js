(function initializeDomain(global) {
function salesForPeriod(sales, periodId) {
  return sales.filter((sale) => sale.periodId === periodId && !sale.canceledAt);
}

function calculateRevenue(sales, products, periodId) {
  const prices = new Map(products.map((product) => [product.id, product.price]));
  return salesForPeriod(sales, periodId)
    .reduce((total, sale) => total + (prices.get(sale.productId) ?? 0), 0);
}

function calculateCogs(sales, products, ingredients, periodId) {
  const costs = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.cost]));
  const productCosts = new Map(products.map((product) => [
    product.id,
    Object.entries(product.recipe).reduce(
      (total, [ingredientId, quantity]) => total + (costs.get(ingredientId) ?? 0) * quantity,
      0,
    ),
  ]));

  return salesForPeriod(sales, periodId)
    .reduce((total, sale) => total + (productCosts.get(sale.productId) ?? 0), 0);
}

function findMissingIngredients(product, ingredients) {
  const stock = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

  return Object.entries(product.recipe).flatMap(([ingredientId, quantity]) => {
    const ingredient = stock.get(ingredientId);
    if (ingredient && ingredient.stock >= quantity) return [];
    return [{ ingredient: ingredient ?? { id: ingredientId, name: ingredientId, stock: 0 }, qty: quantity }];
  });
}

function createInventorySnapshot(ingredients) {
  return Object.fromEntries(ingredients.map((ingredient) => [ingredient.id, ingredient.stock]));
}

function calculateIngredientUsage(sales, products, periodId) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const usage = {};
  salesForPeriod(sales, periodId).forEach((sale) => {
    const product = productById.get(sale.productId);
    if (!product) return;
    Object.entries(product.recipe).forEach(([ingredientId, quantity]) => {
      usage[ingredientId] = (usage[ingredientId] ?? 0) + quantity;
    });
  });
  return usage;
}

function simulateActualStock(ingredients, theoreticalById, usageById) {
  return Object.fromEntries(ingredients.map((ingredient) => {
    const theoretical = theoreticalById[ingredient.id];
    const usage = Math.max(0, usageById[ingredient.id] ?? 0);
    if (!Number.isFinite(theoretical) || theoretical < 0) {
      throw new TypeError(`Invalid theoretical stock for ${ingredient.id}`);
    }
    const baseError = usage > 0 ? ingredient.unit === 'мл' ? 5 : ingredient.unit === 'г' ? 1 : 0 : 0;
    const shortage = ingredient.unit === 'шт'
      ? Math.round(usage * 0.075)
      : Math.round(usage * 0.075 + baseError);
    return [ingredient.id, Math.max(0, theoretical - shortage)];
  }));
}

function calculateInventory(ingredients, actualById, theoreticalById = createInventorySnapshot(ingredients)) {
  return ingredients.map((ingredient) => {
    const actual = actualById[ingredient.id];
    const theoretical = theoreticalById[ingredient.id];
    if (!Number.isFinite(actual) || actual < 0) {
      throw new TypeError(`Invalid actual stock for ${ingredient.id}`);
    }
    if (!Number.isFinite(theoretical) || theoretical < 0) {
      throw new TypeError(`Invalid theoretical stock for ${ingredient.id}`);
    }
    const difference = theoretical - actual;
    return {
      id: ingredient.id,
      theoretical,
      actual,
      difference,
      leak: Math.max(0, difference) * ingredient.cost,
    };
  });
}

global.EsepDomain = {
  calculateCogs,
  calculateIngredientUsage,
  calculateInventory,
  calculateRevenue,
  createInventorySnapshot,
  findMissingIngredients,
  salesForPeriod,
  simulateActualStock,
};
}(globalThis));
