import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Dexie simulada: tablas en memoria con la API mínima que usa el cliente ──
const { estado, tabla } = vi.hoisted(() => {
    const estado = { products: [], barcodes: [], settings: new Map(), webEventos: new Map() };
    const tabla = (nombre) => ({
        toArray: async () => estado[nombre].map(x => ({ ...x })),
    });
    return { estado, tabla };
});
vi.mock('../db', () => ({
    db: {
        products: tabla('products'),
        barcodes: tabla('barcodes'),
        settings: {
            get: async (k) => (estado.settings.has(k) ? { key: k, value: estado.settings.get(k) } : undefined),
            put: async ({ key, value }) => { estado.settings.set(key, value); },
            bulkPut: async (filas) => { for (const f of filas) estado.settings.set(f.key, f.value); },
        },
        webEventos: { bulkGet: async (ids) => ids.map(id => estado.webEventos.get(id)) },
    },
    getLocalISOString: () => '2026-09-11T12:00:00.000',
    garantizarGlobalIds: async () => 0,
    obtenerConfigSyncV2: async () => ({
        dispositivoId: 'central-test', nombreDispositivo: 'Central', ultimoEventoAck: 0,
        auto: false, intervaloMin: 10, ultimaOk: null, ultimoError: null,
    }),
    idsEventosYaAplicados: async () => new Set(),
    aplicarPlanEventos: async (plan) => plan.resumen,
}));

import { sincronizarV2 } from '../utils/syncV2Cliente';

// Fixture real del dump del POS (09/09/2026): 02797 es etiqueta de una unidad de
// BRILLO y código de modelo de VICTORIANO.
const PRODUCTS = [
    { id: 2087, globalId: 'g-brillo', name: 'VESTIDO BRILLO', shortCode: '02786', size: 'S', color: 'VARIOS', stock: 2, price: 388, active: true },
    { id: 2098, globalId: 'g-victoriano', name: 'VESTIDO VICTORIANO', shortCode: '02797', size: 'S', color: 'CELESTE', stock: 1, price: 338, active: true },
];
const BARCODES = [
    { id: 2774, productId: 2087, barcode: '2007054225104', shortCode: '02796', used: false },
    { id: 2775, productId: 2087, barcode: '2007054226118', shortCode: '02797', used: false },
    { id: 2776, productId: 2087, barcode: '2007054226125', shortCode: '02798', used: true },
    { id: 2796, productId: 2098, barcode: '2007952407329', shortCode: '02818', used: false },
];

/**
 * Nube simulada a nivel HTTP: registra cada llamada y aplica las reglas del
 * protocolo relevantes para el cliente (aterrizaje idempotente por sesión y
 * validación de `esperadas` al finalizar). `fallas` permite programar errores
 * por ruta para probar reintentos e interrupciones.
 */
function nubeFalsa({ soportaEtiquetas = true, fallas = {} } = {}) {
    const llamadas = [];
    const staging = new Map(); // sesion → Map(clave → fila)
    let publicadas = new Map(); // clave → fila
    const respuesta = (status, data) => ({
        ok: status >= 200 && status < 300, status,
        text: async () => JSON.stringify(data),
    });
    const fetchFalso = vi.fn(async (url, init = {}) => {
        const u = new URL(url);
        const ruta = u.pathname;
        const body = init.body ? JSON.parse(init.body) : null;
        llamadas.push({ ruta, method: init.method || 'GET', body, query: Object.fromEntries(u.searchParams) });
        if (fallas[ruta]?.length) {
            const f = fallas[ruta].shift();
            if (f === 'red') throw new TypeError('Failed to fetch');
            return respuesta(f, { error: `falla programada ${f}` });
        }
        if (ruta === '/api/sync/v2/eventos') return respuesta(200, { ok: true, eventos: [], ultimoId: 0, hayMas: false });
        if (ruta === '/api/sync/v2/ack') return respuesta(200, { ok: true });
        if (ruta === '/api/sync/v2/snapshot') {
            return respuesta(200, { ok: true, creadasProductos: 0, creadasVariantes: 0, actualizadas: body.filas.length, adoptados: 0, codigosLiberados: 0, rechazadas: 0, detalle: [] });
        }
        if (ruta === '/api/sync/v2/etiquetas') {
            if (!soportaEtiquetas) return respuesta(404, { error: 'not found' });
            if (!staging.has(body.sesion)) staging.set(body.sesion, new Map());
            const s = staging.get(body.sesion);
            for (const e of body.etiquetas) s.set(`${e.etiqueta}|${e.globalId}`, e);
            return respuesta(200, { ok: true, recibidas: body.etiquetas.length, rechazadas: 0, detalle: [] });
        }
        if (ruta === '/api/sync/v2/finalizar') {
            let etiquetas = { ok: true, omitidas: true };
            if (body.etiquetas !== undefined) {
                const s = staging.get(body.sesion) || new Map();
                if (s.size < body.etiquetas.esperadas) {
                    return respuesta(409, { error: 'Etiquetas incompletas', motivo: 'etiquetas_incompletas' });
                }
                const retiradas = [...publicadas.keys()].filter(k => !s.has(k)).length;
                publicadas = new Map(s);
                staging.delete(body.sesion);
                etiquetas = { ok: true, publicadas: s.size, retiradas, sinProducto: 0, vistas: s.size, esperadas: body.etiquetas.esperadas };
            }
            return respuesta(200, { ok: true, vistos: body.productosEsperados, desactivados: 0, etiquetas });
        }
        return respuesta(404, { error: 'ruta desconocida' });
    });
    return { fetchFalso, llamadas, staging, get publicadas() { return publicadas; } };
}

beforeEach(() => {
    estado.products = PRODUCTS.map(p => ({ ...p }));
    estado.barcodes = BARCODES.map(b => ({ ...b }));
    estado.settings = new Map([['syncUrl', 'https://tienda.test'], ['syncToken', 'tok']]);
    estado.webEventos = new Map();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// Los reintentos del cliente esperan 1.5 s y 3 s reales entre intentos.
vi.setConfig({ testTimeout: 30000 });

describe('sincronizarV2 — etiquetas físicas en la misma sesión', () => {
    it('sube stock, luego etiquetas con el globalId de cada producto, y finaliza con esperadas = filas', async () => {
        const nube = nubeFalsa();
        vi.stubGlobal('fetch', nube.fetchFalso);

        const r = await sincronizarV2();

        const rutas = nube.llamadas.map(l => l.ruta);
        expect(rutas).toEqual([
            '/api/sync/v2/eventos',
            '/api/sync/v2/snapshot',
            '/api/sync/v2/etiquetas',
            '/api/sync/v2/finalizar',
            '/api/sync/v2/eventos',
        ]);
        const snap = nube.llamadas[1].body;
        const etq = nube.llamadas[2].body;
        const fin = nube.llamadas[3].body;
        expect(etq.sesion).toBe(snap.sesion);
        expect(etq.dispositivo).toBe('central-test');
        // Payload REAL construido desde products + barcodes: 02797 → BRILLO, 02818 → VICTORIANO
        expect(etq.etiquetas).toEqual([
            { etiqueta: '02796', globalId: 'g-brillo', disponible: true },
            { etiqueta: '02797', globalId: 'g-brillo', disponible: true },
            { etiqueta: '02798', globalId: 'g-brillo', disponible: false },
            { etiqueta: '02818', globalId: 'g-victoriano', disponible: true },
        ]);
        // y el snapshot sigue llevando el código de MODELO (02797 = VICTORIANO)
        expect(snap.filas.find(f => f.globalId === 'g-victoriano').codigo).toBe('02797');
        expect(fin.etiquetas).toEqual({ esperadas: 4 });
        expect(fin.productosEsperados).toBe(2);

        expect(r.etiquetas).toMatchObject({ soportado: true, filas: 4, lotes: 1, recibidas: 4, publicadas: 4, retiradas: 0, duplicadas: [] });
        expect([...nube.publicadas.keys()]).toEqual(['02796|g-brillo', '02797|g-brillo', '02798|g-brillo', '02818|g-victoriano']);
        expect(estado.settings.get('syncV2.ultimaOk')).toBe('2026-09-11T12:00:00.000');
    });

    it('tienda sin soporte (404 en etiquetas): sincroniza el stock igual y NO manda `etiquetas` en finalizar', async () => {
        const nube = nubeFalsa({ soportaEtiquetas: false });
        vi.stubGlobal('fetch', nube.fetchFalso);

        const r = await sincronizarV2();

        const fin = nube.llamadas.find(l => l.ruta === '/api/sync/v2/finalizar').body;
        expect('etiquetas' in fin).toBe(false);
        expect(r.etiquetas.soportado).toBe(false);
        expect(r.etiquetas.publicadas).toBe(0);
        expect(nube.publicadas.size).toBe(0);
        expect(estado.settings.get('syncV2.ultimaOk')).toBe('2026-09-11T12:00:00.000');
    });

    it('un 5xx en un lote de etiquetas se reintenta de forma idempotente y la sesión termina completa', async () => {
        const nube = nubeFalsa({ fallas: { '/api/sync/v2/etiquetas': [503] } });
        vi.stubGlobal('fetch', nube.fetchFalso);

        const r = await sincronizarV2();

        const intentos = nube.llamadas.filter(l => l.ruta === '/api/sync/v2/etiquetas');
        expect(intentos).toHaveLength(2);
        expect(intentos[0].body.sesion).toBe(intentos[1].body.sesion);
        expect(r.etiquetas.recibidas).toBe(4); // se cuenta una vez, no dos
        expect(nube.publicadas.size).toBe(4);
    });

    it('interrupción (red caída persistente al subir etiquetas): NO se finaliza y lo publicado no se toca', async () => {
        const nube = nubeFalsa({ fallas: { '/api/sync/v2/etiquetas': ['red', 'red', 'red'] } });
        vi.stubGlobal('fetch', nube.fetchFalso);

        await expect(sincronizarV2()).rejects.toThrow(/No se pudo contactar/);
        expect(nube.llamadas.some(l => l.ruta === '/api/sync/v2/finalizar')).toBe(false);
        expect(nube.publicadas.size).toBe(0);
        expect(String(estado.settings.get('syncV2.ultimoError'))).toMatch(/No se pudo contactar/);

        // Repetir la sync resuelve: sesión nueva, todo llega y se publica.
        const r = await sincronizarV2();
        expect(r.etiquetas.publicadas).toBe(4);
    });

    it('la nube rechaza el cierre si le faltan etiquetas (409) y el POS lo reporta como error accionable', async () => {
        const nube = nubeFalsa();
        // Simular pérdida silenciosa: la nube "olvida" el aterrizaje antes de finalizar.
        const original = nube.fetchFalso.getMockImplementation();
        nube.fetchFalso.mockImplementation(async (url, init) => {
            const r = await original(url, init);
            if (new URL(url).pathname === '/api/sync/v2/etiquetas') nube.staging.clear();
            return r;
        });
        vi.stubGlobal('fetch', nube.fetchFalso);

        await expect(sincronizarV2()).rejects.toThrow(/Etiquetas incompletas/);
        expect(nube.publicadas.size).toBe(0);
    });

    it('etiqueta vendida en mostrador entre dos syncs: la siguiente sesión la publica como no disponible y retira las que ya no existen', async () => {
        const nube = nubeFalsa();
        vi.stubGlobal('fetch', nube.fetchFalso);
        await sincronizarV2();
        expect(nube.publicadas.get('02796|g-brillo').disponible).toBe(true);

        // Venta en mostrador de 02796 + se elimina la unidad 02818 del POS.
        estado.barcodes.find(b => b.shortCode === '02796').used = true;
        estado.barcodes = estado.barcodes.filter(b => b.shortCode !== '02818');
        const r = await sincronizarV2();

        expect(nube.publicadas.get('02796|g-brillo').disponible).toBe(false);
        expect(nube.publicadas.has('02818|g-victoriano')).toBe(false);
        expect(r.etiquetas.retiradas).toBe(1);
        expect(r.etiquetas.publicadas).toBe(3);
    });

    it('POS sin unidades manda esperadas:0 explícito → la nube retira todas las asociaciones', async () => {
        const nube = nubeFalsa();
        vi.stubGlobal('fetch', nube.fetchFalso);
        await sincronizarV2();
        expect(nube.publicadas.size).toBe(4);

        estado.barcodes = [];
        const r = await sincronizarV2();
        const fin = nube.llamadas.filter(l => l.ruta === '/api/sync/v2/finalizar').at(-1).body;
        expect(fin.etiquetas).toEqual({ esperadas: 0 });
        expect(nube.publicadas.size).toBe(0);
        expect(r.etiquetas.retiradas).toBe(4);
    });

    it('un producto con muchas etiquetas viaja en varios lotes de la misma sesión', async () => {
        estado.barcodes = Array.from({ length: 1100 }, (_, i) => ({
            id: i + 1, productId: 2087, shortCode: String(i + 1).padStart(5, '0'), used: i % 3 === 0,
        }));
        const nube = nubeFalsa();
        vi.stubGlobal('fetch', nube.fetchFalso);

        const r = await sincronizarV2();

        const lotes = nube.llamadas.filter(l => l.ruta === '/api/sync/v2/etiquetas');
        expect(lotes.map(l => l.body.etiquetas.length)).toEqual([500, 500, 100]);
        expect(new Set(lotes.map(l => l.body.sesion)).size).toBe(1);
        expect(nube.llamadas.find(l => l.ruta === '/api/sync/v2/finalizar').body.etiquetas).toEqual({ esperadas: 1100 });
        expect(r.etiquetas).toMatchObject({ filas: 1100, lotes: 3, publicadas: 1100 });
    });
});
