const {
  calculateCogs,
  calculateInventory,
  calculateRevenue,
  findMissingIngredients,
  salesForPeriod,
} = globalThis.EsepDomain;

const SEED = () => ({
  ingredients:[
    {id:'milk', name:'Молоко', unit:'мл', stock:5000, start:5000, threshold:1500, cost:0.06},
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
});
const KEY='esep-demo-v1';
let S = load();
function load(){ try{const r=localStorage.getItem(KEY); if(r) return JSON.parse(r);}catch(e){} return SEED(); }
function save(){ try{localStorage.setItem(KEY, JSON.stringify(S));}catch(e){} }

if(!('lastInventory' in S)){ S.lastInventory=null; delete S.inv; }
if(!S.role) S.role='owner';
if(!Array.isArray(S.periods)||!S.periods.length) S.periods=[{id:1,openedAt:Date.now(),closedAt:null}];
if(!Array.isArray(S.movements)) S.movements=[];
if(!Array.isArray(S.inventories)) S.inventories=S.lastInventory?[S.lastInventory]:[];
const openPeriod = () => S.periods.findLast ? S.periods.findLast(p=>!p.closedAt) : [...S.periods].reverse().find(p=>!p.closedAt);
S.sales.forEach(x=>{ if(!x.periodId) x.periodId=openPeriod().id; });
save();

const fmt = n => Math.round(n).toLocaleString('ru-RU');
const ing = id => S.ingredients.find(i=>i.id===id);
const cogsOf = p => Object.entries(p.recipe).reduce((s,[k,q])=>s+ing(k).cost*q,0);
const periodSales = (id=openPeriod().id) => salesForPeriod(S.sales,id);
const revenue = (id=openPeriod().id) => calculateRevenue(S.sales,S.products,id);
const cogsSold = (id=openPeriod().id) => calculateCogs(S.sales,S.products,S.ingredients,id);
const addMovement = (ingredientId,type,qty,note='') => S.movements.push({
  id:Date.now()+Math.random(),periodId:openPeriod().id,ingredientId,type,qty,note,ts:Date.now()
});

/* ---------- KASSA ---------- */
function sell(p){
  const missing=findMissingIngredients(p,S.ingredients).map(({ingredient,qty})=>({i:ingredient,q:qty}));
  if(missing.length){
    const detail=missing.map(({i,q})=>`${i.name}: нужно ${q} ${i.unit}, осталось ${fmt(Math.max(0,i.stock))} ${i.unit}`).join(' · ');
    showToast('Продажа невозможна — не хватает на складе',detail);
    return;
  }
  for(const [k,q] of Object.entries(p.recipe)){ ing(k).stock -= q; addMovement(k,'sale',-q,p.name); }
  S.sales.push({productId:p.id,periodId:openPeriod().id,ts:Date.now()});
  if(S.lastInventory) S.lastInventory=null;
  save(); renderAll();
  const ded = Object.entries(p.recipe).map(([k,q])=>`−${q} ${ing(k).unit} ${ing(k).name.toLowerCase()}`).join(' · ');
  showToast(`${p.name} · ${p.price} сом`, ded);
}
function cancelLastSale(){
  const sale=[...S.sales].reverse().find(x=>x.periodId===openPeriod().id&&!x.canceledAt);
  if(!sale) return showToast('Отменять нечего','В текущей смене нет активных продаж.');
  const product=S.products.find(p=>p.id===sale.productId);
  if(!product) return showToast('Продажа не отменена','Товар больше не найден в меню.');
  sale.canceledAt=Date.now();
  for(const [ingredientId,quantity] of Object.entries(product.recipe)){
    ing(ingredientId).stock+=quantity;
    addMovement(ingredientId,'refund',quantity,product.name);
  }
  save(); renderAll();
  showToast('Продажа отменена',`${product.name} · ингредиенты возвращены на склад`);
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
    b.setAttribute('aria-label',missing.length?`${p.name}, недоступно: не хватает ${missing.join(', ')}`:`Продать ${p.name} за ${p.price} сом`);
    const rc=Object.entries(p.recipe).map(([k,q])=>`${q}${ing(k).unit} ${ing(k).name.toLowerCase()}`).join(', ');
    b.innerHTML=`<div class="emoji">${p.emoji}</div><div class="pname">${p.name}</div>
      <div class="price num">${p.price} сом</div><div class="rc">${missing.length?'Нет на складе: '+missing.join(', '):rc}</div>`;
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
      return `<div class="row"><span>${p.name}</span><span class="d num">×${c}</span></div>`;
    }).join('');
  }
  document.getElementById('undoSale').disabled=!currentSales.length;
}

/* ---------- STOCK ---------- */
function renderStock(){
  const alerts=document.getElementById('alerts'); const low=S.ingredients.filter(i=>i.stock<i.threshold);
  alerts.innerHTML = low.length ? low.map(i=>{
    const need=Math.ceil((i.start-i.stock)/ (i.unit==='мл'?1000:i.unit==='г'?1000:1));
    const nu = i.unit==='мл'?'л':i.unit==='г'?'кг':'шт';
    return `<div class="alert"><span class="ico">🔴</span><span class="txt"><b>${i.name}</b> заканчивается — осталось ${fmt(i.stock)} ${i.unit}. Пора заказать ≈ ${need} ${nu}.</span></div>`;
  }).join('') : `<div class="alert" style="border-color:rgba(46,158,107,.35);border-left-color:var(--money)"><span class="ico">✅</span><span class="txt">Остатков хватает — заказывать пока нечего.</span></div>`;
  const list=document.getElementById('stockList'); list.innerHTML='';
  S.ingredients.forEach(i=>{
    const pct=Math.max(0,Math.min(100, i.stock/i.start*100));
    const thrPct=Math.max(0,Math.min(100, i.threshold/i.start*100));
    const lowc=i.stock<i.threshold?' low':'';
    const el=document.createElement('div'); el.className='ing'+lowc;
    el.innerHTML=`<div class="top"><span class="nm">${i.name}</span><span class="val num">${fmt(i.stock)} ${i.unit}</span></div>
      <div class="bar"><div class="fill" style="width:${pct}%"></div><div class="thr" style="left:${thrPct}%"></div></div>
      <div class="meta"><span>порог ${fmt(i.threshold)} ${i.unit}</span><span>себест. ${i.cost} сом/${i.unit}</span></div>
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
  ledger.innerHTML=rows.length?rows.map(m=>`<div class="ledger-row"><time>${new Date(m.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time><span>${labels[m.type]} · ${ing(m.ingredientId).name}${m.note?' · '+m.note:''}</span><b>${m.qty>0?'+':''}${fmt(m.qty)} ${ing(m.ingredientId).unit}</b></div>`).join(''):'<div class="muted">Движений пока нет</div>';
  applyRole();
}
function adjustStock(id,type){
  if(S.role!=='owner') return showToast('Недостаточно прав','Приход и списание доступны владельцу.');
  const i=ing(id); const raw=prompt(`${type==='receipt'?'Приход':'Списание'}: ${i.name}, ${i.unit}`);
  if(raw===null) return;
  const qty=Number(String(raw).replace(',','.'));
  if(!Number.isFinite(qty)||qty<=0) return showToast('Количество не сохранено','Введи число больше нуля.');
  if(type==='writeoff'&&qty>i.stock) return showToast('Списание невозможно',`На складе только ${fmt(i.stock)} ${i.unit}.`);
  const delta=type==='receipt'?qty:-qty; i.stock+=delta; addMovement(id,type,delta);
  save(); renderStock(); showToast(type==='receipt'?'Приход сохранён':'Списание сохранено',`${i.name}: ${delta>0?'+':''}${fmt(delta)} ${i.unit}`);
}

/* ---------- INVENTORY ---------- */
function renderInv(){
  if(S.role!=='owner'){
    document.getElementById('invTable').innerHTML='<tbody><tr><td>Инвентаризацию может проводить только владелец.</td></tr></tbody>';
    document.getElementById('periodLabel').textContent=`Смена №${openPeriod().id}`;
    return;
  }
  document.getElementById('periodLabel').textContent=`Смена №${openPeriod().id} · открыта ${new Date(openPeriod().openedAt).toLocaleString('ru-RU')}`;
  const t=document.getElementById('invTable');
  const rows=S.ingredients.map(i=>{
    return `<tr data-id="${i.id}">
      <td class="nm">${i.name}</td>
      <td class="num">${fmt(i.stock)} ${i.unit}</td>
      <td><input type="number" min="0" step="any" inputmode="numeric" value="" placeholder="—"> <span class="muted">${i.unit}</span></td>
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
function recalcInv(){
  let total=0;
  document.querySelectorAll('#invTable tbody tr').forEach(tr=>{
    const i=ing(tr.dataset.id); const inp=tr.querySelector('input');
    const varcell=tr.querySelector('.varcell'); const leakcell=tr.querySelector('.leakcell');
    if(inp.value===''){varcell.textContent='—';varcell.className='varcell num';leakcell.textContent='—';leakcell.className='leakcell num';return;}
    const actual=parseFloat(inp.value)||0; const diff=i.stock-actual; // >0 = утекло
    const leak=Math.max(0,diff)*i.cost;
    varcell.textContent=(diff>0?'−':diff<0?'+':'')+fmt(Math.abs(diff))+' '+i.unit;
    varcell.className='varcell num '+(diff>0?'var-leak':'var-ok');
    leakcell.textContent=diff>0?fmt(leak):'0';
    leakcell.className='leakcell num '+(diff>0?'var-leak':'var-ok');
    total+=leak;
  });
  const tot=document.getElementById('invTotal');
  if(tot){tot.textContent=fmt(total)+' сом'; tot.className='num '+(total>0?'var-leak':'var-ok');}
}
function applyInv(){
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
  const items=calculateInventory(S.ingredients,actualById).map(item=>{
    const i=ing(item.id);
    return {...item,name:i.name,unit:i.unit,diff:item.difference};
  });
  const total=items.reduce((sum,item)=>sum+item.leak,0);
  const period=openPeriod(); const closedAt=Date.now();
  S.lastInventory={periodId:period.id,closedAt,items,total};
  S.inventories.push(S.lastInventory);
  items.forEach(item=>{ const delta=item.actual-item.theoretical; ing(item.id).stock=item.actual; if(delta) addMovement(item.id,'inventory',delta); });
  period.closedAt=closedAt;
  S.periods.push({id:Math.max(...S.periods.map(p=>p.id))+1,openedAt:closedAt,closedAt:null});
  save(); renderDash(); switchView('dash');
}
function fillTheory(){ document.querySelectorAll('#invTable tbody tr').forEach(tr=>{tr.querySelector('input').value=Math.round(ing(tr.dataset.id).stock);}); recalcInv(); }
function simLeak(){
  // реалистичная недостача: чуть меньше, чем по системе
  const gaps={milk:420, beans:35, cup:6, syrup:60, cocoa:18};
  document.querySelectorAll('#invTable tbody tr').forEach(tr=>{
    const i=ing(tr.dataset.id); tr.querySelector('input').value=Math.max(0,Math.round(i.stock-(gaps[i.id]||0)));
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
  if(total>0){
    big.textContent='−'+fmt(total)+' сом'; big.className='big leak';
    const pctRev=rev?(total/rev*100):0;
    exp.innerHTML=`Продано на <b>${fmt(rev)} сом</b>, честная себестоимость — <b>${fmt(cogs)} сом</b>. Но по факту склада не хватает ещё на <b>${fmt(total)} сом</b> — это <b>${pctRev.toFixed(1)}%</b> выручки, которые ушли мимо кассы (пролив, недолив, воровство). <b>Вот куда делись деньги.</b>`;
  }else{
    big.textContent='0 сом'; big.className='big ok';
    exp.innerHTML='Факт сходится с системой — <b>утечки нет</b>. Вся себестоимость ушла в проданные чашки.';
  }
  const max=Math.max(...items.map(x=>x.leak),1);
  bl.innerHTML=items.filter(x=>x.leak>0).sort((a,b)=>b.leak-a.leak).map(x=>
    `<div class="brow"><span class="bn">${x.name}</span><div class="bbar"><span style="width:${x.leak/max*100}%"></span></div>
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
  if(S.role==='barista'&&(v==='inv'||v==='dash')){ showToast('Раздел владельца','Бариста работает с кассой и видит остатки.'); v='kassa'; }
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on', s.id==='v-'+v));
  if(v==='inv') renderInv(); if(v==='dash') renderDash(); if(v==='stock') renderStock(); if(v==='kassa') renderKassa();
  window.scrollTo({top:0,behavior:'auto'});
}
function renderAll(){ renderKassa(); renderStock(); if(document.getElementById('v-inv').classList.contains('on')) renderInv(); if(document.getElementById('v-dash').classList.contains('on')) renderDash(); }
function applyRole(){
  document.getElementById('role').value=S.role;
  document.querySelectorAll('.owner-only').forEach(el=>el.style.display=S.role==='owner'?'':'none');
  document.querySelectorAll('.tabs button').forEach(b=>{ if(b.dataset.v==='inv'||b.dataset.v==='dash') b.style.display=S.role==='owner'?'':'none'; });
}

document.getElementById('tabs').addEventListener('click',e=>{const b=e.target.closest('button'); if(b) switchView(b.dataset.v);});
document.getElementById('reset').onclick=()=>{ if(confirm('Сбросить демо к начальным данным?')){ S=SEED(); save(); switchView('kassa'); renderAll(); } };
document.getElementById('applyInv').onclick=applyInv;
document.getElementById('fillTheory').onclick=fillTheory;
document.getElementById('simLeak').onclick=simLeak;
document.getElementById('undoSale').onclick=cancelLastSale;
document.getElementById('role').onchange=e=>{S.role=e.target.value;save();applyRole();switchView(S.role==='barista'?'kassa':'stock');renderAll();};

applyRole(); renderAll();
