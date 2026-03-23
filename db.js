/**
 * db.js — StockControl v4
 *
 * Stores:
 *  products     { id, barcode, name, variant, category, pkgType, pkgQty, image, createdAt }
 *  lots         { id, productId, barcode, qty, expiry, price, notes, enteredAt }
 *  withdrawals  { id, productId, barcode, qty, pkgQty, pkgType, reason, withdrawnAt }
 *  receptions   { id, supplier, date, status:'open'|'closed', notes, createdAt, closedAt }
 *  rec_items    { id, receptionId, productId, barcode, productName, qty, pkgQty, pkgType, expiry, price, addedAt }
 */

const DB_NAME = 'stockcontrol_v5';
const DB_VER  = 1;
let _db = null;

function openDB() {
  return new Promise((res, rej) => {
    if (_db) return res(_db);
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = e => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('products')) {
        const ps = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        ps.createIndex('barcode', 'barcode', { unique: true });
        ps.createIndex('category', 'category');
      }

      if (!db.objectStoreNames.contains('lots')) {
        const ls = db.createObjectStore('lots', { keyPath: 'id', autoIncrement: true });
        ls.createIndex('productId', 'productId');
        ls.createIndex('expiry', 'expiry');
      }

      if (!db.objectStoreNames.contains('withdrawals')) {
        const ws = db.createObjectStore('withdrawals', { keyPath: 'id', autoIncrement: true });
        ws.createIndex('productId', 'productId');
        ws.createIndex('withdrawnAt', 'withdrawnAt');
      }

      if (!db.objectStoreNames.contains('conteos')) {
        const cs = db.createObjectStore('conteos', { keyPath: 'id', autoIncrement: true });
        cs.createIndex('date', 'date');
        cs.createIndex('status', 'status');
      }

      if (!db.objectStoreNames.contains('conteo_items')) {
        const ci = db.createObjectStore('conteo_items', { keyPath: 'id', autoIncrement: true });
        ci.createIndex('conteoId', 'conteoId');
        ci.createIndex('productId', 'productId');
      }
        const rs = db.createObjectStore('receptions', { keyPath: 'id', autoIncrement: true });
        rs.createIndex('date', 'date');
        rs.createIndex('status', 'status');
      }

      if (!db.objectStoreNames.contains('rec_items')) {
        const ri = db.createObjectStore('rec_items', { keyPath: 'id', autoIncrement: true });
        ri.createIndex('receptionId', 'receptionId');
        ri.createIndex('productId', 'productId');
      }
    };

    req.onsuccess = e => { _db = e.target.result; res(_db); };
    req.onerror   = e => rej(e.target.error);
  });
}

function getAll(store) {
  return openDB().then(db => new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  }));
}

const DB = {

  // ── Products ──────────────────────────────────────────────────

  getByBarcode(barcode) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('products','readonly')
        .objectStore('products').index('barcode').get(barcode);
      req.onsuccess = () => res(req.result || null);
      req.onerror   = () => rej(req.error);
    }));
  },

  getAllProducts() { return getAll('products'); },

  addProduct(data) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('products','readwrite')
        .objectStore('products')
        .add({ image: null, ...data, createdAt: new Date().toISOString() });
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  },

  updateProduct(id, data) {
    return openDB().then(db => new Promise((res, rej) => {
      const store = db.transaction('products','readwrite').objectStore('products');
      const get = store.get(id);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...data });
        put.onsuccess = () => res();
        put.onerror   = () => rej(put.error);
      };
    }));
  },

  // ── Lots ──────────────────────────────────────────────────────

  getAllLots() { return getAll('lots'); },

  getLotsByProduct(productId) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('lots','readonly')
        .objectStore('lots').index('productId').getAll(productId);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  },

  addLot(data) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('lots','readwrite')
        .objectStore('lots')
        .add({ ...data, enteredAt: new Date().toISOString() });
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  },

  deleteLot(id) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('lots','readwrite').objectStore('lots').delete(id);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    }));
  },

  updateLot(id, data) {
    return openDB().then(db => new Promise((res, rej) => {
      const store = db.transaction('lots','readwrite').objectStore('lots');
      const get   = store.get(id);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...data });
        put.onsuccess = () => res();
        put.onerror   = () => rej(put.error);
      };
      get.onerror = () => rej(get.error);
    }));
  },

  // ── Withdrawals ───────────────────────────────────────────────

  getAllWithdrawals() { return getAll('withdrawals'); },

  getWithdrawalsByProduct(productId) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('withdrawals','readonly')
        .objectStore('withdrawals').index('productId').getAll(productId);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  },

  addWithdrawal(data) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('withdrawals','readwrite')
        .objectStore('withdrawals')
        .add({ ...data, withdrawnAt: new Date().toISOString() });
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  },

  // ── Receptions ────────────────────────────────────────────────

  getAllReceptions() { return getAll('receptions'); },

  getReception(id) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('receptions','readonly').objectStore('receptions').get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror   = () => rej(req.error);
    }));
  },

  addReception(data) {
    // data: { supplier, date, notes }
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('receptions','readwrite')
        .objectStore('receptions')
        .add({ ...data, status: 'open', createdAt: new Date().toISOString(), closedAt: null });
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  },

  updateReception(id, data) {
    return openDB().then(db => new Promise((res, rej) => {
      const store = db.transaction('receptions','readwrite').objectStore('receptions');
      const get = store.get(id);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...data });
        put.onsuccess = () => res();
        put.onerror   = () => rej(put.error);
      };
    }));
  },

  // ── Reception Items ───────────────────────────────────────────

  getItemsByReception(receptionId) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('rec_items','readonly')
        .objectStore('rec_items').index('receptionId').getAll(receptionId);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  },

  addRecItem(data) {
    // data: { receptionId, productId, barcode, productName, qty, pkgQty, pkgType, expiry, price }
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('rec_items','readwrite')
        .objectStore('rec_items')
        .add({ ...data, addedAt: new Date().toISOString() });
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  },

  deleteRecItem(id) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('rec_items','readwrite').objectStore('rec_items').delete(id);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    }));
  },

  // ── Combined ──────────────────────────────────────────────────

  async getProductWithLots(barcode) {
    const product = await DB.getByBarcode(barcode);
    if (!product) return null;
    const lots = await DB.getLotsByProduct(product.id);
    return { product, lots };
  },

  async getAllInventory() {
    const [products, lots] = await Promise.all([DB.getAllProducts(), DB.getAllLots()]);
    const map = {};
    lots.forEach(l => { (map[l.productId] = map[l.productId] || []).push(l); });
    return products.map(p => ({ ...p, lots: map[p.id] || [] }));
  },

  async getExpiryReport(daysAhead) {
    const [products, lots] = await Promise.all([DB.getAllProducts(), DB.getAllLots()]);
    const pMap = {};
    products.forEach(p => pMap[p.id] = p);
    const today = new Date(); today.setHours(0,0,0,0);

    return lots
      .filter(l => {
        if (!l.expiry) return daysAhead === 9999;
        const diff = Math.floor((new Date(l.expiry+'T00:00:00') - today) / 86400000);
        if (daysAhead === 0)    return diff < 0;
        if (daysAhead === 9999) return true;
        return diff >= 0 && diff <= daysAhead;
      })
      .map(l => {
        const diff = l.expiry
          ? Math.floor((new Date(l.expiry+'T00:00:00') - today) / 86400000)
          : null;
        return { ...l, product: pMap[l.productId] || {}, daysLeft: diff };
      })
      .sort((a,b) => {
        if (a.daysLeft === null) return 1;
        if (b.daysLeft === null) return -1;
        return a.daysLeft - b.daysLeft;
      });
  },

  // ── Conteos ───────────────────────────────────────────────────

  getAllConteos() { return getAll('conteos'); },

  getConteo(id) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('conteos','readonly').objectStore('conteos').get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror   = () => rej(req.error);
    }));
  },

  addConteo(data) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('conteos','readwrite').objectStore('conteos')
        .add({ ...data, status: 'open', createdAt: new Date().toISOString(), closedAt: null });
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  },

  updateConteo(id, data) {
    return openDB().then(db => new Promise((res, rej) => {
      const store = db.transaction('conteos','readwrite').objectStore('conteos');
      const get = store.get(id);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...data });
        put.onsuccess = () => res(); put.onerror = () => rej(put.error);
      };
    }));
  },

  getConteoItems(conteoId) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('conteo_items','readonly')
        .objectStore('conteo_items').index('conteoId').getAll(conteoId);
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    }));
  },

  addConteoItem(data) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('conteo_items','readwrite').objectStore('conteo_items')
        .add({ ...data, addedAt: new Date().toISOString() });
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    }));
  },

  updateConteoItem(id, data) {
    return openDB().then(db => new Promise((res, rej) => {
      const store = db.transaction('conteo_items','readwrite').objectStore('conteo_items');
      const get = store.get(id);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...data });
        put.onsuccess = () => res(); put.onerror = () => rej(put.error);
      };
    }));
  },

  deleteConteoItem(id) {
    return openDB().then(db => new Promise((res, rej) => {
      const req = db.transaction('conteo_items','readwrite').objectStore('conteo_items').delete(id);
      req.onsuccess = () => res(); req.onerror = () => rej(req.error);
    }));
  },

  // ── Backup / Restore ──────────────────────────────────────────

  async exportBackup() {
    const [products, lots, withdrawals, receptions, rec_items, conteos, conteo_items] = await Promise.all([
      DB.getAllProducts(), DB.getAllLots(), DB.getAllWithdrawals(),
      DB.getAllReceptions(), getAll('rec_items'),
      DB.getAllConteos(), getAll('conteo_items')
    ]);
    return { version: 5, exportedAt: new Date().toISOString(), products, lots, withdrawals, receptions, rec_items, conteos, conteo_items };
  },

  restoreBackup(data) {
    return openDB().then(db => new Promise((res, rej) => {
      const stores = ['products','lots','withdrawals','receptions','rec_items','conteos','conteo_items'];
      const tx = db.transaction(stores, 'readwrite');
      stores.forEach(s => tx.objectStore(s).clear());
      (data.products     || []).forEach(r => tx.objectStore('products').put(r));
      (data.lots         || []).forEach(r => tx.objectStore('lots').put(r));
      (data.withdrawals  || []).forEach(r => tx.objectStore('withdrawals').put(r));
      (data.receptions   || []).forEach(r => tx.objectStore('receptions').put(r));
      (data.rec_items    || []).forEach(r => tx.objectStore('rec_items').put(r));
      (data.conteos      || []).forEach(r => tx.objectStore('conteos').put(r));
      (data.conteo_items || []).forEach(r => tx.objectStore('conteo_items').put(r));
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    }));
  }
};

window.DB = DB;
