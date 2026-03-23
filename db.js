/**
 * db.js — StockControl
 * Base: stockcontrol6  version 1
 * Stores: products, lots, withdrawals, receptions, rec_items, conteos, cnt_items
 */

const DB_NAME = 'stockcontrol6';
const DB_VER  = 1;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('products')) {
        const s = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        s.createIndex('barcode', 'barcode', { unique: true });
      }
      if (!db.objectStoreNames.contains('lots')) {
        const s = db.createObjectStore('lots', { keyPath: 'id', autoIncrement: true });
        s.createIndex('productId', 'productId');
      }
      if (!db.objectStoreNames.contains('withdrawals')) {
        const s = db.createObjectStore('withdrawals', { keyPath: 'id', autoIncrement: true });
        s.createIndex('productId', 'productId');
      }
      if (!db.objectStoreNames.contains('receptions')) {
        db.createObjectStore('receptions', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('rec_items')) {
        const s = db.createObjectStore('rec_items', { keyPath: 'id', autoIncrement: true });
        s.createIndex('receptionId', 'receptionId');
      }
      if (!db.objectStoreNames.contains('conteos')) {
        db.createObjectStore('conteos', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('cnt_items')) {
        const s = db.createObjectStore('cnt_items', { keyPath: 'id', autoIncrement: true });
        s.createIndex('conteoId', 'conteoId');
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function tx(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const s = t.objectStore(storeName);
    const req = fn(s);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function getAll(storeName) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function getByIndex(storeName, indexName, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly')
      .objectStore(storeName).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

const DB = {

  // ── Products ─────────────────────────────────────────────────

  getProductByBarcode(barcode) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const req = db.transaction('products', 'readonly')
        .objectStore('products').index('barcode').get(barcode);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    }));
  },

  getAllProducts() { return getAll('products'); },

  addProduct(data) {
    return tx('products', 'readwrite', s =>
      s.add({ image: null, ...data, createdAt: new Date().toISOString() })
    );
  },

  updateProduct(id, patch) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const store = db.transaction('products', 'readwrite').objectStore('products');
      const get = store.get(id);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...patch });
        put.onsuccess = () => resolve();
        put.onerror   = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    }));
  },

  // ── Lots ─────────────────────────────────────────────────────

  getLotsByProduct(productId) { return getByIndex('lots', 'productId', productId); },
  getAllLots()                 { return getAll('lots'); },

  addLot(data) {
    return tx('lots', 'readwrite', s =>
      s.add({ ...data, enteredAt: new Date().toISOString() })
    );
  },

  updateLot(id, patch) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const store = db.transaction('lots', 'readwrite').objectStore('lots');
      const get = store.get(id);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...patch });
        put.onsuccess = () => resolve();
        put.onerror   = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    }));
  },

  deleteLot(id) {
    return tx('lots', 'readwrite', s => s.delete(id));
  },

  // ── Withdrawals ───────────────────────────────────────────────

  getAllWithdrawals()              { return getAll('withdrawals'); },
  getWithdrawalsByProduct(pid)    { return getByIndex('withdrawals', 'productId', pid); },

  addWithdrawal(data) {
    return tx('withdrawals', 'readwrite', s =>
      s.add({ ...data, withdrawnAt: new Date().toISOString() })
    );
  },

  // ── Composed helpers ─────────────────────────────────────────

  async getProductWithLots(barcode) {
    const product = await DB.getProductByBarcode(barcode);
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
    products.forEach(p => { pMap[p.id] = p; });
    const today = new Date(); today.setHours(0, 0, 0, 0);

    return lots
      .map(l => {
        const diff = l.expiry
          ? Math.floor((new Date(l.expiry + 'T00:00:00') - today) / 86400000)
          : null;
        return { ...l, product: pMap[l.productId] || {}, daysLeft: diff };
      })
      .filter(l => {
        if (daysAhead === 9999) return true;
        if (daysAhead === 0) return l.daysLeft !== null && l.daysLeft < 0;
        return l.daysLeft !== null && l.daysLeft >= 0 && l.daysLeft <= daysAhead;
      })
      .sort((a, b) => {
        if (a.daysLeft === null) return 1;
        if (b.daysLeft === null) return -1;
        return a.daysLeft - b.daysLeft;
      });
  },

  // ── Receptions ───────────────────────────────────────────────

  getAllReceptions()           { return getAll('receptions'); },
  getRecItemsByReception(rid) { return getByIndex('rec_items', 'receptionId', rid); },

  addReception(data) {
    return tx('receptions', 'readwrite', s =>
      s.add({ ...data, status: 'open', createdAt: new Date().toISOString(), closedAt: null })
    );
  },

  updateReception(id, patch) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const store = db.transaction('receptions', 'readwrite').objectStore('receptions');
      const get = store.get(id);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...patch });
        put.onsuccess = () => resolve();
        put.onerror   = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    }));
  },

  addRecItem(data) {
    return tx('rec_items', 'readwrite', s =>
      s.add({ ...data, addedAt: new Date().toISOString() })
    );
  },

  deleteRecItem(id) {
    return tx('rec_items', 'readwrite', s => s.delete(id));
  },

  // ── Conteos ───────────────────────────────────────────────────

  getAllConteos()              { return getAll('conteos'); },
  getCntItemsByConteo(cid)    { return getByIndex('cnt_items', 'conteoId', cid); },

  addConteo(data) {
    return tx('conteos', 'readwrite', s =>
      s.add({ ...data, status: 'open', createdAt: new Date().toISOString(), closedAt: null })
    );
  },

  updateConteo(id, patch) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const store = db.transaction('conteos', 'readwrite').objectStore('conteos');
      const get = store.get(id);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...patch });
        put.onsuccess = () => resolve();
        put.onerror   = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    }));
  },

  addCntItem(data) {
    return tx('cnt_items', 'readwrite', s =>
      s.add({ ...data, addedAt: new Date().toISOString() })
    );
  },

  updateCntItem(id, patch) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const store = db.transaction('cnt_items', 'readwrite').objectStore('cnt_items');
      const get = store.get(id);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...patch });
        put.onsuccess = () => resolve();
        put.onerror   = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    }));
  },

  // ── Backup ───────────────────────────────────────────────────

  async exportBackup() {
    const [products, lots, withdrawals, receptions, rec_items, conteos, cnt_items] =
      await Promise.all([
        getAll('products'), getAll('lots'), getAll('withdrawals'),
        getAll('receptions'), getAll('rec_items'), getAll('conteos'), getAll('cnt_items')
      ]);
    return { v: 6, at: new Date().toISOString(), products, lots, withdrawals, receptions, rec_items, conteos, cnt_items };
  },

  async restoreBackup(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const stores = ['products', 'lots', 'withdrawals', 'receptions', 'rec_items', 'conteos', 'cnt_items'];
      const t = db.transaction(stores, 'readwrite');
      stores.forEach(s => t.objectStore(s).clear());
      (data.products    || []).forEach(r => t.objectStore('products').put(r));
      (data.lots        || []).forEach(r => t.objectStore('lots').put(r));
      (data.withdrawals || []).forEach(r => t.objectStore('withdrawals').put(r));
      (data.receptions  || []).forEach(r => t.objectStore('receptions').put(r));
      (data.rec_items   || []).forEach(r => t.objectStore('rec_items').put(r));
      (data.conteos     || []).forEach(r => t.objectStore('conteos').put(r));
      (data.cnt_items   || []).forEach(r => t.objectStore('cnt_items').put(r));
      t.oncomplete = () => resolve();
      t.onerror    = () => reject(t.error);
    });
  }
};

window.DB = DB;
