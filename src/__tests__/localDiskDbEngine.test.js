import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';

import {
    calcularEstadisticasTablas,
    tieneDatosOperativos,
    decidirSincronizacionInicial,
    aplicarCambioEstadoDisco,
} from '../utils/localDiskDbEngine';
import { crearMiddlewareLocalDiskDb } from '../server/localDiskDbPlugin';

// Imagen JPEG 1x1 mínima válida en Base64 para pruebas reales de disco
const SAMPLE_JPEG_BYTES = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const SAMPLE_DATA_URL = `data:image/jpeg;base64,${SAMPLE_JPEG_BYTES.toString('base64')}`;

describe('Motor de Base de Datos en Disco Local (localDiskDbEngine)', () => {
    it('calcula estadísticas y detecta si existen datos operativos reales', () => {
        const tablasVacias = {
            users: [{ id: 1, username: 'admin' }],
            products: [],
            sales: [],
            kardex: [],
        };
        expect(tieneDatosOperativos(tablasVacias)).toBe(false);

        const tablasOperativas = {
            users: [{ id: 1, username: 'admin' }],
            products: [{ id: 1, name: 'BLUSA', shortCode: '00001', stock: 2 }],
            barcodes: [
                { id: 1, productId: 1, shortCode: '00001' },
                { id: 2, productId: 1, shortCode: '00002' },
            ],
            sales: [],
        };
        expect(tieneDatosOperativos(tablasOperativas)).toBe(true);
        expect(calcularEstadisticasTablas(tablasOperativas)).toEqual({
            products: 1,
            barcodes: 2,
            sales: 0,
            kardex: 0,
            users: 1,
            branches: 0,
            cashClosures: 0,
        });
    });

    it('decide subir del navegador al disco cuando el disco es nuevo y el navegador tiene datos', () => {
        const res = decidirSincronizacionInicial({
            diskInitialized: false,
            diskRevision: 0,
            diskTables: {},
            localTables: {
                products: [{ id: 1, name: 'VESTIDO' }],
                users: [{ id: 1, username: 'admin' }],
            },
            localLastSyncedRev: 0,
        });
        expect(res.action).toBe('push_local_to_disk');
    });

    it('decide subir del navegador al disco si el disco solo tenía el seed vacío y se abre el navegador con catálogo real', () => {
        const res = decidirSincronizacionInicial({
            diskInitialized: true,
            diskRevision: 1,
            diskTables: {
                users: [{ id: 1, username: 'admin' }],
                products: [],
                sales: [],
            },
            localTables: {
                users: [{ id: 1, username: 'admin' }],
                products: [{ id: 1, name: 'JEAN' }, { id: 2, name: 'POLERA' }],
                sales: [{ id: 1, total: 120 }],
            },
            localLastSyncedRev: 0,
        });
        expect(res.action).toBe('push_local_to_disk');
    });

    it('decide noop instantáneo cuando el navegador ya está en la misma revisión de SQLite', () => {
        const res = decidirSincronizacionInicial({
            diskInitialized: true,
            diskRevision: 8,
            diskTables: {
                products: [{ id: 1, name: 'VESTIDO' }],
            },
            localTables: {
                products: [{ id: 1, name: 'VESTIDO' }],
            },
            localLastSyncedRev: 8,
        });
        expect(res.action).toBe('noop');
    });

    it('decide descargar del disco al navegador cuando otro navegador (ej. cajero en otro navegador) se conecta', () => {
        const res = decidirSincronizacionInicial({
            diskInitialized: true,
            diskRevision: 5,
            diskTables: {
                users: [{ id: 1, username: 'admin' }, { id: 2, username: 'cajera' }],
                products: [{ id: 1, name: 'CHAMARRA', stock: 3 }],
                sales: [{ id: 1, total: 250 }],
            },
            localTables: {
                users: [{ id: 1, username: 'admin' }],
                products: [],
                sales: [],
            },
            localLastSyncedRev: 0,
        });
        expect(res.action).toBe('pull_disk_to_local');
    });

    it('aplica parches parciales, operaciones por fila (ops), reemplazos completos y borrado total (wipe)', () => {
        const inicial = aplicarCambioEstadoDisco(null, {
            mode: 'full',
            clientId: 'tab-1',
            now: '2026-11-15T10:00:00.000Z',
            tables: {
                products: [{ id: 1, name: 'FALDA', stock: 1 }],
                settings: [{ key: 'storeName', value: 'Central' }],
                branches: [{ id: 1, name: 'SUCURSAL 1' }],
            },
        });
        expect(inicial.initialized).toBe(true);
        expect(inicial.revision).toBe(1);
        expect(inicial.tables.products).toHaveLength(1);
        expect(inicial.tables.branches).toHaveLength(1);

        const incremental = aplicarCambioEstadoDisco(inicial, {
            mode: 'ops',
            clientId: 'tab-2',
            now: '2026-11-15T10:02:00.000Z',
            upserts: {
                products: [
                    { id: 1, name: 'FALDA', stock: 0 },
                    { id: 2, name: 'ABRIGO', stock: 2 },
                ],
                settings: [{ key: 'storeName', value: 'Tienda Central' }],
            },
            deletes: {
                branches: [1],
            },
        });
        expect(incremental.revision).toBe(2);
        expect(incremental.tables.products).toHaveLength(2);
        expect(incremental.tables.products.find(p => p.id === 1).stock).toBe(0);
        expect(incremental.tables.settings[0].value).toBe('Tienda Central');
        expect(incremental.tables.branches).toHaveLength(0);

        const borrado = aplicarCambioEstadoDisco(incremental, {
            mode: 'wipe',
            clientId: 'tab-1',
            now: '2026-11-15T10:10:00.000Z',
        });
        expect(borrado.initialized).toBe(false);
        expect(borrado.revision).toBe(3);
        expect(borrado.tables.products).toHaveLength(0);
    });
});

describe('Middleware HTTP de Base de Datos SQLite + Imágenes en Disco', () => {
    let tmpDir;
    let middleware;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ropa-cbba-sqlite-test-'));
        middleware = crearMiddlewareLocalDiskDb({ dataDir: tmpDir });
    });

    afterEach(() => {
        try {
            middleware?.close?.();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Ignorar en Windows si el SO libera el archivo un instante después
        }
    });

    function invokeMiddleware(method, url, bodyObj = null, rawResponse = false) {
        return new Promise((resolve, reject) => {
            const req = new EventEmitter();
            req.method = method;
            req.url = url;
            // Simula la PC central: loopback + Host local, que opera sin token.
            req.headers = { host: 'localhost' };
            req.socket = { remoteAddress: '127.0.0.1' };

            const headers = {};
            const res = {
                statusCode: 200,
                setHeader(k, v) {
                    headers[k.toLowerCase()] = v;
                },
                end(payload) {
                    try {
                        resolve({
                            statusCode: this.statusCode,
                            headers,
                            raw: payload,
                            data: !rawResponse && payload ? JSON.parse(payload) : null,
                        });
                    } catch (err) {
                        reject(err);
                    }
                },
            };

            middleware(req, res, () => {
                resolve({ statusCode: 404, data: null });
            }).catch(reject);

            if (bodyObj !== null) {
                const buf = Buffer.isBuffer(bodyObj)
                    ? bodyObj
                    : typeof bodyObj === 'string'
                    ? Buffer.from(bodyObj, 'utf-8')
                    : Buffer.from(JSON.stringify(bodyObj), 'utf-8');
                req.emit('data', buf);
            }
            req.emit('end');
        });
    }

    it('persiste en pos.sqlite, extrae fotos Base64 a imagenes/, separa embeddings y genera backups .sqlite', async () => {
        const stInicial = await invokeMiddleware('GET', '/__local_db/status');
        expect(stInicial.statusCode).toBe(200);
        expect(stInicial.data.engine).toBe('sqlite');
        expect(stInicial.data.initialized).toBe(false);

        const syncRes = await invokeMiddleware('POST', '/__local_db/sync', {
            clientId: 'admin-chrome',
            mode: 'full',
            tables: {
                products: [
                    {
                        id: 10,
                        name: 'VESTIDO GALA',
                        shortCode: '00450',
                        globalId: 'uuid-450',
                        stock: 1,
                        photo: SAMPLE_DATA_URL,
                        embedding: [0.5, 0.5, 0.707],
                    },
                ],
                sales: [
                    {
                        id: 1,
                        total: 250,
                        items: [{ productId: 10, name: 'VESTIDO GALA', photo: SAMPLE_DATA_URL }],
                    },
                ],
                barcodes: [{ id: 100, productId: 10, shortCode: '00450', used: false }],
                users: [{ id: 1, username: 'admin', role: 'admin', password: 'ab:cd' }],
            },
        });
        expect(syncRes.statusCode).toBe(200);
        expect(syncRes.data.initialized).toBe(true);
        expect(syncRes.data.revision).toBe(1);
        expect(syncRes.data.imagesCount).toBe(1); // Deduplicada entre products y sales!
        expect(fs.existsSync(path.join(tmpDir, 'pos.sqlite'))).toBe(true);

        // Snapshot liviano sin embeddings
        const snapRes = await invokeMiddleware('GET', '/__local_db/snapshot?exclude=productEmbeddings');
        expect(snapRes.statusCode).toBe(200);
        expect(snapRes.data.tables.productEmbeddings).toBeUndefined();
        const savedProd = snapRes.data.tables.products[0];
        expect(savedProd.shortCode).toBe('00450');
        expect(savedProd.photo).toMatch(/^\/__local_media\/00450-[a-f0-9]{12}\.jpg$/);
        expect(savedProd.embedding).toBeUndefined();
        expect(savedProd.hasEmbedding).toBe(1);
        expect(snapRes.data.tables.sales[0].items[0].photo).toBe(savedProd.photo);

        // Verificar que GET /__local_media/<archivo> sirve exactamente los bytes JPEG
        const imgRes = await invokeMiddleware('GET', savedProd.photo, null, true);
        expect(imgRes.statusCode).toBe(200);
        expect(imgRes.headers['content-type']).toBe('image/jpeg');
        expect(Buffer.compare(imgRes.raw, SAMPLE_JPEG_BYTES)).toBe(0);

        // Verificar que el vector fue movido a productEmbeddings
        const embRes = await invokeMiddleware('GET', '/__local_db/snapshot?tables=productEmbeddings');
        expect(embRes.data.tables.productEmbeddings).toEqual([
            { productId: 10, globalId: 'uuid-450', embedding: [0.5, 0.5, 0.707] },
        ]);

        // Escritura incremental por fila (mode: 'ops')
        const opsRes = await invokeMiddleware('POST', '/__local_db/sync', {
            clientId: 'admin-chrome',
            mode: 'ops',
            upserts: {
                products: [{ ...savedProd, stock: 0 }],
            },
        });
        expect(opsRes.statusCode).toBe(200);
        expect(opsRes.data.revision).toBe(2);

        const afterOps = await invokeMiddleware('GET', '/__local_db/snapshot?tables=products');
        expect(afterOps.data.tables.products[0].stock).toBe(0);

        // Crear backup manual .sqlite en disco
        const backupRes = await invokeMiddleware('POST', '/__local_db/backup-now');
        expect(backupRes.statusCode).toBe(200);
        expect(backupRes.data.fileName).toMatch(/\.sqlite$/);
        expect(fs.existsSync(backupRes.data.fullPath)).toBe(true);
    });

    it('migra automáticamente un pos-db.json existente hacia pos.sqlite + imagenes/ al arrancar', async () => {
        middleware.close();
        const migrateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ropa-cbba-migrate-test-'));
        try {
            fs.writeFileSync(
                path.join(migrateDir, 'pos-db.json'),
                JSON.stringify({
                    version: 1,
                    initialized: true,
                    revision: 12,
                    tables: {
                        products: [
                            {
                                id: 5,
                                shortCode: '00005',
                                name: 'BLUSA SEDA',
                                stock: 3,
                                price: 180,
                                photo: SAMPLE_DATA_URL,
                                embedding: [0.1, 0.9],
                            },
                        ],
                        users: [{ id: 1, username: 'admin', role: 'admin', password: 'hash:real' }],
                    },
                }),
                'utf-8'
            );

            const migratedMw = crearMiddlewareLocalDiskDb({ dataDir: migrateDir });
            try {
                expect(fs.existsSync(path.join(migrateDir, 'pos.sqlite'))).toBe(true);
                expect(fs.existsSync(path.join(migrateDir, 'pos-db.migrado-sqlite.json'))).toBe(true);
                expect(migratedMw.store.getRevision()).toBe(13); // revision + 1 para forzar hidratación limpia
                expect(migratedMw.store.countImages()).toBe(1);

                const tables = migratedMw.store.getTables(['products', 'productEmbeddings']);
                expect(tables.products[0].photo).toMatch(/^\/__local_media\/00005-/);
                expect(tables.products[0].embedding).toBeUndefined();
                expect(tables.productEmbeddings).toHaveLength(1);
            } finally {
                migratedMw.close();
            }
        } finally {
            try {
                fs.rmSync(migrateDir, { recursive: true, force: true });
            } catch {
                // Ignorar
            }
        }
    });

    it('importa un backup JSON por streaming directo preservando contraseñas existentes cuando vienen con ***', async () => {
        // Admin con hash real, una apertura y el token. El archivo v10 no trae caja ni settings.
        await invokeMiddleware('POST', '/__local_db/sync', {
            mode: 'full',
            clientId: 'setup',
            tables: {
                users: [{ id: 1, username: 'admin', role: 'admin', password: 'salt123:realhash456' }],
                cashOpenings: [{ id: 7, date: '2026-11-22', userId: 1, openingAmount: 100 }],
                settings: [{ key: 'syncToken', value: 'token-vivo' }, { key: 'storeName', value: 'Vieja' }],
            },
        });

        const backupPayload = JSON.stringify({
            version: 10,
            exportedAt: '2026-11-23T20:00:00.000Z',
            data: {
                products: [{ id: 1, name: 'PANTALON', price: 200, stock: 2, photo: SAMPLE_DATA_URL }],
                users: [
                    { id: 1, username: 'admin', role: 'admin', password: '***' },
                    { id: 2, username: 'vendedora1', role: 'seller', password: '***' },
                ],
            },
        });

        const impRes = await invokeMiddleware('POST', '/__local_db/import-backup', backupPayload);
        expect(impRes.statusCode).toBe(200);
        expect(impRes.data.imagesCount).toBe(1);

        const snap = await invokeMiddleware('GET', '/__local_db/snapshot?tables=products,users,cashOpenings,settings');
        expect(snap.data.tables.products[0].photo).toMatch(/^\/__local_media\//);
        expect(snap.data.tables.users.find(u => u.username === 'admin').password).toBe('salt123:realhash456');
        // No se inventa 123456 para quien solo venía enmascarado.
        expect(snap.data.tables.users.find(u => u.username === 'vendedora1')).toBeUndefined();
        expect(snap.data.tables.cashOpenings).toEqual([
            expect.objectContaining({ id: 7, openingAmount: 100 }),
        ]);
        expect(snap.data.tables.settings.find(s => s.key === 'syncToken').value).toBe('token-vivo');
        expect(snap.data.tables.settings.find(s => s.key === 'storeName').value).toBe('Vieja');
    });

    it('un backup v12 escribe la caja y la copia sin secretos no borra el token', async () => {
        await invokeMiddleware('POST', '/__local_db/sync', {
            mode: 'full',
            clientId: 'setup',
            tables: {
                users: [{ id: 1, username: 'admin', role: 'admin', password: 'salt123:realhash456' }],
                settings: [{ key: 'syncToken', value: 'token-vivo' }, { key: 'storeName', value: 'Vieja' }],
                cashOpenings: [{ id: 3, openingAmount: 40 }],
            },
        });

        const backupPayload = JSON.stringify({
            version: 12,
            sinSecretos: true,
            data: {
                products: [{ id: 2, name: 'BLUSA', price: 80, stock: 1, shortCode: '00002' }],
                productEmbeddings: [],
                users: [{ id: 1, username: 'admin', role: 'admin', password: '***', claveOmitida: true }],
                settings: [{ key: 'storeName', value: 'Tienda CBBA' }],
                cashOpenings: [{ id: 1, date: '2026-11-24', userId: 1, openingAmount: 100 }],
                cashClosures: [{ id: 4, date: '2026-11-24', userId: 1, expectedCash: 150 }],
                cashClosureHistory: [],
                securityLogs: [],
            },
        });

        const impRes = await invokeMiddleware('POST', '/__local_db/import-backup', backupPayload);
        expect(impRes.statusCode).toBe(200);

        const snap = await invokeMiddleware('GET', '/__local_db/snapshot?tables=users,settings,cashOpenings,cashClosures,products');
        expect(snap.data.tables.users.find(u => u.username === 'admin').password).toBe('salt123:realhash456');
        expect(snap.data.tables.settings.find(s => s.key === 'syncToken').value).toBe('token-vivo');
        expect(snap.data.tables.settings.find(s => s.key === 'storeName').value).toBe('Tienda CBBA');
        expect(snap.data.tables.cashOpenings[0].openingAmount).toBe(100);
        expect(snap.data.tables.cashClosures[0].expectedCash).toBe(150);
        expect(snap.data.tables.products[0].name).toBe('BLUSA');
    });
});
