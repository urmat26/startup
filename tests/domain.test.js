import test from 'node:test';
import assert from 'node:assert/strict';

await import('../app/domain.js');

const {
  calculateCogs,
  calculateIngredientUsage,
  calculateInventory,
  calculateRevenue,
  createInventorySnapshot,
  findLowStock,
  findMissingIngredients,
  roundMoney,
  salesForPeriod,
  simulateActualStock,
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

test('historical sale snapshots are stable after catalog changes', () => {
  const snapshotSales=[{productId:'esp',periodId:1,unitPrice:95,cogs:32}];
  const changedProducts=[{...products[0],price:150}];
  const changedIngredients=ingredients.map(i=>({...i,cost:i.cost*2}));
  assert.equal(calculateRevenue(snapshotSales,changedProducts,1),95);
  assert.equal(calculateCogs(snapshotSales,changedProducts,changedIngredients,1),32);
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

test('inventory converts shortage and surplus into money', () => {
  const result = calculateInventory(ingredients, { beans: 10, cup: 3 });
  assert.equal(result[0].leak, 15);
  assert.equal(result[1].leak, 0);
  assert.equal(result[1].overageValue,4);
  assert.equal(result[1].netValue,-4);
});

test('low-stock warning works for every ingredient, not only milk', () => {
  const low=findLowStock([
    {id:'milk',stock:20,threshold:10},
    {id:'beans',stock:4,threshold:5},
    {id:'cup',stock:0,threshold:1},
  ]);
  assert.deepEqual(low.map(i=>i.id),['beans','cup']);
});

test('money is rounded to two decimal places',()=>{
  assert.equal(roundMoney(0.1+0.2),0.3);
});

test('inventory rejects incomplete or negative actual stock', () => {
  assert.throws(() => calculateInventory(ingredients, { beans: 10 }), TypeError);
  assert.throws(() => calculateInventory(ingredients, { beans: -1, cup: 1 }), TypeError);
});

test('inventory uses the stock snapshot captured at count start', () => {
  const snapshot=createInventorySnapshot(ingredients);
  const changed=ingredients.map((ingredient)=>({...ingredient,stock:ingredient.stock-2}));
  const result=calculateInventory(changed,{beans:10,cup:1},snapshot);
  assert.equal(result[0].theoretical,20);
  assert.equal(result[0].difference,10);
  assert.equal(result[1].theoretical,2);
});

test('simulated shortage grows with actual shift usage', () => {
  const oneSaleUsage=calculateIngredientUsage(sales,products,1);
  const manySales=Array.from({length:10},()=>({productId:'esp',periodId:1}));
  const manySalesUsage=calculateIngredientUsage(manySales,products,1);
  const snapshot=createInventorySnapshot(ingredients);
  const oneSaleActual=simulateActualStock(ingredients,snapshot,oneSaleUsage);
  const manySalesActual=simulateActualStock(ingredients,snapshot,manySalesUsage);

  assert.equal(oneSaleUsage.beans,18);
  assert.equal(oneSaleUsage.cup,1);
  assert.ok(snapshot.beans-oneSaleActual.beans < snapshot.beans-manySalesActual.beans);
  assert.equal(snapshot.cup-oneSaleActual.cup,0);
  assert.equal(snapshot.cup-manySalesActual.cup,1);
});

test('canceled sales do not contribute to simulated ingredient usage', () => {
  const canceledSales=[
    {productId:'esp',periodId:1},
    {productId:'esp',periodId:1,canceledAt:Date.now()},
  ];
  const usage=calculateIngredientUsage(canceledSales,products,1);
  assert.equal(usage.beans,18);
  assert.equal(usage.cup,1);
});

test('ingredient usage uses the recipe captured by the sale', () => {
  const changedProducts=[{...products[0],recipe:{beans:1,cup:1}}];
  const snapshotSales=[{productId:'esp',periodId:1,recipeSnapshot:{beans:18,cup:1}}];
  assert.deepEqual(calculateIngredientUsage(snapshotSales,changedProducts,1),{beans:18,cup:1});
});

test('hackathon demo scenario produces about 22 som leakage', () => {
  const demoIngredients=[
    {id:'milk',unit:'мл',stock:1450,cost:0.06},
    {id:'beans',unit:'г',stock:892,cost:1.5},
    {id:'cup',unit:'шт',stock:194,cost:4},
    {id:'syrup',unit:'мл',stock:980,cost:0.5},
    {id:'cocoa',unit:'г',stock:400,cost:2.5},
  ];
  const demoProducts=[
    {id:'latte',recipe:{beans:18,milk:200,cup:1}},
    {id:'capp',recipe:{beans:18,milk:150,cup:1}},
    {id:'raf',recipe:{beans:18,milk:150,syrup:20,cup:1}},
  ];
  const demoSales=[
    ...Array.from({length:3},()=>({productId:'latte',periodId:1})),
    ...Array.from({length:2},()=>({productId:'capp',periodId:1})),
    {productId:'raf',periodId:1},
  ];
  const snapshot=createInventorySnapshot(demoIngredients);
  const usage=calculateIngredientUsage(demoSales,demoProducts,1);
  const actual=simulateActualStock(demoIngredients,snapshot,usage);
  const total=calculateInventory(demoIngredients,actual,snapshot)
    .reduce((sum,item)=>sum+item.leak,0);

  assert.deepEqual(usage,{beans:108,milk:1050,cup:6,syrup:20});
  assert.equal(actual.milk,1366);
  assert.equal(actual.beans,883);
  assert.equal(actual.cup,194);
  assert.equal(actual.syrup,973);
  assert.equal(actual.cocoa,400);
  assert.equal(total,22.04);
});
