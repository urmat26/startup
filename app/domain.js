(function initializeDomain(global) {
function salesForPeriod(sales, periodId) {
  return sales.filter((sale) => sale.periodId === periodId && sale.canceledAt == null);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateRevenue(sales, products, periodId) {
  const prices = new Map(products.map((product) => [product.id, product.price]));
  return roundMoney(salesForPeriod(sales, periodId)
    .reduce((total, sale) => total + (Number.isFinite(sale.unitPrice) ? sale.unitPrice : prices.get(sale.productId) ?? 0), 0));
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

  return roundMoney(salesForPeriod(sales, periodId)
    .reduce((total, sale) => total + (Number.isFinite(sale.cogs) ? sale.cogs : productCosts.get(sale.productId) ?? 0), 0));
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

function findLowStock(ingredients) {
  return ingredients.filter((ingredient) => ingredient.stock < ingredient.threshold);
}

function calculateIngredientUsage(sales, products, periodId) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const usage = {};
  salesForPeriod(sales, periodId).forEach((sale) => {
    const product = productById.get(sale.productId);
    const recipe = sale.recipeSnapshot ?? product?.recipe;
    if (!recipe) return;
    Object.entries(recipe).forEach(([ingredientId, quantity]) => {
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
      shortageValue: roundMoney(Math.max(0, difference) * ingredient.cost),
      overageValue: roundMoney(Math.max(0, -difference) * ingredient.cost),
      netValue: roundMoney(difference * ingredient.cost),
      leak: roundMoney(Math.max(0, difference) * ingredient.cost),
    };
  });
}

const isFiniteNonNegative = (value) => Number.isFinite(value) && value >= 0;
const moneyEquals = (left, right) => Math.abs(roundMoney(left) - roundMoney(right)) < 1e-7;

function validateInventory(inventory, ingredients, periodIds) {
  if (!inventory || typeof inventory.id !== 'string' || !periodIds.has(inventory.periodId)
    || !Number.isFinite(inventory.closedAt) || !Array.isArray(inventory.items)
    || inventory.items.length !== ingredients.length || !isFiniteNonNegative(inventory.total)) return false;

  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const itemIds = new Set(inventory.items.map((item) => item?.id));
  if (itemIds.size !== ingredients.length || !ingredients.every((ingredient) => itemIds.has(ingredient.id))) return false;

  if (!inventory.items.every((item) => {
    const ingredient = ingredientsById.get(item?.id);
    if (!ingredient || typeof item.name !== 'string' || typeof item.unit !== 'string'
      || !isFiniteNonNegative(item.theoretical) || !isFiniteNonNegative(item.actual)
      || !Number.isFinite(item.difference) || !Number.isFinite(item.diff)
      || !isFiniteNonNegative(item.shortageValue) || !isFiniteNonNegative(item.overageValue)
      || !Number.isFinite(item.netValue) || !isFiniteNonNegative(item.leak)) return false;
    const difference = item.theoretical - item.actual;
    return Math.abs(item.difference - difference) < 1e-7
      && Math.abs(item.diff - difference) < 1e-7
      && moneyEquals(item.shortageValue, Math.max(0, difference) * ingredient.cost)
      && moneyEquals(item.overageValue, Math.max(0, -difference) * ingredient.cost)
      && moneyEquals(item.netValue, difference * ingredient.cost)
      && moneyEquals(item.leak, item.shortageValue);
  })) return false;

  return moneyEquals(inventory.total, inventory.items.reduce((sum, item) => sum + item.shortageValue, 0));
}

function inventoriesMatch(left, right) {
  if (left.id !== right.id || left.periodId !== right.periodId || left.closedAt !== right.closedAt
    || !moneyEquals(left.total, right.total) || left.items.length !== right.items.length) return false;
  const rightItems = new Map(right.items.map((item) => [item.id, item]));
  return left.items.every((item) => {
    const match = rightItems.get(item.id);
    return match && item.name === match.name && item.unit === match.unit
      && Math.abs(item.theoretical - match.theoretical) < 1e-7
      && Math.abs(item.actual - match.actual) < 1e-7
      && Math.abs(item.difference - match.difference) < 1e-7
      && moneyEquals(item.shortageValue, match.shortageValue)
      && moneyEquals(item.overageValue, match.overageValue)
      && moneyEquals(item.netValue, match.netValue)
      && moneyEquals(item.leak, match.leak);
  });
}

function validateState(state) {
  if (!state || state.schemaVersion !== 2 || !Array.isArray(state.ingredients)
    || !Array.isArray(state.products) || !Array.isArray(state.sales)) return false;
  const ingredientIds = new Set(state.ingredients.map((ingredient) => ingredient?.id));
  const productIds = new Set(state.products.map((product) => product?.id));
  if (ingredientIds.size !== state.ingredients.length || productIds.size !== state.products.length) return false;
  if (!state.ingredients.every((ingredient) => ingredient && typeof ingredient.id === 'string'
    && typeof ingredient.name === 'string' && typeof ingredient.unit === 'string'
    && isFiniteNonNegative(ingredient.stock) && isFiniteNonNegative(ingredient.start)
    && isFiniteNonNegative(ingredient.threshold) && isFiniteNonNegative(ingredient.cost))) return false;
  if (!state.products.every((product) => product && typeof product.id === 'string'
    && typeof product.name === 'string' && isFiniteNonNegative(product.price) && product.recipe
    && Object.entries(product.recipe).length > 0
    && Object.entries(product.recipe).every(([id, quantity]) => ingredientIds.has(id)
      && Number.isFinite(quantity) && quantity > 0))) return false;
  if (state.role !== 'owner' && state.role !== 'barista') return false;
  if (!Array.isArray(state.periods) || state.periods.filter((period) => period?.closedAt == null).length !== 1) return false;
  const periodIds = new Set(state.periods.map((period) => period?.id));
  if (periodIds.size !== state.periods.length || !state.periods.every((period) => period
    && Number.isFinite(period.id) && Number.isFinite(period.openedAt)
    && (period.closedAt == null || Number.isFinite(period.closedAt)))) return false;
  if (!Array.isArray(state.movements) || !Array.isArray(state.inventories)) return false;
  if (new Set(state.sales.map((sale) => sale?.id)).size !== state.sales.length
    || new Set(state.movements.map((event) => event?.id)).size !== state.movements.length
    || new Set(state.inventories.map((inventory) => inventory?.id)).size !== state.inventories.length) return false;
  if (!state.sales.every((sale) => sale && typeof sale.id === 'string' && productIds.has(sale.productId)
    && periodIds.has(sale.periodId) && Number.isFinite(sale.ts)
    && (sale.canceledAt == null || Number.isFinite(sale.canceledAt))
    && isFiniteNonNegative(sale.unitPrice) && isFiniteNonNegative(sale.cogs) && sale.recipeSnapshot
    && Object.entries(sale.recipeSnapshot).every(([id, quantity]) => ingredientIds.has(id)
      && Number.isFinite(quantity) && quantity > 0))) return false;
  if (!state.movements.every((event) => event && typeof event.id === 'string'
    && ingredientIds.has(event.ingredientId) && periodIds.has(event.periodId)
    && Number.isFinite(event.qty) && Number.isFinite(event.ts))) return false;
  if (!state.inventories.every((inventory) => validateInventory(inventory, state.ingredients, periodIds))) return false;
  if (state.lastInventory) {
    if (!validateInventory(state.lastInventory, state.ingredients, periodIds)) return false;
    const stored = state.inventories.find((inventory) => inventory.id === state.lastInventory.id);
    if (!stored || !inventoriesMatch(stored, state.lastInventory)) return false;
  }
  if (state.inventoryDraft) {
    if (!periodIds.has(state.inventoryDraft.periodId) || !Number.isFinite(state.inventoryDraft.startedAt)
      || !state.inventoryDraft.snapshot) return false;
    if (!state.ingredients.every((ingredient) => isFiniteNonNegative(state.inventoryDraft.snapshot[ingredient.id]))) return false;
    if (state.inventoryDraft.actual
      && !Object.entries(state.inventoryDraft.actual).every(([id, value]) => ingredientIds.has(id)
        && isFiniteNonNegative(value))) return false;
  }
  return state.ingredients.every((ingredient) => {
    const projected = ingredient.start + state.movements
      .filter((event) => event.ingredientId === ingredient.id)
      .reduce((sum, event) => sum + event.qty, 0);
    return Math.abs(projected - ingredient.stock) < 1e-7;
  });
}

function migrateLegacyState(legacy, migratedAt = Date.now()) {
  if (!legacy || !Array.isArray(legacy.ingredients) || !Array.isArray(legacy.products)
    || !Array.isArray(legacy.sales)) return null;
  const ingredients = legacy.ingredients.map((ingredient) => ({ ...ingredient }));
  const products = legacy.products.map((product) => ({ ...product, recipe: { ...product.recipe } }));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const periods = Array.isArray(legacy.periods) && legacy.periods.length
    ? legacy.periods.map((period) => ({ ...period }))
    : [{ id: 1, openedAt: migratedAt, closedAt: null }];
  let openPeriods = periods.filter((period) => period.closedAt == null);
  if (!openPeriods.length) {
    const nextId = Math.max(0, ...periods.map((period) => period.id)) + 1;
    periods.push({ id: nextId, openedAt: migratedAt, closedAt: null });
    openPeriods = [periods.at(-1)];
  }
  if (openPeriods.length > 1) {
    openPeriods.slice(0, -1).forEach((period) => { period.closedAt = migratedAt; });
  }
  const openPeriod = openPeriods.at(-1);
  const sales = legacy.sales.map((sale, index) => {
    const product = productsById.get(sale.productId);
    if (!product) return { ...sale };
    const recipeSnapshot = sale.recipeSnapshot ? { ...sale.recipeSnapshot } : { ...product.recipe };
    const cogs = Number.isFinite(sale.cogs) ? sale.cogs : roundMoney(Object.entries(recipeSnapshot)
      .reduce((sum, [id, quantity]) => sum + (ingredientsById.get(id)?.cost ?? 0) * quantity, 0));
    return { ...sale, id: String(sale.id ?? `legacy-sale-${index}`), periodId: sale.periodId ?? openPeriod.id,
      productName: sale.productName ?? product.name, unitPrice: sale.unitPrice ?? product.price, cogs, recipeSnapshot };
  });
  const movements = (Array.isArray(legacy.movements) ? legacy.movements : []).map((event, index) => ({
    ...event,
    id: String(event.id ?? `legacy-event-${index}`),
    periodId: event.periodId ?? openPeriod.id,
  }));
  ingredients.forEach((ingredient) => {
    const projected = ingredient.start + movements.filter((event) => event.ingredientId === ingredient.id)
      .reduce((sum, event) => sum + event.qty, 0);
    const balance = ingredient.stock - projected;
    if (Math.abs(balance) >= 1e-7) movements.push({
      id: `migration-${ingredient.id}-${migratedAt}`,
      periodId: openPeriod.id,
      ingredientId: ingredient.id,
      type: 'migration',
      qty: balance,
      note: 'Баланс при миграции esep-demo-v1',
      sourceId: null,
      ts: migratedAt,
    });
  });

  function normalizeInventory(inventory, index) {
    const actual = Object.fromEntries(ingredients.map((ingredient) => [ingredient.id,
      inventory.actual?.[ingredient.id] ?? inventory.items?.find((item) => item.id === ingredient.id)?.actual]));
    const theoretical = Object.fromEntries(ingredients.map((ingredient) => [ingredient.id,
      inventory.snapshot?.[ingredient.id]
        ?? inventory.items?.find((item) => item.id === ingredient.id)?.theoretical]));
    const items = calculateInventory(ingredients, actual, theoretical).map((item) => {
      const ingredient = ingredientsById.get(item.id);
      return { ...item, name: ingredient.name, unit: ingredient.unit, diff: item.difference };
    });
    return { id: String(inventory.id ?? `legacy-inventory-${index}`),
      periodId: inventory.periodId ?? openPeriod.id, closedAt: inventory.closedAt ?? migratedAt,
      items, total: roundMoney(items.reduce((sum, item) => sum + item.shortageValue, 0)) };
  }

  const inventorySources = Array.isArray(legacy.inventories) && legacy.inventories.length
    ? legacy.inventories
    : legacy.lastInventory ? [legacy.lastInventory]
      : legacy.inv?.completed ? [legacy.inv] : [];
  let inventories;
  try { inventories = inventorySources.map(normalizeInventory); } catch (error) { return null; }
  let lastInventory = null;
  if (legacy.lastInventory) {
    const lastIndex = inventorySources.findIndex((inventory) =>
      (legacy.lastInventory.id != null && inventory.id === legacy.lastInventory.id)
      || (legacy.lastInventory.id == null && inventory.periodId === legacy.lastInventory.periodId));
    lastInventory = inventories[lastIndex >= 0 ? lastIndex : inventories.length - 1] ?? null;
  } else if (legacy.inv?.completed) {
    lastInventory = inventories.at(-1) ?? null;
  }
  const draftSource = legacy.inventoryDraft ?? (legacy.inv && !legacy.inv.completed ? legacy.inv : null);
  const inventoryDraft = draftSource ? {
    periodId: draftSource.periodId ?? openPeriod.id,
    startedAt: draftSource.startedAt ?? migratedAt,
    snapshot: { ...draftSource.snapshot },
    actual: { ...(draftSource.actual ?? {}) },
  } : null;
  return { ...legacy, schemaVersion: 2, ingredients, products, sales, role: legacy.role ?? 'owner', periods,
    movements, inventories, lastInventory, inventoryDraft };
}

global.EsepDomain = {
  calculateCogs,
  calculateIngredientUsage,
  calculateInventory,
  calculateRevenue,
  createInventorySnapshot,
  findMissingIngredients,
  findLowStock,
  migrateLegacyState,
  roundMoney,
  salesForPeriod,
  simulateActualStock,
  validateState,
};
}(globalThis));
