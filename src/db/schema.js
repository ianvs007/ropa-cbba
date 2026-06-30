import Dexie from 'dexie';

/**
 * 🛍️ TIENDA DE ROPA — Base de datos local (Dexie.js / IndexedDB)
 * Funciona completamente offline en el navegador del usuario.
 */
export const db = new Dexie('TiendaRopa_Database');

// ==============================================================================
// 📦 ESQUEMA v1 — ESTRUCTURA INICIAL
// ==============================================================================
db.version(1).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount',
    users: '++id, username, role',
    settings: 'key',
});

// ==============================================================================
// 🏷️ ESQUEMA v3 — MÓDULO DE RESERVAS Y CATEGORÍAS
// ==============================================================================
db.version(3).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
});

// ==============================================================================
// 🏷️ ESQUEMA v4 — CÓDIGOS DE BARRAS POR UNIDAD FÍSICA
// ==============================================================================
db.version(4).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, used, createdAt',
});

// ==============================================================================
// 🏷️ ESQUEMA v5 — MARCAS Y COLORES PARA AUTOCOMPLETADO
// ==============================================================================
db.version(5).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
});

// ==============================================================================
// 🏷️ ESQUEMA v6 — CÓDIGO CORTO DE 5 DÍGITOS
// ==============================================================================
db.version(6).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
});

// ==============================================================================
// 🏷️ ESQUEMA v7 — GASTOS CON MÉTODO DE PAGO
// ==============================================================================
db.version(7).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
});

// ==============================================================================
// 🏷️ ESQUEMA v8 — GASTOS CON TRAZABILIDAD
// ==============================================================================
db.version(8).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
});

// ==============================================================================
// 🏷️ ESQUEMA v10 — ARCHIVADO LÓGICO DE PRODUCTOS
// ==============================================================================
db.version(10).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod, status',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
}).upgrade(async tx => {
    return tx.products.toCollection().modify({ active: true });
});

// ==============================================================================
// 🏷️ ESQUEMA v13 — SANEAMIENTO DE IDs Y CÓDIGOS ÚNICOS
// ==============================================================================
db.version(13).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod, status',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, shortCode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
}).upgrade(async tx => {
    // 1. Obtener todos los productos y unidades
    const prods = await tx.products.toArray();
    const units = await tx.barcodes.toArray();

    const usedCodes = new Set();
    // Prioridad 1: Mantener códigos de productos (modelos)
    prods.forEach(p => {
        const c = parseInt(p.shortCode);
        if (!isNaN(c)) usedCodes.add(c);
    });

    let counter = 1;
    // 2. Procesar unidades (barcodes) y sanear productId
    for (const u of units) {
        const currentCodeInt = parseInt(u.shortCode);
        const updates = {};
        
        // Saneamiento de productId (asegurar que sea número)
        if (typeof u.productId === 'string') {
            updates.productId = parseInt(u.productId, 10);
        }

        // Si no tiene código O si el código ya está siendo usado (duplicado)
        if (!u.shortCode || isNaN(currentCodeInt) || usedCodes.has(currentCodeInt)) {
            while (usedCodes.has(counter)) counter++;
            const newCode = counter.toString().padStart(5, '0');
            updates.shortCode = newCode;
            usedCodes.add(counter);
            counter++;
        } else {
            usedCodes.add(currentCodeInt);
        }

        if (Object.keys(updates).length > 0) {
            await tx.barcodes.update(u.id, updates);
        }
    }
});

// ==============================================================================
// 🏷️ ESQUEMA v15 — SOPORTE PARA CIERRES DE CAJA
// ==============================================================================
db.version(15).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod, status',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, shortCode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
    cashClosures: '++id, date',
});

// ==============================================================================
// 🏷️ ESQUEMA v16 — AUDITORÍA DE CIERRES DE CAJA Y SEGURIDAD
// ==============================================================================
db.version(16).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod, status',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date, status',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, shortCode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
    cashClosures: '++id, date, closedAt',
    cashClosureHistory: '++id, closureId, date, changedBy', // ← NUEVA TABLA
});

// ==============================================================================
// 🔐 ESQUEMA v17 — LOGS DE SEGURIDAD Y DETECCIÓN DE MANIPULACIONES
// ==============================================================================
db.version(17).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod, status',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date, status',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, shortCode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
    cashClosures: '++id, date, closedAt',
    cashClosureHistory: '++id, closureId, date, changedBy',
    securityLogs: '++id, timestamp, eventType, userId',
});

// ==============================================================================
// 🔐 ESQUEMA v18 — CIERRE DE CAJA POR TURNO (USUARIO)
// ==============================================================================
db.version(18).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod, status',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date, status, userId',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, shortCode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
    cashClosures: '++id, date, userId, closedAt',
    cashClosureHistory: '++id, closureId, date, changedBy',
    securityLogs: '++id, timestamp, eventType, userId',
});

// ==============================================================================
// 💰 ESQUEMA v19 — APERTURA DE CAJA OBLIGATORIA
// ==============================================================================
db.version(19).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod, status',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date, status, userId',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, shortCode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
    cashClosures: '++id, date, userId, closedAt',
    cashClosureHistory: '++id, closureId, date, changedBy',
    securityLogs: '++id, timestamp, eventType, userId',
    cashOpenings: '++id, date, userId, openedAt',
});

// ==============================================================================
// 🔄 ESQUEMA v20 — MULTI-TURNO: shiftId en ventas, pagos y gastos
// ==============================================================================
db.version(20).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod, status, shiftId',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy, shiftId',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date, status, userId, shiftId',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, shortCode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
    cashClosures: '++id, date, userId, closedAt, openingId',
    cashClosureHistory: '++id, closureId, date, changedBy',
    securityLogs: '++id, timestamp, eventType, userId',
    cashOpenings: '++id, date, userId, openedAt',
});

// ==============================================================================
// 📸 ESQUEMA v21 — BÚSQUEDA POR FOTO: índice de embeddings visuales
// ==============================================================================
// Se añade SOLO a la tabla products el índice `hasEmbedding` (0/1) para filtrar
// rápido qué productos ya tienen vector visual. El vector en sí se guarda como
// propiedad normal `embedding` (array de 1024 floats normalizados, NO indexada).
// El resto de tablas se copian sin cambios desde v20.
db.version(21).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt, hasEmbedding',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod, status, shiftId',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy, shiftId',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date, status, userId, shiftId',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, shortCode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
    cashClosures: '++id, date, userId, closedAt, openingId',
    cashClosureHistory: '++id, closureId, date, changedBy',
    securityLogs: '++id, timestamp, eventType, userId',
    cashOpenings: '++id, date, userId, openedAt',
}).upgrade(async tx => {
    // Backfill: los productos previos no tienen `hasEmbedding`. IndexedDB usa
    // índices sparse (omite registros sin la propiedad), así que sin este relleno
    // NO aparecerían en `.where('hasEmbedding').notEqual(1)` y el reindexado los
    // ignoraría. Marcamos hasEmbedding=0 para que entren al índice.
    return tx.products.toCollection().modify(p => {
        if (p.hasEmbedding === undefined) p.hasEmbedding = 0;
    });
});

// ==============================================================================
// 🔐 ESQUEMA v22 — PERMISOS GRANULARES POR USUARIO ADMIN SECUNDARIO
// ==============================================================================
// Se añade a la tabla users el campo `permissions` (objeto { [clave]: boolean }),
// NO indexado, por lo que el string de stores de users NO cambia. Igualmente hay
// que declarar la versión para que Dexie la registre; el resto de tablas se copian
// idénticas a la v21. SIN .upgrade(): los admins secundarios sin `permissions`
// quedan con acceso mínimo y hasPermission() trata permissions undefined como {}.
db.version(22).stores({
    products: '++id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt, hasEmbedding',
    kardex: '++id, productId, date, type',
    sales: '++id, date, total, sellerId, paymentMethod, status, shiftId',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, amount, paymentMethod, userId, registeredBy, shiftId',
    users: '++id, username, role',
    settings: 'key',
    reservations: '++id, clientName, clientPhone, productId, status, createdAt, sellerId',
    reservationPayments: '++id, reservationId, date, status, userId, shiftId',
    categories: '++id, name',
    productNames: '++id, name',
    productFields: '++id, name, type',
    barcodes: '++id, productId, barcode, shortCode, used, createdAt',
    brands: '++id, name',
    colors: '++id, name',
    cashClosures: '++id, date, userId, closedAt, openingId',
    cashClosureHistory: '++id, closureId, date, changedBy',
    securityLogs: '++id, timestamp, eventType, userId',
    cashOpenings: '++id, date, userId, openedAt',
});
