/**
 * app.js — StockControl v5  (sin auth)
 */

window.addEventListener('error', e => {
  console.error('StockControl error:', e.message, 'line:', e.lineno);
});

// ── Helpers ───────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function toast(msg, type='') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast-'+type : '');
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  return dt.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})
    + ' ' + dt.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
}

function daysLeft(expStr) {
  if (!expStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((new Date(expStr+'T00:00:00') - today) / 86400000);
}

function expiryBadge(days) {
  if (days === null) return '<span class="badge badge-info">Sin fecha</span>';
  if (days < 0)      return `<span class="badge badge-danger">Vencido ${Math.abs(days)}d</span>`;
  if (days === 0)    return `<span class="badge badge-danger">Vence HOY</span>`;
  if (days <= 7)     return `<span class="badge badge-danger">${days}d</span>`;
  if (days <= 30)    return `<span class="badge badge-warn">${days}d</span>`;
  return `<span class="badge badge-ok">${days}d</span>`;
}

function initials(name) {
  return (name||'').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';
}

function totalStock(lots) {
  return lots.reduce((s,l) => s+(l.qty||0), 0);
}

function pkgBreakdown(total, pkgType, pkgQty) {
  if (!pkgQty || pkgQty <= 1 || pkgType === 'unidad') return null;
  return { full: Math.floor(total/pkgQty), rem: total%pkgQty, pkgType, pkgQty };
}

// ── Beep ──────────────────────────────────────────────────────────

let audioCtx = null;

function beep() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, audioCtx.currentTime+0.08);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime+0.15);
    osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime+0.15);
  } catch(_) {}
}

document.addEventListener('touchstart', () => {
  if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if (audioCtx.state==='suspended') audioCtx.resume();
}, { once: true });

// ── Image compression ─────────────────────────────────────────────

function compressImage(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        let w = img.width, h = img.height;
        if (w>MAX||h>MAX) { if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;} }
        const canvas = document.createElement('canvas');
        canvas.width=w; canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg',0.75));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Package calculator helpers ────────────────────────────────────

function calcUnitsFromForm(qtyInputId, typeInputId, product) {
  const qty    = parseInt($(qtyInputId).value) || 0;
  const type   = $(typeInputId).value;
  const pkgQty = product ? (product.pkgQty || 1) : 1;
  const pkgType = product ? (product.pkgType || 'unidad') : 'unidad';
  if (type === 'unit' || pkgQty <= 1 || pkgType === 'unidad') return qty;
  return qty * pkgQty;
}

function renderCalcPreview(previewId, qty, type, product) {
  const el = $(previewId);
  if (!el) return;
  const pkgQty  = product ? (product.pkgQty || 1) : 1;
  const pkgType = product ? (product.pkgType || 'unidad') : 'unidad';
  const n = parseInt(qty) || 0;
  if (n <= 0) { el.innerHTML = ''; return; }
  if (type === 'pkg' && pkgQty > 1 && pkgType !== 'unidad') {
    const total = n * pkgQty;
    el.innerHTML = `<span class="qty-big">${total}</span> <span class="qty-dim">unidades — ${n} ${pkgType}${n!==1?'s':''} × ${pkgQty} uds. c/u</span>`;
  } else {
    el.innerHTML = `<span class="qty-big">${n}</span> <span class="qty-dim">unidades sueltas</span>`;
  }
}

// ── Nav ───────────────────────────────────────────────────────────

const SECTION_LOAD = {
  scan:      () => {},
  deposit:   loadDeposit,
  gondola:   () => runGondolaSearch(),
  reception: loadRecentReceptions,
  conteo:    loadConteoHistory,
  register:  () => {},
  config:    () => {}
};

function initNav() {
  document.querySelectorAll('.nav-item[data-sec]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = btn.dataset.sec;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const targetSec = $('sec-'+sec);
      if (targetSec) targetSec.classList.add('active');
      if (sec !== 'scan')      stopScanCam();
      if (sec !== 'deposit')   stopDepCam();
      if (sec !== 'gondola')   stopGondolaCam();
      if (sec !== 'conteo')    stopCntCam();
      if (sec !== 'reception') stopRecCam();
      if (SECTION_LOAD[sec]) SECTION_LOAD[sec]();
    });
  });
}

function flashVp(id) {
  const vp=$(id); if(!vp) return;
  const el=document.createElement('div'); el.className='scanner-flash';
  vp.appendChild(el); setTimeout(()=>el.remove(),450);
}

// ── ESCANEAR ─────────────────────────────────────────────────────

let scanStream=null, scanInterval=null, lastScanCode=null, scanDetector=null;

function initScanSection() {
  if ('BarcodeDetector' in window) {
    scanDetector = new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','code_93','upc_a','upc_e','qr_code','itf','codabar']});
  } else {
    $('scanner-status').textContent = 'Usá el campo manual';
    $('btn-cam-start').disabled = true;
  }
  $('btn-cam-start').addEventListener('click', startScanCam);
  $('btn-cam-stop').addEventListener('click', stopScanCam);
  $('btn-manual').addEventListener('click', () => { const c=$('inp-barcode').value.trim(); if(c) handleScanCode(c); });
  $('inp-barcode').addEventListener('keydown', e => { if(e.key==='Enter'){const c=$('inp-barcode').value.trim();if(c)handleScanCode(c);} });
  $('btn-close-scan').addEventListener('click', hideScanResult);
  $('btn-close-unknown').addEventListener('click', hideScanResult);
}

async function startScanCam() {
  try {
    $('scanner-status').textContent = 'Iniciando...';
    scanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}}});
    const video = $('scanner-video');
    video.srcObject = scanStream; await video.play();
    $('btn-cam-start').classList.add('hidden'); $('btn-cam-stop').classList.remove('hidden');
    $('scanner-status').textContent = 'Apuntá al código';
    if (scanDetector) {
      scanInterval = setInterval(async () => {
        try {
          const codes = await scanDetector.detect(video);
          if (codes.length>0) {
            const code = codes[0].rawValue;
            if (code!==lastScanCode) {
              lastScanCode=code; flashVp('scanner-vp'); beep();
              await handleScanCode(code);
              setTimeout(()=>{lastScanCode=null;},3000);
            }
          }
        } catch(_){}
      }, 350);
    }
  } catch(e) { $('scanner-status').textContent='Sin acceso a la cámara'; }
}

function stopScanCam() {
  if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null;}
  if(scanInterval){clearInterval(scanInterval);scanInterval=null;}
  const v=$('scanner-video'); if(v) v.srcObject=null;
  $('btn-cam-start').classList.remove('hidden'); $('btn-cam-stop').classList.add('hidden');
  const st=$('scanner-status'); if(st) st.textContent='Presioná iniciar';
  lastScanCode=null;
}

function hideScanResult() {
  $('scan-result-area').classList.add('hidden');
  $('result-existing').classList.add('hidden');
  $('result-unknown').classList.add('hidden');
  $('inp-barcode').value=''; lastScanCode=null;
}

async function handleScanCode(barcode) {
  $('inp-barcode').value = barcode;
  const result = await DB.getProductWithLots(barcode);
  $('scan-result-area').classList.remove('hidden');
  $('result-existing').classList.add('hidden');
  $('result-unknown').classList.add('hidden');
  if (result) renderScanExisting(result.product, result.lots);
  else { $('unknown-code').textContent = barcode; $('result-unknown').classList.remove('hidden'); }
}

function renderScanExisting(product, lots) {
  $('result-existing').classList.remove('hidden');
  $('ri-icon').textContent = initials(product.name);
  $('ri-name').textContent = product.name;
  $('ri-variant').textContent = product.variant||'';
  $('ri-variant').style.display = product.variant ? 'block':'none';
  $('ri-code').textContent = product.barcode;
  $('ri-cat').textContent = product.category;
  const imgWrap=$('ri-img-wrap'), imgEl=$('ri-img');
  if (product.image) { imgEl.src=product.image; imgWrap.classList.remove('hidden'); }
  else { imgWrap.classList.add('hidden'); }
  const total = totalStock(lots);
  const pkg   = pkgBreakdown(total, product.pkgType, product.pkgQty||1);
  $('ri-stock-num').textContent = total;
  $('ri-stock-pkg').textContent = pkg ? `${pkg.full} ${pkg.pkgType}${pkg.full!==1?'s':''}${pkg.rem>0?` + ${pkg.rem} sueltas`:''}` : '';
  const sorted = [...lots].sort((a,b)=>{if(!a.expiry)return 1;if(!b.expiry)return -1;return a.expiry.localeCompare(b.expiry);});
  $('ri-lots').innerHTML = sorted.length===0
    ? '<div class="empty-state" style="padding:1.25rem"><p>Sin lotes</p></div>'
    : sorted.map(l => {
        const days = daysLeft(l.expiry);
        return `<div class="lot-item">
          <div class="lot-item-left">
            <div class="lot-item-date">Vto: ${l.expiry?fmtDate(l.expiry):'—'} ${expiryBadge(days)}</div>
            <div class="lot-item-sub">Ingresó ${fmtDate(l.enteredAt)}</div>
          </div>
          <div class="lot-item-right"><div class="lot-item-qty">${l.qty}</div><div class="lot-item-unit">uds.</div></div>
        </div>`;
      }).join('');
}

// ── DEPÓSITO — listado ────────────────────────────────────────────

let depStream=null, depInterval=null, lastDepCode=null, depDetector=null;
let currentSheetProduct=null, currentSheetLots=[];
let currentDepFilter='all', currentExpFilter='any';

function initDepositSection() {
  $('btn-dep-scan-toggle').addEventListener('click', () => {
    const wrap=$('dep-scanner-wrap');
    const visible=!wrap.classList.contains('hidden');
    if(visible){wrap.classList.add('hidden');stopDepCam();}else{wrap.classList.remove('hidden');}
  });
  if('BarcodeDetector' in window){depDetector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','code_93','upc_a','upc_e','qr_code','itf','codabar']});}
  else{$('dep-scanner-status').textContent='Usá el campo manual';$('btn-dep-cam-start').disabled=true;}
  $('btn-dep-cam-start').addEventListener('click', startDepCam);
  $('btn-dep-cam-stop').addEventListener('click', stopDepCam);
  $('btn-dep-manual').addEventListener('click', () => { const c=$('dep-inp-barcode').value.trim(); if(c) handleDepScan(c); });
  $('dep-inp-barcode').addEventListener('keydown', e => { if(e.key==='Enter'){const c=$('dep-inp-barcode').value.trim();if(c)handleDepScan(c);} });
  $('dep-search').addEventListener('input', loadDeposit);
  $('dep-cat-filter').addEventListener('change', loadDeposit);
  $('dep-chips-stock').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('dep-chips-stock').querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active'); currentDepFilter=chip.dataset.filter; loadDeposit();
    });
  });
  $('dep-chips-exp').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('dep-chips-exp').querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active'); currentExpFilter=chip.dataset.exp; loadDeposit();
    });
  });
  $('btn-sheet-close').addEventListener('click', closeSheet);
  $('sheet-backdrop').addEventListener('click', e => { if(e.target===$('sheet-backdrop')) closeSheet(); });
  $('sh-tab-in').addEventListener('click', () => switchSheetTab('in'));
  $('sh-tab-out').addEventListener('click', () => switchSheetTab('out'));
  $('sh-tab-edit').addEventListener('click', () => { switchSheetTab('edit'); loadSheetEditForm(); });
  $('btn-sh-edit-photo').addEventListener('click', () => $('sh-edit-inp-photo').click());
  $('sh-edit-inp-photo').addEventListener('change', async e => {
    const file=e.target.files[0]; if(!file) return;
    const b64=await compressImage(file);
    $('sh-edit-img-preview').src=b64; $('sh-edit-img-preview').classList.remove('hidden');
    $('sh-edit-img-placeholder').classList.add('hidden'); $('btn-sh-edit-clear-photo').disabled=false;
  });
  $('btn-sh-edit-clear-photo').addEventListener('click', () => {
    $('sh-edit-img-preview').src=''; $('sh-edit-img-preview').classList.add('hidden');
    $('sh-edit-img-placeholder').classList.remove('hidden'); $('btn-sh-edit-clear-photo').disabled=true;
  });
  $('btn-sh-edit-save').addEventListener('click', saveSheetEdit);
  ['sh-in-qty','sh-in-qty-type'].forEach(id => { $(id).addEventListener('input', updateSheetInCalc); $(id).addEventListener('change', updateSheetInCalc); });
  ['sh-out-qty','sh-out-pkg-type'].forEach(id => { $(id).addEventListener('input', updateSheetPreview); $(id).addEventListener('change', updateSheetPreview); });
  $('btn-sh-in-confirm').addEventListener('click', confirmSheetIngress);
  $('btn-sh-out-confirm').addEventListener('click', confirmSheetWithdrawal);
}

async function startDepCam() {
  try {
    $('dep-scanner-status').textContent='Iniciando...';
    depStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}}});
    const video=$('dep-scanner-video'); video.srcObject=depStream; await video.play();
    $('btn-dep-cam-start').classList.add('hidden'); $('btn-dep-cam-stop').classList.remove('hidden');
    $('dep-scanner-status').textContent='Apuntá al código';
    if(depDetector){depInterval=setInterval(async()=>{try{const codes=await depDetector.detect(video);if(codes.length>0){const code=codes[0].rawValue;if(code!==lastDepCode){lastDepCode=code;flashVp('dep-scanner-vp');beep();await handleDepScan(code);setTimeout(()=>{lastDepCode=null;},3000);}}}catch(_){}},350);}
  }catch(e){$('dep-scanner-status').textContent='Sin acceso a la cámara';}
}

function stopDepCam() {
  if(depStream){depStream.getTracks().forEach(t=>t.stop());depStream=null;}
  if(depInterval){clearInterval(depInterval);depInterval=null;}
  const v=$('dep-scanner-video');if(v)v.srcObject=null;
  $('btn-dep-cam-start').classList.remove('hidden');$('btn-dep-cam-stop').classList.add('hidden');
  const st=$('dep-scanner-status');if(st)st.textContent='Presioná iniciar';
  lastDepCode=null;
}

async function handleDepScan(barcode) {
  $('dep-inp-barcode').value='';
  const result=await DB.getProductWithLots(barcode);
  if(!result){toast('Producto no registrado. Usá Registrar.','warn');return;}
  openSheet(result.product, result.lots);
}

async function loadDeposit() {
  const inventory=await DB.getAllInventory();
  const search=$('dep-search').value.toLowerCase();
  const cat=$('dep-cat-filter').value;
  const today=new Date(); today.setHours(0,0,0,0);
  const lotDays=l=>l.expiry?Math.floor((new Date(l.expiry+'T00:00:00')-today)/86400000):null;
  const LOW=5;
  let filtered=inventory.filter(p=>(!search||p.name.toLowerCase().includes(search)||(p.variant||'').toLowerCase().includes(search)||p.barcode.includes(search))&&(!cat||p.category===cat));
  if(currentDepFilter==='zero') filtered=filtered.filter(p=>totalStock(p.lots)===0);
  else if(currentDepFilter==='low') filtered=filtered.filter(p=>{const t=totalStock(p.lots);return t>0&&t<=LOW;});
  else if(currentDepFilter==='ok') filtered=filtered.filter(p=>totalStock(p.lots)>LOW);
  if(currentExpFilter!=='any'){
    if(currentExpFilter==='nofecha') filtered=filtered.filter(p=>p.lots.some(l=>!l.expiry));
    else if(currentExpFilter==='0') filtered=filtered.filter(p=>p.lots.some(l=>{const d=lotDays(l);return d!==null&&d<0;}));
    else{const max=Number(currentExpFilter);filtered=filtered.filter(p=>p.lots.some(l=>{const d=lotDays(l);return d!==null&&d>=0&&d<=max;}));}
  }
  const totalUnits=inventory.reduce((s,p)=>s+totalStock(p.lots),0);
  const zeroStock=inventory.filter(p=>totalStock(p.lots)===0).length;
  let exp7=0,expPast=0;
  inventory.forEach(p=>p.lots.forEach(l=>{const d=daysLeft(l.expiry);if(d===null)return;if(d<0)expPast++;else if(d<=7)exp7++;}));
  $('dep-metrics').innerHTML=`<div class="metric"><div class="metric-label">Productos</div><div class="metric-value">${inventory.length}</div></div><div class="metric"><div class="metric-label">Unidades</div><div class="metric-value">${totalUnits}</div></div><div class="metric"><div class="metric-label">Sin stock</div><div class="metric-value ${zeroStock>0?'amber':''}">${zeroStock}</div></div><div class="metric"><div class="metric-label">Vencen 7d</div><div class="metric-value ${exp7>0?'red':''}">${exp7} lotes</div></div>`;
  const list=$('dep-product-list'),empty=$('dep-empty');
  if(filtered.length===0){list.innerHTML='';empty.classList.remove('hidden');$('dep-empty-msg').innerHTML='No hay productos que coincidan.';return;}
  empty.classList.add('hidden');
  const sorted=filtered.slice().sort((a,b)=>{
    if(currentExpFilter!=='any'){const aMin=Math.min(...a.lots.map(l=>{const d=lotDays(l);return d!==null?d:9999;}),9999);const bMin=Math.min(...b.lots.map(l=>{const d=lotDays(l);return d!==null?d:9999;}),9999);if(aMin!==bMin)return aMin-bMin;}
    if(currentDepFilter==='zero'||currentDepFilter==='low')return totalStock(a.lots)-totalStock(b.lots);
    return a.name.localeCompare(b.name);
  });
  list.innerHTML=sorted.map(p=>{
    const total=totalStock(p.lots);
    const pkg=pkgBreakdown(total,p.pkgType,p.pkgQty||1);
    const lotsWithExp=p.lots.filter(l=>l.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry));
    const nextExp=lotsWithExp[0]||null;
    const days=nextExp?daysLeft(nextExp.expiry):null;
    let badge='';
    if(total===0)badge='<span class="badge badge-warn" style="font-size:10px">Sin stock</span>';
    else if(total<=LOW)badge=`<span class="badge badge-warn" style="font-size:10px">Stock bajo</span>`;
    else if(days!==null){if(days<0)badge=`<span class="badge badge-danger" style="font-size:10px">Vencido hace ${Math.abs(days)}d</span>`;else if(days===0)badge=`<span class="badge badge-danger" style="font-size:10px">Vence HOY</span>`;else if(days<=3)badge=`<span class="badge badge-danger" style="font-size:10px">Vence en ${days}d</span>`;else if(days<=7)badge=`<span class="badge badge-danger" style="font-size:10px">${days}d</span>`;else if(days<=30)badge=`<span class="badge badge-warn" style="font-size:10px">${days}d</span>`;}
    const iconHtml=p.image?`<img src="${esc(p.image)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`:esc(initials(p.name));
    const pkgLine=pkg&&pkg.full>0?`${pkg.full} ${pkg.pkgType}${pkg.full!==1?'s':''}${pkg.rem>0?` + ${pkg.rem} sueltas`:''}`:null;
    const expLine=nextExp?(days!==null&&days<0?`vto: ${fmtDate(nextExp.expiry)} (vencido)`:`próx. vto: ${fmtDate(nextExp.expiry)}`):null;
    return `<div class="product-row" data-pid="${p.id}"><div class="p-icon">${iconHtml}</div><div class="p-info"><div class="p-name">${esc(p.name)}${p.variant?` <span style="font-size:12px;color:var(--text2)">— ${esc(p.variant)}</span>`:''}</div><div class="p-meta">${esc(p.category)} · ${p.lots.length} lote${p.lots.length!==1?'s':''} ${badge?'· '+badge:''}</div>${expLine?`<div style="font-size:12px;color:var(--text2);margin-top:2px">${expLine}</div>`:''}${pkgLine?`<div style="font-size:12px;color:var(--text2)">${pkgLine}</div>`:''}</div><div class="p-right"><div class="p-qty" style="${total===0||total<=LOW?'color:var(--amber)':''}">${total}</div><div class="p-unit">uds.</div></div></div>`;
  }).join('');
  list.querySelectorAll('.product-row').forEach(row=>{row.addEventListener('click',async()=>{const pid=Number(row.dataset.pid);const p=sorted.find(x=>x.id===pid);if(p)openSheet(p,p.lots);});});
}

// ── Bottom Sheet ──────────────────────────────────────────────────

function openSheet(product, lots) {
  currentSheetProduct=product; currentSheetLots=lots;
  const shImg=$('sh-img'),shIcon=$('sh-icon');
  if(product.image){shImg.src=product.image;shImg.classList.remove('hidden');shIcon.classList.add('hidden');}
  else{shImg.classList.add('hidden');shIcon.classList.remove('hidden');shIcon.textContent=initials(product.name);}
  $('sh-name').textContent=product.name;
  $('sh-variant').textContent=product.variant||'';$('sh-variant').style.display=product.variant?'block':'none';
  $('sh-code').textContent=product.barcode;$('sh-cat').textContent=product.category;
  refreshSheetStock();
  if(product.pkgType)$('sh-out-pkg-type').value=product.pkgType;
  $('sh-in-qty').value=1;$('sh-in-qty-type').value='pkg';$('sh-in-exp').value='';$('sh-in-price').value='';$('sh-in-notes').value='';
  $('sh-out-qty').value=1;$('sh-out-reason').value='';
  switchSheetTab('in'); updateSheetInCalc(); updateSheetPreview();
  renderSheetLots(); loadSheetHistory(product.id);
  $('sheet-backdrop').classList.remove('hidden'); document.body.style.overflow='hidden';
}

function closeSheet() {
  $('sheet-backdrop').classList.add('hidden'); document.body.style.overflow='';
  currentSheetProduct=null; currentSheetLots=[];
}

function refreshSheetStock() {
  const total=totalStock(currentSheetLots);
  const pkg=pkgBreakdown(total,currentSheetProduct.pkgType,currentSheetProduct.pkgQty||1);
  $('sh-stock-num').textContent=total;
  $('sh-stock-pkg').textContent=pkg?`${pkg.full} ${pkg.pkgType}${pkg.full!==1?'s':''}${pkg.rem>0?` + ${pkg.rem} sueltas`:''}` :'';
  $('sh-lots-count').textContent=`${currentSheetLots.length} lote${currentSheetLots.length!==1?'s':''}`;
}

function switchSheetTab(tab) {
  ['in','out','edit'].forEach(t=>{$('sh-tab-'+t).classList.toggle('active',tab===t);$('sh-form-'+t).classList.toggle('hidden',tab!==t);});
  $('sh-tab-out').classList.toggle('out',tab==='out');
}

function updateSheetInCalc() {
  if(!currentSheetProduct)return;
  renderCalcPreview('sh-in-calc',$('sh-in-qty').value,$('sh-in-qty-type').value,currentSheetProduct);
}

function updateSheetPreview() {
  if(!currentSheetProduct)return;
  const qty=parseInt($('sh-out-qty').value)||0,type=$('sh-out-pkg-type').value,pkgQty=currentSheetProduct.pkgQty||1,total=totalStock(currentSheetLots);
  let unitsOut=(type!=='unidad'&&pkgQty>1)?qty*pkgQty:qty;
  const rem=total-unitsOut;
  const prev=$('sh-calc-preview');
  if(unitsOut<=0){prev.innerHTML='Ingresá una cantidad';return;}
  const pkgLabel=type!=='unidad'&&pkgQty>1?` (${qty} ${type} × ${pkgQty} = ${unitsOut} uds.)` :'';
  prev.innerHTML=rem<0?`<span style="color:var(--red)">⚠️ Stock insuficiente — faltan ${Math.abs(rem)} unidades</span>`:`Retirás <strong>${unitsOut} unidades</strong>${pkgLabel} · quedan <strong>${rem}</strong>`;
}

async function confirmSheetIngress() {
  if(!currentSheetProduct)return;
  const units=calcUnitsFromForm('sh-in-qty','sh-in-qty-type',currentSheetProduct);
  if(units<1){toast('Ingresá una cantidad válida','error');return;}
  const rawQty=parseInt($('sh-in-qty').value)||0,type=$('sh-in-qty-type').value,pkgQty=currentSheetProduct.pkgQty||1,pkgType=currentSheetProduct.pkgType||'unidad';
  const desc=type==='pkg'&&pkgQty>1&&pkgType!=='unidad'?`${rawQty} ${pkgType}${rawQty!==1?'s':''}=${units}uds.`:`${units}uds.`;
  $('btn-sh-in-confirm').disabled=true;
  await DB.addLot({productId:currentSheetProduct.id,barcode:currentSheetProduct.barcode,qty:units,expiry:$('sh-in-exp').value||null,price:parseFloat($('sh-in-price').value)||null,notes:$('sh-in-notes').value.trim()});
  $('btn-sh-in-confirm').disabled=false; beep(); toast(`Ingreso: ${desc} de ${currentSheetProduct.name}`,'success');
  const updated=await DB.getProductWithLots(currentSheetProduct.barcode);
  if(updated){currentSheetProduct=updated.product;currentSheetLots=updated.lots;}
  $('sh-in-qty').value=1;$('sh-in-exp').value='';$('sh-in-price').value='';$('sh-in-notes').value='';
  updateSheetInCalc(); refreshSheetStock(); renderSheetLots(); loadDeposit();
}

async function confirmSheetWithdrawal() {
  if(!currentSheetProduct)return;
  const qty=parseInt($('sh-out-qty').value)||0,type=$('sh-out-pkg-type').value,pkgQty=currentSheetProduct.pkgQty||1,reason=$('sh-out-reason').value.trim();
  let unitsOut=(type!=='unidad'&&pkgQty>1)?qty*pkgQty:qty;
  if(qty<=0){toast('Ingresá una cantidad válida','error');return;}
  const total=totalStock(currentSheetLots);
  if(unitsOut>total){toast(`Stock insuficiente (${total} disponibles)`,'error');return;}
  const sorted=[...currentSheetLots].filter(l=>(l.qty||0)>0).sort((a,b)=>!a.expiry?1:!b.expiry?-1:a.expiry.localeCompare(b.expiry));
  let toDeduct=unitsOut;
  for(const lot of sorted){if(toDeduct<=0)break;const deduct=Math.min(lot.qty,toDeduct);lot.qty-=deduct;toDeduct-=deduct;if(lot.qty<=0)await DB.deleteLot(lot.id);else await DB.updateLot(lot.id,{qty:lot.qty});}
  await DB.addWithdrawal({productId:currentSheetProduct.id,barcode:currentSheetProduct.barcode,qty:unitsOut,pkgQty:qty,pkgType:type,reason});
  beep(); toast(`Retiro: ${unitsOut}uds. de ${currentSheetProduct.name}`,'success');
  const updated=await DB.getProductWithLots(currentSheetProduct.barcode);
  if(updated){currentSheetProduct=updated.product;currentSheetLots=updated.lots;}
  $('sh-out-qty').value=1;$('sh-out-reason').value='';
  refreshSheetStock(); updateSheetPreview(); renderSheetLots(); loadSheetHistory(currentSheetProduct.id); loadDeposit();
}

function renderSheetLots() {
  const sorted=[...currentSheetLots].sort((a,b)=>!a.expiry?1:!b.expiry?-1:a.expiry.localeCompare(b.expiry));
  $('sh-lots-list').innerHTML=sorted.length===0?'<div class="empty-state" style="padding:1rem"><p>Sin lotes en stock</p></div>':sorted.map(l=>{const days=daysLeft(l.expiry);return`<div class="lot-item"><div class="lot-item-left"><div class="lot-item-date">Vto: ${l.expiry?fmtDate(l.expiry):'—'} ${expiryBadge(days)}</div><div class="lot-item-sub">Ingresó ${fmtDate(l.enteredAt)}${l.price?` · $${l.price}`:''}</div></div><div class="lot-item-right"><div class="lot-item-qty">${l.qty}</div><div class="lot-item-unit">uds.</div></div></div>`;}).join('');
}

async function loadSheetHistory(productId) {
  const withdrawals=await DB.getWithdrawalsByProduct(productId);
  const sorted=[...withdrawals].sort((a,b)=>b.withdrawnAt.localeCompare(a.withdrawnAt));
  $('sh-history-list').innerHTML=sorted.length===0?'<div class="empty-state" style="padding:1rem"><p>Sin retiros anteriores</p></div>':sorted.slice(0,20).map(w=>{const pkgDetail=w.pkgType!=='unidad'&&w.pkgQty>1?` (${w.pkgQty} ${w.pkgType})`:'';return`<div class="withdraw-row"><div class="withdraw-info"><div class="withdraw-date">${fmtDateTime(w.withdrawnAt)}</div><div class="withdraw-reason">${esc(w.reason||'Sin motivo')}</div></div><div class="withdraw-qty">−${w.qty}u.${pkgDetail}</div></div>`;}).join('');
}

function loadSheetEditForm() {
  if(!currentSheetProduct)return;
  const p=currentSheetProduct;
  const preview=$('sh-edit-img-preview'),placeholder=$('sh-edit-img-placeholder'),clearBtn=$('btn-sh-edit-clear-photo');
  if(p.image){preview.src=p.image;preview.classList.remove('hidden');placeholder.classList.add('hidden');clearBtn.disabled=false;}
  else{preview.src='';preview.classList.add('hidden');placeholder.classList.remove('hidden');clearBtn.disabled=true;}
  $('sh-edit-name').value=p.name||''; $('sh-edit-variant').value=p.variant||''; $('sh-edit-pkg-qty').value=p.pkgQty||1;
  const catSel=$('sh-edit-cat'); for(let i=0;i<catSel.options.length;i++){if(catSel.options[i].value===p.category||catSel.options[i].text===p.category){catSel.selectedIndex=i;break;}}
  const pkgSel=$('sh-edit-pkg-type'); for(let i=0;i<pkgSel.options.length;i++){if(pkgSel.options[i].value===p.pkgType){pkgSel.selectedIndex=i;break;}}
}

async function saveSheetEdit() {
  if(!currentSheetProduct)return;
  const name=$('sh-edit-name').value.trim();
  if(!name){toast('El nombre es obligatorio','error');return;}
  const preview=$('sh-edit-img-preview');
  let newImage;
  if(preview.classList.contains('hidden')||!preview.src||preview.src===window.location.href)newImage=null;
  else newImage=preview.src;
  $('btn-sh-edit-save').disabled=true;
  await DB.updateProduct(currentSheetProduct.id,{name,variant:$('sh-edit-variant').value.trim(),category:$('sh-edit-cat').value,pkgType:$('sh-edit-pkg-type').value,pkgQty:parseInt($('sh-edit-pkg-qty').value)||1,image:newImage});
  $('btn-sh-edit-save').disabled=false;
  const updated=await DB.getProductWithLots(currentSheetProduct.barcode);
  if(updated){currentSheetProduct=updated.product;currentSheetLots=updated.lots;
    const shImg=$('sh-img'),shIcon=$('sh-icon');
    if(newImage){shImg.src=newImage;shImg.classList.remove('hidden');shIcon.classList.add('hidden');}else{shImg.classList.add('hidden');shIcon.classList.remove('hidden');shIcon.textContent=initials(name);}
    $('sh-name').textContent=name;$('sh-variant').textContent=$('sh-edit-variant').value.trim();$('sh-variant').style.display=$('sh-edit-variant').value.trim()?'block':'none';$('sh-cat').textContent=$('sh-edit-cat').value;}
  beep(); toast('Producto actualizado','success'); switchSheetTab('in'); loadDeposit();
}

// ── REGISTRAR ─────────────────────────────────────────────────────

let regImage=null, regScanStream=null, regScanInterval=null, regDetector=null;

function initRegisterSection() {
  $('reg-barcode').addEventListener('input', checkBarcodeExists);
  $('reg-barcode').addEventListener('keydown', e=>{ if(e.key==='Enter') checkBarcodeExists(); });
  $('btn-reg-scan-code').addEventListener('click', toggleRegScanner);
  $('btn-reg-cam-stop').addEventListener('click', stopRegCam);
  ['reg-qty','reg-qty-type','reg-pkg-type','reg-pkg-qty'].forEach(id=>{const el=$(id);if(!el)return;el.addEventListener('input',updateRegCalc);el.addEventListener('change',updateRegCalc);});
  $('btn-reg-photo').addEventListener('click', ()=>$('reg-inp-photo').click());
  $('reg-inp-photo').addEventListener('change', async e=>{const file=e.target.files[0];if(!file)return;const b64=await compressImage(file);setRegPhoto(b64);});
  $('btn-reg-clear-photo').addEventListener('click', clearRegPhoto);
  $('btn-reg-save').addEventListener('click', saveNewProduct);
  if('BarcodeDetector' in window)regDetector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','code_93','upc_a','upc_e','qr_code','itf','codabar']});
}

async function checkBarcodeExists() {
  const barcode=$('reg-barcode').value.trim();
  const existsEl=$('reg-barcode-exists');
  if(!barcode){existsEl.classList.add('hidden');return;}
  const p=await DB.getByBarcode(barcode);
  existsEl.classList.toggle('hidden',!p);
}

async function toggleRegScanner() {
  const wrap=$('reg-scanner-wrap');
  if(!wrap.classList.contains('hidden')){stopRegCam();return;}
  if(!regDetector){toast('Cámara no disponible','warn');return;}
  wrap.classList.remove('hidden');
  try{$('reg-scanner-status').textContent='Iniciando...';regScanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}}});const video=$('reg-scanner-video');video.srcObject=regScanStream;await video.play();$('reg-scanner-status').textContent='Apuntá al código';regScanInterval=setInterval(async()=>{try{const codes=await regDetector.detect(video);if(codes.length>0){const code=codes[0].rawValue;flashVp('reg-scanner-vp');beep();$('reg-barcode').value=code;stopRegCam();checkBarcodeExists();}}catch(_){}},350);}catch(e){$('reg-scanner-status').textContent='Sin acceso a la cámara';}
}

function stopRegCam() {
  if(regScanStream){regScanStream.getTracks().forEach(t=>t.stop());regScanStream=null;}
  if(regScanInterval){clearInterval(regScanInterval);regScanInterval=null;}
  const v=$('reg-scanner-video');if(v)v.srcObject=null;
  $('reg-scanner-wrap').classList.add('hidden');
}

function updateRegCalc() {
  renderCalcPreview('reg-qty-calc',$('reg-qty').value,$('reg-qty-type').value,{pkgType:$('reg-pkg-type').value,pkgQty:parseInt($('reg-pkg-qty').value)||1});
}

function getRegUnits() {
  const qty=parseInt($('reg-qty').value)||0,type=$('reg-qty-type').value,pkgQty=parseInt($('reg-pkg-qty').value)||1,pkgType=$('reg-pkg-type').value;
  if(type==='unit'||pkgQty<=1||pkgType==='unidad')return qty;
  return qty*pkgQty;
}

function setRegPhoto(b64){regImage=b64;$('reg-img-preview').src=b64;$('reg-img-preview').classList.remove('hidden');$('reg-img-placeholder').classList.add('hidden');$('btn-reg-clear-photo').disabled=false;}
function clearRegPhoto(){regImage=null;$('reg-img-preview').classList.add('hidden');$('reg-img-placeholder').classList.remove('hidden');$('btn-reg-clear-photo').disabled=true;}

function resetRegForm() {
  $('reg-barcode').value='';$('reg-name').value='';$('reg-variant').value='';
  $('reg-cat').selectedIndex=0;$('reg-pkg-type').selectedIndex=0;$('reg-pkg-qty').value=1;
  $('reg-qty').value=1;$('reg-exp').value='';$('reg-price').value='';
  $('reg-barcode-exists').classList.add('hidden'); clearRegPhoto();
}

async function saveNewProduct() {
  const barcode=$('reg-barcode').value.trim(),name=$('reg-name').value.trim();
  if(!barcode){toast('El código de barras es obligatorio','error');return;}
  if(!name){toast('El nombre es obligatorio','error');return;}
  const exists=await DB.getByBarcode(barcode);
  if(exists){toast('Este código ya está registrado. Usá Depósito para agregar stock.','error');return;}
  const units=getRegUnits(),pkgQty=parseInt($('reg-pkg-qty').value)||1;
  if(units<1){toast('Ingresá una cantidad válida','error');return;}
  $('btn-reg-save').disabled=true;
  const productId=await DB.addProduct({barcode,name,variant:$('reg-variant').value.trim(),category:$('reg-cat').value,pkgType:$('reg-pkg-type').value,pkgQty,image:regImage||null});
  await DB.addLot({productId,barcode,qty:units,expiry:$('reg-exp').value||null,price:parseFloat($('reg-price').value)||null,notes:''});
  $('btn-reg-save').disabled=false; beep();
  const type=$('reg-qty-type').value,pkgType=$('reg-pkg-type').value,rawQty=parseInt($('reg-qty').value)||0;
  const desc=type==='pkg'&&pkgQty>1&&pkgType!=='unidad'?`${rawQty} ${pkgType}${rawQty!==1?'s':''}=${units}uds.`:`${units}uds.`;
  toast(`✓ ${name} — ${desc}`,'success'); resetRegForm(); loadDeposit();
}

// ── FECHAS ────────────────────────────────────────────────────────

let currentExpDays=0;

function initExpChips() {
  $('exp-chips').querySelectorAll('.chip').forEach(chip=>{
    chip.addEventListener('click',()=>{
      $('exp-chips').querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active'); currentExpDays=Number(chip.dataset.days); loadExpiry();
    });
  });
}

async function loadExpiry() {
  const lots=await DB.getExpiryReport(currentExpDays);
  const expired=lots.filter(l=>l.daysLeft!==null&&l.daysLeft<0).length;
  const cr7=lots.filter(l=>l.daysLeft!==null&&l.daysLeft>=0&&l.daysLeft<=7).length;
  const total=lots.reduce((s,l)=>s+(l.qty||0),0);
  $('exp-metrics').innerHTML=`<div class="metric"><div class="metric-label">Lotes</div><div class="metric-value">${lots.length}</div></div><div class="metric"><div class="metric-label">Unidades</div><div class="metric-value">${total}</div></div><div class="metric"><div class="metric-label">Vencidos</div><div class="metric-value ${expired>0?'red':''}">${expired}</div></div><div class="metric"><div class="metric-label">Críticos 7d</div><div class="metric-value ${cr7>0?'amber':''}">${cr7}</div></div>`;
  const list=$('exp-list'),empty=$('exp-empty');
  if(lots.length===0){list.innerHTML='';empty.classList.remove('hidden');return;}
  empty.classList.add('hidden');
  list.innerHTML=lots.map(l=>{const days=l.daysLeft,prod=l.product||{};const label=prod.name+(prod.variant?` — ${prod.variant}`:'');let urgClass='exp-ok',daysStr='';if(days===null){daysStr='—';}else if(days<0){urgClass='exp-urgent';daysStr=`${Math.abs(days)}d`;}else if(days===0){urgClass='exp-urgent';daysStr='HOY';}else if(days<=7){urgClass='exp-urgent';daysStr=`${days}d`;}else if(days<=30){urgClass='exp-warn';daysStr=`${days}d`;}else{daysStr=`${days}d`;}return`<div class="exp-item ${urgClass}"><div class="exp-item-info"><div class="exp-item-name">${esc(label)}</div><div class="exp-item-variant">${esc(prod.category||'')} · Vto: <strong>${l.expiry?fmtDate(l.expiry):'—'}</strong> · Ingresó: ${fmtDate(l.enteredAt)}</div></div><div class="exp-item-right"><div class="exp-item-days">${daysStr}</div><div class="exp-item-qty">${l.qty} uds.</div></div></div>`;}).join('');
}

// ── GÓNDOLA — Reposición ──────────────────────────────────────────

let gondolaList=[], gondolaSheetProduct=null, gondolaScanStream=null, gondolaScanInterval=null, gondolaDetector=null, gondolaCatFilter='';

function initGondolaSection() {
  $('gondola-search').addEventListener('input', ()=>runGondolaSearch());
  $('gondola-cat-chips').querySelectorAll('.chip').forEach(c=>{c.addEventListener('click',()=>{$('gondola-cat-chips').querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));c.classList.add('active');gondolaCatFilter=c.dataset.cat;runGondolaSearch();});});
  if('BarcodeDetector' in window)gondolaDetector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','code_93','upc_a','upc_e','qr_code','itf','codabar']});
  $('btn-gondola-scan').addEventListener('click', toggleGondolaScanner);
  $('btn-gondola-cam-stop').addEventListener('click', stopGondolaCam);
  $('btn-gsh-close').addEventListener('click', closeGondolaSheet);
  $('gondola-sheet-backdrop').addEventListener('click', e=>{if(e.target===$('gondola-sheet-backdrop'))closeGondolaSheet();});
  ['gsh-qty','gsh-qty-type'].forEach(id=>{$(id).addEventListener('input',updateGshCalc);$(id).addEventListener('change',updateGshCalc);});
  $('btn-gsh-add').addEventListener('click', addToGondolaList);
  $('btn-gondola-share').addEventListener('click', shareGondolaList);
  $('btn-gondola-clear').addEventListener('click', ()=>{if(confirm('¿Vaciar la lista de reposición?')){gondolaList=[];renderGondolaList();runGondolaSearch();}});
}

async function toggleGondolaScanner() {
  const wrap=$('gondola-scanner-wrap');
  if(!wrap.classList.contains('hidden')){stopGondolaCam();return;}
  if(!gondolaDetector){toast('Cámara no disponible','warn');return;}
  wrap.classList.remove('hidden');
  try{$('gondola-scanner-status').textContent='Iniciando...';gondolaScanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}}});const video=$('gondola-scanner-video');video.srcObject=gondolaScanStream;await video.play();$('gondola-scanner-status').textContent='Apuntá al código';gondolaScanInterval=setInterval(async()=>{try{const codes=await gondolaDetector.detect(video);if(codes.length>0){const code=codes[0].rawValue;flashVp('gondola-scanner-vp');beep();stopGondolaCam();$('gondola-search').value='';await handleGondolaScan(code);}}catch(_){}},350);}catch(e){$('gondola-scanner-status').textContent='Sin acceso a la cámara';}
}

function stopGondolaCam() {
  if(gondolaScanStream){gondolaScanStream.getTracks().forEach(t=>t.stop());gondolaScanStream=null;}
  if(gondolaScanInterval){clearInterval(gondolaScanInterval);gondolaScanInterval=null;}
  const v=$('gondola-scanner-video');if(v)v.srcObject=null;
  $('gondola-scanner-wrap').classList.add('hidden');
}

async function handleGondolaScan(barcode) {
  const result=await DB.getProductWithLots(barcode);
  if(!result){toast('Producto no registrado en el sistema','warn');return;}
  openGondolaSheet(result.product, result.lots);
}

async function runGondolaSearch() {
  const query=$('gondola-search').value.trim().toLowerCase(),cat=gondolaCatFilter;
  if(!query&&!cat){$('gondola-results').classList.add('hidden');$('gondola-welcome').classList.remove('hidden');return;}
  $('gondola-welcome').classList.add('hidden');
  const inventory=await DB.getAllInventory();
  const filtered=inventory.filter(p=>{const matchName=!query||p.name.toLowerCase().includes(query)||(p.variant||'').toLowerCase().includes(query)||p.barcode.includes(query);const matchCat=!cat||p.category===cat;return matchName&&matchCat;});
  const sorted=filtered.sort((a,b)=>{const as=totalStock(a.lots),bs=totalStock(b.lots);if(as>0&&bs===0)return -1;if(as===0&&bs>0)return 1;return a.name.localeCompare(b.name);});
  const listEl=$('gondola-results-list');
  $('gondola-results-count').textContent=`${sorted.length} producto${sorted.length!==1?'s':''}`;
  $('gondola-results-title').textContent=query?`"${query}"`:cat||'Resultados';
  if(sorted.length===0){listEl.innerHTML='<div class="empty-state" style="padding:1.5rem"><p>Sin resultados en el depósito</p></div>';$('gondola-results').classList.remove('hidden');return;}
  listEl.innerHTML=sorted.map(p=>{
    const total=totalStock(p.lots),pkg=pkgBreakdown(total,p.pkgType,p.pkgQty||1);
    const inList=gondolaList.some(i=>i.barcode===p.barcode);
    const lotsWithExp=p.lots.filter(l=>l.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry));
    const nextExp=lotsWithExp[0]||null,days=nextExp?daysLeft(nextExp.expiry):null;
    const iconHtml=p.image?`<img src="${esc(p.image)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`:esc(initials(p.name));
    const pkgLine=pkg&&pkg.full>0?`${pkg.full} ${p.pkgType}${pkg.full!==1?'s':''}${pkg.rem>0?` + ${pkg.rem} sueltas`:''}`:null;
    const expLine=nextExp?`próx. vto: ${fmtDate(nextExp.expiry)}${days!==null&&days<0?' (VENCIDO)':days!==null&&days<=7?` (${days}d)`:''}`:null;
    const stockColor=total===0?'color:var(--amber)':days!==null&&days<0?'color:var(--red)':'';
    return `<div class="gondola-product-card"><div class="gondola-product-head"><div class="gondola-product-icon">${iconHtml}</div><div style="flex:1;min-width:0"><div class="gondola-product-name">${esc(p.name)}${p.variant?` <span style="font-weight:400;color:var(--text2)">— ${esc(p.variant)}</span>`:''}</div><div class="gondola-product-meta">${esc(p.category)}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-size:22px;font-weight:800;line-height:1;${stockColor}">${total}</div><div style="font-size:11px;color:var(--text2)">uds. en dep.</div></div></div>${pkgLine||expLine?`<div style="font-size:12px;color:var(--text2);margin:0 0 .5rem;padding-left:50px">${pkgLine||''}${pkgLine&&expLine?' · ':''}${expLine||''}</div>`:''}<div style="padding-left:50px"><button class="gondola-lot-btn ${inList?'in-list':''}" data-pid="${p.id}">${inList?'✓ En la lista':total===0?'Sin stock — agregar igual':'Agregar a lista'}</button></div></div>`;
  }).join('');
  listEl.querySelectorAll('.gondola-lot-btn').forEach(btn=>{btn.addEventListener('click',async()=>{const pid=Number(btn.dataset.pid);const p=sorted.find(x=>x.id===pid);if(p){const lots=p.lots;openGondolaSheet(p,lots);}});});
  $('gondola-results').classList.remove('hidden');
}

function openGondolaSheet(product, lots) {
  gondolaSheetProduct={product,lots};
  const gshImg=$('gsh-img'),gshIcon=$('gsh-icon');
  if(product.image){gshImg.src=product.image;gshImg.classList.remove('hidden');gshIcon.classList.add('hidden');}else{gshImg.classList.add('hidden');gshIcon.classList.remove('hidden');gshIcon.textContent=initials(product.name);}
  $('gsh-name').textContent=product.name;$('gsh-variant').textContent=product.variant||'';$('gsh-variant').style.display=product.variant?'block':'none';
  const total=totalStock(lots),pkg=pkgBreakdown(total,product.pkgType,product.pkgQty||1);
  const lotsWithExp=lots.filter(l=>l.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry));
  const nextLot=lotsWithExp[0],days=nextLot?daysLeft(nextLot.expiry):null;
  let stockInfo=`<strong>${total} unidades</strong> en depósito`;
  if(pkg&&pkg.full>0)stockInfo+=` (${pkg.full} ${product.pkgType}${pkg.full!==1?'s':''}${pkg.rem>0?` + ${pkg.rem} sueltas`:''})`; 
  if(nextLot)stockInfo+=`<br>Próximo vencimiento: ${fmtDate(nextLot.expiry)}${days!==null?` — ${days<0?'VENCIDO':`${days} días`}`:''}`;
  $('gsh-stock-info').innerHTML=stockInfo;
  $('gsh-qty-type').value='pkg';$('gsh-qty').value=1;$('gsh-note').value='';
  updateGshCalc();
  $('gondola-sheet-backdrop').classList.remove('hidden'); document.body.style.overflow='hidden';
}

function closeGondolaSheet() {
  $('gondola-sheet-backdrop').classList.add('hidden'); document.body.style.overflow=''; gondolaSheetProduct=null;
}

function updateGshCalc() {
  if(!gondolaSheetProduct)return;
  renderCalcPreview('gsh-calc',$('gsh-qty').value,$('gsh-qty-type').value,gondolaSheetProduct.product);
}

function addToGondolaList() {
  if(!gondolaSheetProduct)return;
  const {product,lots}=gondolaSheetProduct;
  const rawQty=parseInt($('gsh-qty').value)||0,type=$('gsh-qty-type').value,pkgQty=product.pkgQty||1,pkgType=product.pkgType||'unidad';
  const units=(type==='pkg'&&pkgQty>1&&pkgType!=='unidad')?rawQty*pkgQty:rawQty;
  if(units<1){toast('Ingresá una cantidad válida','error');return;}
  gondolaList=gondolaList.filter(i=>i.barcode!==product.barcode);
  gondolaList.push({barcode:product.barcode,productName:product.name,variant:product.variant||'',image:product.image||null,pkgType,pkgQty,rawQty,units,type,note:$('gsh-note').value.trim(),sysStock:totalStock(lots),nextExp:lots.filter(l=>l.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0]?.expiry||null});
  beep();
  const desc=type==='pkg'&&pkgQty>1&&pkgType!=='unidad'?`${rawQty} ${pkgType}${rawQty!==1?'s':''}=${units}uds.`:`${units}uds.`;
  toast(`Lista: ${product.name} · ${desc}`,'success');
  closeGondolaSheet(); renderGondolaList(); runGondolaSearch();
}

function renderGondolaList() {
  const listSection=$('gondola-list-section'),listEl=$('gondola-list-items'),countEl=$('gondola-list-count'),shareBtn=$('btn-gondola-share'),clearBtn=$('btn-gondola-clear');
  if(gondolaList.length===0){listSection.classList.add('hidden');shareBtn.style.display='none';clearBtn.style.display='none';return;}
  listSection.classList.remove('hidden');shareBtn.style.display='';clearBtn.style.display='';
  countEl.textContent=`${gondolaList.length} ítem${gondolaList.length!==1?'s':''}`;
  listEl.innerHTML=gondolaList.map((item,idx)=>{
    const iconHtml=item.image?`<img src="${esc(item.image)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`:esc(initials(item.productName));
    const pkgDesc=item.type==='pkg'&&item.pkgQty>1&&item.pkgType!=='unidad'?`${item.rawQty} ${item.pkgType}${item.rawQty!==1?'s':''}=${item.units}uds.`:`${item.units}uds.`;
    return`<div class="gondola-list-item"><div class="gondola-list-icon">${iconHtml}</div><div class="gondola-list-info"><div class="gondola-list-name">${esc(item.productName)}${item.variant?` <span style="font-weight:400;color:var(--text2)">— ${esc(item.variant)}</span>`:''}</div><div class="gondola-list-meta">${pkgDesc} · Dep: ${item.sysStock}uds.${item.nextExp?' · Vto: '+fmtDate(item.nextExp):''}</div>${item.note?`<div style="font-size:11px;color:var(--text2);font-style:italic;margin-top:2px">${esc(item.note)}</div>`:''}</div><div class="gondola-list-right"><div class="gondola-list-qty">${item.units}</div><div class="gondola-list-unit">uds.</div><button class="gondola-list-del" data-idx="${idx}" title="Quitar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div></div>`;
  }).join('');
  listEl.querySelectorAll('.gondola-list-del').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();gondolaList.splice(Number(btn.dataset.idx),1);renderGondolaList();runGondolaSearch();});});
}

function shareGondolaList() {
  if(gondolaList.length===0)return;
  const date=new Date().toLocaleDateString('es-AR');
  const lines=[`*Lista de reposición — ${date}*`,'']; 
  gondolaList.forEach((item,i)=>{const pkgDesc=item.type==='pkg'&&item.pkgQty>1&&item.pkgType!=='unidad'?`${item.rawQty} ${item.pkgType}${item.rawQty!==1?'s':''}`:` ${item.units}uds.`;const name=item.variant?`${item.productName} — ${item.variant}`:item.productName;lines.push(`${i+1}. ${name}: *${pkgDesc}*${item.note?' ('+item.note+')':''}`);});
  lines.push('',`_Dep. stock actual incluido_`);
  const text=lines.join('\n');
  if(navigator.share){navigator.share({text}).catch(()=>{});}
  else{navigator.clipboard.writeText(text).then(()=>toast('Lista copiada al portapapeles','success')).catch(()=>window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank'));}
}

// ── CONTEO FÍSICO ─────────────────────────────────────────────────

let cntStream=null,cntInterval=null,lastCntCode=null,cntDetector=null;
let activeConteoId=null,cntScannedProduct=null,cntItemsMap={};

function initConteoSection() {
  $('btn-cnt-new').addEventListener('click', startConteo);
  $('btn-cnt-finish').addEventListener('click', showConteoDiff);
  $('btn-cnt-diff-back').addEventListener('click',()=>{$('cnt-diff-view').classList.add('hidden');$('cnt-active').classList.remove('hidden');});
  $('btn-cnt-apply').addEventListener('click', applyConteo);
  $('btn-conteo-history').addEventListener('click',()=>{$('cnt-active').classList.add('hidden');$('cnt-diff-view').classList.add('hidden');$('cnt-idle').classList.remove('hidden');loadConteoHistory();});
  if('BarcodeDetector' in window)cntDetector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','code_93','upc_a','upc_e','qr_code','itf','codabar']});
  else{$('cnt-scanner-status').textContent='Usá el campo manual';$('btn-cnt-cam-start').disabled=true;}
  $('btn-cnt-cam-start').addEventListener('click', startCntCam);
  $('btn-cnt-cam-stop').addEventListener('click', stopCntCam);
  $('btn-cnt-manual').addEventListener('click',()=>{const c=$('cnt-inp-barcode').value.trim();if(c)handleCntScan(c);});
  $('cnt-inp-barcode').addEventListener('keydown',e=>{if(e.key==='Enter'){const c=$('cnt-inp-barcode').value.trim();if(c)handleCntScan(c);}});
  $('btn-cnt-p-close').addEventListener('click', closeCntPanel);
  ['cnt-p-qty','cnt-p-qty-type'].forEach(id=>{$(id).addEventListener('input',updateCntCalc);$(id).addEventListener('change',updateCntCalc);});
  $('btn-cnt-p-add').addEventListener('click', addCntItem);
  loadConteoHistory();
}

async function startConteo() {
  const date=new Date().toISOString().split('T')[0];
  activeConteoId=await DB.addConteo({date,label:`Conteo ${fmtDate(date)}`});
  cntItemsMap={};
  $('cnt-active-title').textContent=`Conteo ${fmtDate(date)}`;$('cnt-active-meta').textContent=`Iniciado hoy · 0 productos`;
  $('cnt-idle').classList.add('hidden');$('cnt-active').classList.remove('hidden');$('cnt-diff-view').classList.add('hidden');
  closeCntPanel(); renderCntList();
}

async function startCntCam() {
  try{$('cnt-scanner-status').textContent='Iniciando...';cntStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}}});const video=$('cnt-scanner-video');video.srcObject=cntStream;await video.play();$('btn-cnt-cam-start').classList.add('hidden');$('btn-cnt-cam-stop').classList.remove('hidden');$('cnt-scanner-status').textContent='Apuntá al código';if(cntDetector){cntInterval=setInterval(async()=>{try{const codes=await cntDetector.detect(video);if(codes.length>0){const code=codes[0].rawValue;if(code!==lastCntCode){lastCntCode=code;flashVp('cnt-scanner-vp');beep();await handleCntScan(code);setTimeout(()=>{lastCntCode=null;},3000);}}}catch(_){}},350);}}catch(e){$('cnt-scanner-status').textContent='Sin acceso a la cámara';}
}

function stopCntCam() {
  if(cntStream){cntStream.getTracks().forEach(t=>t.stop());cntStream=null;}
  if(cntInterval){clearInterval(cntInterval);cntInterval=null;}
  const v=$('cnt-scanner-video');if(v)v.srcObject=null;
  $('btn-cnt-cam-start').classList.remove('hidden');$('btn-cnt-cam-stop').classList.add('hidden');
  const st=$('cnt-scanner-status');if(st)st.textContent='Presioná iniciar';lastCntCode=null;
}

async function handleCntScan(barcode) {
  $('cnt-inp-barcode').value='';
  const product=await DB.getByBarcode(barcode);
  cntScannedProduct=product||{barcode,name:barcode,variant:'',pkgType:'unidad',pkgQty:1,image:null};
  const existing=cntItemsMap[barcode];
  const lots=product?await DB.getLotsByProduct(product.id):[];
  const sysStock=totalStock(lots);
  $('cnt-p-icon').textContent=initials(cntScannedProduct.name);
  if(product&&product.image)$('cnt-p-icon').innerHTML=`<img src="${esc(product.image)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`;
  $('cnt-p-name').textContent=product?product.name:'No registrado — se registrará';
  $('cnt-p-variant').textContent=product?(product.variant||''):barcode;
  $('cnt-p-variant').style.display=(product&&product.variant)||!product?'block':'none';
  $('cnt-p-code').textContent=barcode;
  $('cnt-p-qty').value=existing?existing.countedRaw:1;$('cnt-p-qty-type').value='pkg';
  $('cnt-p-current').textContent=product?`Sistema tiene: ${sysStock} unidades en stock`:'Producto nuevo — se dará de alta al confirmar';
  updateCntCalc(); $('cnt-product-panel').classList.remove('hidden');
}

function closeCntPanel(){$('cnt-product-panel').classList.add('hidden');cntScannedProduct=null;$('cnt-inp-barcode').value='';}
function updateCntCalc(){if(!cntScannedProduct)return;renderCalcPreview('cnt-p-calc',$('cnt-p-qty').value,$('cnt-p-qty-type').value,cntScannedProduct);}

async function addCntItem() {
  if(!cntScannedProduct||!activeConteoId)return;
  const rawQty=parseInt($('cnt-p-qty').value)||0,type=$('cnt-p-qty-type').value,pkgQty=cntScannedProduct.pkgQty||1,pkgType=cntScannedProduct.pkgType||'unidad';
  const units=(type==='pkg'&&pkgQty>1&&pkgType!=='unidad')?rawQty*pkgQty:rawQty;
  const barcode=cntScannedProduct.barcode;
  $('btn-cnt-p-add').disabled=true;
  if(cntItemsMap[barcode]){await DB.updateConteoItem(cntItemsMap[barcode].itemId,{countedUnits:units,countedRaw:rawQty,pkgType:type==='pkg'?pkgType:'unidad'});cntItemsMap[barcode].countedUnits=units;cntItemsMap[barcode].countedRaw=rawQty;}
  else{const id=await DB.addConteoItem({conteoId:activeConteoId,productId:cntScannedProduct.id||null,barcode,productName:cntScannedProduct.name,variant:cntScannedProduct.variant||'',pkgType:type==='pkg'?pkgType:'unidad',countedUnits:units,countedRaw:rawQty});cntItemsMap[barcode]={itemId:id,countedUnits:units,countedRaw:rawQty,product:cntScannedProduct};}
  $('btn-cnt-p-add').disabled=false; beep();
  const desc=type==='pkg'&&pkgQty>1&&pkgType!=='unidad'?`${rawQty} ${pkgType}${rawQty!==1?'s':''}=${units}uds.`:`${units}uds.`;
  toast(`${cntScannedProduct.name} — ${desc}`,'success'); closeCntPanel(); renderCntList();
}

async function renderCntList() {
  const items=await DB.getConteoItems(activeConteoId);
  const count=items.length;
  $('cnt-items-count').textContent=`${count} producto${count!==1?'s':''}`;$('cnt-active-meta').textContent=`En curso · ${count} producto${count!==1?'s':''} contados`;
  const listEl=$('cnt-items-list');
  if(items.length===0){listEl.innerHTML='<div class="empty-state" style="padding:1.5rem"><p>Escaneá el primer producto del depósito</p></div>';return;}
  const products=await DB.getAllProducts();const pMap={};products.forEach(p=>pMap[p.barcode]=p);
  listEl.innerHTML=items.sort((a,b)=>b.addedAt.localeCompare(a.addedAt)).map(it=>{const prod=pMap[it.barcode];const iconHtml=prod&&prod.image?`<img src="${esc(prod.image)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`:esc(initials(it.productName));const pkgLabel=it.pkgType!=='unidad'&&it.countedRaw!==it.countedUnits?`${it.countedRaw} paquetes = ${it.countedUnits}uds.`:`${it.countedUnits}uds.`;return`<div class="rec-item"><div class="rec-item-icon">${iconHtml}</div><div class="rec-item-info"><div class="rec-item-name">${esc(it.productName)}</div>${it.variant?`<div class="rec-item-meta">${esc(it.variant)}</div>`:''}<div style="font-size:11px;color:var(--text2);margin-top:2px">${pkgLabel}</div></div><div class="rec-item-right"><div class="rec-item-qty">${it.countedUnits}</div><div class="rec-item-unit">uds.</div></div></div>`;}).join('');
  cntItemsMap={};items.forEach(it=>{cntItemsMap[it.barcode]={itemId:it.id,countedUnits:it.countedUnits,countedRaw:it.countedRaw,product:pMap[it.barcode]||null};});
}

async function showConteoDiff() {
  const cntItems=await DB.getConteoItems(activeConteoId);
  if(cntItems.length===0){toast('Escaneá al menos un producto primero','error');return;}
  const inventory=await DB.getAllInventory();
  const sysMap={};inventory.forEach(p=>{sysMap[p.barcode]={product:p,sysStock:totalStock(p.lots)};});
  const cntMap={};cntItems.forEach(it=>{cntMap[it.barcode]=it;});
  const diffs=[],missing=[];
  cntItems.forEach(it=>{const sys=sysMap[it.barcode];const sysStock=sys?sys.sysStock:0;const diff=it.countedUnits-sysStock;if(diff!==0)diffs.push({it,sysStock,diff,prod:sys?sys.product:null});});
  inventory.forEach(p=>{if(!cntMap[p.barcode]&&totalStock(p.lots)>0)missing.push(p);});
  const gained=diffs.filter(d=>d.diff>0).length,lost=diffs.filter(d=>d.diff<0).length;
  $('cnt-diff-metrics').innerHTML=`<div class="metric"><div class="metric-label">Contados</div><div class="metric-value">${cntItems.length}</div></div><div class="metric"><div class="metric-label">Con diferencia</div><div class="metric-value ${diffs.length>0?'amber':''}">${diffs.length}</div></div><div class="metric"><div class="metric-label">Stock extra</div><div class="metric-value green">+${gained}</div></div><div class="metric"><div class="metric-label">Faltante</div><div class="metric-value ${lost>0?'red':''}">-${lost}</div></div>`;
  $('cnt-diff-meta').textContent=`${cntItems.length} productos · ${diffs.length} diferencias`;$('cnt-diff-badge').textContent=`${diffs.length}`;
  const diffEl=$('cnt-diff-list');
  if(diffs.length===0){diffEl.innerHTML='<div class="empty-state" style="padding:1.25rem"><p>Sin diferencias — el stock coincide</p></div>';}
  else{diffEl.innerHTML=diffs.map(d=>{const prod=d.prod,it=d.it;const iconHtml=prod&&prod.image?`<img src="${esc(prod.image)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`:esc(initials(it.productName));const diffColor=d.diff>0?'var(--green)':'var(--red)';return`<div class="rec-item"><div class="rec-item-icon">${iconHtml}</div><div class="rec-item-info"><div class="rec-item-name">${esc(it.productName)}</div><div class="rec-item-meta">Sistema: ${d.sysStock}uds → Conteo: ${it.countedUnits}uds</div></div><div class="rec-item-right" style="color:${diffColor}"><div class="rec-item-qty">${d.diff>0?'+'+d.diff:d.diff}</div><div class="rec-item-unit">uds.</div></div></div>`;}).join('');}
  const missingEl=$('cnt-missing-list');$('cnt-missing-badge').textContent=missing.length;
  if(missing.length===0){$('cnt-missing-card').classList.add('hidden');}
  else{$('cnt-missing-card').classList.remove('hidden');missingEl.innerHTML=missing.map(p=>`<div class="rec-item"><div class="rec-item-icon">${p.image?`<img src="${esc(p.image)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`:esc(initials(p.name))}</div><div class="rec-item-info"><div class="rec-item-name">${esc(p.name)}</div><div class="rec-item-meta">Sistema: ${totalStock(p.lots)}uds · Se asumirá 0</div></div><div class="rec-item-right" style="color:var(--red)"><div class="rec-item-qty">0</div><div class="rec-item-unit">uds.</div></div></div>`).join('');}
  $('cnt-active').classList.add('hidden');$('cnt-diff-view').classList.remove('hidden');
}

async function applyConteo() {
  $('btn-cnt-apply').disabled=true;
  const cntItems=await DB.getConteoItems(activeConteoId);
  const inventory=await DB.getAllInventory();
  const sysMap={};inventory.forEach(p=>{sysMap[p.barcode]=p;});
  const cntMap={};cntItems.forEach(it=>{cntMap[it.barcode]=it;});
  for(const it of cntItems){let product=sysMap[it.barcode];if(!product&&it.productName!==it.barcode){await DB.addProduct({barcode:it.barcode,name:it.productName,variant:it.variant||'',category:'Otros',pkgType:it.pkgType||'unidad',pkgQty:1});product=await DB.getByBarcode(it.barcode);}if(!product)continue;const lots=await DB.getLotsByProduct(product.id);for(const l of lots)await DB.deleteLot(l.id);if(it.countedUnits>0)await DB.addLot({productId:product.id,barcode:it.barcode,qty:it.countedUnits,expiry:null,price:null,notes:`Conteo #${activeConteoId}`});}
  for(const p of inventory){if(!cntMap[p.barcode]){const lots=await DB.getLotsByProduct(p.id);for(const l of lots)await DB.deleteLot(l.id);}}
  await DB.updateConteo(activeConteoId,{status:'closed',closedAt:new Date().toISOString(),itemCount:cntItems.length});
  $('btn-cnt-apply').disabled=false; stopCntCam(); activeConteoId=null; cntItemsMap={};
  $('cnt-diff-view').classList.add('hidden');$('cnt-idle').classList.remove('hidden');
  toast('Stock actualizado al conteo real','success'); loadConteoHistory(); loadDeposit();
}

async function loadConteoHistory() {
  const all=await DB.getAllConteos();
  const sorted=[...all].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,10);
  const el=$('cnt-history-list');
  if(sorted.length===0){el.innerHTML='<div class="empty-state" style="padding:1.5rem"><p>Sin conteos aún</p></div>';return;}
  el.innerHTML=sorted.map(c=>`<div class="rec-recent-item ${c.status==='open'?'cnt-open-row':''}" data-cid="${c.id}" data-status="${c.status}"><div style="flex:1"><div class="rec-recent-supplier">${esc(c.label||'Conteo')}</div><div class="rec-recent-meta">${fmtDate(c.date)} · ${c.itemCount||0} productos</div></div>${c.status==='open'?'<span class="badge badge-warn">Abierto</span>':'<span class="badge badge-ok">Cerrado</span>'}</div>`).join('');
  el.querySelectorAll('.cnt-open-row').forEach(row=>{row.addEventListener('click',async()=>{const cid=Number(row.dataset.cid);const c=sorted.find(x=>x.id===cid);if(!c)return;activeConteoId=cid;cntItemsMap={};$('cnt-idle').classList.add('hidden');$('cnt-active').classList.remove('hidden');$('cnt-active-title').textContent=c.label||'Conteo';await renderCntList();});});
}

// ── RECEPCIÓN ─────────────────────────────────────────────────────

let recStream=null,recInterval=null,lastRecCode=null,recDetector=null;
let activeReceptionId=null,activeReceptionProduct=null;

function initReceptionSection() {
  $('btn-rec-new').addEventListener('click', showNewRecForm);
  $('btn-rec-cancel-new').addEventListener('click',()=>{$('rec-new-form').classList.add('hidden');$('rec-idle').classList.remove('hidden');});
  $('btn-rec-start').addEventListener('click', startReception);
  $('btn-rec-history').addEventListener('click',()=>{$('rec-idle').classList.remove('hidden');$('rec-active').classList.add('hidden');$('rec-new-form').classList.add('hidden');$('rec-closed-view').classList.add('hidden');loadRecentReceptions();});
  if('BarcodeDetector' in window)recDetector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','code_93','upc_a','upc_e','qr_code','itf','codabar']});
  else{$('rec-scanner-status').textContent='Usá el campo manual';$('btn-rec-cam-start').disabled=true;}
  $('btn-rec-cam-start').addEventListener('click', startRecCam);
  $('btn-rec-cam-stop').addEventListener('click', stopRecCam);
  $('btn-rec-manual').addEventListener('click',()=>{const c=$('rec-inp-barcode').value.trim();if(c)handleRecScan(c);});
  $('rec-inp-barcode').addEventListener('keydown',e=>{if(e.key==='Enter'){const c=$('rec-inp-barcode').value.trim();if(c)handleRecScan(c);}});
  $('btn-rec-p-close').addEventListener('click', closeRecProductPanel);
  ['rec-p-qty','rec-p-qty-type'].forEach(id=>{$(id).addEventListener('input',updateRecCalc);$(id).addEventListener('change',updateRecCalc);});
  $('btn-rec-p-add').addEventListener('click', addRecItem);
  $('btn-rec-close-session').addEventListener('click', closeReception);
  $('btn-rec-closed-back').addEventListener('click',()=>{$('rec-closed-view').classList.add('hidden');$('rec-idle').classList.remove('hidden');loadRecentReceptions();});
  loadRecentReceptions();
}

function showNewRecForm() {
  $('rec-date').value=new Date().toISOString().split('T')[0];$('rec-supplier').value='';$('rec-notes').value='';
  DB.getAllReceptions().then(recs=>{const suppliers=[...new Set(recs.map(r=>r.supplier).filter(Boolean))];$('rec-supplier-list').innerHTML=suppliers.map(s=>`<option value="${esc(s)}">`).join('');});
  $('rec-idle').classList.add('hidden');$('rec-new-form').classList.remove('hidden');
}

async function startReception() {
  const supplier=$('rec-supplier').value.trim();
  if(!supplier){toast('Ingresá el nombre del proveedor','error');return;}
  $('btn-rec-start').disabled=true;
  activeReceptionId=await DB.addReception({supplier,date:$('rec-date').value||new Date().toISOString().split('T')[0],notes:$('rec-notes').value.trim()});
  $('btn-rec-start').disabled=false;
  $('rec-new-form').classList.add('hidden');
  showActiveSession(activeReceptionId, supplier, $('rec-date').value);
}

async function showActiveSession(recId, supplier, date) {
  activeReceptionId=recId;
  $('rec-active-supplier').textContent=supplier;$('rec-active-meta').textContent=`${fmtDate(date)} · Abierta`;
  $('rec-idle').classList.add('hidden');$('rec-new-form').classList.add('hidden');$('rec-closed-view').classList.add('hidden');$('rec-active').classList.remove('hidden');
  closeRecProductPanel(); await renderRecItems();
}

async function startRecCam() {
  try{$('rec-scanner-status').textContent='Iniciando...';recStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}}});const video=$('rec-scanner-video');video.srcObject=recStream;await video.play();$('btn-rec-cam-start').classList.add('hidden');$('btn-rec-cam-stop').classList.remove('hidden');$('rec-scanner-status').textContent='Apuntá al código';if(recDetector){recInterval=setInterval(async()=>{try{const codes=await recDetector.detect(video);if(codes.length>0){const code=codes[0].rawValue;if(code!==lastRecCode){lastRecCode=code;flashVp('rec-scanner-vp');beep();await handleRecScan(code);setTimeout(()=>{lastRecCode=null;},3000);}}}catch(_){}},350);}}catch(e){$('rec-scanner-status').textContent='Sin acceso a la cámara';}
}

function stopRecCam() {
  if(recStream){recStream.getTracks().forEach(t=>t.stop());recStream=null;}
  if(recInterval){clearInterval(recInterval);recInterval=null;}
  const v=$('rec-scanner-video');if(v)v.srcObject=null;
  $('btn-rec-cam-start').classList.remove('hidden');$('btn-rec-cam-stop').classList.add('hidden');
  const st=$('rec-scanner-status');if(st)st.textContent='Presioná iniciar';lastRecCode=null;
}

async function handleRecScan(barcode) {
  $('rec-inp-barcode').value='';
  const product=await DB.getByBarcode(barcode);
  activeReceptionProduct=product||{barcode,name:barcode,variant:'',pkgType:'unidad',pkgQty:1,image:null};
  $('rec-p-icon').textContent=initials(activeReceptionProduct.name);
  if(product&&product.image)$('rec-p-icon').innerHTML=`<img src="${esc(product.image)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`;
  $('rec-p-name').textContent=product?product.name:'Producto no registrado';
  $('rec-p-variant').textContent=product?(product.variant||''):barcode;
  $('rec-p-variant').style.display=(product&&product.variant)||!product?'block':'none';
  $('rec-p-code').textContent=barcode;
  $('rec-p-qty-type').value='pkg';$('rec-p-qty').value=1;$('rec-p-exp').value='';$('rec-p-price').value='';
  updateRecCalc(); $('rec-product-panel').classList.remove('hidden');
}

function closeRecProductPanel(){$('rec-product-panel').classList.add('hidden');activeReceptionProduct=null;$('rec-inp-barcode').value='';}
function updateRecCalc(){if(!activeReceptionProduct)return;renderCalcPreview('rec-p-calc',$('rec-p-qty').value,$('rec-p-qty-type').value,activeReceptionProduct);}

async function addRecItem() {
  if(!activeReceptionProduct||!activeReceptionId)return;
  const rawQty=parseInt($('rec-p-qty').value)||0,type=$('rec-p-qty-type').value,pkgQty=activeReceptionProduct.pkgQty||1,pkgType=activeReceptionProduct.pkgType||'unidad';
  const units=(type==='pkg'&&pkgQty>1&&pkgType!=='unidad')?rawQty*pkgQty:rawQty;
  if(units<1){toast('Ingresá una cantidad válida','error');return;}
  $('btn-rec-p-add').disabled=true;
  await DB.addRecItem({receptionId:activeReceptionId,productId:activeReceptionProduct.id||null,barcode:activeReceptionProduct.barcode,productName:activeReceptionProduct.name,qty:units,pkgQty:rawQty,pkgType:type==='pkg'?pkgType:'unidad',expiry:$('rec-p-exp').value||null,price:parseFloat($('rec-p-price').value)||null});
  $('btn-rec-p-add').disabled=false; beep();
  const desc=type==='pkg'&&pkgQty>1&&pkgType!=='unidad'?`${rawQty} ${pkgType}${rawQty!==1?'s':''}=${units}uds.`:`${units}uds.`;
  toast(`Agregado: ${activeReceptionProduct.name} · ${desc}`,'success');
  closeRecProductPanel(); await renderRecItems();
}

async function renderRecItems() {
  if(!activeReceptionId)return;
  const items=await DB.getItemsByReception(activeReceptionId);
  const listEl=$('rec-items-list');
  $('rec-items-count').textContent=`${items.length} ítem${items.length!==1?'s':''}`;
  if(items.length===0){listEl.innerHTML='<div class="empty-state" style="padding:1.5rem"><p>Escaneá un producto para agregarlo</p></div>';$('rec-summary').classList.add('hidden');return;}
  const grouped={};items.forEach(it=>{const key=it.barcode;if(!grouped[key])grouped[key]={...it,qty:0,lines:[]};grouped[key].qty+=it.qty;grouped[key].lines.push(it);});
  const products=await DB.getAllProducts();const pMap={};products.forEach(p=>pMap[p.barcode]=p);
  listEl.innerHTML=Object.values(grouped).map(g=>{const prod=pMap[g.barcode];const iconHtml=prod&&prod.image?`<img src="${esc(prod.image)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`:esc(initials(g.productName));const linesHtml=g.lines.map(it=>{const pkgLabel=it.pkgType!=='unidad'&&it.pkgQty>1?`${it.pkgQty} ${it.pkgType}${it.pkgQty!==1?'s':''}=${it.qty}uds.`:`${it.qty}uds.`;return`<div style="font-size:11px;color:var(--text2);margin-top:2px">· ${pkgLabel}${it.expiry?' · vto '+fmtDate(it.expiry):''}${it.price?' · $'+it.price:''}<button class="rec-item-del" data-id="${it.id}" title="Eliminar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`;}).join('');const variant=prod?(prod.variant||''):'';return`<div class="rec-item"><div class="rec-item-icon">${iconHtml}</div><div class="rec-item-info"><div class="rec-item-name">${esc(g.productName)}</div>${variant?`<div class="rec-item-meta">${esc(variant)}</div>`:''}${linesHtml}</div><div class="rec-item-right"><div class="rec-item-qty">${g.qty}</div><div class="rec-item-unit">uds.</div></div></div>`;}).join('');
  listEl.querySelectorAll('.rec-item-del').forEach(btn=>{btn.addEventListener('click',async e=>{e.stopPropagation();await DB.deleteRecItem(Number(btn.dataset.id));await renderRecItems();});});
  const totalUnits=items.reduce((s,it)=>s+(it.qty||0),0);let totalPrice=0,hasPrice=false;items.forEach(it=>{if(it.price){totalPrice+=it.price*it.qty;hasPrice=true;}});
  $('rec-total-items').textContent=items.length;$('rec-total-units').textContent=totalUnits;$('rec-total-price').textContent=hasPrice?`$${totalPrice.toFixed(2)}`:'—';$('rec-total-price-row').style.display=hasPrice?'':'none';$('rec-summary').classList.remove('hidden');
}

async function closeReception() {
  if(!activeReceptionId)return;
  const items=await DB.getItemsByReception(activeReceptionId);
  if(items.length===0&&!confirm('La sesión está vacía. ¿Cerrarla de todas formas?'))return;
  const updateStock=confirm(`¿Cerrar la recepción y actualizar el stock?\n\n· OK = Cerrar Y agregar al stock del depósito\n· Cancelar = Cerrar solo como registro`);
  $('btn-rec-close-session').disabled=true;
  if(updateStock){for(const it of items){if(!it.productId)continue;await DB.addLot({productId:it.productId,barcode:it.barcode,qty:it.qty,expiry:it.expiry||null,price:it.price||null,notes:`Recepción #${activeReceptionId}`});}toast('Recepción cerrada y stock actualizado','success');loadDeposit();}
  else toast('Recepción cerrada como registro','success');
  await DB.updateReception(activeReceptionId,{status:'closed',closedAt:new Date().toISOString()});
  $('btn-rec-close-session').disabled=false; stopRecCam(); activeReceptionId=null; activeReceptionProduct=null;
  $('rec-active').classList.add('hidden');$('rec-idle').classList.remove('hidden');await loadRecentReceptions();
}

async function loadRecentReceptions() {
  const all=await DB.getAllReceptions();
  const sorted=[...all].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20);
  const listEl=$('rec-recent-list');
  if(sorted.length===0){listEl.innerHTML='<div class="empty-state" style="padding:1.5rem"><p>Sin recepciones aún</p></div>';return;}
  const countMap={};
  for(const r of sorted){const its=await DB.getItemsByReception(r.id);countMap[r.id]=its.length;}
  listEl.innerHTML=sorted.map(r=>{const badge=r.status==='open'?'<span class="badge badge-warn">Abierta</span>':'<span class="badge badge-ok">Cerrada</span>';const itemCount=countMap[r.id]||0;return`<div class="rec-recent-item" data-rec-id="${r.id}" data-status="${r.status}"><div style="flex:1;min-width:0"><div class="rec-recent-supplier">${esc(r.supplier)}</div><div class="rec-recent-meta">${fmtDate(r.date)} · ${itemCount} ítem${itemCount!==1?'s':''}</div></div><div class="rec-recent-badge">${badge}</div></div>`;}).join('');
  listEl.querySelectorAll('.rec-recent-item').forEach(row=>{row.addEventListener('click',async()=>{const recId=Number(row.dataset.recId),status=row.dataset.status,rec=sorted.find(r=>r.id===recId);if(!rec)return;if(status==='open')showActiveSession(recId,rec.supplier,rec.date);else showClosedReception(rec);});});
}

async function showClosedReception(rec) {
  $('rec-idle').classList.add('hidden');$('rec-active').classList.add('hidden');$('rec-closed-view').classList.remove('hidden');
  $('rec-closed-supplier').textContent=rec.supplier;$('rec-closed-meta').textContent=`${fmtDate(rec.date)} · Cerrada`;
  const items=await DB.getItemsByReception(rec.id);
  const products=await DB.getAllProducts();const pMap={};products.forEach(p=>pMap[p.barcode]=p);
  const listEl=$('rec-closed-items-list');
  if(items.length===0){listEl.innerHTML='<div class="empty-state" style="padding:1.5rem"><p>Sin ítems</p></div>';$('rec-closed-summary').innerHTML='';return;}
  const grouped={};items.forEach(it=>{if(!grouped[it.barcode])grouped[it.barcode]={...it,qty:0,lines:[]};grouped[it.barcode].qty+=it.qty;grouped[it.barcode].lines.push(it);});
  listEl.innerHTML=Object.values(grouped).map(g=>{const prod=pMap[g.barcode];const iconHtml=prod&&prod.image?`<img src="${esc(prod.image)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`:esc(initials(g.productName));const linesHtml=g.lines.map(it=>{const pkgLabel=it.pkgType!=='unidad'&&it.pkgQty>1?`${it.pkgQty} ${it.pkgType}${it.pkgQty!==1?'s':''}=${it.qty}uds.`:`${it.qty}uds.`;return`<div style="font-size:11px;color:var(--text2);margin-top:2px">· ${pkgLabel}${it.expiry?' · vto '+fmtDate(it.expiry):''}${it.price?' · $'+it.price:''}</div>`;}).join('');return`<div class="rec-item"><div class="rec-item-icon">${iconHtml}</div><div class="rec-item-info"><div class="rec-item-name">${esc(g.productName)}</div>${linesHtml}</div><div class="rec-item-right"><div class="rec-item-qty">${g.qty}</div><div class="rec-item-unit">uds.</div></div></div>`;}).join('');
  const totalUnits=items.reduce((s,it)=>s+(it.qty||0),0);let totalPrice=0,hasPrice=false;items.forEach(it=>{if(it.price){totalPrice+=it.price*it.qty;hasPrice=true;}});
  $('rec-closed-summary').innerHTML=`<div class="rec-summary-row"><span>Total ítems</span><span>${items.length}</span></div><div class="rec-summary-row"><span>Total unidades</span><span>${totalUnits}</span></div>${hasPrice?`<div class="rec-summary-row"><span>Total costo</span><span>$${totalPrice.toFixed(2)}</span></div>`:''}${rec.notes?`<div class="rec-summary-row"><span>Notas</span><span style="color:var(--text2);font-size:13px">${esc(rec.notes)}</span></div>`:''}`;
}

// ── MÁS / Config ─────────────────────────────────────────────────

function initConfig() {
  $('btn-backup-export').addEventListener('click', exportBackup);
  $('btn-backup-import').addEventListener('click',()=>{$('inp-backup-file').value='';$('inp-backup-file').click();});
  $('inp-backup-file').addEventListener('change',e=>processBackup(e.target.files[0]));
  $('btn-full-csv').addEventListener('click', exportCSV);
}

async function exportBackup() {
  const data=await DB.exportBackup();
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const date=new Date().toISOString().split('T')[0];
  const a=document.createElement('a');a.href=url;a.download=`stockcontrol-backup-${date}.json`;a.click();URL.revokeObjectURL(url);
  toast(`Backup exportado — ${data.products.length} productos`,'success');
}

async function processBackup(file) {
  if(!file)return;
  try{const text=await file.text(),data=JSON.parse(text);if(!data.products||!data.lots){toast('Archivo inválido','error');return;}const ok=confirm(`¿Restaurar backup?\n\n📦 ${data.products.length} productos\n📋 ${data.lots.length} lotes\n\n⚠️ Reemplaza todos los datos actuales.`);if(!ok)return;await DB.restoreBackup(data);toast('Backup restaurado','success');loadDeposit();}catch(e){toast('Error al procesar el archivo','error');}
}

async function exportCSV() {
  const inv=await DB.getAllInventory();
  const rows=[['Producto','Variante','Código','Categoría','Tipo paquete','Uds/paquete','Cantidad lote','Vencimiento','Precio','Fecha ingreso']];
  inv.forEach(p=>{if(p.lots.length===0)rows.push([p.name,p.variant||'',p.barcode,p.category,p.pkgType||'',p.pkgQty||1,'','','','']);else p.lots.forEach(l=>rows.push([p.name,p.variant||'',p.barcode,p.category,p.pkgType||'',p.pkgQty||1,l.qty||'',l.expiry||'',l.price||'',l.enteredAt?l.enteredAt.split('T')[0]:'']));});
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='inventario-stockcontrol.csv';a.click();URL.revokeObjectURL(url);
}

// ── Boot ──────────────────────────────────────────────────────────

function startApp() {
  initNav();
  initScanSection();
  initDepositSection();
  initGondolaSection();
  initConteoSection();
  initReceptionSection();
  initRegisterSection();
  initExpChips();
  initConfig();
  $('btn-cfg-go-register').addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    stopDepCam();stopGondolaCam();stopCntCam();stopRecCam();
    $('sec-register').classList.add('active');
  });
  loadDeposit();
  loadExpiry();
}

document.addEventListener('DOMContentLoaded', startApp);
