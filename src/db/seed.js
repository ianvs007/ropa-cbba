import { db } from './schema';
import { hashPassword } from '../utils/crypto';

/**
 * Migración de contraseñas legacy a hash PBKDF2.
 * Se ejecuta DESPUÉS de que la BD esté abierta (no dentro de on('ready')).
 */
async function migratePasswordsToHash() {
    try {
        const allUsers = await db.users.toArray();
        for (const u of allUsers) {
            if (u.password && !u.password.includes(':')) {
                await db.users.update(u.id, { password: await hashPassword(u.password) });
            }
        }
    } catch (err) {
        console.error('Error migrando contraseñas:', err);
    }
}

/**
 * 🌱 SEED — Datos iniciales al arrancar la BD por primera vez
 * Se ejecuta una sola vez cuando la BD está lista.
 */
db.on('ready', async () => {
    // ── Usuarios: crear admin por defecto si no existe
    const userCount = await db.users.count();
    if (userCount === 0) {
        await db.users.bulkAdd([
            { username: 'admin', password: 'admin123', role: 'admin', name: 'Administrador', active: true },
            { username: 'cajera', password: 'cajera123', role: 'seller', name: 'Cajera', active: true },
        ]);
    }

    // ── Configuración: datos de la tienda por defecto
    const settingsCount = await db.settings.count();
    if (settingsCount === 0) {
        await db.settings.bulkPut([
            { key: 'storeName', value: 'Mi Tienda de Ropa' },
            { key: 'storePhone', value: '' },
            { key: 'storeAddress', value: '' },
            { key: 'currency', value: 'Bs.' },
            { key: 'lowStockAlert', value: '5' },
            { key: 'taxRate', value: '0' },
            { key: 'maxDiscount', value: '10' },
        ]);
    }

    // ── Categorías de gastos por defecto
    const expCatCount = await db.expenseCategories.count();
    if (expCatCount === 0) {
        await db.expenseCategories.bulkAdd([
            { name: 'Alquiler' },
            { name: 'Servicios (Luz/Agua)' },
            { name: 'Transporte' },
            { name: 'Publicidad' },
            { name: 'Otros' },
        ]);
    }

    // ── Categorías y Nombres base
    const catCount = await db.categories.count();
    if (catCount === 0) {
        const defaultCats = [
            'Blusas', 'Camisas', 'Camisetas', 'Pantalones', 'Jeans', 'Faldas',
            'Vestidos', 'Chaquetas', 'Abrigos', 'Ropa Interior', 'Calzado',
            'Accesorios', 'Ropa Deportiva', 'Ropa de Niños', 'Otros',
        ];
        await db.categories.bulkAdd(defaultCats.map(name => ({ name })));
    }

    const namesCount = await db.productNames.count();
    if (namesCount === 0) {
        const defaultNames = [
            'Blusa', 'Camisa', 'Pantalón', 'Jean', 'Vestido', 'Chaqueta',
            'Zapato', 'Zapatilla', 'Polera', 'Bividi', 'Short', 'Sudadera',
            'Gorra', 'Cinturón',
        ];
        await db.productNames.bulkAdd(defaultNames.map(name => ({ name })));
    }

    // ── MIGRACIÓN: Asignar shortCode a productos antiguos que no tengan
    const productsToMigrate = await db.products.filter(p => !p.shortCode).toArray();
    if (productsToMigrate.length > 0) {
        const allProducts = await db.products.where('shortCode').above('').toArray();
        const codes = allProducts.map(p => parseInt(p.shortCode, 10)).filter(n => !isNaN(n));
        let nextCode = codes.length > 0 ? Math.max(...codes) + 1 : 1;

        for (const p of productsToMigrate) {
            const shortCode = nextCode.toString().padStart(5, '0');
            await db.products.update(p.id, { shortCode });
            nextCode++;
        }

    }
});

// Ejecutar migración de contraseñas después de que la BD esté abierta
db.open().then(() => migratePasswordsToHash());
