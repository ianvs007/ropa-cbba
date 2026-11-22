import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import {
    crearMiddlewareLocalDiskDb,
    obtenerOCrearTokenLocalDb,
} from '../server/localDiskDbPlugin.js';

const TOKEN = 'f'.repeat(48);

/**
 * Levanta el middleware REAL sobre un servidor HTTP en loopback. Para simular a otra PC de
 * la red se envía un `Host` con la IP de la LAN: el servidor ve un acceso "no local".
 */
function crearServidor(options = {}) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-localdb-'));
    const middleware = crearMiddlewareLocalDiskDb({ dataDir, token: TOKEN, ...options });
    const server = http.createServer((req, res) => {
        middleware(req, res, () => {
            res.statusCode = 404;
            res.end('fuera-del-plugin');
        });
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, dataDir, port: server.address().port });
        });
    });
}

function pedir(port, { method = 'GET', url, headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                method,
                path: url,
                headers: {
                    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                    ...headers,
                },
            },
            res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const texto = Buffer.concat(chunks).toString('utf-8');
                    let json = null;
                    try { json = JSON.parse(texto); } catch { /* respuesta no JSON */ }
                    resolve({ status: res.statusCode, json, texto });
                });
            }
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

const COMO_RED = { Host: '192.168.1.20:3001' };

describe('middleware /__local_db con autenticación', () => {
    let ctx;
    beforeAll(async () => { ctx = await crearServidor(); });
    afterAll(() => {
        ctx.server.close();
        fs.rmSync(ctx.dataDir, { recursive: true, force: true });
    });

    it('la central (loopback + Host local) opera sin token', async () => {
        const r = await pedir(ctx.port, { url: '/__local_db/status', headers: { Host: `localhost:${ctx.port}` } });
        expect(r.status).toBe(200);
        expect(r.json.ok).toBe(true);
        expect(r.json.dbPath).toBeTruthy();
    });

    it('otra PC de la red sin token no puede leer snapshot ni status (401)', async () => {
        for (const url of ['/__local_db/snapshot', '/__local_db/status']) {
            const r = await pedir(ctx.port, { url, headers: COMO_RED });
            expect(r.status).toBe(401);
            expect(r.json.ok).toBe(false);
        }
    });

    it('otra PC de la red NO puede escribir (sync full / wipe) sin token y la BD no cambia', async () => {
        const intento = await pedir(ctx.port, {
            method: 'POST',
            url: '/__local_db/sync',
            headers: COMO_RED,
            body: { clientId: 'atacante', mode: 'full', tables: { users: [{ id: 1, username: 'hacker', password: 'x' }] } },
        });
        expect(intento.status).toBe(401);

        const borrado = await pedir(ctx.port, {
            method: 'POST',
            url: '/__local_db/sync',
            headers: COMO_RED,
            body: { clientId: 'atacante', mode: 'wipe' },
        });
        expect(borrado.status).toBe(401);

        const estado = await pedir(ctx.port, { url: '/__local_db/snapshot', headers: { Host: `localhost:${ctx.port}` } });
        expect(estado.json.revision).toBe(0);
        expect(estado.json.tables.users).toEqual([]);
    });

    it('token incorrecto en la red es 401; token correcto da acceso pero sin rutas del disco', async () => {
        const mal = await pedir(ctx.port, { url: '/__local_db/status', headers: { ...COMO_RED, 'X-POS-Token': 'x'.repeat(48) } });
        expect(mal.status).toBe(401);

        const bien = await pedir(ctx.port, { url: '/__local_db/status', headers: { ...COMO_RED, 'X-POS-Token': TOKEN } });
        expect(bien.status).toBe(200);
        expect(bien.json.dbPath).toBeUndefined();
        expect(bien.json.backupsDir).toBeUndefined();
    });

    it('con token la red puede sincronizar y la central ve el cambio', async () => {
        const escritura = await pedir(ctx.port, {
            method: 'POST',
            url: '/__local_db/sync',
            headers: { ...COMO_RED, 'X-POS-Token': TOKEN },
            body: { clientId: 'pc-2', mode: 'patch', tables: { categories: [{ id: 1, name: 'Blusas' }] } },
        });
        expect(escritura.status).toBe(200);
        expect(escritura.json.revision).toBeGreaterThan(0);

        const lectura = await pedir(ctx.port, {
            url: '/__local_db/snapshot?tables=categories',
            headers: { Host: `localhost:${ctx.port}` },
        });
        expect(lectura.json.tables.categories).toEqual([{ id: 1, name: 'Blusas' }]);
    });

    it('el stream SSE exige token y lo acepta por query (EventSource no envía cabeceras)', async () => {
        const sinToken = await pedir(ctx.port, { url: '/__local_db/stream', headers: COMO_RED });
        expect(sinToken.status).toBe(401);

        const statusConToken = await new Promise((resolve, reject) => {
            const req = http.get(
                { host: '127.0.0.1', port: ctx.port, path: `/__local_db/stream?token=${TOKEN}`, headers: COMO_RED },
                res => {
                    resolve(res.statusCode);
                    res.destroy();
                }
            );
            req.on('error', reject);
        });
        expect(statusConToken).toBe(200);
    });

    it('un Host externo desde loopback (DNS rebinding) exige token', async () => {
        const r = await pedir(ctx.port, { url: '/__local_db/status', headers: { Host: 'evil.example.com:3001' } });
        expect(r.status).toBe(401);
    });

    it('una web de otro origen no puede usar la central aunque sea loopback (403)', async () => {
        const r = await pedir(ctx.port, {
            method: 'POST',
            url: '/__local_db/sync',
            headers: { Host: `localhost:${ctx.port}`, Origin: 'https://sitio-malicioso.com' },
            body: { clientId: 'csrf', mode: 'wipe' },
        });
        expect(r.status).toBe(403);
    });

    it('/__local_db/token solo se entrega a la central', async () => {
        const local = await pedir(ctx.port, { url: '/__local_db/token', headers: { Host: `localhost:${ctx.port}` } });
        expect(local.status).toBe(200);
        expect(local.json.token).toBe(TOKEN);

        const red = await pedir(ctx.port, { url: '/__local_db/token', headers: { ...COMO_RED, 'X-POS-Token': TOKEN } });
        expect(red.status).toBe(403);
        expect(red.json.token).toBeUndefined();
    });

    it('rutas fuera de /__local_db pasan al siguiente middleware', async () => {
        const r = await pedir(ctx.port, { url: '/index.html', headers: COMO_RED });
        expect(r.status).toBe(404);
        expect(r.texto).toBe('fuera-del-plugin');
    });
});

describe('confiarLoopback desactivado', () => {
    it('la central también necesita el token', async () => {
        const ctx = await crearServidor({ confiarLoopback: false });
        try {
            const sin = await pedir(ctx.port, { url: '/__local_db/status', headers: { Host: `localhost:${ctx.port}` } });
            expect(sin.status).toBe(401);
            const con = await pedir(ctx.port, {
                url: '/__local_db/status',
                headers: { Host: `localhost:${ctx.port}`, 'X-POS-Token': TOKEN },
            });
            expect(con.status).toBe(200);
        } finally {
            ctx.server.close();
            fs.rmSync(ctx.dataDir, { recursive: true, force: true });
        }
    });
});

describe('obtenerOCrearTokenLocalDb', () => {
    it('genera un token aleatorio, lo persiste y lo reutiliza', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-token-'));
        try {
            const a = obtenerOCrearTokenLocalDb(dir, {});
            expect(a).toMatch(/^[0-9a-f]{48}$/);
            expect(obtenerOCrearTokenLocalDb(dir, {})).toBe(a);
            expect(fs.readFileSync(path.join(dir, '.local-db-token'), 'utf-8').trim()).toBe(a);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('prefiere POS_LOCAL_DB_TOKEN y exige un largo mínimo', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-token-'));
        try {
            expect(obtenerOCrearTokenLocalDb(dir, { POS_LOCAL_DB_TOKEN: 'z'.repeat(20) })).toBe('z'.repeat(20));
            expect(() => obtenerOCrearTokenLocalDb(dir, { POS_LOCAL_DB_TOKEN: 'corto' })).toThrow(/al menos/);
            expect(fs.existsSync(path.join(dir, '.local-db-token'))).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('regenera si el archivo guardado es demasiado corto', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-token-'));
        try {
            fs.writeFileSync(path.join(dir, '.local-db-token'), 'abc');
            expect(obtenerOCrearTokenLocalDb(dir, {})).toMatch(/^[0-9a-f]{48}$/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
