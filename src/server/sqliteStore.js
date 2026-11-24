import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import {
    POS_DB_TABLES,
    obtenerClavePrimariaFila,
} from '../utils/localDiskDbEngine.js';
import { componerTablasRestauracion } from '../utils/backupDatos.js';

const MAX_AUTO_BACKUPS = 15;
const MEDIA_URL_PREFIX = '/__local_media/';

const MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

function normalizarExtensionMime(subtype = '') {
    const clean = String(subtype).toLowerCase().trim();
    if (clean === 'jpeg' || clean === 'jpg') return 'jpg';
    if (clean === 'png') return 'png';
    if (clean === 'webp') return 'webp';
    if (clean === 'gif') return 'gif';
    if (clean === 'svg+xml' || clean === 'svg') return 'svg';
    return 'jpg';
}

function limpiarPrefijoArchivo(hint) {
    const clean = String(hint || 'img')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 16);
    return clean || 'img';
}

/**
 * Almacén SQLite en disco (`datos-pos/pos.sqlite`) + carpeta de imágenes físicas (`datos-pos/imagenes/`).
 *
 * Reemplaza el antiguo archivo monolítico `pos-db.json` (300+ MB) por:
 *  - Tablas reales en SQLite (WAL) con escritura incremental por fila en <1 ms.
 *  - Extracción automática de imágenes Base64 (`data:image/...`) a archivos `.jpg`/`.png`/`.webp`
 *    servidos bajo `/__local_media/<archivo>` con caché inmutable por hash.
 *  - Separación automática de los vectores `embedding` (1024 floats) hacia la tabla `productEmbeddings`
 *    para que el catálogo `products` pese <1 MB y cambiar de menú sea instantáneo.
 *  - Migración automática y sin pérdida desde `datos-pos/pos-db.json` en el primer arranque.
 */
export class SqlitePosStore {
    constructor({ dataDir }) {
        this.dataDir = dataDir;
        this.dbPath = path.join(dataDir, 'pos.sqlite');
        this.legacyJsonPath = path.join(dataDir, 'pos-db.json');
        this.imagesDir = path.join(dataDir, 'imagenes');
        this.backupsDir = path.join(dataDir, 'backups');

        fs.mkdirSync(this.dataDir, { recursive: true });
        fs.mkdirSync(this.imagesDir, { recursive: true });
        fs.mkdirSync(this.backupsDir, { recursive: true });

        this.hashToFileName = new Map();
        this._indexExistingImages();

        this.db = new DatabaseSync(this.dbPath);
        this._initSchema();

        this.lastDailyBackupCheck = '';
        this._migrateLegacyJsonIfNeeded();
    }

    _indexExistingImages() {
        try {
            const files = fs.readdirSync(this.imagesDir);
            for (const f of files) {
                const m = f.match(/-([a-f0-9]{12})\.(jpg|jpeg|png|webp|gif|svg)$/i);
                if (m) {
                    this.hashToFileName.set(m[1].toLowerCase(), f);
                }
            }
        } catch {
            // Ignorar si aún no hay imágenes
        }
    }

    _initSchema() {
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA temp_store = MEMORY;

            CREATE TABLE IF NOT EXISTS _meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        for (const table of POS_DB_TABLES) {
            if (table === 'products') {
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS "products" (
                        row_key TEXT PRIMARY KEY,
                        sort_num REAL,
                        short_code TEXT,
                        global_id TEXT,
                        name TEXT,
                        stock REAL,
                        price REAL,
                        photo TEXT,
                        data TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_products_short_code ON "products"(short_code);
                    CREATE INDEX IF NOT EXISTS idx_products_global_id ON "products"(global_id);
                `);
            } else {
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS "${table}" (
                        row_key TEXT PRIMARY KEY,
                        sort_num REAL,
                        data TEXT NOT NULL
                    );
                `);
            }
        }

        this.stmtGetMeta = this.db.prepare('SELECT value FROM _meta WHERE key = ?');
        this.stmtSetMeta = this.db.prepare(
            'INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        );

        this.stmtsUpsert = {};
        this.stmtsDelete = {};
        this.stmtsSelectAll = {};
        this.stmtsCount = {};

        for (const table of POS_DB_TABLES) {
            if (table === 'products') {
                this.stmtsUpsert[table] = this.db.prepare(`
                    INSERT INTO "products" (row_key, sort_num, short_code, global_id, name, stock, price, photo, data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(row_key) DO UPDATE SET
                        sort_num = excluded.sort_num,
                        short_code = excluded.short_code,
                        global_id = excluded.global_id,
                        name = excluded.name,
                        stock = excluded.stock,
                        price = excluded.price,
                        photo = excluded.photo,
                        data = excluded.data
                `);
            } else {
                this.stmtsUpsert[table] = this.db.prepare(`
                    INSERT INTO "${table}" (row_key, sort_num, data)
                    VALUES (?, ?, ?)
                    ON CONFLICT(row_key) DO UPDATE SET
                        sort_num = excluded.sort_num,
                        data = excluded.data
                `);
            }
            this.stmtsDelete[table] = this.db.prepare(`DELETE FROM "${table}" WHERE row_key = ?`);
            this.stmtsSelectAll[table] = this.db.prepare(
                `SELECT data FROM "${table}" ORDER BY CASE WHEN sort_num IS NULL THEN 1 ELSE 0 END, sort_num ASC, row_key ASC`
            );
            this.stmtsCount[table] = this.db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`);
        }
    }

    _getMeta(key, fallback = null) {
        const row = this.stmtGetMeta.get(key);
        return row ? row.value : fallback;
    }

    _setMeta(key, value) {
        this.stmtSetMeta.run(key, String(value ?? ''));
    }

    isInitialized() {
        return this._getMeta('initialized', '0') === '1';
    }

    getRevision() {
        return Number(this._getMeta('revision', '0')) || 0;
    }

    getUpdatedAt() {
        return this._getMeta('updatedAt', '') || null;
    }

    getLastClientId() {
        return this._getMeta('lastClientId', '') || null;
    }

    /**
     * Convierte un `data:image/...;base64,...` en un archivo físico dentro de `datos-pos/imagenes/`
     * y devuelve su ruta pública `/__local_media/<nombre>`. Si ya es una ruta o está vacío, lo devuelve igual.
     */
    externalizeDataUrl(photoValue, prefixHint = 'img') {
        if (!photoValue || typeof photoValue !== 'string') return photoValue || '';
        if (!photoValue.startsWith('data:image/')) return photoValue;

        const commaIdx = photoValue.indexOf(',');
        if (commaIdx === -1) return photoValue;

        const header = photoValue.slice(0, commaIdx);
        const m = header.match(/^data:image\/([a-zA-Z0-9+.-]+);base64$/i);
        if (!m) return photoValue;

        const ext = normalizarExtensionMime(m[1]);
        const b64 = photoValue.slice(commaIdx + 1);
        let buf;
        try {
            buf = Buffer.from(b64, 'base64');
        } catch {
            return photoValue;
        }
        if (!buf || buf.length === 0) return '';

        const hash12 = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
        const existing = this.hashToFileName.get(hash12);
        if (existing && fs.existsSync(path.join(this.imagesDir, existing))) {
            return `${MEDIA_URL_PREFIX}${existing}`;
        }

        const safePrefix = limpiarPrefijoArchivo(prefixHint);
        const fileName = `${safePrefix}-${hash12}.${ext}`;
        const fullPath = path.join(this.imagesDir, fileName);
        if (!fs.existsSync(fullPath)) {
            fs.writeFileSync(fullPath, buf);
        }
        this.hashToFileName.set(hash12, fileName);
        return `${MEDIA_URL_PREFIX}${fileName}`;
    }

    /**
     * Resuelve de forma segura un archivo dentro de `datos-pos/imagenes/`.
     */
    resolveImageFile(rawName) {
        const cleanName = path.basename(String(rawName || '').trim());
        if (!cleanName || cleanName !== rawName || cleanName.includes('..')) {
            return null;
        }
        const fullPath = path.join(this.imagesDir, cleanName);
        if (!fs.existsSync(fullPath)) return null;
        const ext = path.extname(cleanName).toLowerCase();
        return {
            fullPath,
            fileName: cleanName,
            contentType: MIME_BY_EXT[ext] || 'application/octet-stream',
        };
    }

    /**
     * Limpia un producto:
     *  - Extrae foto Base64 a `datos-pos/imagenes/`.
     *  - Extrae el vector `embedding` (si viene adjunto) hacia `extractedEmbeddings` y lo quita de `products`.
     */
    _sanitizeProductRow(rawRow, extractedEmbeddings = []) {
        if (!rawRow || typeof rawRow !== 'object') return rawRow;
        let cloned = null;
        const ensureClone = () => {
            if (!cloned) cloned = { ...rawRow };
            return cloned;
        };

        if (typeof rawRow.photo === 'string' && rawRow.photo.startsWith('data:image/')) {
            const target = ensureClone();
            target.photo = this.externalizeDataUrl(
                rawRow.photo,
                rawRow.shortCode || rawRow.globalId || rawRow.id || 'prenda'
            );
        }

        if (Array.isArray(rawRow.embedding) && rawRow.embedding.length > 0) {
            if (rawRow.id !== undefined && rawRow.id !== null) {
                extractedEmbeddings.push({
                    productId: rawRow.id,
                    globalId: rawRow.globalId || null,
                    embedding: rawRow.embedding,
                });
            }
            const target = ensureClone();
            target.hasEmbedding = 1;
            delete target.embedding;
        } else if ('embedding' in rawRow) {
            const target = ensureClone();
            delete target.embedding;
        }

        return cloned || rawRow;
    }

    /**
     * Limpia fotos Base64 heredadas dentro de `sales.items[].photo`.
     */
    _sanitizeSaleRow(rawSale) {
        if (!rawSale || !Array.isArray(rawSale.items)) return rawSale;
        let hasInlinePhoto = false;
        for (const it of rawSale.items) {
            if (typeof it?.photo === 'string' && it.photo.startsWith('data:image/')) {
                hasInlinePhoto = true;
                break;
            }
        }
        if (!hasInlinePhoto) return rawSale;

        return {
            ...rawSale,
            items: rawSale.items.map(it => {
                if (typeof it?.photo === 'string' && it.photo.startsWith('data:image/')) {
                    return {
                        ...it,
                        photo: this.externalizeDataUrl(it.photo, it.productId || 'venta'),
                    };
                }
                return it;
            }),
        };
    }

    _upsertSingleRow(table, row, fallbackIdx = 0) {
        const pkVal = obtenerClavePrimariaFila(table, row);
        const rowKey = pkVal !== undefined && pkVal !== null ? String(pkVal) : `idx_${fallbackIdx}`;
        const numVal = typeof pkVal === 'number' && Number.isFinite(pkVal)
            ? pkVal
            : (/^\d+$/.test(rowKey) ? Number(rowKey) : null);
        const json = JSON.stringify(row);

        if (table === 'products') {
            this.stmtsUpsert.products.run(
                rowKey,
                numVal,
                row.shortCode ?? null,
                row.globalId ?? null,
                row.name ?? null,
                typeof row.stock === 'number' ? row.stock : Number(row.stock) || 0,
                typeof row.price === 'number' ? row.price : Number(row.price) || 0,
                row.photo ?? null,
                json
            );
        } else {
            this.stmtsUpsert[table].run(rowKey, numVal, json);
        }
    }

    _migrateLegacyJsonIfNeeded() {
        if (this.isInitialized()) return;
        if (!fs.existsSync(this.legacyJsonPath)) return;

        try {
            const raw = fs.readFileSync(this.legacyJsonPath, 'utf-8');
            if (!raw.trim()) return;
            const parsed = JSON.parse(raw);
            const srcTables = parsed?.tables || parsed?.data || {};
            const baseRev = Number(parsed?.revision) || 0;

            this.applySync({
                mode: 'full',
                clientId: parsed?.lastClientId || 'migracion-sqlite',
                tables: srcTables,
                forceRevision: baseRev + 1,
                forceInitialized: Boolean(parsed?.initialized ?? true),
            });

            const migratedPath = path.join(this.dataDir, 'pos-db.migrado-sqlite.json');
            try {
                if (fs.existsSync(migratedPath)) {
                    fs.unlinkSync(migratedPath);
                }
                fs.renameSync(this.legacyJsonPath, migratedPath);
            } catch {
                // Si otro proceso lo tiene abierto en lectura, conservarlo sin fallar
            }
        } catch (err) {
            console.error('[SQLite] Error migrando pos-db.json a SQLite:', err.message);
        }
    }

    getStats() {
        const count = (t) => Number(this.stmtsCount[t]?.get()?.c) || 0;
        return {
            products: count('products'),
            productEmbeddings: count('productEmbeddings'),
            barcodes: count('barcodes'),
            sales: count('sales'),
            kardex: count('kardex'),
            users: count('users'),
            branches: count('branches'),
            cashClosures: count('cashClosures'),
        };
    }

    countImages() {
        try {
            return fs.readdirSync(this.imagesDir).filter(f => !f.startsWith('.')).length;
        } catch {
            return 0;
        }
    }

    countBackups() {
        try {
            return fs
                .readdirSync(this.backupsDir)
                .filter(f => f.endsWith('.sqlite') || f.endsWith('.json')).length;
        } catch {
            return 0;
        }
    }

    getStatus() {
        return {
            engine: 'sqlite',
            initialized: this.isInitialized(),
            revision: this.getRevision(),
            updatedAt: this.getUpdatedAt(),
            lastClientId: this.getLastClientId(),
            dbPath: this.dbPath,
            imagesDir: this.imagesDir,
            imagesCount: this.countImages(),
            backupsDir: this.backupsDir,
            backupsCount: this.countBackups(),
            stats: this.getStats(),
        };
    }

    /**
     * Devuelve el mapa de tablas solicitadas desde SQLite.
     */
    getTables(tableNames = POS_DB_TABLES) {
        const out = {};
        for (const t of tableNames) {
            if (!POS_DB_TABLES.includes(t)) continue;
            const rows = this.stmtsSelectAll[t].all();
            out[t] = rows.map(r => JSON.parse(r.data));
        }
        return out;
    }

    /**
     * Aplica `full`, `patch`, `ops` o `wipe` dentro de una única transacción ACID en SQLite.
     */
    applySync(body = {}) {
        const mode = body.mode || 'patch';
        const now = body.now || new Date().toISOString();
        const nextRev = typeof body.forceRevision === 'number'
            ? body.forceRevision
            : this.getRevision() + 1;
        const clientId = body.clientId || '';

        const updatedTables = new Set();
        const sanitizedUpserts = {};

        this.db.exec('BEGIN IMMEDIATE');
        try {
            if (mode === 'wipe') {
                for (const t of POS_DB_TABLES) {
                    this.db.exec(`DELETE FROM "${t}"`);
                    updatedTables.add(t);
                }
                this._setMeta('initialized', '0');
                this._setMeta('revision', nextRev);
                this._setMeta('updatedAt', now);
                this._setMeta('lastClientId', clientId);
                this.db.exec('COMMIT');

                return {
                    initialized: false,
                    revision: nextRev,
                    updatedAt: now,
                    lastClientId: clientId || null,
                    updatedTables: Array.from(updatedTables),
                    sanitizedUpserts: {},
                };
            }

            if (mode === 'ops') {
                const upserts = body.upserts && typeof body.upserts === 'object' ? body.upserts : {};
                const deletes = body.deletes && typeof body.deletes === 'object' ? body.deletes : {};
                const extractedEmbeddings = [];

                for (const t of POS_DB_TABLES) {
                    const dels = Array.isArray(deletes[t]) ? deletes[t] : [];
                    for (const key of dels) {
                        this.stmtsDelete[t].run(String(key));
                        updatedTables.add(t);
                        if (t === 'products') {
                            this.stmtsDelete.productEmbeddings.run(String(key));
                            updatedTables.add('productEmbeddings');
                        }
                    }

                    const ups = Array.isArray(upserts[t]) ? upserts[t] : [];
                    if (ups.length === 0) continue;

                    const cleanRows = [];
                    for (let i = 0; i < ups.length; i++) {
                        let row = ups[i];
                        if (t === 'products') {
                            const sanitized = this._sanitizeProductRow(row, extractedEmbeddings);
                            if (sanitized !== row) {
                                if (!sanitizedUpserts.products) sanitizedUpserts.products = [];
                                sanitizedUpserts.products.push(sanitized);
                            }
                            row = sanitized;
                        } else if (t === 'sales') {
                            const sanitized = this._sanitizeSaleRow(row);
                            if (sanitized !== row) {
                                if (!sanitizedUpserts.sales) sanitizedUpserts.sales = [];
                                sanitizedUpserts.sales.push(sanitized);
                            }
                            row = sanitized;
                        }
                        this._upsertSingleRow(t, row, i);
                        cleanRows.push(row);
                    }
                    updatedTables.add(t);
                }

                if (extractedEmbeddings.length > 0) {
                    for (let i = 0; i < extractedEmbeddings.length; i++) {
                        this._upsertSingleRow('productEmbeddings', extractedEmbeddings[i], i);
                    }
                    updatedTables.add('productEmbeddings');
                }
            } else {
                // mode === 'full' o mode === 'patch'
                const incoming = body.tables && typeof body.tables === 'object' ? body.tables : {};
                const targetTables = mode === 'full'
                    ? POS_DB_TABLES
                    : Object.keys(incoming).filter(t => POS_DB_TABLES.includes(t) && Array.isArray(incoming[t]));

                const extractedEmbeddings = [];

                for (const t of targetTables) {
                    // En mode === 'full', si `productEmbeddings` no venía explícito en un backup antiguo,
                    // se llenará con `extractedEmbeddings` extraídos de `products`.
                    this.db.exec(`DELETE FROM "${t}"`);
                    const rows = Array.isArray(incoming[t]) ? incoming[t] : [];
                    for (let i = 0; i < rows.length; i++) {
                        let row = rows[i];
                        if (t === 'products') {
                            const sanitized = this._sanitizeProductRow(row, extractedEmbeddings);
                            if (sanitized !== row) {
                                sanitizedUpserts.productsChanged = true;
                            }
                            row = sanitized;
                        } else if (t === 'sales') {
                            const sanitized = this._sanitizeSaleRow(row);
                            if (sanitized !== row) {
                                sanitizedUpserts.salesChanged = true;
                            }
                            row = sanitized;
                        }
                        this._upsertSingleRow(t, row, i);
                    }
                    updatedTables.add(t);
                }

                if (extractedEmbeddings.length > 0) {
                    for (let i = 0; i < extractedEmbeddings.length; i++) {
                        this._upsertSingleRow('productEmbeddings', extractedEmbeddings[i], i);
                    }
                    updatedTables.add('productEmbeddings');
                }
            }

            const initFlag = typeof body.forceInitialized === 'boolean' ? body.forceInitialized : true;
            this._setMeta('initialized', initFlag ? '1' : '0');
            this._setMeta('revision', nextRev);
            this._setMeta('updatedAt', now);
            this._setMeta('lastClientId', clientId);

            this.db.exec('COMMIT');
        } catch (err) {
            try {
                this.db.exec('ROLLBACK');
            } catch {
                // Ignorar
            }
            throw err;
        }

        if (this.isInitialized()) {
            this._ensureDailyBackup();
        }

        return {
            initialized: this.isInitialized(),
            revision: nextRev,
            updatedAt: now,
            lastClientId: clientId || null,
            updatedTables: Array.from(updatedTables),
            sanitizedUpserts,
        };
    }

    /**
     * Importa un archivo `.json` completo (incluso de 300+ MB) directamente en Node.js + SQLite,
     * extrayendo fotos Base64 a `datos-pos/imagenes/`, separando `productEmbeddings` y preservando
     * hashes de contraseñas existentes cuando el backup trae `password: '***'`.
     * Un usuario que solo existe enmascarado no se crea con una clave inventada.
     * Las tablas que el archivo no trae (caja de un v10/v11, token de una copia
     * sin secretos) no se vacían.
     */
    importBackupJsonString(rawJson) {
        const parsed = JSON.parse(rawJson);
        const data = parsed?.data || parsed?.tables;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('Archivo de backup inválido: no contiene tablas reconocibles.');
        }

        const actuales = this.getTables();
        const compuesto = componerTablasRestauracion(
            { ...parsed, data },
            actuales,
        );
        if (!compuesto.ok) {
            throw new Error(compuesto.error || 'Archivo de backup inválido');
        }

        const tables = compuesto.tablas;

        if (compuesto.reemplazadas.includes('products')) {
            const usedCodes = new Set();
            let maxCode = 0;
            for (const p of tables.products) {
                const n = parseInt(p?.shortCode, 10);
                if (!isNaN(n)) {
                    usedCodes.add(n);
                    if (n > maxCode) maxCode = n;
                }
            }
            let nextCode = maxCode + 1;
            tables.products = tables.products.map(p => {
                const copy = { ...p };
                if (!copy.globalId) copy.globalId = crypto.randomUUID();
                if (!copy.updatedAt) copy.updatedAt = copy.createdAt || new Date().toISOString();
                if (!copy.shortCode) {
                    while (usedCodes.has(nextCode)) nextCode++;
                    copy.shortCode = String(nextCode).padStart(5, '0');
                    usedCodes.add(nextCode++);
                }
                return copy;
            });
        }

        const nextRev = Math.max(this.getRevision(), Number(parsed.revision) || 0) + 1;
        const aplicado = this.applySync({
            mode: 'full',
            clientId: 'server-backup-import',
            tables,
            forceRevision: nextRev,
            forceInitialized: true,
        });
        return {
            ...aplicado,
            avisos: compuesto.avisos,
            usuariosOmitidos: compuesto.usuariosOmitidos,
        };
    }

    /**
     * Genera una copia instantánea y consistente de `pos.sqlite` mediante `VACUUM INTO`.
     */
    createBackup(prefijo = 'backup-manual') {
        fs.mkdirSync(this.backupsDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `${prefijo}-${stamp}.sqlite`;
        const fullPath = path.join(this.backupsDir, fileName);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
        const escaped = fullPath.replace(/'/g, "''");
        this.db.exec(`VACUUM INTO '${escaped}'`);
        return { fileName, fullPath };
    }

    _ensureDailyBackup() {
        const hoy = new Date().toISOString().slice(0, 10);
        if (this.lastDailyBackupCheck === hoy) return;
        this.lastDailyBackupCheck = hoy;

        const dailyPath = path.join(this.backupsDir, `backup-auto-${hoy}.sqlite`);
        if (fs.existsSync(dailyPath)) return;

        try {
            const escaped = dailyPath.replace(/'/g, "''");
            this.db.exec(`VACUUM INTO '${escaped}'`);
            this._rotateAutoBackups();
        } catch (err) {
            console.warn('[SQLite] No se pudo crear backup diario automático:', err.message);
        }
    }

    _rotateAutoBackups() {
        try {
            const files = fs
                .readdirSync(this.backupsDir)
                .filter(f => f.startsWith('backup-auto-') && (f.endsWith('.sqlite') || f.endsWith('.json')))
                .sort();
            while (files.length > MAX_AUTO_BACKUPS) {
                const oldest = files.shift();
                if (oldest) {
                    fs.unlinkSync(path.join(this.backupsDir, oldest));
                }
            }
        } catch {
            // Ignorar errores de rotación
        }
    }

    close() {
        try {
            if (this.db) {
                this.db.close();
                this.db = null;
            }
        } catch {
            // Ignorar
        }
    }
}
