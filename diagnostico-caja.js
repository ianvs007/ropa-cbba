/**
 * 🔍 DIAGNÓSTICO DE CIERRE DE CAJA — ejecutar en la consola del navegador (F12)
 * con la app abierta en el entorno de DESARROLLO (el que ya tiene la BD de producción).
 *
 * Qué hace:
 *  - Abre la IndexedDB 'TiendaRopa_Database' en modo solo lectura.
 *  - Extrae los datos relevantes del cierre de caja (sin tocar nada).
 *  - Descarga un archivo 'diagnostico_caja.json'.
 *
 * Instrucciones:
 *  1. Abre la app en el navegador (entorno dev con la BD de producción).
 *  2. F12 → pestaña "Consola".
 *  3. Copia TODO este archivo, pégalo en la consola y presiona Enter.
 *  4. Se descargará 'diagnostico_caja.json'. Guárdalo/muévelo a la carpeta del proyecto.
 */
(async () => {
    const DB_NAME = 'TiendaRopa_Database';

    const readStore = (db, name) => new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains(name)) return resolve({ missing: true, rows: [] });
        const tx = db.transaction(name, 'readonly');
        const req = tx.objectStore(name).getAll();
        req.onsuccess = () => resolve({ missing: false, rows: req.result });
        req.onerror = () => reject(req.error);
    });

    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    console.log('%c[diagnóstico] BD abierta, versión ' + db.version, 'color:green');

    const [sales, payments, expenses, closures, openings, users, history] = await Promise.all([
        readStore(db, 'sales'),
        readStore(db, 'reservationPayments'),
        readStore(db, 'expenses'),
        readStore(db, 'cashClosures'),
        readStore(db, 'cashOpenings'),
        readStore(db, 'users'),
        readStore(db, 'cashClosureHistory'),
    ]);

    const pick = (rows, fields) => rows.map(r => {
        const o = {};
        fields.forEach(f => { if (r[f] !== undefined) o[f] = r[f]; });
        return o;
    });

    const out = {
        exportedAt: new Date().toISOString(),
        localToday: new Date().toLocaleDateString('sv'), // YYYY-MM-DD local del PC
        dbVersion: db.version,
        stores: {
            sales: sales.missing ? 'AUSENTE' : sales.rows.length,
            reservationPayments: payments.missing ? 'AUSENTE' : payments.rows.length,
            expenses: expenses.missing ? 'AUSENTE' : expenses.rows.length,
            cashClosures: closures.missing ? 'AUSENTE' : closures.rows.length,
            cashOpenings: openings.missing ? 'AUSENTE' : openings.rows.length,
            users: users.missing ? 'AUSENTE' : users.rows.length,
            cashClosureHistory: history.missing ? 'AUSENTE' : history.rows.length,
        },
        users: pick(users.rows, ['id', 'username', 'name', 'role']),
        cashOpenings: pick(openings.rows, ['id', 'date', 'userId', 'username', 'cashStart', 'openedAt']),
        cashClosures: pick(closures.rows, ['id', 'date', 'userId', 'username', 'openingId', 'closedAt', 'retroactive', 'cashStart', 'cashOnHand', 'cashDifference', 'totalSales', 'notes', 'reopenedAt', 'closedBy']),
        sales: pick(sales.rows, ['id', 'date', 'sellerId', 'status', 'total', 'paymentMethod', 'shiftId']),
        reservationPayments: pick(payments.rows, ['id', 'date', 'userId', 'status', 'amount', 'paymentMethod', 'shiftId', 'reservationId']),
        expenses: pick(expenses.rows, ['id', 'date', 'userId', 'status', 'amount', 'paymentMethod', 'shiftId']),
        cashClosureHistory: pick(history.rows, ['id', 'closureId', 'changedAt', 'changedBy']),
    };

    db.close();

    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'diagnostico_caja.json';
    a.click();

    console.log('%c[diagnóstico] ✅ Archivo diagnostico_caja.json descargado', 'color:green;font-weight:bold');
    console.table(out.stores);
})().catch(e => console.error('[diagnóstico] Error:', e));
