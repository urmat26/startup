const {
  calculateCogs,
  calculateIngredientUsage,
  calculateInventory,
  calculateRevenue,
  createInventorySnapshot,
  findLowStock,
  findMissingIngredients,
  migrateLegacyState: migrateLegacyStateData,
  roundMoney,
  salesForPeriod,
  simulateActualStock,
  validateState,
} = globalThis.EsepDomain;

const SEED = () => ({
  schemaVersion:2,
  ingredients:[
    {id:'milk', name:'Молоко', unit:'мл', stock:2500, start:2500, threshold:1500, cost:0.06},
    {id:'beans',name:'Зёрна',  unit:'г',  stock:1000, start:1000, threshold:300,  cost:1.5},
    {id:'cup',  name:'Стаканы',unit:'шт', stock:200,  start:200,  threshold:50,   cost:4},
    {id:'syrup',name:'Сироп',  unit:'мл', stock:1000, start:1000, threshold:250,  cost:0.5},
    {id:'cocoa',name:'Какао',  unit:'г',  stock:400,  start:400,  threshold:120,  cost:2.5},
  ],
  products:[
    {id:'esp',  emoji:'☕', name:'Эспрессо', price:90,  recipe:{beans:18, cup:1}},
    {id:'amer', emoji:'☕', name:'Американо', price:110, recipe:{beans:18, cup:1}},
    {id:'latte',emoji:'🥛', name:'Латте',    price:160, recipe:{beans:18, milk:200, cup:1}},
    {id:'capp', emoji:'☕', name:'Капучино', price:150, recipe:{beans:18, milk:150, cup:1}},
    {id:'raf',  emoji:'🍮', name:'Раф',      price:190, recipe:{beans:18, milk:150, syrup:20, cup:1}},
    {id:'hot',  emoji:'🍫', name:'Какао',    price:140, recipe:{milk:200, cocoa:15, cup:1}},
  ],
  sales:[],
  role:'owner',
  periods:[{id:1,openedAt:Date.now(),closedAt:null}],
  movements:[],
  inventories:[],
  lastInventory:null,
  inventoryDraft:null,
});
const KEY='esep-demo-v2';
const LEGACY_KEY='esep-demo-v1';
const LEGACY_BACKUP_KEY='esep-demo-v1-backup';
let S=initializeState();
let cloudContext=null;
function migrateLegacyState(legacy){
  return migrateLegacyStateData(legacy);
}
function initializeState(){
  let legacyRaw=null;
  try{
    const current=localStorage.getItem(KEY);
    if(current){
      const state=JSON.parse(current);
      if(validateState(state)) return state;
    }
  }catch(error){}
  try{
    legacyRaw=localStorage.getItem(LEGACY_KEY);
    if(legacyRaw){
      localStorage.setItem(LEGACY_BACKUP_KEY,legacyRaw);
      const state=migrateLegacyState(JSON.parse(legacyRaw));
      if(!validateState(state)) throw new TypeError('Invalid migrated state');
      localStorage.setItem(KEY,JSON.stringify(state));
      try{localStorage.removeItem(LEGACY_KEY);}catch(error){}
      return state;
    }
  }catch(error){
    return SEED();
  }
  const state=SEED();
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch(error){}
  return state;
}
function save(){try{if(!validateState(S))return false;localStorage.setItem(KEY,JSON.stringify(S));return true;}catch(error){return false;}}
const cloneState=()=>JSON.parse(JSON.stringify(S));
function transact(mutator){
  const previous=cloneState();
  try{mutator();if(!save()) throw new Error('Storage write failed');return true;}
  catch(error){S=previous;return false;}
}

const openPeriod = () => S.periods.findLast ? S.periods.findLast(p=>!p.closedAt) : [...S.periods].reverse().find(p=>!p.closedAt);

const fmt = n => Math.round(n).toLocaleString('ru-RU');
const ing = id => S.ingredients.find(i=>i.id===id);
const esc = value => String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const makeId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`}`;
const periodSales = (id=openPeriod().id) => salesForPeriod(S.sales,id);
const revenue = (id=openPeriod().id) => calculateRevenue(S.sales,S.products,id);
const cogsSold = (id=openPeriod().id) => calculateCogs(S.sales,S.products,S.ingredients,id);
const inventoryInProgress = () => S.inventoryDraft?.periodId===openPeriod().id;
const addMovement = (ingredientId,type,qty,note='',sourceId=null) => S.movements.push({
  id:makeId('event'),periodId:openPeriod().id,ingredientId,type,qty,note,sourceId,ts:Date.now()
});

/* ---------- KASSA ---------- */
async function sell(p){
  if(cloudContext){
    const button=[...document.querySelectorAll('.tile')].find(tile=>tile.dataset.productId===p.id);
    if(button) button.disabled=true;
    const {error}=await globalThis.EsepSupabase.rpc('record_sale',{target_product_id:p.id});
    if(error){if(button)button.disabled=false;showToast('Продажа не сохранена',cloudError(error));return;}
    await reloadCloudLocation();
    showToast(`${p.name} · ${p.price} сом`,'Продажа и списание сохранены в облаке.');
    return;
  }
  if(inventoryInProgress()) return showToast('Продажа приостановлена','Заверши или отмени текущую инвентаризацию.');
  const missing=findMissingIngredients(p,S.ingredients).map(({ingredient,qty})=>({i:ingredient,q:qty}));
  if(missing.length){
    const detail=missing.map(({i,q})=>`${i.name}: нужно ${q} ${i.unit}, осталось ${fmt(Math.max(0,i.stock))} ${i.unit}`).join(' · ');
    showToast('Продажа невозможна — не хватает на складе',detail);
    return;
  }
  const saleId=makeId('sale');
  const recipeSnapshot=Object.fromEntries(Object.entries(p.recipe));
  const cogs=roundMoney(Object.entries(recipeSnapshot).reduce((sum,[id,qty])=>sum+ing(id).cost*qty,0));
  const saved=transact(()=>{
    for(const [id,qty] of Object.entries(recipeSnapshot)){ing(id).stock-=qty;addMovement(id,'sale',-qty,p.name,saleId);}
    S.sales.push({id:saleId,productId:p.id,productName:p.name,unitPrice:p.price,cogs,recipeSnapshot,periodId:openPeriod().id,ts:Date.now()});
  });
  if(!saved){renderAll();showToast('Продажа не сохранена','Хранилище недоступно. Повтори операцию.');return;}
  renderAll();
  const ded = Object.entries(p.recipe).map(([k,q])=>`−${q} ${ing(k).unit} ${ing(k).name.toLowerCase()}`).join(' · ');
  showToast(`${p.name} · ${p.price} сом`, ded);
}
async function cancelLastSale(){
  if(inventoryInProgress()) return showToast('Отмена приостановлена','Заверши или отмени текущую инвентаризацию.');
  const sale=[...S.sales].reverse().find(x=>x.periodId===openPeriod().id&&x.canceledAt==null);
  if(!sale) return showToast('Отменять нечего','В текущей смене нет активных продаж.');
  if(cloudContext){
    const button=document.getElementById('undoSale');button.disabled=true;
    const {error}=await globalThis.EsepSupabase.rpc('cancel_sale',{target_sale_id:sale.id});
    if(error){button.disabled=false;showToast('Продажа не отменена',cloudError(error));return;}
    await reloadCloudLocation();
    showToast('Продажа отменена','Ингредиенты возвращены на облачный склад.');
    return;
  }
  const product=S.products.find(p=>p.id===sale.productId);
  const recipe=sale.recipeSnapshot||product?.recipe;
  if(!recipe) return showToast('Продажа не отменена','Состав исходной продажи не найден.');
  const productName=sale.productName||product?.name||'Товар';
  const saved=transact(()=>{
    sale.canceledAt=Date.now();
    for(const [ingredientId,quantity] of Object.entries(recipe)){
      const ingredient=ing(ingredientId);if(!ingredient) throw new Error('Ingredient not found');
      ingredient.stock+=quantity;
      addMovement(ingredientId,'refund',quantity,productName,sale.id);
    }
  });
  if(!saved){renderAll();showToast('Отмена не сохранена','Хранилище недоступно. Повтори операцию.');return;}
  renderAll();
  showToast('Продажа отменена',`${productName} · ингредиенты возвращены на склад`);
}
let toastTimer;
function showToast(t1,t2){
  document.getElementById('toastT1').textContent=t1;
  document.getElementById('toastT2').textContent=t2;
  const el=document.getElementById('toast'); el.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2200);
}
function renderKassa(){
  const menu=document.getElementById('menu');
  menu.innerHTML='';
  S.products.forEach(p=>{
    const b=document.createElement('button'); b.className='tile';
    b.dataset.productId=p.id;
    const missing=findMissingIngredients(p,S.ingredients).map(({ingredient})=>ingredient.name);
    b.disabled=missing.length>0;
    b.title=missing.length?`Не хватает: ${missing.join(', ')}`:'';
    b.setAttribute('aria-label',missing.length?`${p.name}, недоступно: не хватает ${missing.join(', ')}`:`Продать ${p.name} за ${p.price} сом`);
    const rc=Object.entries(p.recipe).map(([k,q])=>`${q}${ing(k).unit} ${ing(k).name.toLowerCase()}`).join(', ');
    b.innerHTML=`<div class="emoji">${esc(p.emoji)}</div><div class="pname">${esc(p.name)}</div>
      <div class="price num">${p.price} сом</div>${missing.length?`<div class="stock-status">Не хватает: ${esc(missing.join(', '))}</div>`:`<div class="rc">${esc(rc)}</div>`}`;
    b.onclick=()=>sell(p);
    menu.appendChild(b);
  });
  document.getElementById('rev').textContent=fmt(revenue())+' сом';
  const currentSales=periodSales();
  document.getElementById('cups').textContent=currentSales.length;
  const feed=document.getElementById('feed');
  if(!currentSales.length){feed.innerHTML='<div class="empty">Продаж пока нет</div>';}
  else{
    const counts={};
    currentSales.forEach(x=>counts[x.productId]=(counts[x.productId]||0)+1);
    feed.innerHTML=Object.entries(counts).map(([id,c])=>{
      const p=S.products.find(p=>p.id===id);
      return `<div class="row"><span>${esc(p?.name||'Неизвестный товар')}</span><span class="d num">×${c}</span></div>`;
    }).join('');
  }
  document.getElementById('undoSale').disabled=!currentSales.length;
}

/* ---------- STOCK ---------- */
function renderStock(){
  const alerts=document.getElementById('alerts'); const low=findLowStock(S.ingredients);
  alerts.innerHTML = low.length ? low.map(i=>{
    const need=Math.ceil((i.start-i.stock)/ (i.unit==='мл'?1000:i.unit==='г'?1000:1));
    const nu = i.unit==='мл'?'л':i.unit==='г'?'кг':'шт';
    return `<div class="alert"><span class="ico">🔴</span><span class="txt"><b>${esc(i.name)}</b> заканчивается — осталось ${fmt(i.stock)} ${esc(i.unit)}. Пора заказать ≈ ${need} ${esc(nu)}.</span></div>`;
  }).join('') : `<div class="alert" style="border-color:rgba(46,158,107,.35);border-left-color:var(--money)"><span class="ico">✅</span><span class="txt">Остатков хватает — заказывать пока нечего.</span></div>`;
  const list=document.getElementById('stockList'); list.innerHTML='';
  S.ingredients.forEach(i=>{
    const pct=Math.max(0,Math.min(100, i.stock/i.start*100));
    const thrPct=Math.max(0,Math.min(100, i.threshold/i.start*100));
    const lowc=i.stock<i.threshold?' low':'';
    const el=document.createElement('div'); el.className='ing'+lowc;
    el.innerHTML=`<div class="top"><span class="nm">${esc(i.name)}</span><span class="val num">${fmt(i.stock)} ${esc(i.unit)}</span></div>
      <div class="bar"><div class="fill" style="width:${pct}%"></div><div class="thr" style="left:${thrPct}%"></div></div>
      <div class="meta"><span>порог ${fmt(i.threshold)} ${esc(i.unit)}</span><span>себест. ${i.cost} сом/${esc(i.unit)}</span></div>
      <div class="stock-actions owner-only">
        <button data-stock="receipt" data-id="${i.id}">+ Приход</button>
        <button data-stock="writeoff" data-id="${i.id}">− Списание</button>
      </div>`;
    list.appendChild(el);
  });
  document.querySelectorAll('[data-stock]').forEach(b=>b.onclick=()=>adjustStock(b.dataset.id,b.dataset.stock));
  const ledger=document.getElementById('ledger');
  const labels={sale:'Продажа',receipt:'Приход',writeoff:'Списание',inventory:'Инвентаризация'};
  labels.refund='Отмена продажи';
  const rows=[...S.movements].reverse().slice(0,10);
  ledger.innerHTML=rows.length?rows.map(m=>{const ingredient=ing(m.ingredientId);return `<div class="ledger-row"><time>${new Date(m.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time><span>${esc(labels[m.type]||m.type)} · ${esc(ingredient?.name||m.ingredientId)}${m.note?' · '+esc(m.note):''}</span><b>${m.qty>0?'+':''}${fmt(m.qty)} ${esc(ingredient?.unit||'')}</b></div>`;}).join(''):'<div class="muted">Движений пока нет</div>';
  applyRole();
}
function adjustStock(id,type){
  if(S.role!=='owner') return showToast('Недостаточно прав','Приход и списание доступны владельцу.');
  if(inventoryInProgress()) return showToast('Склад заблокирован','Заверши или отмени текущую инвентаризацию.');
  openStockModal(id,type);
}

function cloudError(error){
  const message=String(error?.message||'Не удалось выполнить операцию.');
  if(/insufficient stock/i.test(message)) return 'На складе недостаточно ингредиентов.';
  if(/inventory in progress/i.test(message)) return 'Сначала заверши или отмени инвентаризацию.';
  if(/owner access required/i.test(message)) return 'Операция доступна только владельцу.';
  if(/open shift not found/i.test(message)) return 'Открытая смена не найдена.';
  return message;
}
async function loadCloudLocation(locationId){
  const client=globalThis.EsepSupabase;
  if(!client) throw new Error('Supabase client is unavailable');
  const [ingredientsResult,productsResult,recipesResult,shiftsResult,salesResult,movementsResult,inventoriesResult,itemsResult]=await Promise.all([
    client.from('ingredients').select('*').eq('location_id',locationId).order('created_at'),
    client.from('products').select('*').eq('location_id',locationId).eq('active',true).order('created_at'),
    client.from('product_recipes').select('product_id,ingredient_id,quantity').eq('location_id',locationId),
    client.from('shifts').select('*').eq('location_id',locationId).order('opened_at'),
    client.from('sales').select('*').eq('location_id',locationId).order('created_at'),
    client.from('stock_movements').select('*').eq('location_id',locationId).order('created_at'),
    client.from('inventories').select('*').eq('location_id',locationId).order('started_at'),
    client.from('inventory_items').select('*').eq('location_id',locationId),
  ]);
  const failed=[ingredientsResult,productsResult,recipesResult,shiftsResult,salesResult,movementsResult,inventoriesResult,itemsResult].find(result=>result.error);
  if(failed) throw failed.error;
  const openShift=shiftsResult.data.find(row=>!row.closed_at);
  if(!openShift) throw new Error('Open shift not found');
  const periodIds=new Map(shiftsResult.data.map((row,index)=>[row.id,index+1]));
  const recipesByProduct={};
  recipesResult.data.forEach(row=>{(recipesByProduct[row.product_id]??={})[row.ingredient_id]=Number(row.quantity);});
  const role=S.role;
  const ingredients=ingredientsResult.data.map(row=>({id:row.id,code:row.code,name:row.name,unit:row.unit,stock:Number(row.stock),start:Number(row.initial_stock),threshold:Number(row.threshold),cost:Number(row.unit_cost)}));
  const ingredientsById=new Map(ingredients.map(ingredient=>[ingredient.id,ingredient]));
  const inventoryItemsById={};
  itemsResult.data.forEach(row=>(inventoryItemsById[row.inventory_id]??=[]).push(row));
  const mapInventory=row=>{
    const items=(inventoryItemsById[row.id]||[]).map(item=>{
      const ingredient=ingredientsById.get(item.ingredient_id);
      const difference=Number(item.difference||0);
      return {id:item.ingredient_id,name:ingredient?.name||'Ингредиент',unit:ingredient?.unit||'',theoretical:Number(item.theoretical),actual:Number(item.actual),difference,diff:difference,shortageValue:Number(item.shortage_value),overageValue:Number(item.overage_value),netValue:difference*(ingredient?.cost||0),leak:Number(item.shortage_value)};
    });
    return {id:row.id,periodId:periodIds.get(row.shift_id),closedAt:Date.parse(row.completed_at),items,total:Number(row.total_shortage)};
  };
  const completedInventories=inventoriesResult.data.filter(row=>row.status==='completed').map(mapInventory);
  const draft=inventoriesResult.data.find(row=>row.status==='draft');
  S={
    schemaVersion:2,
    ingredients,
    products:productsResult.data.map(row=>({id:row.id,code:row.code,emoji:row.emoji,name:row.name,price:Number(row.price),recipe:recipesByProduct[row.id]||{}})),
    sales:salesResult.data.map(row=>({id:row.id,productId:row.product_id,productName:row.product_name,unitPrice:Number(row.unit_price),cogs:Number(row.cogs),recipeSnapshot:Object.fromEntries(Object.entries(row.recipe_snapshot).map(([id,qty])=>[id,Number(qty)])),periodId:periodIds.get(row.shift_id),ts:Date.parse(row.created_at),canceledAt:row.canceled_at?Date.parse(row.canceled_at):null})),
    role,
    periods:shiftsResult.data.map((row,index)=>({id:index+1,openedAt:Date.parse(row.opened_at),closedAt:row.closed_at?Date.parse(row.closed_at):null})),
    movements:movementsResult.data.map(row=>({id:row.id,periodId:periodIds.get(row.shift_id)||periodIds.get(openShift.id),ingredientId:row.ingredient_id,type:row.type==='sale_cancel'?'refund':row.type,qty:Number(row.quantity),note:row.note,sourceId:row.source_id,ts:Date.parse(row.created_at)})),
    inventories:completedInventories,
    lastInventory:completedInventories.at(-1)||null,
    inventoryDraft:draft?{id:draft.id,periodId:periodIds.get(draft.shift_id),startedAt:Date.parse(draft.started_at),snapshot:Object.fromEntries((inventoryItemsById[draft.id]||[]).map(item=>[item.ingredient_id,Number(item.theoretical)])),actual:Object.fromEntries((inventoryItemsById[draft.id]||[]).filter(item=>item.actual!=null).map(item=>[item.ingredient_id,Number(item.actual)]))}:null,
  };
  cloudContext={locationId,shiftId:openShift.id};
  document.getElementById('reset').hidden=true;
  renderAll();
}
async function reloadCloudLocation(){if(cloudContext) await loadCloudLocation(cloudContext.locationId);}

let pendingStockOperation=null;
function openStockModal(id,type){
  const ingredient=ing(id);
  if(!ingredient) return;
  pendingStockOperation={id,type};
  const writeoff=type==='writeoff';
  document.getElementById('stockModalEyebrow').textContent=ingredient.name;
  document.getElementById('stockModalTitle').textContent=writeoff?'Списание':'Приход';
  document.getElementById('stockUnit').textContent=`(${ingredient.unit})`;
  document.getElementById('stockReasonField').hidden=!writeoff;
  document.getElementById('stockReason').required=writeoff;
  document.getElementById('stockSubmit').textContent=writeoff?'Сохранить списание':'Сохранить приход';
  document.getElementById('stockComment').placeholder=writeoff?'Что произошло?':'Например, название поставщика';
  document.getElementById('stockForm').reset();
  clearStockErrors();
  const modal=document.getElementById('stockModal');
  modal.showModal();
  document.getElementById('stockQuantity').focus();
}
function closeStockModal(){
  document.getElementById('stockModal').close();
  pendingStockOperation=null;
}
function clearStockErrors(){
  ['stockQuantity','stockReason'].forEach(id=>document.getElementById(id).removeAttribute('aria-invalid'));
  document.getElementById('stockQuantityError').textContent='';
  document.getElementById('stockReasonError').textContent='';
}
async function submitStockOperation(event){
  event.preventDefault();
  if(!pendingStockOperation) return;
  clearStockErrors();
  const ingredient=ing(pendingStockOperation.id);
  const quantityInput=document.getElementById('stockQuantity');
  const reasonInput=document.getElementById('stockReason');
  const qty=Number(String(quantityInput.value).replace(',','.'));
  let invalid=false;
  if(!Number.isFinite(qty)||qty<=0){
    quantityInput.setAttribute('aria-invalid','true');
    document.getElementById('stockQuantityError').textContent='Введите число больше нуля.';
    invalid=true;
  }else if(pendingStockOperation.type==='writeoff'&&qty>ingredient.stock){
    quantityInput.setAttribute('aria-invalid','true');
    document.getElementById('stockQuantityError').textContent=`На складе только ${fmt(ingredient.stock)} ${ingredient.unit}.`;
    invalid=true;
  }
  if(pendingStockOperation.type==='writeoff'&&!reasonInput.value){
    reasonInput.setAttribute('aria-invalid','true');
    document.getElementById('stockReasonError').textContent='Укажите причину списания.';
    invalid=true;
  }
  if(invalid) return;
  const type=pendingStockOperation.type;
  const comment=document.getElementById('stockComment').value.trim();
  const note=[type==='writeoff'?reasonInput.value:'Поставка',comment].filter(Boolean).join(' · ');
  if(cloudContext){
    const submit=document.getElementById('stockSubmit');submit.disabled=true;
    const {error}=await globalThis.EsepSupabase.rpc('adjust_stock',{
      target_ingredient_id:ingredient.id,operation:type,amount:qty,operation_note:note,
    });
    submit.disabled=false;
    if(error){showToast('Операция не сохранена',cloudError(error));return;}
    closeStockModal();
    await reloadCloudLocation();
    showToast(type==='receipt'?'Приход сохранён':'Списание сохранено',`${ingredient.name}: ${type==='receipt'?'+':'−'}${fmt(qty)} ${ingredient.unit}`);
    return;
  }
  const delta=type==='receipt'?qty:-qty;
  const saved=transact(()=>{ingredient.stock+=delta;addMovement(ingredient.id,type,delta,note);});
  if(!saved){renderStock();showToast('Операция не сохранена','Хранилище недоступно. Повтори операцию.');return;}
  closeStockModal();
  renderStock();
  showToast(type==='receipt'?'Приход сохранён':'Списание сохранено',`${ingredient.name}: ${delta>0?'+':''}${fmt(delta)} ${ingredient.unit}`);
}

/* ---------- INVENTORY ---------- */
function renderInv(){
  if(S.role!=='owner'){
    document.getElementById('invTable').innerHTML='<tbody><tr><td>Инвентаризацию может проводить только владелец.</td></tr></tbody>';
    document.getElementById('periodLabel').textContent=`Смена №${openPeriod().id}`;
    return;
  }
  const period=openPeriod();
  const active=inventoryInProgress();
  document.getElementById('invStartTools').hidden=active;
  document.getElementById('invActiveTools').hidden=!active;
  if(!active){
    document.getElementById('periodLabel').textContent=`Смена №${period.id} · открыта ${new Date(period.openedAt).toLocaleString('ru-RU')}`;
    document.getElementById('invTable').innerHTML='<tbody><tr><td class="muted">Нажми «Начать инвентаризацию», чтобы зафиксировать расчетные остатки и начать пересчет.</td></tr></tbody>';
    return;
  }
  const snapshot=S.inventoryDraft.snapshot;
  document.getElementById('periodLabel').textContent=`Смена №${period.id} · пересчет начат ${new Date(S.inventoryDraft.startedAt).toLocaleString('ru-RU')}`;
  const t=document.getElementById('invTable');
  const rows=S.ingredients.map(i=>{
    const actual=S.inventoryDraft.actual?.[i.id]??'';
    return `<tr data-id="${i.id}">
      <td class="nm">${esc(i.name)}</td>
      <td class="num">${fmt(snapshot[i.id])} ${esc(i.unit)}</td>
      <td><input type="number" min="0" step="any" inputmode="numeric" value="${actual}" placeholder="—" aria-label="Фактический остаток: ${esc(i.name)}"> <span class="muted">${esc(i.unit)}</span></td>
      <td class="varcell num">—</td>
      <td class="leakcell num">—</td>
    </tr>`;
  }).join('');
  t.innerHTML=`<thead><tr><th>Ингредиент</th><th>По системе</th><th>Факт (насчитал)</th><th>Расхождение</th><th>≈ сом</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4" style="text-align:right">Итого утечка за смену</td><td class="num" id="invTotal">—</td></tr></tfoot>`;
  t.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>recalcInv(true)));
  recalcInv(false);
}
async function startInventory(){
  if(S.role!=='owner'||inventoryInProgress()) return;
  if(cloudContext){
    const {error}=await globalThis.EsepSupabase.rpc('start_inventory',{target_location_id:cloudContext.locationId});
    if(error){showToast('Инвентаризация не начата',cloudError(error));return;}
    await reloadCloudLocation();renderInv();
    showToast('Инвентаризация начата','Продажи и складские операции временно приостановлены.');
    return;
  }
  const period=openPeriod();
  if(!transact(()=>{S.inventoryDraft={periodId:period.id,startedAt:Date.now(),snapshot:createInventorySnapshot(S.ingredients),actual:{}};})){
    showToast('Инвентаризация не начата','Хранилище недоступно.');return;
  }
  renderInv();
  showToast('Инвентаризация начата','Продажи и складские операции приостановлены до завершения или отмены.');
}
function recalcInv(persist=false){
  let total=0,complete=true;
  const actualById={};
  document.querySelectorAll('#invTable tbody tr').forEach(tr=>{
    const i=ing(tr.dataset.id); const inp=tr.querySelector('input');
    const varcell=tr.querySelector('.varcell'); const leakcell=tr.querySelector('.leakcell');
    const actual=Number(inp.value);
    if(inp.value.trim()===''||!Number.isFinite(actual)||actual<0){
      complete=false; inp.classList.toggle('invalid',inp.value.trim()!=='');
      varcell.textContent='Не проверено';varcell.className='varcell num var-leak';
      leakcell.textContent='—';leakcell.className='leakcell num';return;
    }
    inp.classList.remove('invalid');
    actualById[i.id]=actual;
    const diff=S.inventoryDraft.snapshot[i.id]-actual; // >0 = утекло
    const leak=Math.max(0,diff)*i.cost;
    varcell.textContent=(diff>0?'−':diff<0?'+':'')+fmt(Math.abs(diff))+' '+i.unit;
    varcell.className='varcell num '+(diff>0?'var-leak':'var-ok');
    leakcell.textContent=diff>0?fmt(leak):'0';
    leakcell.className='leakcell num '+(diff>0?'var-leak':'var-ok');
    total+=leak;
  });
  if(persist&&cloudContext){S.inventoryDraft.actual=actualById;}
  else if(persist&&!transact(()=>{S.inventoryDraft.actual=actualById;})){
    document.querySelectorAll('#invTable tbody tr').forEach(tr=>{
      tr.querySelector('input').value=S.inventoryDraft.actual?.[tr.dataset.id]??'';
    });
    recalcInv(false);
    showToast('Черновик не сохранён','Изменения отменены. Проверь доступ к хранилищу браузера.');
    return;
  }
  const tot=document.getElementById('invTotal');
  if(tot){tot.textContent=complete?fmt(total)+' сом':'Не проверено';tot.className='num '+(complete&&total===0?'var-ok':'var-leak');}
}
async function applyInv(){
  if(!inventoryInProgress()) return showToast('Инвентаризация не начата','Сначала нажми «Начать инвентаризацию».');
  const actualById={};
  let invalid=false;
  document.querySelectorAll('#invTable tbody tr').forEach(tr=>{
    const inp=tr.querySelector('input'); const actual=Number(inp.value);
    if(inp.value==='' || !Number.isFinite(actual) || actual<0){ invalid=true; return; }
    actualById[tr.dataset.id]=actual;
  });
  if(invalid || Object.keys(actualById).length!==S.ingredients.length){
    showToast('Инвентаризация не закрыта','Введи фактический неотрицательный остаток для каждого ингредиента.');
    return;
  }
  if(cloudContext){
    const {error}=await globalThis.EsepSupabase.rpc('complete_inventory',{target_inventory_id:S.inventoryDraft.id,actual_stock:actualById});
    if(error){showToast('Инвентаризация не закрыта',cloudError(error));return;}
    await reloadCloudLocation();renderDash();switchView('dash');
    return;
  }
  const items=calculateInventory(S.ingredients,actualById,S.inventoryDraft.snapshot).map(item=>{
    const i=ing(item.id);
    return {...item,name:i.name,unit:i.unit,diff:item.difference};
  });
  const total=roundMoney(items.reduce((sum,item)=>sum+item.leak,0));
  const period=openPeriod(); const closedAt=Date.now();
  const inventoryId=makeId('inventory');
  const saved=transact(()=>{
    S.lastInventory={id:inventoryId,periodId:period.id,closedAt,items,total};
    S.inventories.push(S.lastInventory);
    items.forEach(item=>{const delta=item.actual-item.theoretical;ing(item.id).stock=item.actual;if(delta)addMovement(item.id,'inventory',delta,'',inventoryId);});
    period.closedAt=closedAt;
    S.periods.push({id:Math.max(...S.periods.map(p=>p.id))+1,openedAt:closedAt,closedAt:null});
    S.inventoryDraft=null;
  });
  if(!saved){renderInv();showToast('Инвентаризация не закрыта','Хранилище недоступно.');return;}
  renderDash(); switchView('dash');
}
async function cancelInventory(){
  if(!inventoryInProgress()) return;
  if(!confirm('Отменить инвентаризацию? Введённые значения будут удалены.')) return;
  if(cloudContext){
    const {error}=await globalThis.EsepSupabase.rpc('cancel_inventory',{target_inventory_id:S.inventoryDraft.id});
    if(error){showToast('Отмена не сохранена',cloudError(error));return;}
    await reloadCloudLocation();switchView('kassa');
    showToast('Инвентаризация отменена','Продажи и складские операции снова доступны.');
    return;
  }
  if(!transact(()=>{S.inventoryDraft=null;})){showToast('Отмена не сохранена','Хранилище недоступно.');return;}
  switchView('kassa'); renderAll();
  showToast('Инвентаризация отменена','Продажи и складские операции снова доступны.');
}
function fillTheory(){ document.querySelectorAll('#invTable tbody tr').forEach(tr=>{tr.querySelector('input').value=Math.round(S.inventoryDraft.snapshot[tr.dataset.id]);}); recalcInv(true); }
function simLeak(){
  const usage=calculateIngredientUsage(S.sales,S.products,openPeriod().id);
  const actual=simulateActualStock(S.ingredients,S.inventoryDraft.snapshot,usage);
  document.querySelectorAll('#invTable tbody tr').forEach(tr=>{
    tr.querySelector('input').value=actual[tr.dataset.id];
  });
  recalcInv(true);
}

/* ---------- DASHBOARD ---------- */
function renderDash(){
  const reportPeriod=S.lastInventory?.periodId||openPeriod().id;
  const rev=revenue(reportPeriod), cogs=cogsSold(reportPeriod), fc=rev?Math.round(cogs/rev*100):0;
  document.getElementById('dRev').textContent=fmt(rev);
  document.getElementById('dCogs').textContent=fmt(cogs);
  document.getElementById('dFc').textContent=fc+'%';
  document.getElementById('dCups').textContent=periodSales(reportPeriod).length;
  const big=document.getElementById('leakBig'), exp=document.getElementById('leakExp');
  const bl=document.getElementById('breakList');
  renderPeriodHistory();
  if(!S.lastInventory){
    big.textContent='—'; big.className='big ok';
    exp.innerHTML='Сделай <b>инвентаризацию</b> — и Эсеп покажет, сколько денег утекло помимо проданных чашек.';
    bl.innerHTML='<div class="muted" style="font-size:14px">Сделай инвентаризацию, чтобы увидеть разбивку утечки по продуктам.</div>';
    return;
  }
  const items=S.lastInventory.items;
  const total=S.lastInventory.total;
  const overageTotal=roundMoney(items.reduce((sum,item)=>sum+(item.overageValue||0),0));
  if(total>0){
    big.textContent='−'+fmt(total)+' сом'; big.className='big leak';
    const pctRev=rev?(total/rev*100):0;
    exp.innerHTML=`Продано на <b>${fmt(rev)} сом</b>, честная себестоимость — <b>${fmt(cogs)} сом</b>. Недостача составляет <b>${fmt(total)} сом</b> — это <b>${pctRev.toFixed(1)}%</b> выручки. Возможные причины: пролив, порча, ошибка учета или хищение.${overageTotal?` Излишек по другим позициям: <b>${fmt(overageTotal)} сом</b>.`:''}`;
  }else if(overageTotal>0){
    big.textContent='+'+fmt(overageTotal)+' сом';big.className='big ok';
    exp.innerHTML=`Обнаружен излишек на <b>${fmt(overageTotal)} сом</b>. Проверь техкарты, поступления и предыдущий пересчет.`;
  }else{
    big.textContent='0 сом'; big.className='big ok';
    exp.innerHTML='Факт сходится с системой — <b>утечки нет</b>. Вся себестоимость ушла в проданные чашки.';
  }
  const max=Math.max(...items.map(x=>x.leak),1);
  bl.innerHTML=items.filter(x=>x.leak>0).sort((a,b)=>b.leak-a.leak).map(x=>
    `<div class="brow"><span class="bn">${esc(x.name)}</span><div class="bbar"><span style="width:${x.leak/max*100}%"></span></div>
     <span class="bv">−${fmt(x.leak)} сом</span></div>`).join('') || '<div class="muted" style="font-size:14px">Утечки нет — всё сходится ✅</div>';
}
function renderPeriodHistory(){
  const root=document.getElementById('periodHistory');
  const closed=[...S.periods].filter(p=>p.closedAt).reverse();
  if(!closed.length){
    root.innerHTML='<div class="muted" style="font-size:14px">Закрытых смен пока нет.</div>';
    return;
  }
  root.innerHTML=closed.map(period=>{
    const inv=S.inventories.find(x=>x.periodId===period.id);
    const cups=periodSales(period.id).length;
    return `<div class="history-row">
      <div class="shift">Смена №${period.id}<span class="when">${new Date(period.closedAt).toLocaleString('ru-RU')}</span></div>
      <div class="metric">${fmt(revenue(period.id))} сом<span>выручка</span></div>
      <div class="metric">${cups}<span>чашек</span></div>
      <div class="metric">${fmt(inv?.total||0)} сом<span>утечка</span></div>
    </div>`;
  }).join('');
}

/* ---------- CATALOG ---------- */
let catalogProducts=[];
const catalogModal=document.getElementById('catalogModal');
function catalogMessage(form,message){form.querySelector('[data-catalog-error]').textContent=message;}
function catalogRpcError(error){
  const message=String(error?.message||'Не удалось сохранить изменения.');
  if(/duplicate key/i.test(message)) return 'Такой код уже используется в этой точке.';
  if(/inventory in progress/i.test(message)) return 'Заверши или отмени инвентаризацию перед изменением каталога.';
  if(/owner access required/i.test(message)) return 'Редактировать каталог может только владелец.';
  return message;
}
async function loadCatalog(){
  const [productsResult,recipesResult]=await Promise.all([
    globalThis.EsepSupabase.from('products').select('*').eq('location_id',cloudContext.locationId).order('created_at'),
    globalThis.EsepSupabase.from('product_recipes').select('product_id,ingredient_id,quantity').eq('location_id',cloudContext.locationId),
  ]);
  if(productsResult.error||recipesResult.error){showToast('Каталог не загружен',catalogRpcError(productsResult.error||recipesResult.error));return;}
  const recipes={};recipesResult.data.forEach(row=>(recipes[row.product_id]??={})[row.ingredient_id]=Number(row.quantity));
  catalogProducts=productsResult.data.map(row=>({...row,price:Number(row.price),recipe:recipes[row.id]||{}}));
  renderCatalogLists();
}
function renderCatalogLists(){
  const ingredientRoot=document.getElementById('catalogIngredientList');
  ingredientRoot.innerHTML=S.ingredients.map(i=>`<div class="catalog-row"><div class="catalog-main"><b>${esc(i.name)}</b><span>${esc(i.code)} · остаток ${fmt(i.stock)} ${esc(i.unit)} · порог ${fmt(i.threshold)}</span></div><div class="catalog-value">${i.cost} сом/${esc(i.unit)}</div><button type="button" data-edit-ingredient="${i.id}">Изменить</button></div>`).join('');
  const productRoot=document.getElementById('catalogProductList');
  productRoot.innerHTML=catalogProducts.map(p=>`<div class="catalog-row${p.active?'':' inactive'}"><div class="catalog-main"><b>${esc(p.emoji)} ${esc(p.name)}</b><span>${esc(p.code)} · ${Object.keys(p.recipe).length} ингредиента</span></div><div class="catalog-value">${fmt(p.price)} сом</div><div class="catalog-actions"><button type="button" data-edit-product="${p.id}">Изменить</button><button type="button" data-toggle-product="${p.id}">${p.active?'Скрыть':'Вернуть'}</button></div></div>`).join('');
  ingredientRoot.querySelectorAll('[data-edit-ingredient]').forEach(button=>button.onclick=()=>openIngredientForm(button.dataset.editIngredient));
  productRoot.querySelectorAll('[data-edit-product]').forEach(button=>button.onclick=()=>openProductForm(button.dataset.editProduct));
  productRoot.querySelectorAll('[data-toggle-product]').forEach(button=>button.onclick=()=>toggleProduct(button.dataset.toggleProduct));
}
function closeCatalogForms(){document.getElementById('ingredientForm').hidden=true;document.getElementById('productForm').hidden=true;}
function openIngredientForm(id=null){
  closeCatalogForms();const form=document.getElementById('ingredientForm');form.reset();form.hidden=false;
  const ingredient=id?S.ingredients.find(item=>item.id===id):null;
  form.elements.id.value=ingredient?.id||'';form.elements.name.value=ingredient?.name||'';form.elements.code.value=ingredient?.code||'';
  form.elements.unit.value=ingredient?.unit||'';form.elements.stock.value=ingredient?.stock||0;form.elements.threshold.value=ingredient?.threshold||0;form.elements.cost.value=ingredient?.cost||0;
  document.getElementById('ingredientFormTitle').textContent=ingredient?'Изменить ингредиент':'Новый ингредиент';
  document.getElementById('openingStockField').hidden=Boolean(ingredient);catalogMessage(form,'');form.scrollIntoView({block:'nearest'});
}
function openProductForm(id=null){
  closeCatalogForms();const form=document.getElementById('productForm');form.reset();form.hidden=false;
  const product=id?catalogProducts.find(item=>item.id===id):null;
  form.elements.id.value=product?.id||'';form.elements.name.value=product?.name||'';form.elements.code.value=product?.code||'';form.elements.emoji.value=product?.emoji||'';form.elements.price.value=product?.price||0;
  document.getElementById('productFormTitle').textContent=product?'Изменить товар':'Новый товар';
  document.getElementById('recipeEditor').innerHTML=S.ingredients.map(i=>`<div class="recipe-row"><span>${esc(i.name)}</span><label><input data-recipe-id="${i.id}" type="number" min="0" step="any" value="${product?.recipe[i.id]||0}"><small>${esc(i.unit)}</small></label></div>`).join('');
  catalogMessage(form,'');form.scrollIntoView({block:'nearest'});
}
async function toggleProduct(id){
  const product=catalogProducts.find(item=>item.id===id);if(!product)return;
  const {error}=await globalThis.EsepSupabase.rpc('set_product_active',{target_product_id:id,enabled:!product.active});
  if(error){showToast('Товар не изменён',catalogRpcError(error));return;}await reloadCloudLocation();await loadCatalog();
}
document.getElementById('ingredientForm').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget;const values=new FormData(form);const submit=form.querySelector('[type="submit"]');submit.disabled=true;catalogMessage(form,'');
  const {error}=await globalThis.EsepSupabase.rpc('save_ingredient',{target_location_id:cloudContext.locationId,target_ingredient_id:values.get('id')||null,ingredient_code:String(values.get('code')).trim().toLowerCase(),ingredient_name:String(values.get('name')).trim(),ingredient_unit:String(values.get('unit')).trim(),opening_stock:Number(values.get('stock')),low_stock_threshold:Number(values.get('threshold')),cost_per_unit:Number(values.get('cost'))});
  submit.disabled=false;if(error){catalogMessage(form,catalogRpcError(error));return;}closeCatalogForms();await reloadCloudLocation();await loadCatalog();showToast('Ингредиент сохранён','Каталог точки обновлён.');
};
document.getElementById('productForm').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget;const values=new FormData(form);const recipe={};
  form.querySelectorAll('[data-recipe-id]').forEach(input=>{const quantity=Number(input.value);if(quantity>0)recipe[input.dataset.recipeId]=quantity;});
  if(!Object.keys(recipe).length){catalogMessage(form,'Добавь хотя бы один ингредиент в техкарту.');return;}
  const submit=form.querySelector('[type="submit"]');submit.disabled=true;catalogMessage(form,'');
  const {error}=await globalThis.EsepSupabase.rpc('save_product',{target_location_id:cloudContext.locationId,target_product_id:values.get('id')||null,product_code:String(values.get('code')).trim().toLowerCase(),product_name:String(values.get('name')).trim(),product_emoji:String(values.get('emoji')).trim(),product_price:Number(values.get('price')),recipe});
  submit.disabled=false;if(error){catalogMessage(form,catalogRpcError(error));return;}closeCatalogForms();await reloadCloudLocation();await loadCatalog();showToast('Товар сохранён','Цена и техкарта обновлены.');
};
document.getElementById('manageCatalog').onclick=async()=>{setAccountMenu(false);closeCatalogForms();catalogModal.showModal();await loadCatalog();};
document.getElementById('catalogModalClose').onclick=()=>catalogModal.close();
catalogModal.addEventListener('cancel',event=>{event.preventDefault();catalogModal.close();});
document.getElementById('addIngredient').onclick=()=>openIngredientForm();document.getElementById('addProduct').onclick=()=>openProductForm();
document.querySelectorAll('[data-close-catalog-form]').forEach(button=>button.onclick=closeCatalogForms);
document.getElementById('catalogTabs').onclick=event=>{const button=event.target.closest('[data-catalog-view]');if(!button)return;document.querySelectorAll('[data-catalog-view]').forEach(item=>item.classList.toggle('on',item===button));document.getElementById('catalogProducts').hidden=button.dataset.catalogView!=='products';document.getElementById('catalogIngredients').hidden=button.dataset.catalogView!=='ingredients';closeCatalogForms();};

/* ---------- shell ---------- */
function switchView(v){
  if(S.role==='barista'&&(v==='stock'||v==='inv'||v==='dash')){ showToast('Раздел владельца','Бариста работает только с кассой.'); v='kassa'; }
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on', s.id==='v-'+v));
  if(v==='inv') renderInv(); if(v==='dash') renderDash(); if(v==='stock') renderStock(); if(v==='kassa') renderKassa();
  window.scrollTo({top:0,behavior:'auto'});
}
function renderAll(){ renderKassa(); renderStock(); if(document.getElementById('v-inv').classList.contains('on')) renderInv(); if(document.getElementById('v-dash').classList.contains('on')) renderDash(); }
function applyRole(){
  document.getElementById('roleLabel').textContent=S.role==='owner'?'Владелец':'Бариста';
  document.querySelectorAll('.owner-only').forEach(el=>el.style.display=S.role==='owner'?'':'none');
  document.querySelectorAll('.tabs button').forEach(b=>{ if(b.dataset.v==='stock'||b.dataset.v==='inv'||b.dataset.v==='dash') b.style.display=S.role==='owner'?'':'none'; });
}
function setAuthenticatedRole(role){
  if(role!=='owner'&&role!=='barista') return;
  if(S.role!==role) transact(()=>{S.role=role;});
  applyRole();
  const current=document.querySelector('.view.on')?.id.replace('v-','')||'kassa';
  const protectedView=current==='stock'||current==='inv'||current==='dash';
  switchView(role==='barista'&&protectedView?'kassa':current);
  renderAll();
}

document.getElementById('tabs').addEventListener('click',e=>{const b=e.target.closest('button'); if(b) switchView(b.dataset.v);});
const accountToggle=document.getElementById('accountToggle');
const accountMenu=document.getElementById('accountMenu');
function setAccountMenu(open){accountMenu.hidden=!open;accountToggle.setAttribute('aria-expanded',String(open));}
accountToggle.onclick=()=>setAccountMenu(accountMenu.hidden);
document.addEventListener('click',event=>{if(!accountMenu.hidden&&!event.target.closest('.account')) setAccountMenu(false);});
document.getElementById('reset').onclick=()=>{if(confirm('Сбросить демо к начальным данным?')){
  const authenticatedRole=S.role;
  if(!transact(()=>{S=SEED();S.role=authenticatedRole;})){showToast('Сброс не сохранён','Хранилище недоступно.');return;}
  switchView('kassa');renderAll();
}};
document.getElementById('applyInv').onclick=applyInv;
document.getElementById('startInv').onclick=startInventory;
document.getElementById('fillTheory').onclick=fillTheory;
document.getElementById('simLeak').onclick=simLeak;
document.getElementById('cancelInv').onclick=cancelInventory;
document.getElementById('undoSale').onclick=cancelLastSale;
document.getElementById('stockForm').onsubmit=submitStockOperation;
document.getElementById('stockModalClose').onclick=closeStockModal;
document.getElementById('stockModalCancel').onclick=closeStockModal;
document.getElementById('stockModal').addEventListener('cancel',event=>{event.preventDefault();closeStockModal();});

applyRole(); renderAll();
globalThis.EsepApp={loadCloudLocation,setRole:setAuthenticatedRole,showToast};
