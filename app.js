/**
 * app.js — StockControl (sin auth)
 * Secciones: Escanear · Depósito · Góndola · Registrar · Recepción · Conteo · Más
 */

// ── Utilidades ────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' '+type : '');
  el.textContent = msg;
  $('toast-wrap').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function fmt(iso) {
  if (!iso) return '—';
  const s = iso.split('T')[0];
  const [y,m,d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})
       + ' ' + d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
}

function daysLeft(exp) {
  if (!exp) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((new Date(exp+'T00:00:00') - today) / 86400000);
}

function expBadge(days) {
  if (days === null) return '<span class="badge">Sin fecha</span>';
  if (days < 0)  return `<span class="badge danger">Vencido ${Math.abs(days)}d</span>`;
  if (days === 0) return `<span class="badge danger">Vence HOY</span>`;
  if (days <= 7)  return `<span class="badge danger">${days}d</span>`;
  if (days <= 30) return `<span class="badge warn">${days}d</span>`;
  return `<span class="badge ok">${days}d</span>`;
}

function initials(name) {
  return (name||'?').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?';
}

function stockTotal(lots) {
  return lots.reduce((s,l) => s + (l.qty||0), 0);
}

function pkgBreak(total, pkgType, pkgQty) {
  if (!pkgQty || pkgQty <= 1 || pkgType === 'unidad') return null;
  return { full: Math.floor(total/pkgQty), rem: total%pkgQty, pkgType };
}

function calcUnits(qty, qtyType, pkgType, pkgQty) {
  const n = parseInt(qty) || 0;
  if (qtyType === 'pkg' && pkgQty > 1 && pkgType !== 'unidad') return n * pkgQty;
  return n;
}

function renderCalc(elId, qty, qtyType, pkgType, pkgQty) {
  const el = $(elId); if (!el) return;
  const n = parseInt(qty) || 0;
  if (n <= 0) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (qtyType === 'pkg' && pkgQty > 1 && pkgType !== 'unidad') {
    el.innerHTML = `<span class="calc-big">${n * pkgQty}</span> <span class="calc-dim">unidades — ${n} ${pkgType}${n!==1?'s':''} × ${pkgQty}</span>`;
  } else {
    el.innerHTML = `<span class="calc-big">${n}</span> <span class="calc-dim">unidades</span>`;
  }
}

// ── Beep ──────────────────────────────────────────────────────────

let _actx = null;
function beep() {
  try {
    if (!_actx) _actx = new (window.AudioContext||window.webkitAudioContext)();
    const o = _actx.createOscillator(), g = _actx.createGain();
    o.connect(g); g.connect(_actx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(880, _actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(660, _actx.currentTime+.08);
    g.gain.setValueAtTime(.4, _actx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, _actx.currentTime+.15);
    o.start(); o.stop(_actx.currentTime+.15);
  } catch(_) {}
}
document.addEventListener('touchstart', () => {
  if (!_actx) _actx = new (window.AudioContext||window.webkitAudioContext)();
  if (_actx.state === 'suspended') _actx.resume();
}, { once: true });

// ── Image compression ─────────────────────────────────────────────

function compressImg(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        let w = img.width, h = img.height;
        if (w>MAX||h>MAX) { if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;} }
        const c = document.createElement('canvas');
        c.width=w; c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        resolve(c.toDataURL('image/jpeg',.75));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Scanner helper ────────────────────────────────────────────────

let _detector = null;
function getDetector() {
  if (_detector) return _detector;
  if ('BarcodeDetector' in window) {
    _detector = new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','code_93','upc_a','upc_e','qr_code','itf','codabar']});
  }
  return _detector;
}

function flashVp(vpId) {
  const vp = $(vpId); if (!vp) return;
  const f = document.createElement('div'); f.className = 'scan-flash';
  vp.appendChild(f); setTimeout(() => f.remove(), 400);
}

function startCam(videoId, statusId, onCode) {
  // Returns a stop function
  let stream = null, interval = null;
  const video = $(videoId);
  const status = $(statusId);
  if (status) status.textContent = 'Iniciando...';

  const det = getDetector();

  navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}}})
    .then(s => {
      stream = s;
      video.srcObject = s;
      return video.play();
    })
    .then(() => {
      if (status) status.textContent = 'Apuntá al código';
      if (det) {
        let last = null;
        interval = setInterval(async () => {
          try {
            const codes = await det.detect(video);
            if (codes.length > 0) {
              const val = codes[0].rawValue;
              if (val !== last) {
                last = val;
                const vpId = videoId.replace('-video', '-vp');
                flashVp(vpId); beep();
                onCode(val);
                setTimeout(() => { last = null; }, 3000);
              }
            }
          } catch(_) {}
        }, 350);
      }
    })
    .catch(() => { if (status) status.textContent = 'Sin acceso a la cámara'; });

  return function stop() {
    if (interval) { clearInterval(interval); interval = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (video) video.srcObject = null;
    if (status) status.textContent = 'Presioná iniciar';
  };
}

// ── Navigation ────────────────────────────────────────────────────

const pages = ['scan','dep','gondola','reg','rec','cnt','mas'];
let currentPage = 'scan';
let stopCams = {}; // page -> stopFn

function goTo(page) {
  // stop cameras of current page if any
  if (stopCams[currentPage]) { stopCams[currentPage](); delete stopCams[currentPage]; }

  pages.forEach(p => {
    const el = $('pg-'+p); if (el) el.classList.toggle('active', p === page);
  });
  document.querySelectorAll('#bottom-nav .ni').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
  currentPage = page;

  // reload data when entering
  if (page === 'dep')     loadDep();
  if (page === 'gondola') { $('gon-search').value=''; $('gon-welcome').classList.remove('hidden'); $('gon-results').classList.add('hidden'); }
  if (page === 'rec')     loadRecHistory();
  if (page === 'cnt')     loadCntHistory();
}

document.querySelectorAll('#bottom-nav .ni').forEach(btn => {
  btn.addEventListener('click', () => goTo(btn.dataset.page));
});

// ── ESCANEAR ──────────────────────────────────────────────────────

let stopScanCam = null;

function initScan() {
  const det = getDetector();
  if (!det) { $('scan-status').textContent = 'Usá el campo manual'; $('btn-scan-start').disabled = true; }

  $('btn-scan-start').addEventListener('click', () => {
    stopScanCam = startCam('scan-video', 'scan-status', code => showScanResult(code));
    $('btn-scan-start').classList.add('hidden');
    $('btn-scan-stop').classList.remove('hidden');
  });
  $('btn-scan-stop').addEventListener('click', () => {
    if (stopScanCam) { stopScanCam(); stopScanCam = null; }
    $('btn-scan-start').classList.remove('hidden');
    $('btn-scan-stop').classList.add('hidden');
    $('scan-status').textContent = 'Presioná iniciar';
  });

  $('btn-scan-manual').addEventListener('click', () => {
    const v = $('scan-inp').value.trim(); if (v) showScanResult(v);
  });
  $('scan-inp').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = $('scan-inp').value.trim(); if (v) showScanResult(v); }
  });

  $('btn-scan-close').addEventListener('click', hideScanResult);
  $('btn-unknown-close').addEventListener('click', hideScanResult);
}

function hideScanResult() {
  $('scan-result').classList.add('hidden');
  $('scan-found').classList.add('hidden');
  $('scan-unknown').classList.add('hidden');
  $('scan-inp').value = '';
}

async function showScanResult(barcode) {
  $('scan-inp').value = barcode;
  const data = await DB.getProductWithLots(barcode);
  $('scan-result').classList.remove('hidden');
  $('scan-found').classList.add('hidden');
  $('scan-unknown').classList.add('hidden');

  if (!data) {
    $('sr-unknown-code').textContent = barcode;
    $('scan-unknown').classList.remove('hidden');
    return;
  }

  const { product, lots } = data;
  $('sr-avatar').innerHTML = product.image
    ? `<img src="${esc(product.image)}" alt=""/>`
    : esc(initials(product.name));
  $('sr-name').textContent    = product.name;
  $('sr-variant').textContent = product.variant || '';
  $('sr-variant').style.display = product.variant ? 'block' : 'none';
  $('sr-code').textContent    = barcode;
  $('sr-cat').textContent     = product.category || '';

  if (product.image) {
    $('sr-img').src = product.image;
    $('sr-img-wrap').classList.remove('hidden');
  } else {
    $('sr-img-wrap').classList.add('hidden');
  }

  const total = stockTotal(lots);
  $('sr-stock').textContent = total;
  const pkg = pkgBreak(total, product.pkgType, product.pkgQty||1);
  $('sr-pkg').textContent = pkg
    ? `${pkg.full} ${pkg.pkgType}${pkg.full!==1?'s':''}${pkg.rem>0?` + ${pkg.rem} sueltas`:''}`
    : '';
  $('sr-pkg').style.display = pkg ? 'block' : 'none';

  const sorted = [...lots].sort((a,b) => !a.expiry?1:!b.expiry?-1:a.expiry.localeCompare(b.expiry));
  $('sr-lots').innerHTML = sorted.length === 0
    ? '<div class="empty"><p>Sin lotes</p></div>'
    : sorted.map(l => {
        const d = daysLeft(l.expiry);
        return `<div class="lot-row">
          <div class="lot-left">
            <div class="lot-date">Vto: ${fmt(l.expiry)} ${expBadge(d)}</div>
            <div class="lot-sub">Ingresó ${fmt(l.enteredAt)} · ${l.qty} uds.</div>
          </div>
          <div class="lot-right">
            <div class="lot-qty">${l.qty}</div>
            <div class="lot-unit">uds.</div>
          </div>
        </div>`;
      }).join('');

  $('scan-found').classList.remove('hidden');
}

// ── DEPÓSITO ──────────────────────────────────────────────────────

let depFilter = 'all';
let stopDepCam = null;

function initDep() {
  // Scanner toggle
  $('btn-dep-cam-toggle').addEventListener('click', () => {
    const wrap = $('dep-cam-wrap');
    if (wrap.classList.contains('hidden')) {
      wrap.classList.remove('hidden');
    } else {
      wrap.classList.add('hidden');
      if (stopDepCam) { stopDepCam(); stopDepCam = null; }
      $('btn-dep-cam-start').classList.remove('hidden');
      $('btn-dep-cam-stop').classList.add('hidden');
    }
  });
  $('btn-dep-cam-start').addEventListener('click', () => {
    stopDepCam = startCam('dep-scan-video', 'dep-scan-status', code => {
      $('dep-cam-wrap').classList.add('hidden');
      if (stopDepCam) { stopDepCam(); stopDepCam = null; }
      $('btn-dep-cam-start').classList.remove('hidden');
      $('btn-dep-cam-stop').classList.add('hidden');
      openSheetByBarcode(code);
    });
    $('btn-dep-cam-start').classList.add('hidden');
    $('btn-dep-cam-stop').classList.remove('hidden');
  });
  $('btn-dep-cam-stop').addEventListener('click', () => {
    if (stopDepCam) { stopDepCam(); stopDepCam = null; }
    $('btn-dep-cam-start').classList.remove('hidden');
    $('btn-dep-cam-stop').classList.add('hidden');
  });
  $('btn-dep-scan-manual').addEventListener('click', () => {
    const v = $('dep-scan-inp').value.trim(); if (v) openSheetByBarcode(v);
  });
  $('dep-scan-inp').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = $('dep-scan-inp').value.trim(); if (v) openSheetByBarcode(v); }
  });

  // Search + filter
  $('dep-search').addEventListener('input', loadDep);
  $('dep-cat').addEventListener('change', loadDep);

  $('dep-filter-chips').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('dep-filter-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      depFilter = chip.dataset.f;
      loadDep();
    });
  });
}

async function openSheetByBarcode(barcode) {
  const data = await DB.getProductWithLots(barcode);
  if (!data) { toast('Producto no registrado. Usá Registrar.', 'wrn'); return; }
  openSheet(data.product, data.lots);
}

async function loadDep() {
  const inventory = await DB.getAllInventory();
  const search = $('dep-search').value.toLowerCase().trim();
  const cat    = $('dep-cat').value;
  const today  = new Date(); today.setHours(0,0,0,0);

  let list = inventory.filter(p => {
    if (search && !p.name.toLowerCase().includes(search) && !(p.variant||'').toLowerCase().includes(search) && !p.barcode.includes(search)) return false;
    if (cat && p.category !== cat) return false;
    return true;
  });

  // quick filter
  const f = depFilter;
  if (f === 'zero') list = list.filter(p => stockTotal(p.lots) === 0);
  else if (f === 'low') list = list.filter(p => { const t=stockTotal(p.lots); return t>0&&t<=5; });
  else if (f === 'exp0') list = list.filter(p => p.lots.some(l => { const d=daysLeft(l.expiry); return d!==null&&d<0; }));
  else if (f === 'exp7') list = list.filter(p => p.lots.some(l => { const d=daysLeft(l.expiry); return d!==null&&d>=0&&d<=7; }));
  else if (f === 'exp15') list = list.filter(p => p.lots.some(l => { const d=daysLeft(l.expiry); return d!==null&&d>=0&&d<=15; }));
  else if (f === 'exp30') list = list.filter(p => p.lots.some(l => { const d=daysLeft(l.expiry); return d!==null&&d>=0&&d<=30; }));
  else if (f === 'exp60') list = list.filter(p => p.lots.some(l => { const d=daysLeft(l.expiry); return d!==null&&d>=0&&d<=60; }));
  else if (f === 'exp90') list = list.filter(p => p.lots.some(l => { const d=daysLeft(l.expiry); return d!==null&&d>=0&&d<=90; }));

  // metrics (always from full inventory)
  const total   = inventory.reduce((s,p) => s+stockTotal(p.lots), 0);
  const zero    = inventory.filter(p => stockTotal(p.lots)===0).length;
  let venc7=0, vencidos=0;
  inventory.forEach(p => p.lots.forEach(l => {
    const d=daysLeft(l.expiry); if(d===null)return;
    if(d<0) vencidos++; else if(d<=7) venc7++;
  }));
  $('dep-metrics').innerHTML = `
    <div class="metric"><div class="metric-lbl">Productos</div><div class="metric-val">${inventory.length}</div></div>
    <div class="metric"><div class="metric-lbl">Unidades</div><div class="metric-val">${total}</div></div>
    <div class="metric"><div class="metric-lbl">Sin stock</div><div class="metric-val ${zero>0?'amber':''}">${zero}</div></div>
    <div class="metric"><div class="metric-lbl">Vencen 7d</div><div class="metric-val ${venc7>0?'red':''}">${venc7}</div></div>
  `;

  const depList = $('dep-list');
  const depEmpty = $('dep-empty');

  if (list.length === 0) {
    depList.innerHTML = '';
    depEmpty.classList.remove('hidden');
    return;
  }
  depEmpty.classList.add('hidden');

  list.sort((a,b) => a.name.localeCompare(b.name));

  depList.innerHTML = list.map(p => {
    const total = stockTotal(p.lots);
    const pkg   = pkgBreak(total, p.pkgType, p.pkgQty||1);
    const nextLot = p.lots.filter(l=>l.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];
    const days = nextLot ? daysLeft(nextLot.expiry) : null;

    let badge = '';
    if (total === 0) badge = '<span class="badge warn">Sin stock</span>';
    else if (days !== null && days < 0) badge = `<span class="badge danger">Vencido</span>`;
    else if (days !== null && days <= 7) badge = `<span class="badge danger">${days}d</span>`;
    else if (days !== null && days <= 30) badge = `<span class="badge warn">${days}d</span>`;

    const icon = p.image
      ? `<img src="${esc(p.image)}" alt=""/>`
      : esc(initials(p.name));

    const meta2 = pkg && pkg.full>0
      ? `${pkg.full} ${pkg.pkgType}${pkg.full!==1?'s':''}${pkg.rem>0?` + ${pkg.rem}`:''}`
      : '';

    return `<div class="prod-row" data-id="${p.id}">
      <div class="avatar">${icon}</div>
      <div class="prod-info">
        <div class="prod-name">${esc(p.name)}${p.variant?` <span style="font-weight:400;color:var(--text2)">— ${esc(p.variant)}</span>`:''}</div>
        <div class="prod-meta">${esc(p.category||'')} ${badge ? '· '+badge : ''} ${nextLot&&days!==null?'· vto '+fmt(nextLot.expiry):''}</div>
        ${meta2 ? `<div class="prod-meta">${meta2}</div>` : ''}
      </div>
      <div class="prod-right">
        <div class="prod-qty" ${total===0?'style="color:var(--amber)"':''}>${total}</div>
        <div class="prod-unit">uds.</div>
      </div>
    </div>`;
  }).join('');

  depList.querySelectorAll('.prod-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = Number(row.dataset.id);
      const p  = list.find(x => x.id === id);
      if (p) openSheet(p, p.lots);
    });
  });
}

// ── SHEET (depósito detalle) ──────────────────────────────────────

let shProduct = null, shLots = [];

function openSheet(product, lots) {
  shProduct = product; shLots = lots;

  // header
  $('sh-avatar').innerHTML = product.image
    ? `<img src="${esc(product.image)}" alt=""/>`
    : esc(initials(product.name));
  $('sh-name').textContent    = product.name;
  $('sh-variant').textContent = product.variant || '';
  $('sh-variant').style.display = product.variant ? 'block' : 'none';
  $('sh-code').textContent    = product.barcode;
  $('sh-cat').textContent     = product.category || '';

  if (product.image) {
    $('sh-img').src = product.image;
    $('sh-img-wrap').classList.remove('hidden');
  } else {
    $('sh-img-wrap').classList.add('hidden');
  }

  refreshSheetStock();

  // reset forms
  $('sh-in-qty').value=1; $('sh-in-qty-type').value='unit';
  $('sh-in-exp').value=''; $('sh-in-price').value=''; $('sh-in-notes').value='';
  $('sh-out-qty').value=1; $('sh-out-reason').value='';
  if (product.pkgType) $('sh-out-pkg-type').value = product.pkgType;
  $('sh-in-calc').classList.add('hidden');
  $('sh-out-preview').innerHTML = '';
  updateShInCalc(); updateShOutPreview();
  switchTab('in');
  renderShLots(); renderShWithdrawals();

  $('sheet-bg').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  $('sheet-bg').classList.add('hidden');
  document.body.style.overflow = '';
  shProduct = null; shLots = [];
}

function refreshSheetStock() {
  const total = stockTotal(shLots);
  const pkg   = pkgBreak(total, shProduct.pkgType, shProduct.pkgQty||1);
  $('sh-stock').textContent = total;
  $('sh-pkg').textContent = pkg
    ? `${pkg.full} ${pkg.pkgType}${pkg.full!==1?'s':''}${pkg.rem>0?` + ${pkg.rem} sueltas`:''}`
    : '';
  $('sh-pkg').style.display = pkg ? 'block':'none';
  $('sh-lots-count').textContent = `${shLots.length} lote${shLots.length!==1?'s':''}`;
}

function switchTab(tab) {
  ['in','out','edit'].forEach(t => {
    $('sh-tab-'+t).classList.toggle('active', t===tab);
    $('sh-form-'+t).classList.toggle('hidden', t!==tab);
  });
}

function updateShInCalc() {
  if (!shProduct) return;
  renderCalc('sh-in-calc', $('sh-in-qty').value, $('sh-in-qty-type').value, shProduct.pkgType, shProduct.pkgQty||1);
}

function updateShOutPreview() {
  if (!shProduct) return;
  const qty    = parseInt($('sh-out-qty').value)||0;
  const type   = $('sh-out-pkg-type').value;
  const pkgQty = shProduct.pkgQty||1;
  const total  = stockTotal(shLots);
  const units  = (type!=='unidad' && pkgQty>1) ? qty*pkgQty : qty;
  const rem    = total - units;
  const prev   = $('sh-out-preview');
  if (units <= 0) { prev.innerHTML=''; return; }
  const pkgLabel = type!=='unidad' && pkgQty>1 ? ` (${qty} ${type} × ${pkgQty})` : '';
  prev.innerHTML = rem < 0
    ? `<span style="color:var(--red)">⚠️ Stock insuficiente (${total} disp.)</span>`
    : `Retirás <strong>${units} uds.</strong>${pkgLabel} · quedan <strong>${rem}</strong>`;
}

function renderShLots() {
  const sorted = [...shLots].sort((a,b)=>!a.expiry?1:!b.expiry?-1:a.expiry.localeCompare(b.expiry));
  $('sh-lots').innerHTML = sorted.length===0
    ? '<div class="empty"><p>Sin lotes en stock</p></div>'
    : sorted.map(l => {
        const d = daysLeft(l.expiry);
        return `<div class="lot-row">
          <div class="lot-left">
            <div class="lot-date">Vto: ${fmt(l.expiry)} ${expBadge(d)}</div>
            <div class="lot-sub">Ingresó ${fmt(l.enteredAt)}${l.price?' · $'+l.price:''}</div>
          </div>
          <div class="lot-right">
            <div class="lot-qty">${l.qty}</div><div class="lot-unit">uds.</div>
          </div>
        </div>`;
      }).join('');
}

async function renderShWithdrawals() {
  if (!shProduct) return;
  const list = await DB.getWithdrawalsByProduct(shProduct.id);
  const sorted = [...list].sort((a,b)=>b.withdrawnAt.localeCompare(a.withdrawnAt));
  $('sh-withdrawals').innerHTML = sorted.length===0
    ? '<div class="empty"><p>Sin retiros</p></div>'
    : sorted.slice(0,20).map(w => `<div class="wd-row">
        <div class="wd-info">
          <div class="wd-date">${fmtDt(w.withdrawnAt)}</div>
          <div class="wd-reason">${esc(w.reason||'Sin motivo')}</div>
        </div>
        <div class="wd-qty">−${w.qty}u.</div>
      </div>`).join('');
}

function loadShEditForm() {
  if (!shProduct) return;
  const p = shProduct;
  const prev = $('sh-edit-img-preview'), ph = $('sh-edit-img-ph');
  if (p.image) { prev.src=p.image; prev.classList.remove('hidden'); ph.classList.add('hidden'); $('btn-sh-edit-clear').disabled=false; }
  else { prev.src=''; prev.classList.add('hidden'); ph.classList.remove('hidden'); $('btn-sh-edit-clear').disabled=true; }
  $('sh-edit-name').value    = p.name||'';
  $('sh-edit-variant').value = p.variant||'';
  $('sh-edit-pkg-qty').value = p.pkgQty||1;
  const catSel = $('sh-edit-cat');
  for (let i=0;i<catSel.options.length;i++) {
    if (catSel.options[i].text===p.category) { catSel.selectedIndex=i; break; }
  }
  const pkgSel = $('sh-edit-pkg-type');
  for (let i=0;i<pkgSel.options.length;i++) {
    if (pkgSel.options[i].value===p.pkgType) { pkgSel.selectedIndex=i; break; }
  }
}

function initSheet() {
  $('btn-sh-close').addEventListener('click', closeSheet);
  $('sheet-bg').addEventListener('click', e => { if(e.target===$('sheet-bg')) closeSheet(); });

  ['in','out','edit'].forEach(tab => {
    $('sh-tab-'+tab).addEventListener('click', () => {
      switchTab(tab);
      if (tab==='edit') loadShEditForm();
    });
  });

  ['sh-in-qty','sh-in-qty-type'].forEach(id => {
    $(id).addEventListener('input', updateShInCalc);
    $(id).addEventListener('change', updateShInCalc);
  });
  ['sh-out-qty','sh-out-pkg-type'].forEach(id => {
    $(id).addEventListener('input', updateShOutPreview);
    $(id).addEventListener('change', updateShOutPreview);
  });

  $('btn-sh-in').addEventListener('click', async () => {
    if (!shProduct) return;
    const units = calcUnits($('sh-in-qty').value, $('sh-in-qty-type').value, shProduct.pkgType, shProduct.pkgQty||1);
    if (units < 1) { toast('Ingresá una cantidad válida','err'); return; }
    await DB.addLot({
      productId: shProduct.id, barcode: shProduct.barcode, qty: units,
      expiry: $('sh-in-exp').value||null, price: parseFloat($('sh-in-price').value)||null,
      notes: $('sh-in-notes').value.trim()
    });
    beep(); toast(`Ingreso: ${units} uds. de ${shProduct.name}`,'ok');
    const updated = await DB.getProductWithLots(shProduct.barcode);
    if (updated) { shProduct=updated.product; shLots=updated.lots; }
    $('sh-in-qty').value=1; $('sh-in-exp').value=''; $('sh-in-price').value=''; $('sh-in-notes').value='';
    updateShInCalc(); refreshSheetStock(); renderShLots(); loadDep();
  });

  $('btn-sh-out').addEventListener('click', async () => {
    if (!shProduct) return;
    const qty    = parseInt($('sh-out-qty').value)||0;
    const type   = $('sh-out-pkg-type').value;
    const pkgQty = shProduct.pkgQty||1;
    const units  = (type!=='unidad'&&pkgQty>1) ? qty*pkgQty : qty;
    if (units < 1) { toast('Ingresá una cantidad válida','err'); return; }
    const total  = stockTotal(shLots);
    if (units > total) { toast(`Stock insuficiente (${total} disp.)`,'err'); return; }

    // FIFO
    const sorted = [...shLots].filter(l=>(l.qty||0)>0).sort((a,b)=>!a.expiry?1:!b.expiry?-1:a.expiry.localeCompare(b.expiry));
    let rem = units;
    for (const lot of sorted) {
      if (rem <= 0) break;
      const take = Math.min(lot.qty, rem); lot.qty -= take; rem -= take;
      if (lot.qty <= 0) await DB.deleteLot(lot.id); else await DB.updateLot(lot.id, {qty:lot.qty});
    }
    await DB.addWithdrawal({productId:shProduct.id, barcode:shProduct.barcode, qty:units, pkgQty:qty, pkgType:type, reason:$('sh-out-reason').value.trim()});
    beep(); toast(`Retiro: ${units} uds. de ${shProduct.name}`,'ok');
    const updated = await DB.getProductWithLots(shProduct.barcode);
    if (updated) { shProduct=updated.product; shLots=updated.lots; }
    $('sh-out-qty').value=1; $('sh-out-reason').value='';
    updateShOutPreview(); refreshSheetStock(); renderShLots(); renderShWithdrawals(); loadDep();
  });

  // Edit photo
  async function handleEditPhoto(e) {
    const f=e.target.files[0]; if(!f) return;
    const b64=await compressImg(f);
    $('sh-edit-img-preview').src=b64; $('sh-edit-img-preview').classList.remove('hidden');
    $('sh-edit-img-ph').classList.add('hidden'); $('btn-sh-edit-clear').disabled=false;
    e.target.value='';
  }
  $('btn-sh-edit-photo-cam').addEventListener('click', () => $('sh-edit-inp-photo-cam').click());
  $('btn-sh-edit-photo-gal').addEventListener('click', () => $('sh-edit-inp-photo-gal').click());
  $('sh-edit-inp-photo-cam').addEventListener('change', handleEditPhoto);
  $('sh-edit-inp-photo-gal').addEventListener('change', handleEditPhoto);
  $('btn-sh-edit-clear').addEventListener('click', () => {
    $('sh-edit-img-preview').src=''; $('sh-edit-img-preview').classList.add('hidden');
    $('sh-edit-img-ph').classList.remove('hidden'); $('btn-sh-edit-clear').disabled=true;
  });

  $('btn-sh-edit-save').addEventListener('click', async () => {
    if (!shProduct) return;
    const name = $('sh-edit-name').value.trim();
    if (!name) { toast('El nombre es obligatorio','err'); return; }
    const imgPrev = $('sh-edit-img-preview');
    const newImg  = imgPrev.classList.contains('hidden') ? null : imgPrev.src || null;
    await DB.updateProduct(shProduct.id, {
      name, variant: $('sh-edit-variant').value.trim(),
      category: $('sh-edit-cat').value,
      pkgType:  $('sh-edit-pkg-type').value,
      pkgQty:   parseInt($('sh-edit-pkg-qty').value)||1,
      image:    newImg
    });
    beep(); toast('Producto actualizado','ok');
    const updated = await DB.getProductWithLots(shProduct.barcode);
    if (updated) { shProduct=updated.product; shLots=updated.lots; openSheet(shProduct, shLots); }
    loadDep();
  });
}

// ── REGISTRAR ─────────────────────────────────────────────────────

let regImg = null;
let stopRegCam = null;

function initReg() {
  // barcode check
  $('reg-barcode').addEventListener('input', checkRegBarcode);

  // scanner
  $('btn-reg-scan').addEventListener('click', () => {
    if (!getDetector()) { toast('Cámara no disponible','wrn'); return; }
    $('reg-cam-wrap').classList.toggle('hidden');
    if (!$('reg-cam-wrap').classList.contains('hidden')) {
      stopRegCam = startCam('reg-scan-video', 'reg-scan-status', code => {
        $('reg-cam-wrap').classList.add('hidden');
        if (stopRegCam) { stopRegCam(); stopRegCam = null; }
        $('reg-barcode').value = code;
        checkRegBarcode();
      });
    } else {
      if (stopRegCam) { stopRegCam(); stopRegCam = null; }
    }
  });
  $('btn-reg-cam-stop').addEventListener('click', () => {
    $('reg-cam-wrap').classList.add('hidden');
    if (stopRegCam) { stopRegCam(); stopRegCam = null; }
  });

  // pkg type change → show/hide pkg qty field
  $('reg-pkg-type').addEventListener('change', () => {
    const isPkg = $('reg-pkg-type').value !== 'unidad';
    $('reg-pkg-qty-wrap').style.display = isPkg ? 'flex' : 'none';
    updateRegCalc();
  });

  // quantity calc
  ['reg-qty','reg-qty-type','reg-pkg-type','reg-pkg-qty'].forEach(id => {
    const el=$(id); if(!el) return;
    el.addEventListener('input', updateRegCalc);
    el.addEventListener('change', updateRegCalc);
  });

  // photo
  $('btn-reg-photo-cam').addEventListener('click', () => $('reg-inp-photo-cam').click());
  $('btn-reg-photo-gal').addEventListener('click', () => $('reg-inp-photo-gal').click());
  async function handleRegPhoto(e) {
    const f=e.target.files[0]; if(!f) return;
    regImg = await compressImg(f);
    $('reg-img-preview').src=regImg; $('reg-img-preview').classList.remove('hidden');
    $('reg-img-ph').classList.add('hidden'); $('btn-reg-clear-photo').disabled=false;
    e.target.value='';
  }
  $('reg-inp-photo-cam').addEventListener('change', handleRegPhoto);
  $('reg-inp-photo-gal').addEventListener('change', handleRegPhoto);
  $('btn-reg-clear-photo').addEventListener('click', () => {
    regImg=null; $('reg-img-preview').src=''; $('reg-img-preview').classList.add('hidden');
    $('reg-img-ph').classList.remove('hidden'); $('btn-reg-clear-photo').disabled=true;
  });

  // save
  $('btn-reg-save').addEventListener('click', saveReg);
}

async function checkRegBarcode() {
  const bc = $('reg-barcode').value.trim();
  if (!bc) { $('reg-exists-warn').classList.add('hidden'); return; }
  const p = await DB.getProductByBarcode(bc);
  $('reg-exists-warn').classList.toggle('hidden', !p);
}

function updateRegCalc() {
  const pkgType = $('reg-pkg-type').value;
  const pkgQty  = parseInt($('reg-pkg-qty').value)||1;
  const qty     = $('reg-qty').value;
  const qtyType = $('reg-qty-type').value;
  renderCalc('reg-qty-calc', qty, qtyType, pkgType, pkgQty);
  $('reg-qty-calc-wrap').classList.toggle('hidden', !qty || parseInt(qty)<=0);
}

async function saveReg() {
  const barcode = $('reg-barcode').value.trim();
  const name    = $('reg-name').value.trim();

  if (!barcode) { toast('El código de barras es obligatorio','err'); return; }
  if (!name)    { toast('El nombre es obligatorio','err');           return; }

  const existing = await DB.getProductByBarcode(barcode);
  if (existing) { toast('Este código ya está registrado','err'); return; }

  const pkgType = $('reg-pkg-type').value;
  const pkgQty  = parseInt($('reg-pkg-qty').value)||1;
  const units   = calcUnits($('reg-qty').value, $('reg-qty-type').value, pkgType, pkgQty);

  if (units < 1) { toast('Ingresá al menos 1 unidad','err'); return; }

  $('btn-reg-save').disabled = true;

  try {
    const productId = await DB.addProduct({
      barcode, name,
      variant:  $('reg-variant').value.trim(),
      category: $('reg-cat').value,
      pkgType, pkgQty,
      image: regImg || null
    });

    await DB.addLot({
      productId, barcode, qty: units,
      expiry: $('reg-exp').value || null,
      price:  parseFloat($('reg-price').value) || null,
      notes:  ''
    });

    beep();
    const desc = $('reg-qty-type').value==='pkg' && pkgQty>1 && pkgType!=='unidad'
      ? `${$('reg-qty').value} ${pkgType}${parseInt($('reg-qty').value)!==1?'s':''}=${units}uds.`
      : `${units} uds.`;
    toast(`✓ ${name} registrado — ${desc}`,'ok');

    // reset form
    $('reg-barcode').value=''; $('reg-name').value=''; $('reg-variant').value='';
    $('reg-cat').selectedIndex=0; $('reg-pkg-type').selectedIndex=0; $('reg-pkg-qty').value=12;
    $('reg-pkg-qty-wrap').style.display='none';
    $('reg-qty').value=1; $('reg-qty-type').value='unit'; $('reg-exp').value=''; $('reg-price').value='';
    $('reg-exists-warn').classList.add('hidden');
    $('reg-qty-calc-wrap').classList.add('hidden');
    regImg=null; $('reg-img-preview').src=''; $('reg-img-preview').classList.add('hidden');
    $('reg-img-ph').classList.remove('hidden'); $('btn-reg-clear-photo').disabled=true;

    loadDep();
  } catch(err) {
    toast('Error al guardar','err');
    console.error(err);
  } finally {
    $('btn-reg-save').disabled = false;
  }
}

// ── RECEPCIÓN ─────────────────────────────────────────────────────

let recId = null, recProd = null, stopRecCam = null;

function initRec() {
  $('btn-rec-new').addEventListener('click', () => {
    $('rec-date').value = new Date().toISOString().split('T')[0];
    $('rec-supplier').value=''; $('rec-note').value='';
    // suggestions
    DB.getAllReceptions().then(recs => {
      const supp = [...new Set(recs.map(r=>r.supplier).filter(Boolean))];
      $('rec-suppliers-list').innerHTML = supp.map(s=>`<option value="${esc(s)}">`).join('');
    });
    $('rec-idle').classList.add('hidden'); $('rec-form').classList.remove('hidden');
  });
  $('btn-rec-cancel').addEventListener('click', () => {
    $('rec-form').classList.add('hidden'); $('rec-idle').classList.remove('hidden');
  });
  $('btn-rec-start').addEventListener('click', startRec);
  $('btn-rec-close').addEventListener('click', closeRec);
  $('btn-rec-hist').addEventListener('click', () => {
    $('rec-idle').classList.remove('hidden');
    $('rec-active').classList.add('hidden'); $('rec-closed').classList.add('hidden');
    if (stopRecCam) { stopRecCam(); stopRecCam=null; }
    loadRecHistory();
  });
  $('btn-rec-back').addEventListener('click', () => {
    $('rec-closed').classList.add('hidden'); $('rec-idle').classList.remove('hidden');
  });

  // scanner
  $('btn-rec-cam-start').addEventListener('click', () => {
    stopRecCam = startCam('rec-scan-video', 'rec-scan-status', code => handleRecScan(code));
    $('btn-rec-cam-start').classList.add('hidden'); $('btn-rec-cam-stop').classList.remove('hidden');
  });
  $('btn-rec-cam-stop').addEventListener('click', () => {
    if (stopRecCam) { stopRecCam(); stopRecCam=null; }
    $('btn-rec-cam-start').classList.remove('hidden'); $('btn-rec-cam-stop').classList.add('hidden');
  });
  $('btn-rec-scan-manual').addEventListener('click', () => {
    const v=$('rec-scan-inp').value.trim(); if(v) handleRecScan(v);
  });
  $('rec-scan-inp').addEventListener('keydown', e => {
    if(e.key==='Enter'){const v=$('rec-scan-inp').value.trim();if(v)handleRecScan(v);}
  });

  // product panel
  $('btn-rec-p-close').addEventListener('click', () => { $('rec-prod-panel').classList.add('hidden'); recProd=null; });
  ['rec-p-qty','rec-p-qty-type'].forEach(id => {
    $(id).addEventListener('input', updateRecCalc);
    $(id).addEventListener('change', updateRecCalc);
  });
  $('btn-rec-p-add').addEventListener('click', addRecItem);
}

async function startRec() {
  const supplier = $('rec-supplier').value.trim();
  if (!supplier) { toast('Ingresá el nombre del proveedor','err'); return; }
  $('btn-rec-start').disabled=true;
  recId = await DB.addReception({ supplier, date:$('rec-date').value, notes:$('rec-note').value.trim() });
  $('btn-rec-start').disabled=false;
  $('rec-form').classList.add('hidden');
  showRecActive(recId, supplier, $('rec-date').value);
}

function showRecActive(id, supplier, date) {
  recId = id;
  $('rec-active-name').textContent = supplier;
  $('rec-active-meta').textContent = fmt(date) + ' · Abierta';
  $('rec-idle').classList.add('hidden'); $('rec-form').classList.add('hidden'); $('rec-closed').classList.add('hidden');
  $('rec-active').classList.remove('hidden');
  $('rec-prod-panel').classList.add('hidden'); recProd=null;
  loadRecItems();
}

async function handleRecScan(barcode) {
  $('rec-scan-inp').value='';
  const p = await DB.getProductByBarcode(barcode);
  recProd = p || { barcode, name: barcode, variant:'', pkgType:'unidad', pkgQty:1, image:null, id:null };
  $('rec-p-avatar').innerHTML = p && p.image ? `<img src="${esc(p.image)}" alt=""/>` : esc(initials(recProd.name));
  $('rec-p-name').textContent = p ? p.name : 'No registrado';
  $('rec-p-code').textContent = barcode;
  $('rec-p-qty').value=1; $('rec-p-qty-type').value='unit';
  $('rec-p-exp').value=''; $('rec-p-price').value='';
  updateRecCalc();
  $('rec-prod-panel').classList.remove('hidden');
}

function updateRecCalc() {
  if (!recProd) return;
  renderCalc('rec-p-calc', $('rec-p-qty').value, $('rec-p-qty-type').value, recProd.pkgType, recProd.pkgQty||1);
  $('rec-p-calc').classList.toggle('hidden', !$('rec-p-qty').value || parseInt($('rec-p-qty').value)<=0);
}

async function addRecItem() {
  if (!recProd || !recId) return;
  const units = calcUnits($('rec-p-qty').value, $('rec-p-qty-type').value, recProd.pkgType, recProd.pkgQty||1);
  if (units < 1) { toast('Ingresá una cantidad válida','err'); return; }
  $('btn-rec-p-add').disabled=true;
  await DB.addRecItem({
    receptionId: recId, productId: recProd.id||null,
    barcode: recProd.barcode, productName: recProd.name,
    qty: units, pkgQty: parseInt($('rec-p-qty').value)||0,
    pkgType: $('rec-p-qty-type').value==='pkg' ? recProd.pkgType : 'unidad',
    expiry: $('rec-p-exp').value||null, price: parseFloat($('rec-p-price').value)||null
  });
  $('btn-rec-p-add').disabled=false;
  beep(); toast(`Agregado: ${recProd.name}`,'ok');
  $('rec-prod-panel').classList.add('hidden'); recProd=null;
  loadRecItems();
}

async function loadRecItems() {
  if (!recId) return;
  const items = await DB.getRecItemsByReception(recId);
  $('rec-count').textContent = items.length;

  const listEl = $('rec-items-list');
  if (items.length===0) { listEl.innerHTML='<div class="empty"><p>Escaneá un producto</p></div>'; $('rec-totals').classList.add('hidden'); return; }

  // group by barcode
  const groups = {};
  items.forEach(it => {
    if (!groups[it.barcode]) groups[it.barcode] = { ...it, qty:0, lines:[] };
    groups[it.barcode].qty += it.qty;
    groups[it.barcode].lines.push(it);
  });

  listEl.innerHTML = Object.values(groups).map(g => {
    const linesHtml = g.lines.map(it => {
      const pkgLabel = it.pkgType!=='unidad'&&it.pkgQty>1 ? `${it.pkgQty} ${it.pkgType}(s)=${it.qty}uds.` : `${it.qty}uds.`;
      return `<div style="font-size:11px;color:var(--text2);margin-top:2px">
        · ${pkgLabel}${it.expiry?' · vto '+fmt(it.expiry):''}${it.price?' · $'+it.price:''}
        <button class="ri-del" data-rid="${it.id}">✕</button>
      </div>`;
    }).join('');
    return `<div class="ri-row">
      <div class="ri-icon">${esc(initials(g.productName))}</div>
      <div class="ri-info"><div class="ri-name">${esc(g.productName)}</div>${linesHtml}</div>
      <div class="ri-right"><div class="ri-qty">${g.qty}</div><div class="ri-unit">uds.</div></div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.ri-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await DB.deleteRecItem(Number(btn.dataset.rid));
      loadRecItems();
    });
  });

  // totals
  const totalUnits = items.reduce((s,it)=>s+it.qty,0);
  let totalPrice=0, hasPrice=false;
  items.forEach(it => { if(it.price){totalPrice+=it.price*it.qty;hasPrice=true;} });
  $('rec-totals-body').innerHTML = `
    <div class="lot-row"><div class="lot-left">Ítems</div><div class="lot-right"><div class="lot-qty">${items.length}</div></div></div>
    <div class="lot-row"><div class="lot-left">Total unidades</div><div class="lot-right"><div class="lot-qty">${totalUnits}</div></div></div>
    ${hasPrice?`<div class="lot-row"><div class="lot-left">Costo total</div><div class="lot-right"><div class="lot-qty">$${totalPrice.toFixed(2)}</div></div></div>`:''}
  `;
  $('rec-totals').classList.remove('hidden');
}

async function closeRec() {
  if (!recId) return;
  const items = await DB.getRecItemsByReception(recId);
  if (items.length===0 && !confirm('La sesión está vacía. ¿Cerrarla?')) return;
  const addStock = confirm('¿Actualizar el stock del depósito?\n\nOK = Cerrar Y agregar al stock\nCancelar = Solo registrar');
  if (addStock) {
    for (const it of items) {
      if (!it.productId) continue;
      await DB.addLot({ productId:it.productId, barcode:it.barcode, qty:it.qty, expiry:it.expiry||null, price:it.price||null, notes:`Recepción #${recId}` });
    }
    toast('Recepción cerrada y stock actualizado','ok');
    loadDep();
  } else {
    toast('Recepción cerrada como registro','ok');
  }
  await DB.updateReception(recId, { status:'closed', closedAt: new Date().toISOString() });
  if (stopRecCam) { stopRecCam(); stopRecCam=null; }
  recId=null; recProd=null;
  $('rec-active').classList.add('hidden'); $('rec-idle').classList.remove('hidden');
  loadRecHistory();
}

async function loadRecHistory() {
  const all = await DB.getAllReceptions();
  const sorted = [...all].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20);
  const el = $('rec-hist-list');
  if (sorted.length===0) { el.innerHTML='<div class="empty"><p>Sin recepciones aún</p></div>'; return; }

  // count items per reception
  const counts = {};
  for (const r of sorted) {
    const items = await DB.getRecItemsByReception(r.id);
    counts[r.id] = items.length;
  }

  el.innerHTML = sorted.map(r => `
    <div class="prod-row" data-rid="${r.id}" data-status="${r.status}">
      <div class="prod-info">
        <div class="prod-name">${esc(r.supplier)}</div>
        <div class="prod-meta">${fmt(r.date)} · ${counts[r.id]||0} ítems</div>
      </div>
      <span class="badge ${r.status==='open'?'warn':'ok'}">${r.status==='open'?'Abierta':'Cerrada'}</span>
    </div>`).join('');

  el.querySelectorAll('.prod-row').forEach(row => {
    row.addEventListener('click', async () => {
      const rid = Number(row.dataset.rid);
      const status = row.dataset.status;
      const rec = sorted.find(r=>r.id===rid);
      if (!rec) return;
      if (status==='open') {
        showRecActive(rid, rec.supplier, rec.date);
      } else {
        showRecClosed(rec);
      }
    });
  });
}

async function showRecClosed(rec) {
  $('rec-idle').classList.add('hidden'); $('rec-active').classList.add('hidden');
  $('rec-closed-name').textContent = rec.supplier;
  $('rec-closed-meta').textContent = fmt(rec.date) + ' · Cerrada';
  const items = await DB.getRecItemsByReception(rec.id);
  const el = $('rec-closed-items');
  el.innerHTML = items.length===0
    ? '<div class="empty"><p>Sin ítems</p></div>'
    : items.map(it => `<div class="ri-row">
        <div class="ri-icon">${esc(initials(it.productName))}</div>
        <div class="ri-info"><div class="ri-name">${esc(it.productName)}</div>
          <div class="ri-meta">${it.qty}uds.${it.expiry?' · vto '+fmt(it.expiry):''}${it.price?' · $'+it.price:''}</div>
        </div>
        <div class="ri-right"><div class="ri-qty">${it.qty}</div><div class="ri-unit">uds.</div></div>
      </div>`).join('');
  const totalUnits = items.reduce((s,it)=>s+it.qty,0);
  $('rec-closed-totals').innerHTML = `<div class="lot-row"><div class="lot-left">Total unidades</div><div class="lot-right"><div class="lot-qty">${totalUnits}</div></div></div>`;
  $('rec-closed').classList.remove('hidden');
}

// ── CONTEO FÍSICO ─────────────────────────────────────────────────

let cntId=null, cntProd=null, stopCntCam=null;
let cntMap = {}; // barcode → { itemId, units, raw }

function initCnt() {
  $('btn-cnt-new').addEventListener('click', startCnt);
  $('btn-cnt-finish').addEventListener('click', showCntDiff);
  $('btn-cnt-diff-back').addEventListener('click', () => {
    $('cnt-diff').classList.add('hidden'); $('cnt-active').classList.remove('hidden');
  });
  $('btn-cnt-apply').addEventListener('click', applyCnt);
  $('btn-cnt-hist').addEventListener('click', () => {
    $('cnt-idle').classList.remove('hidden');
    $('cnt-active').classList.add('hidden'); $('cnt-diff').classList.add('hidden');
    if (stopCntCam) { stopCntCam(); stopCntCam=null; }
    loadCntHistory();
  });

  $('btn-cnt-cam-start').addEventListener('click', () => {
    stopCntCam = startCam('cnt-scan-video', 'cnt-scan-status', code => handleCntScan(code));
    $('btn-cnt-cam-start').classList.add('hidden'); $('btn-cnt-cam-stop').classList.remove('hidden');
  });
  $('btn-cnt-cam-stop').addEventListener('click', () => {
    if (stopCntCam) { stopCntCam(); stopCntCam=null; }
    $('btn-cnt-cam-start').classList.remove('hidden'); $('btn-cnt-cam-stop').classList.add('hidden');
  });
  $('btn-cnt-scan-manual').addEventListener('click', () => {
    const v=$('cnt-scan-inp').value.trim(); if(v) handleCntScan(v);
  });
  $('cnt-scan-inp').addEventListener('keydown', e => {
    if(e.key==='Enter'){const v=$('cnt-scan-inp').value.trim();if(v)handleCntScan(v);}
  });

  $('btn-cnt-p-close').addEventListener('click', () => { $('cnt-prod-panel').classList.add('hidden'); cntProd=null; });
  ['cnt-p-qty','cnt-p-qty-type'].forEach(id => {
    $(id).addEventListener('input', updateCntCalc);
    $(id).addEventListener('change', updateCntCalc);
  });
  $('btn-cnt-p-add').addEventListener('click', addCntItem);
}

async function startCnt() {
  const date = new Date().toISOString().split('T')[0];
  cntId = await DB.addConteo({ date, label:`Conteo ${fmt(date)}` });
  cntMap = {};
  $('cnt-title').textContent = `Conteo ${fmt(date)}`;
  $('cnt-meta').textContent  = 'En curso · 0 productos';
  $('cnt-idle').classList.add('hidden'); $('cnt-active').classList.remove('hidden'); $('cnt-diff').classList.add('hidden');
  $('cnt-prod-panel').classList.add('hidden'); cntProd=null;
  renderCntItems();
}

async function handleCntScan(barcode) {
  $('cnt-scan-inp').value='';
  const p = await DB.getProductByBarcode(barcode);
  cntProd = p || { barcode, name:barcode, variant:'', pkgType:'unidad', pkgQty:1, image:null, id:null };

  const lots = p ? await DB.getLotsByProduct(p.id) : [];
  const sys  = stockTotal(lots);

  $('cnt-p-avatar').innerHTML = p&&p.image ? `<img src="${esc(p.image)}" alt=""/>` : esc(initials(cntProd.name));
  $('cnt-p-name').textContent = p ? p.name : 'No registrado';
  $('cnt-p-code').textContent = barcode;
  $('cnt-sys-stock').textContent = p ? `Sistema: ${sys} unidades en stock` : 'Producto nuevo — se registrará al confirmar';

  const prev = cntMap[barcode];
  $('cnt-p-qty').value = prev ? prev.raw : 0;
  $('cnt-p-qty-type').value = 'unit';
  updateCntCalc();
  $('cnt-prod-panel').classList.remove('hidden');
}

function updateCntCalc() {
  if (!cntProd) return;
  renderCalc('cnt-p-calc', $('cnt-p-qty').value, $('cnt-p-qty-type').value, cntProd.pkgType, cntProd.pkgQty||1);
  $('cnt-p-calc').classList.toggle('hidden', !$('cnt-p-qty').value || parseInt($('cnt-p-qty').value)<=0);
}

async function addCntItem() {
  if (!cntProd || !cntId) return;
  const raw  = parseInt($('cnt-p-qty').value)||0;
  const type = $('cnt-p-qty-type').value;
  const units = calcUnits($('cnt-p-qty').value, type, cntProd.pkgType, cntProd.pkgQty||1);
  const bc = cntProd.barcode;

  $('btn-cnt-p-add').disabled=true;
  if (cntMap[bc]) {
    await DB.updateCntItem(cntMap[bc].itemId, { countedUnits:units, countedRaw:raw });
    cntMap[bc].units=units; cntMap[bc].raw=raw;
  } else {
    const id = await DB.addCntItem({ conteoId:cntId, productId:cntProd.id||null, barcode:bc, productName:cntProd.name, variant:cntProd.variant||'', pkgType:cntProd.pkgType||'unidad', countedUnits:units, countedRaw:raw });
    cntMap[bc] = { itemId:id, units, raw };
  }
  $('btn-cnt-p-add').disabled=false;
  beep(); toast(`${cntProd.name} — ${units} uds.`,'ok');
  $('cnt-prod-panel').classList.add('hidden'); cntProd=null;
  renderCntItems();
}

async function renderCntItems() {
  const items = await DB.getCntItemsByConteo(cntId);
  $('cnt-count').textContent = items.length;
  $('cnt-meta').textContent  = `En curso · ${items.length} productos contados`;
  const el = $('cnt-items-list');
  if (items.length===0) { el.innerHTML='<div class="empty"><p>Escaneá el primer producto</p></div>'; return; }
  el.innerHTML = items.sort((a,b)=>b.addedAt.localeCompare(a.addedAt)).map(it => `
    <div class="ri-row">
      <div class="ri-icon">${esc(initials(it.productName))}</div>
      <div class="ri-info">
        <div class="ri-name">${esc(it.productName)}</div>
        <div class="ri-meta">${it.countedUnits} uds.${it.countedRaw!==it.countedUnits?` (${it.countedRaw} paquetes)`:''}</div>
      </div>
      <div class="ri-right"><div class="ri-qty">${it.countedUnits}</div><div class="ri-unit">uds.</div></div>
    </div>`).join('');
  // update map
  cntMap={};
  items.forEach(it => { cntMap[it.barcode]={itemId:it.id,units:it.countedUnits,raw:it.countedRaw}; });
}

async function showCntDiff() {
  const items = await DB.getCntItemsByConteo(cntId);
  if (items.length===0) { toast('Escaneá al menos un producto','wrn'); return; }
  const inventory = await DB.getAllInventory();
  const sysMap={};
  inventory.forEach(p => { sysMap[p.barcode]={product:p, sys:stockTotal(p.lots)}; });
  const cntBarcodes = new Set(items.map(it=>it.barcode));

  const diffs = items
    .map(it => ({ it, sys:(sysMap[it.barcode]?.sys||0), diff:it.countedUnits-(sysMap[it.barcode]?.sys||0) }))
    .filter(d => d.diff!==0);

  const missing = inventory.filter(p => !cntBarcodes.has(p.barcode) && stockTotal(p.lots)>0);

  const gained=diffs.filter(d=>d.diff>0).length, lost=diffs.filter(d=>d.diff<0).length;
  $('cnt-diff-metrics').innerHTML=`
    <div class="metric"><div class="metric-lbl">Contados</div><div class="metric-val">${items.length}</div></div>
    <div class="metric"><div class="metric-lbl">Diferencias</div><div class="metric-val ${diffs.length>0?'amber':''}">${diffs.length}</div></div>
    <div class="metric"><div class="metric-lbl">Extra</div><div class="metric-val green">+${gained}</div></div>
    <div class="metric"><div class="metric-lbl">Faltante</div><div class="metric-val ${lost>0?'red':''}">-${lost}</div></div>`;
  $('cnt-diff-meta').textContent = `${items.length} productos · ${diffs.length} diferencias`;
  $('cnt-diff-badge').textContent = diffs.length;

  $('cnt-diff-list').innerHTML = diffs.length===0
    ? '<div class="empty"><p>Sin diferencias — el stock coincide</p></div>'
    : diffs.map(d => `<div class="ri-row">
        <div class="ri-icon">${esc(initials(d.it.productName))}</div>
        <div class="ri-info"><div class="ri-name">${esc(d.it.productName)}</div>
          <div class="ri-meta">Sistema: ${d.sys}uds → Conteo: ${d.it.countedUnits}uds</div>
        </div>
        <div class="ri-right" style="color:${d.diff>0?'var(--green)':'var(--red)'}">
          <div class="ri-qty">${d.diff>0?'+'+d.diff:d.diff}</div><div class="ri-unit">uds.</div>
        </div>
      </div>`).join('');

  $('cnt-missing-badge').textContent = missing.length;
  if (missing.length===0) { $('cnt-missing-card').classList.add('hidden'); }
  else {
    $('cnt-missing-card').classList.remove('hidden');
    $('cnt-missing-list').innerHTML = missing.map(p => `<div class="ri-row">
      <div class="ri-icon">${esc(initials(p.name))}</div>
      <div class="ri-info"><div class="ri-name">${esc(p.name)}</div>
        <div class="ri-meta">Sistema: ${stockTotal(p.lots)}uds → Se pondrá en 0</div>
      </div>
      <div class="ri-right" style="color:var(--red)"><div class="ri-qty">0</div><div class="ri-unit">uds.</div></div>
    </div>`).join('');
  }

  $('cnt-active').classList.add('hidden'); $('cnt-diff').classList.remove('hidden');
}

async function applyCnt() {
  $('btn-cnt-apply').disabled=true;
  const items = await DB.getCntItemsByConteo(cntId);
  const inventory = await DB.getAllInventory();
  const sysMap={}; inventory.forEach(p => { sysMap[p.barcode]=p; });
  const cntBarcodes = new Set(items.map(it=>it.barcode));

  for (const it of items) {
    let p = sysMap[it.barcode];
    if (!p) {
      await DB.addProduct({ barcode:it.barcode, name:it.productName, variant:it.variant||'', category:'Otros', pkgType:it.pkgType||'unidad', pkgQty:1 });
      p = await DB.getProductByBarcode(it.barcode);
    }
    if (!p) continue;
    const lots = await DB.getLotsByProduct(p.id);
    for (const l of lots) await DB.deleteLot(l.id);
    if (it.countedUnits>0) await DB.addLot({ productId:p.id, barcode:it.barcode, qty:it.countedUnits, expiry:null, price:null, notes:`Conteo #${cntId}` });
  }
  for (const p of inventory) {
    if (!cntBarcodes.has(p.barcode)) {
      const lots = await DB.getLotsByProduct(p.id);
      for (const l of lots) await DB.deleteLot(l.id);
    }
  }
  await DB.updateConteo(cntId, { status:'closed', closedAt:new Date().toISOString(), itemCount:items.length });

  $('btn-cnt-apply').disabled=false;
  if (stopCntCam) { stopCntCam(); stopCntCam=null; }
  cntId=null; cntProd=null; cntMap={};
  $('cnt-diff').classList.add('hidden'); $('cnt-idle').classList.remove('hidden');
  toast('Stock actualizado al conteo real','ok');
  loadCntHistory(); loadDep();
}

async function loadCntHistory() {
  const all = await DB.getAllConteos();
  const sorted=[...all].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,10);
  const el=$('cnt-hist-list');
  if (sorted.length===0) { el.innerHTML='<div class="empty"><p>Sin conteos aún</p></div>'; return; }
  el.innerHTML = sorted.map(c => `
    <div class="prod-row ${c.status==='open'?'cnt-open':''}">
      <div class="prod-info">
        <div class="prod-name">${esc(c.label||'Conteo')}</div>
        <div class="prod-meta">${fmt(c.date)} · ${c.itemCount||0} productos</div>
      </div>
      <span class="badge ${c.status==='open'?'warn':'ok'}">${c.status==='open'?'Abierto':'Cerrado'}</span>
    </div>`).join('');

  el.querySelectorAll('.cnt-open').forEach((row, i) => {
    const c = sorted.filter(x=>x.status==='open')[i];
    if (!c) return;
    row.addEventListener('click', async () => {
      cntId=c.id; cntMap={};
      $('cnt-idle').classList.add('hidden'); $('cnt-active').classList.remove('hidden');
      $('cnt-title').textContent=c.label||'Conteo';
      await renderCntItems();
    });
  });
}

// ── GÓNDOLA ───────────────────────────────────────────────────────

let gonList = [], gonProd = null, stopGonCam = null, gonCat = '';

function initGondola() {
  $('gon-search').addEventListener('input', runGonSearch);
  $('gon-cat-chips').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('gon-cat-chips').querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active'); gonCat=chip.dataset.cat;
      runGonSearch();
    });
  });

  $('btn-gon-scan').addEventListener('click', () => {
    if (!getDetector()) { toast('Cámara no disponible','wrn'); return; }
    const wrap=$('gon-cam-wrap');
    wrap.classList.toggle('hidden');
    if (!wrap.classList.contains('hidden')) {
      stopGonCam = startCam('gon-scan-video','gon-scan-status', code => {
        wrap.classList.add('hidden');
        if(stopGonCam){stopGonCam();stopGonCam=null;}
        handleGonScan(code);
      });
    } else {
      if(stopGonCam){stopGonCam();stopGonCam=null;}
    }
  });
  $('btn-gon-cam-stop').addEventListener('click', () => {
    $('gon-cam-wrap').classList.add('hidden');
    if(stopGonCam){stopGonCam();stopGonCam=null;}
  });

  $('btn-gon-share').addEventListener('click', shareGonList);
  $('btn-gon-clear').addEventListener('click', () => {
    if(!confirm('¿Vaciar la lista?')) return;
    gonList=[]; renderGonList(); runGonSearch();
  });

  // sheet
  $('btn-gsh-close').addEventListener('click', () => { $('gon-sheet-bg').classList.add('hidden'); document.body.style.overflow=''; gonProd=null; });
  $('gon-sheet-bg').addEventListener('click', e => { if(e.target===$('gon-sheet-bg')){$('gon-sheet-bg').classList.add('hidden');document.body.style.overflow='';gonProd=null;} });
  ['gsh-qty','gsh-qty-type'].forEach(id => { $(id).addEventListener('input',updateGshCalc); $(id).addEventListener('change',updateGshCalc); });
  $('btn-gsh-add').addEventListener('click', addToGonList);
}

async function handleGonScan(barcode) {
  const data = await DB.getProductWithLots(barcode);
  if (!data) { toast('Producto no registrado','wrn'); return; }
  openGonSheet(data.product, data.lots);
}

async function runGonSearch() {
  const q = $('gon-search').value.trim().toLowerCase();
  if (!q && !gonCat) { $('gon-welcome').classList.remove('hidden'); $('gon-results').classList.add('hidden'); return; }
  $('gon-welcome').classList.add('hidden');

  const inventory = await DB.getAllInventory();
  const filtered = inventory.filter(p => {
    const mn = !q || p.name.toLowerCase().includes(q) || (p.variant||'').toLowerCase().includes(q) || p.barcode.includes(q);
    const mc = !gonCat || p.category===gonCat;
    return mn && mc;
  }).sort((a,b) => {
    const as=stockTotal(a.lots), bs=stockTotal(b.lots);
    if(as>0&&bs===0) return -1; if(as===0&&bs>0) return 1;
    return a.name.localeCompare(b.name);
  });

  const card = $('gon-results-card');
  if (filtered.length===0) { card.innerHTML='<div class="empty"><p>Sin resultados</p></div>'; $('gon-results').classList.remove('hidden'); return; }

  card.innerHTML = filtered.map(p => {
    const total  = stockTotal(p.lots);
    const inList = gonList.some(i=>i.barcode===p.barcode);
    const lotsE  = p.lots.filter(l=>l.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry));
    const next   = lotsE[0]; const days = next?daysLeft(next.expiry):null;
    const stockColor = total===0?'color:var(--amber)':days!==null&&days<0?'color:var(--red)':'';
    const pkg = pkgBreak(total, p.pkgType, p.pkgQty||1);
    const pkgTxt = pkg&&pkg.full>0?`${pkg.full} ${pkg.pkgType}${pkg.full!==1?'s':''}${pkg.rem>0?` + ${pkg.rem}`:''}`:'';
    const expTxt = next ? `vto: ${fmt(next.expiry)}${days!==null&&days<0?' (VENCIDO)':days!==null&&days<=7?` (${days}d)`:''}` : '';
    return `<div class="gon-prod-card">
      <div class="gon-prod-head">
        <div class="avatar" style="width:36px;height:36px;font-size:11px">${p.image?`<img src="${esc(p.image)}" alt=""/>`:esc(initials(p.name))}</div>
        <div style="flex:1;min-width:0">
          <div class="gon-prod-name">${esc(p.name)}${p.variant?` <span style="font-weight:400;color:var(--text2)">— ${esc(p.variant)}</span>`:''}</div>
          <div class="gon-prod-meta">${esc(p.category||'')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:22px;font-weight:800;line-height:1;${stockColor}">${total}</div>
          <div style="font-size:11px;color:var(--text2)">uds.</div>
        </div>
      </div>
      ${pkgTxt||expTxt?`<div style="font-size:12px;color:var(--text2);margin:0 0 .5rem;padding-left:46px">${pkgTxt}${pkgTxt&&expTxt?' · ':''}${expTxt}</div>`:''}
      <div style="padding-left:46px">
        <button class="gon-add-btn ${inList?'in-list':''}" data-pid="${p.id}">${inList?'✓ En la lista':total===0?'Sin stock — agregar igual':'Agregar a lista'}</button>
      </div>
    </div>`;
  }).join('');

  card.querySelectorAll('.gon-add-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = Number(btn.dataset.pid);
      const p   = filtered.find(x=>x.id===pid);
      if (p) openGonSheet(p, p.lots);
    });
  });
  $('gon-results').classList.remove('hidden');
}

function openGonSheet(product, lots) {
  gonProd = { product, lots };
  $('gsh-avatar').innerHTML = product.image ? `<img src="${esc(product.image)}" alt=""/>` : esc(initials(product.name));
  $('gsh-name').textContent    = product.name;
  $('gsh-variant').textContent = product.variant||'';
  $('gsh-variant').style.display = product.variant?'block':'none';
  const total = stockTotal(lots);
  const pkg   = pkgBreak(total, product.pkgType, product.pkgQty||1);
  const next  = lots.filter(l=>l.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];
  const days  = next?daysLeft(next.expiry):null;
  let info    = `${total} uds. en depósito`;
  if (pkg&&pkg.full>0) info += ` (${pkg.full} ${product.pkgType}${pkg.full!==1?'s':''}${pkg.rem>0?` + ${pkg.rem}`:''})`;
  if (next) info += ` · vto ${fmt(next.expiry)}${days!==null?` (${days<0?'VENCIDO':`${days}d`})`:''}`;
  $('gsh-stock-info').textContent = info;
  $('gsh-qty').value=1; $('gsh-qty-type').value='unit'; $('gsh-note').value='';
  $('gsh-calc').classList.add('hidden');
  updateGshCalc();
  $('gon-sheet-bg').classList.remove('hidden'); document.body.style.overflow='hidden';
}

function updateGshCalc() {
  if (!gonProd) return;
  const {product}=gonProd;
  renderCalc('gsh-calc',$('gsh-qty').value,$('gsh-qty-type').value,product.pkgType,product.pkgQty||1);
  $('gsh-calc').classList.toggle('hidden',!$('gsh-qty').value||parseInt($('gsh-qty').value)<=0);
}

function addToGonList() {
  if (!gonProd) return;
  const {product,lots}=gonProd;
  const raw  = parseInt($('gsh-qty').value)||0;
  const type = $('gsh-qty-type').value;
  const units = calcUnits($('gsh-qty').value, type, product.pkgType, product.pkgQty||1);
  if (units<1) { toast('Ingresá una cantidad válida','err'); return; }
  gonList = gonList.filter(i=>i.barcode!==product.barcode);
  const next = lots.filter(l=>l.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];
  gonList.push({ barcode:product.barcode, name:product.name, variant:product.variant||'', image:product.image||null, pkgType:product.pkgType||'unidad', pkgQty:product.pkgQty||1, raw, units, type, note:$('gsh-note').value.trim(), sysStock:stockTotal(lots), nextExp:next?.expiry||null });
  beep(); toast(`${product.name} → lista`,'ok');
  $('gon-sheet-bg').classList.add('hidden'); document.body.style.overflow=''; gonProd=null;
  renderGonList(); runGonSearch();
}

function renderGonList() {
  const sec=$('gon-list-section'), card=$('gon-list-card');
  const share=$('btn-gon-share'), clear=$('btn-gon-clear');
  if (gonList.length===0) { sec.classList.add('hidden'); share.classList.add('hidden'); clear.classList.add('hidden'); return; }
  sec.classList.remove('hidden'); share.classList.remove('hidden'); clear.classList.remove('hidden');
  $('gon-list-badge').textContent=`${gonList.length} ítems`;
  card.innerHTML = gonList.map((it,i) => {
    const pkgDesc = it.type==='pkg'&&it.pkgQty>1&&it.pkgType!=='unidad'
      ? `${it.raw} ${it.pkgType}${it.raw!==1?'s':''}=${it.units}uds.`
      : `${it.units}uds.`;
    return `<div class="gon-list-row">
      <div class="avatar" style="width:36px;height:36px;font-size:11px;flex-shrink:0">${it.image?`<img src="${esc(it.image)}" alt=""/>`:esc(initials(it.name))}</div>
      <div class="gon-list-info">
        <div class="gon-list-name">${esc(it.name)}${it.variant?` <span style="font-weight:400;color:var(--text2)">— ${esc(it.variant)}</span>`:''}</div>
        <div class="gon-list-meta">${pkgDesc} · Dep: ${it.sysStock}uds.${it.nextExp?' · vto '+fmt(it.nextExp):''}</div>
        ${it.note?`<div style="font-size:11px;color:var(--text2);font-style:italic">${esc(it.note)}</div>`:''}
      </div>
      <div class="gon-list-right">
        <div class="gon-list-qty">${it.units}</div>
        <div class="gon-list-unit">uds.</div>
        <button class="gon-del" data-i="${i}">✕</button>
      </div>
    </div>`;
  }).join('');
  card.querySelectorAll('.gon-del').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); gonList.splice(Number(btn.dataset.i),1); renderGonList(); runGonSearch(); });
  });
}

function shareGonList() {
  if (!gonList.length) return;
  const date = new Date().toLocaleDateString('es-AR');
  const lines = [`*Lista de reposición — ${date}*`, ''];
  gonList.forEach((it,i) => {
    const pd = it.type==='pkg'&&it.pkgQty>1&&it.pkgType!=='unidad' ? `${it.raw} ${it.pkgType}${it.raw!==1?'s':''}` : `${it.units}uds.`;
    lines.push(`${i+1}. ${it.name}${it.variant?' — '+it.variant:''}: *${pd}*${it.note?' ('+it.note+')':''}`);
  });
  const text = lines.join('\n');
  if (navigator.share) navigator.share({text}).catch(()=>{});
  else navigator.clipboard.writeText(text).then(()=>toast('Lista copiada','ok')).catch(()=>window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank'));
}

// ── MÁS ───────────────────────────────────────────────────────────

function initMas() {
  $('btn-go-reg').addEventListener('click', () => goTo('reg'));
  $('btn-backup').addEventListener('click', doBackup);
  $('btn-restore').addEventListener('click', () => { $('inp-restore').value=''; $('inp-restore').click(); });
  $('inp-restore').addEventListener('change', e => doRestore(e.target.files[0]));
  $('btn-csv').addEventListener('click', doCSV);
}

async function doBackup() {
  const data = await DB.exportBackup();
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=`stockcontrol-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast(`Backup exportado — ${data.products.length} productos`,'ok');
}

async function doRestore(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.products||!data.lots) { toast('Archivo inválido','err'); return; }
    if (!confirm(`¿Restaurar?\n\n${data.products.length} productos\n${data.lots.length} lotes\n\n⚠️ Reemplaza TODO.`)) return;
    await DB.restoreBackup(data);
    toast('Backup restaurado','ok');
    loadDep();
  } catch(e) { toast('Error al procesar el archivo','err'); }
}

async function doCSV() {
  const inv = await DB.getAllInventory();
  const rows = [['Producto','Variante','Código','Categoría','Tipo paquete','Uds/paquete','Cantidad','Vencimiento','Precio','Fecha ingreso']];
  inv.forEach(p => {
    if (p.lots.length===0) rows.push([p.name,p.variant||'',p.barcode,p.category,p.pkgType||'',p.pkgQty||1,'','','','']);
    else p.lots.forEach(l => rows.push([p.name,p.variant||'',p.barcode,p.category,p.pkgType||'',p.pkgQty||1,l.qty||'',l.expiry||'',l.price||'',l.enteredAt?l.enteredAt.split('T')[0]:'']));
  });
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download='inventario.csv'; a.click(); URL.revokeObjectURL(url);
}

// ── Boot ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initScan();
  initDep();
  initSheet();
  initReg();
  initRec();
  initCnt();
  initGondola();
  initMas();
  loadDep();
});
