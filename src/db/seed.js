import { db } from './schema';
import { hashPassword, migrarContrasenasLegacy } from '../utils/crypto';
import { initDiskSync } from './diskSync';

/**
 * Migra a hash PBKDF2 las contraseñas que aún estén en texto plano (usuarios de versiones
 * antiguas). Desde que `verifyPassword` ya no acepta texto plano, un usuario sin migrar no
 * podría entrar; por eso Login espera a `inicializacionUsuarios` antes de verificar.
 * Se ejecuta DESPUÉS de que la BD esté abierta (no dentro de on('ready')).
 */
async function migratePasswordsToHash() {
    try {
        const cambios = await migrarContrasenasLegacy(await db.users.toArray());
        for (const { id, password } of cambios) {
            await db.users.update(id, { password });
        }
    } catch (err) {
        console.error('Error migrando contraseñas:', err);
    }
}

/**
 * Crea los usuarios iniciales cuando la BD está vacía. Las contraseñas iniciales
 * (admin123 / cajera123) se guardan YA hasheadas y con `mustChangePassword: true`: el
 * primer login obliga a elegir una contraseña nueva (ver Login.jsx y utils/passwordPolicy).
 */
async function sembrarUsuariosIniciales() {
    try {
        if ((await db.users.count()) > 0) return;
        const [adminHash, cajeraHash] = await Promise.all([
            hashPassword('admin123'),
            hashPassword('cajera123'),
        ]);
        await db.users.bulkAdd([
            { username: 'admin', password: adminHash, role: 'admin', name: 'Administrador', active: true, mustChangePassword: true },
            { username: 'cajera', password: cajeraHash, role: 'seller', name: 'Cajera', active: true, mustChangePassword: true },
        ]);
    } catch (err) {
        console.error('Error creando usuarios iniciales:', err);
    }
}

/**
 * 🌱 SEED — Datos iniciales al arrancar la BD por primera vez
 * Se ejecuta una sola vez cuando la BD está lista.
 */
db.on('ready', async () => {
    // Los usuarios iniciales se crean fuera de on('ready') (necesitan hash asíncrono):
    // ver `sembrarUsuariosIniciales` abajo.

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

    // ── Sucursales por defecto para traslados de entrada/salida
    if (db.branches) {
        const branchesCount = await db.branches.count();
        if (branchesCount === 0) {
            await db.branches.bulkAdd([
                { name: 'SUCURSAL 1' },
                { name: 'SUCURSAL 2' },
            ]);
        }
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

/**
 * Resuelve cuando la BD está abierta, los usuarios iniciales sembrados y las contraseñas
 * legacy migradas. Login la espera para no rechazar un usuario válido durante el arranque
 * (no incluye la sincronización con disco, que puede tardar).
 */
export const inicializacionUsuarios = db
    .open()
    .then(() => sembrarUsuariosIniciales())
    .then(() => migratePasswordsToHash())
    .catch(err => {
        console.error('Error en la inicialización de usuarios:', err);
    });

inicializacionUsuarios
    .then(() => initDiskSync(db))
    .then(() => migratePasswordsToHash())
    .catch(err => {
        console.error('Error en la sincronización inicial con disco:', err);
    });
