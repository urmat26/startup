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
let S=initializeState();
const isFiniteNonNegative = value => Number.isFinite(value)&&value>=0;
function validateState(state){
  if(!state||state.schemaVersion!==2||!Array.isArray(state.ingredients)||!Array.isArray(state.products)||!Array.isArray(state.sales)) return false;
  const ingredientIds=new Set(state.ingredients.map(i=>i?.id));
  const productIds=new Set(state.products.map(p=>p?.id));
  if(ingredientIds.size!==state.ingredients.length||productIds.size!==state.products.length) return false;
  if(!state.ingredients.every(i=>i&&typeof i.id==='string'&&typeof i.name==='string'&&typeof i.unit==='string'
    &&isFiniteNonNegative(i.stock)&&isFiniteNonNegative(i.start)&&isFiniteNonNegative(i.threshold)&&isFiniteNonNegative(i.cost))) return false;
  if(!state.products.every(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&isFiniteNonNegative(p.price)
    &&p.recipe&&Object.entries(p.recipe).length>0&&Object.entries(p.recipe).every(([id,qty])=>ingredientIds.has(id)&&Number.isFinite(qty)&&qty>0))) return false;
  if(state.role!=='owner'&&state.role!=='barista') return false;
  if(!Array.isArray(state.periods)||state.periods.filter(p=>p&&p.closedAt==null).length!==1) return false;
  const periodIds=new Set(state.periods.map(p=>p?.id));
  if(periodIds.size!==state.periods.length||!state.periods.every(p=>p&&Number.isFinite(p.id)&&Number.isFinite(p.openedAt))) return false;
  if(!Array.isArray(state.movements)||!Array.isArray(state.inventories)) return false;
  if(new Set(state.sales.map(sale=>sale?.id)).size!==state.sales.length||new Set(state.movements.map(event=>event?.id)).size!==state.movements.length) return false;
  if(!state.sales.every(sale=>sale&&typeof sale.id==='string'&&productIds.has(sale.productId)&&periodIds.has(sale.periodId)&&Number.isFinite(sale.ts)
    &&(sale.canceledAt==null||Number.isFinite(sale.canceledAt))&&isFiniteNonNegative(sale.unitPrice)&&isFiniteNonNegative(sale.cogs)&&sale.recipeSnapshot
    &&Object.entries(sale.recipeSnapshot).every(([id,qty])=>ingredientIds.has(id)&&Number.isFinite(qty)&&qty>0))) return false;
  if(!state.movements.every(event=>event&&typeof event.id==='string'&&ingredientIds.has(event.ingredientId)&&periodIds.has(event.periodId)&&Number.isFinite(event.qty)&&Number.isFinite(event.ts))) return false;
  if(!state.inventories.every(inventory=>inventory&&typeof inventory.id==='string'&&periodIds.has(inventory.periodId)&&Number.isFinite(inventory.closedAt)
    &&Array.isArray(inventory.items)&&isFiniteNonNegative(inventory.total))) return false;
  if(state.lastInventory&&!state.inventories.some(inventory=>inventory.id===state.lastInventory.id)) return false;
  if(state.inventoryDraft){
    if(!Number.isFinite(state.inventoryDraft.periodId)||!Number.isFinite(state.inventoryDraft.startedAt)||!state.inventoryDraft.snapshot) return false;
    if(!state.ingredients.every(i=>isFiniteNonNegative(state.inventoryDraft.snapshot[i.id]))) return false;
    if(state.inventoryDraft.actual&&!Object.values(state.inventoryDraft.actual).every(isFiniteNonNegative)) return false;
  }
  return state.ingredients.every(ingredient=>{
    const projected=ingredient.start+state.movements.filter(event=>event.ingredientId===ingredient.id).reduce((sum,event)=>sum+event.qty,0);
    return Math.abs(projected-ingredient.stock)<1e-7;
  });
}
function initializeState(){
  try{
    const raw=localStorage.getItem(KEY);
    if(!raw){
      const state=SEED();
      localStorage.setItem(KEY,JSON.stringify(state));
      return state;
    }
    const state=JSON.parse(raw);
    if(!validateState(state)) throw new TypeError('Invalid stored state');
    localStorage.setItem(KEY,JSON.stringify(state));
    return state;
  }catch(error){
    const state=SEED();
    try{
      localStorage.removeItem(KEY);
      localStorage.setItem(KEY,JSON.stringify(state));
    }catch(removeError){}
    return state;
  }
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
function sell(p){
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
function cancelLastSale(){
  if(inventoryInProgress()) return showToast('Отмена приостановлена','Заверши или отмени текущую инвентаризацию.');
  const sale=[...S.sales].reverse().find(x=>x.periodId===openPeriod().id&&!x.canceledAt);
  if(!sale) return showToast('Отменять нечего','В текущей смене нет активных продаж.');
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
  const i=ing(id); const raw=prompt(`${type==='receipt'?'Приход':'Списание'}: ${i.name}, ${i.unit}`);
  if(raw===null) return;
  const qty=Number(String(raw).replace(',','.'));
  if(!Number.isFinite(qty)||qty<=0) return showToast('Количество не сохранено','Введи число больше нуля.');
  if(type==='writeoff'&&qty>i.stock) return showToast('Списание невозможно',`На складе только ${fmt(i.stock)} ${i.unit}.`);
  const delta=type==='receipt'?qty:-qty;
  const saved=transact(()=>{i.stock+=delta;addMovement(id,type,delta);});
  if(!saved){renderStock();showToast('Операция не сохранена','Хранилище недоступно. Повтори операцию.');return;}
  renderStock(); showToast(type==='receipt'?'Приход сохранён':'Списание сохранено',`${i.name}: ${delta>0?'+':''}${fmt(delta)} ${i.unit}`);
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
  t.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',recalcInv));
  recalcInv();
}
function startInventory(){
  if(S.role!=='owner'||inventoryInProgress()) return;
  const period=openPeriod();
  if(!transact(()=>{S.inventoryDraft={periodId:period.id,startedAt:Date.now(),snapshot:createInventorySnapshot(S.ingredients),actual:{}};})){
    showToast('Инвентаризация не начата','Хранилище недоступно.');return;
  }
  renderInv();
  showToast('Инвентаризация начата','Продажи и складские операции приостановлены до завершения или отмены.');
}
function recalcInv(){
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
  S.inventoryDraft.actual=actualById;
  if(!save()) showToast('Черновик не сохранён','Проверь доступ к хранилищу браузера.');
  const tot=document.getElementById('invTotal');
  if(tot){tot.textContent=complete?fmt(total)+' сом':'Не проверено';tot.className='num '+(complete&&total===0?'var-ok':'var-leak');}
}
function applyInv(){
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
function cancelInventory(){
  if(!inventoryInProgress()) return;
  if(!transact(()=>{S.inventoryDraft=null;})){showToast('Отмена не сохранена','Хранилище недоступно.');return;}
  switchView('kassa'); renderAll();
  showToast('Инвентаризация отменена','Продажи и складские операции снова доступны.');
}
function fillTheory(){ document.querySelectorAll('#invTable tbody tr').forEach(tr=>{tr.querySelector('input').value=Math.round(S.inventoryDraft.snapshot[tr.dataset.id]);}); recalcInv(); }
function simLeak(){
  const usage=calculateIngredientUsage(S.sales,S.products,openPeriod().id);
  const actual=simulateActualStock(S.ingredients,S.inventoryDraft.snapshot,usage);
  document.querySelectorAll('#invTable tbody tr').forEach(tr=>{
    tr.querySelector('input').value=actual[tr.dataset.id];
  });
  recalcInv();
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
  document.getElementById('role').value=S.role;
  document.querySelectorAll('.owner-only').forEach(el=>el.style.display=S.role==='owner'?'':'none');
  document.querySelectorAll('.tabs button').forEach(b=>{ if(b.dataset.v==='stock'||b.dataset.v==='inv'||b.dataset.v==='dash') b.style.display=S.role==='owner'?'':'none'; });
}

document.getElementById('tabs').addEventListener('click',e=>{const b=e.target.closest('button'); if(b) switchView(b.dataset.v);});
document.getElementById('reset').onclick=()=>{if(confirm('Сбросить демо к начальным данным?')){
  if(!transact(()=>{S=SEED();})){showToast('Сброс не сохранён','Хранилище недоступно.');return;}
  switchView('kassa');renderAll();
}};
document.getElementById('applyInv').onclick=applyInv;
document.getElementById('startInv').onclick=startInventory;
document.getElementById('fillTheory').onclick=fillTheory;
document.getElementById('simLeak').onclick=simLeak;
document.getElementById('cancelInv').onclick=cancelInventory;
document.getElementById('undoSale').onclick=cancelLastSale;
document.getElementById('role').onchange=e=>{
  const current=document.querySelector('.view.on')?.id.replace('v-','')||'kassa';
  const nextRole=e.target.value;
  if(!transact(()=>{S.role=nextRole;})){e.target.value=S.role;showToast('Роль не изменена','Хранилище недоступно.');return;}
  applyRole();
  const protectedView=current==='stock'||current==='inv'||current==='dash';
  switchView(S.role==='barista'&&protectedView?'kassa':current);
  renderAll();
};

applyRole(); renderAll();
