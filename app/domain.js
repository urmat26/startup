export function salesForPeriod(sales, periodId) {
  return sales.filter((sale) => sale.periodId === periodId);
}

export function calculateRevenue(sales, products, periodId) {
  const prices = new Map(products.map((product) => [product.id, product.price]));
  return salesForPeriod(sales, periodId)
    .reduce((total, sale) => total + (prices.get(sale.productId) ?? 0), 0);
}

export function calculateCogs(sales, products, ingredients, periodId) {
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

export function findMissingIngredients(product, ingredients) {
  const stock = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

  return Object.entries(product.recipe).flatMap(([ingredientId, quantity]) => {
    const ingredient = stock.get(ingredientId);
    if (ingredient && ingredient.stock >= quantity) return [];
    return [{ ingredient: ingredient ?? { id: ingredientId, name: ingredientId, stock: 0 }, qty: quantity }];
  });
}

export function calculateInventory(ingredients, actualById) {
  return ingredients.map((ingredient) => {
    const actual = actualById[ingredient.id];
    if (!Number.isFinite(actual) || actual < 0) {
      throw new TypeError(`Invalid actual stock for ${ingredient.id}`);
    }
    const difference = ingredient.stock - actual;
    return {
      id: ingredient.id,
      theoretical: ingredient.stock,
      actual,
      difference,
      leak: Math.max(0, difference) * ingredient.cost,
    };
  });
}
