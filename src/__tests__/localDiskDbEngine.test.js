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

    it('aplica parches parciales, reemplazos completos y borrado total (wipe)', () => {
        const inicial = aplicarCambioEstadoDisco(null, {
            mode: 'full',
            clientId: 'tab-1',
            now: '2026-11-15T10:00:00.000Z',
            tables: {
                products: [{ id: 1, name: 'FALDA', stock: 1 }],
                branches: [{ id: 1, name: 'SUCURSAL 1' }],
            },
        });
        expect(inicial.initialized).toBe(true);
        expect(inicial.revision).toBe(1);
        expect(inicial.tables.products).toHaveLength(1);
        expect(inicial.tables.branches).toHaveLength(1);

        const parchado = aplicarCambioEstadoDisco(inicial, {
            mode: 'patch',
            clientId: 'tab-2',
            now: '2026-11-15T10:05:00.000Z',
            tables: {
                products: [
                    { id: 1, name: 'FALDA', stock: 1 },
                    { id: 2, name: 'ABRIGO', stock: 2 },
                ],
            },
        });
        expect(parchado.revision).toBe(2);
        expect(parchado.updatedTables).toEqual(['products']);
        expect(parchado.tables.products).toHaveLength(2);
        expect(parchado.tables.branches).toHaveLength(1);

        const borrado = aplicarCambioEstadoDisco(parchado, {
            mode: 'wipe',
            clientId: 'tab-1',
            now: '2026-11-15T10:10:00.000Z',
        });
        expect(borrado.initialized).toBe(false);
        expect(borrado.revision).toBe(3);
        expect(borrado.tables.products).toHaveLength(0);
    });
});

describe('Middleware HTTP de Base de Datos en Disco Local', () => {
    let tmpDir;
    let middleware;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ropa-cbba-disk-test-'));
        middleware = crearMiddlewareLocalDiskDb({ dataDir: tmpDir });
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Ignorar
        }
    });

    function invokeMiddleware(method, url, bodyObj = null) {
        return new Promise((resolve, reject) => {
            const req = new EventEmitter();
            req.method = method;
            req.url = url;
            // La propia máquina central: loopback + Host local (no requiere token)
            req.headers = { host: 'localhost:3001' };
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
                            data: payload ? JSON.parse(payload) : null,
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
                req.emit('data', Buffer.from(JSON.stringify(bodyObj), 'utf-8'));
            }
            req.emit('end');
        });
    }

    it('persiste cambios en pos-db.json y genera respaldos en disco', async () => {
        const stInicial = await invokeMiddleware('GET', '/__local_db/status');
        expect(stInicial.statusCode).toBe(200);
        expect(stInicial.data.initialized).toBe(false);

        const syncRes = await invokeMiddleware('POST', '/__local_db/sync', {
            clientId: 'admin-chrome',
            mode: 'full',
            tables: {
                products: [{ id: 10, name: 'VESTIDO GALA', shortCode: '00450', stock: 1 }],
                barcodes: [{ id: 100, productId: 10, shortCode: '00450', used: false }],
                users: [{ id: 1, username: 'admin', role: 'admin' }],
            },
        });
        expect(syncRes.statusCode).toBe(200);
        expect(syncRes.data.initialized).toBe(true);
        expect(syncRes.data.revision).toBe(1);
        expect(fs.existsSync(path.join(tmpDir, 'pos-db.json'))).toBe(true);

        // Otro navegador pide el snapshot
        const snapRes = await invokeMiddleware('GET', '/__local_db/snapshot?tables=products,barcodes');
        expect(snapRes.statusCode).toBe(200);
        expect(snapRes.data.tables.products).toHaveLength(1);
        expect(snapRes.data.tables.products[0].shortCode).toBe('00450');

        // Crear backup manual en disco
        const backupRes = await invokeMiddleware('POST', '/__local_db/backup-now');
        expect(backupRes.statusCode).toBe(200);
        expect(fs.existsSync(backupRes.data.fullPath)).toBe(true);
    });
});
