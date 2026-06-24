/**
 * 🛍️ TIENDA DE ROPA — Punto de entrada de la base de datos
 *
 * Re-exporta todo desde los módulos especializados para mantener
 * compatibilidad con el resto del proyecto sin cambiar ningún import.
 *
 * Módulos internos:
 *  - db/schema.js  ← Instancia Dexie y definición de versiones
 *  - db/seed.js    ← Datos semilla e inicialización
 *  - db/helpers.js ← Funciones utilitarias
 *  - db/audit.js   ← Auditoría e integridad de datos
 */

// La instancia Dexie
export { db } from './db/schema';

// Semillas (efecto secundario: registra db.on('ready'))
import './db/seed';

// Helpers públicos
export {
    generateBarcode,
    barcodeExists,
    findProductByBarcode,
    generateUniqueBarcode,
    generateShortCode,
    shortCodeExists,
    generateBarcodesForProduct,
    fixMissingShortCodes,
    discountStock,
    exportDatabase,
    importDatabase,
    resetForProduction,
    deleteEntireDatabase,
    calculateClosureData,
    syncClosureIfDateExists,
    calculateMonthlySummary,
    getLocalISOString,
} from './db/helpers';

// Audit públicos
export {
    recordCashClosureChange,
    getCashClosureAuditTrail,
    checkDataIntegrity,
    automaticcorrectDataIntegrity,
    getAuditStats,
} from './db/audit';
