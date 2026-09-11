import { describe, it, expect } from 'vitest';
import {
    trocear,
    armarFilasSnapshot,
    armarFilasEtiquetas,
    normalizarEtiqueta,
    planificarAplicacionEventos,
    mensajeErrorHttp,
    debeSincronizarAuto,
    PREFIJO_REF_WEB,
    TAM_LOTE_ETIQUETAS,
} from '../utils/syncV2';

// Fixture mínima tomada del dump real del POS (pos-productos.json, 09/09/2026):
// dos productos y cuatro etiquetas. 02797 es a la vez etiqueta de una unidad de
// VESTIDO BRILLO y código de MODELO de VESTIDO VICTORIANO.
const FIXTURE_PRODUCTS = [
    { id: 2087, globalId: 'g-brillo', name: 'VESTIDO BRILLO', shortCode: '02786', size: 'S', color: 'VARIOS', stock: 2, price: 388, active: true },
    { id: 2098, globalId: 'g-victoriano', name: 'VESTIDO VICTORIANO', shortCode: '02797', size: 'S', color: 'CELESTE', stock: 1, price: 338, active: true },
];
const FIXTURE_BARCODES = [
    { id: 2774, productId: 2087, barcode: '2007054225104', shortCode: '02796', used: false },
    { id: 2775, productId: 2087, barcode: '2007054226118', shortCode: '02797', used: false },
    { id: 2776, productId: 2087, barcode: '2007054226125', shortCode: '02798', used: true },
    { id: 2796, productId: 2098, barcode: '2007952407329', shortCode: '02818', used: false },
];

const prod = (extra) => ({
    id: 1, globalId: 'g-1', shortCode: '00001', name: 'VESTIDO ROJO', size: 'M', color: 'ROJO',
    stock: 3, price: 150, active: true, ...extra,
});
const evento = (extra) => ({
    id: 10, tipo: 'venta', globalId: 'g-1', codigo: '00001', nombre: 'VESTIDO ROJO', talla: 'M', color: 'ROJO',
    delta: -1, pedidoRef: 'ABCDEF01', creadoEn: '2026-09-10 12:00:00', ...extra,
});

describe('trocear', () => {
    it('parte en lotes del tamaño pedido y el último es más corto', () => {
        const lotes = trocear([1, 2, 3, 4, 5], 2);
        expect(lotes).toEqual([[1, 2], [3, 4], [5]]);
    });
    it('lista vacía → sin lotes', () => {
        expect(trocear([], 250)).toEqual([]);
    });
});

describe('armarFilasSnapshot', () => {
    it('solo activos con shortCode y globalId; cuenta productos distintos', () => {
        const r = armarFilasSnapshot([
            prod(),
            prod({ id: 2, globalId: '', shortCode: '00002' }),
            prod({ id: 3, globalId: 'g-3', shortCode: '' }),
            prod({ id: 4, globalId: 'g-4', shortCode: '00004', active: false }),
        ]);
        expect(r.filas).toHaveLength(1);
        expect(r.sinGlobalId).toHaveLength(1);
        expect(r.sinCodigo).toHaveLength(1);
        expect(r.productosDistintos).toBe(1);
        expect(r.filas[0]).toEqual({
            globalId: 'g-1', codigo: '00001', nombre: 'VESTIDO ROJO', talla: 'M', color: 'ROJO', stock: 3, precio: 150,
        });
    });
    it('stock y precio se sanean', () => {
        const r = armarFilasSnapshot([prod({ stock: -2.7, price: 'x' })]);
        expect(r.filas[0].stock).toBe(0);
        expect(r.filas[0].precio).toBe(0);
    });
});

describe('normalizarEtiqueta (estricta, idéntica a la nube)', () => {
    it('acepta 1 a 5 dígitos y conserva/rellena ceros a la izquierda', () => {
        expect(normalizarEtiqueta('02797')).toBe('02797');
        expect(normalizarEtiqueta('2797')).toBe('02797');
        expect(normalizarEtiqueta(' 42 ')).toBe('00042');
        expect(normalizarEtiqueta('00001')).toBe('00001');
    });
    it('nunca convierte un código inválido en válido', () => {
        expect(normalizarEtiqueta('027970')).toBeNull();   // 6 dígitos: no se recorta
        expect(normalizarEtiqueta('2797a')).toBeNull();    // letras: no se limpia
        expect(normalizarEtiqueta('02 797')).toBeNull();
        expect(normalizarEtiqueta('')).toBeNull();
        expect(normalizarEtiqueta(null)).toBeNull();
        expect(normalizarEtiqueta(undefined)).toBeNull();
        expect(normalizarEtiqueta('2007054226118')).toBeNull(); // un EAN no es etiqueta corta
    });
});

describe('armarFilasEtiquetas (payload real del POS a partir de products + barcodes)', () => {
    it('caso 02797: cada etiqueta viaja con el globalId de SU producto y su disponibilidad', () => {
        const r = armarFilasEtiquetas(FIXTURE_PRODUCTS, FIXTURE_BARCODES);
        expect(r.filas).toEqual([
            { etiqueta: '02796', globalId: 'g-brillo', disponible: true },
            { etiqueta: '02797', globalId: 'g-brillo', disponible: true },
            { etiqueta: '02798', globalId: 'g-brillo', disponible: false },
            { etiqueta: '02818', globalId: 'g-victoriano', disponible: true },
        ]);
        expect(r.duplicadas).toEqual([]);
        expect(r.invalidas).toEqual([]);
        expect(r.omitidasSinPublicar).toBe(0);
        // El snapshot de productos sigue mandando el código de MODELO: 02797 es
        // VICTORIANO ahí y BRILLO en las etiquetas. Ambas cosas viajan; la nube
        // resuelve la etiqueta primero.
        const snap = armarFilasSnapshot(FIXTURE_PRODUCTS);
        expect(snap.filas.find(f => f.codigo === '02797').globalId).toBe('g-victoriano');
        expect(snap.filas.find(f => f.codigo === '02786').globalId).toBe('g-brillo');
    });

    it('la etiqueta vendida (02798) viaja con disponible:false, no se omite', () => {
        const r = armarFilasEtiquetas(FIXTURE_PRODUCTS, FIXTURE_BARCODES);
        expect(r.filas.find(f => f.etiqueta === '02798')).toEqual({ etiqueta: '02798', globalId: 'g-brillo', disponible: false });
    });

    it('omite unidades de productos archivados, sin código o sin globalId (no van en el snapshot)', () => {
        const products = [
            ...FIXTURE_PRODUCTS,
            { id: 3, globalId: 'g-arch', name: 'ARCHIVADA', shortCode: '00003', stock: 1, price: 1, active: false },
            { id: 4, globalId: '', name: 'SIN GLOBAL', shortCode: '00004', stock: 1, price: 1, active: true },
            { id: 5, globalId: 'g-sin-cod', name: 'SIN CODIGO', shortCode: '', stock: 1, price: 1, active: true },
        ];
        const barcodes = [
            ...FIXTURE_BARCODES,
            { id: 30, productId: 3, shortCode: '00030', used: false },
            { id: 40, productId: 4, shortCode: '00040', used: false },
            { id: 50, productId: 5, shortCode: '00050', used: false },
            { id: 60, productId: 999, shortCode: '00060', used: false }, // unidad huérfana
        ];
        const r = armarFilasEtiquetas(products, barcodes);
        expect(r.filas.map(f => f.etiqueta)).toEqual(['02796', '02797', '02798', '02818']);
        expect(r.omitidasSinPublicar).toBe(4);
    });

    it('etiqueta repetida en productos DISTINTOS: se envían ambas y se reporta el conflicto', () => {
        const barcodes = [...FIXTURE_BARCODES, { id: 9, productId: 2098, shortCode: '02797', used: false }];
        const r = armarFilasEtiquetas(FIXTURE_PRODUCTS, barcodes);
        expect(r.filas.filter(f => f.etiqueta === '02797')).toEqual([
            { etiqueta: '02797', globalId: 'g-brillo', disponible: true },
            { etiqueta: '02797', globalId: 'g-victoriano', disponible: true },
        ]);
        expect(r.duplicadas).toEqual([{
            etiqueta: '02797',
            productos: [
                { id: 2087, name: 'VESTIDO BRILLO', globalId: 'g-brillo' },
                { id: 2098, name: 'VESTIDO VICTORIANO', globalId: 'g-victoriano' },
            ],
        }]);
    });

    it('misma etiqueta dos veces en el MISMO producto: una fila, disponible si alguna unidad lo está', () => {
        const barcodes = [
            { id: 1, productId: 2087, shortCode: '02796', used: true },
            { id: 2, productId: 2087, shortCode: '02796', used: false },
        ];
        const r = armarFilasEtiquetas(FIXTURE_PRODUCTS, barcodes);
        expect(r.filas).toEqual([{ etiqueta: '02796', globalId: 'g-brillo', disponible: true }]);
        expect(r.duplicadas).toEqual([]);
    });

    it('códigos inválidos se omiten y se listan (nunca se "arreglan"); "2797" sí se normaliza a 02797', () => {
        const barcodes = [
            { id: 1, productId: 2087, shortCode: '2797', used: false },
            { id: 2, productId: 2087, shortCode: 'ABC12', used: false },
            { id: 3, productId: 2087, shortCode: '', used: false },
            { id: 4, productId: 2087, shortCode: '123456', used: false },
        ];
        const r = armarFilasEtiquetas(FIXTURE_PRODUCTS, barcodes);
        expect(r.filas).toEqual([{ etiqueta: '02797', globalId: 'g-brillo', disponible: true }]);
        expect(r.invalidas.map(i => i.shortCode)).toEqual(['ABC12', '', '123456']);
    });

    it('un producto con muchas etiquetas se trocea en lotes acotados', () => {
        const barcodes = Array.from({ length: 1201 }, (_, i) => ({
            id: i + 1, productId: 2087, shortCode: String(i + 1).padStart(5, '0'), used: false,
        }));
        const r = armarFilasEtiquetas(FIXTURE_PRODUCTS, barcodes);
        expect(r.filas).toHaveLength(1201);
        const lotes = trocear(r.filas, TAM_LOTE_ETIQUETAS);
        expect(lotes).toHaveLength(3);
        expect(lotes[0]).toHaveLength(500);
        expect(lotes[2]).toHaveLength(201);
    });

    it('sin unidades → lista vacía explícita (la nube retira lo publicado solo si se manda esperadas:0)', () => {
        const r = armarFilasEtiquetas(FIXTURE_PRODUCTS, []);
        expect(r.filas).toEqual([]);
    });
});

describe('planificarAplicacionEventos', () => {
    it('venta: descuenta stock, marca la primera unidad libre (FIFO) con la ref web y arma kardex de salida', () => {
        const barcodes = [
            { id: 11, productId: 1, used: true, shortCode: '00011' },
            { id: 12, productId: 1, used: false, shortCode: '00012' },
            { id: 13, productId: 1, used: false, shortCode: '00013' },
        ];
        const plan = planificarAplicacionEventos({ eventos: [evento()], products: [prod()], barcodes });
        expect(plan.operaciones).toHaveLength(1);
        const op = plan.operaciones[0];
        expect(op.stockAnterior).toBe(3);
        expect(op.stockNuevo).toBe(2);
        expect(op.unidadesAMarcar.map(u => u.id)).toEqual([12]);
        expect(op.kardex).toEqual({ type: 'salida', qty: 1, notes: 'VENTA EN LÍNEA #ABCDEF01' });
        expect(op.aviso).toBeNull();
        expect(plan.ultimoId).toBe(10);
        expect(plan.resumen).toMatchObject({ eventos: 1, aplicados: 1, unidadesDescontadas: 1, huerfanos: 0, saltados: 0 });
    });

    it('evento ya aplicado se salta (idempotencia por id)', () => {
        const plan = planificarAplicacionEventos({
            eventos: [evento()], products: [prod()], barcodes: [], yaAplicados: new Set([10]),
        });
        expect(plan.operaciones).toHaveLength(0);
        expect(plan.saltados).toEqual([10]);
        expect(plan.ultimoId).toBe(10);
    });

    it('venta con stock insuficiente descuenta lo disponible y avisa', () => {
        const plan = planificarAplicacionEventos({
            eventos: [evento({ delta: -2 })], products: [prod({ stock: 1 })], barcodes: [],
        });
        const op = plan.operaciones[0];
        expect(op.stockNuevo).toBe(0);
        expect(op.delta).toBe(-1);
        expect(op.aviso).toMatch(/insuficiente/);
        expect(plan.resumen.avisos).toBe(1);
    });

    it('cancelación repone stock y libera SOLO unidades marcadas por ese pedido web', () => {
        const barcodes = [
            { id: 11, productId: 1, used: true, usedRef: `${PREFIJO_REF_WEB}ABCDEF01`, shortCode: '00011' },
            { id: 12, productId: 1, used: true, usedRef: '', shortCode: '00012' }, // vendida en mostrador
        ];
        const plan = planificarAplicacionEventos({
            eventos: [evento({ id: 20, tipo: 'cancelacion', delta: 1 })], products: [prod({ stock: 1 })], barcodes,
        });
        const op = plan.operaciones[0];
        expect(op.stockNuevo).toBe(2);
        expect(op.unidadesALiberar.map(u => u.id)).toEqual([11]);
        expect(op.kardex.type).toBe('entrada');
        expect(op.kardex.notes).toBe('CANCELACIÓN WEB #ABCDEF01');
        expect(op.aviso).toBeNull();
    });

    it('cancelación sin unidades propias repone stock igual y avisa (no toca etiquetas de mostrador)', () => {
        const barcodes = [{ id: 12, productId: 1, used: true, usedRef: '', shortCode: '00012' }];
        const plan = planificarAplicacionEventos({
            eventos: [evento({ id: 21, tipo: 'expiracion', delta: 1 })], products: [prod({ stock: 0 })], barcodes,
        });
        const op = plan.operaciones[0];
        expect(op.stockNuevo).toBe(1);
        expect(op.unidadesALiberar).toEqual([]);
        expect(op.aviso).toMatch(/etiqueta/);
        expect(op.kardex.notes).toBe('EXPIRACIÓN WEB #ABCDEF01');
    });

    it('venta y su cancelación en la misma página se encadenan: stock y unidad vuelven al inicio', () => {
        const barcodes = [{ id: 12, productId: 1, used: false, shortCode: '00012' }];
        const plan = planificarAplicacionEventos({
            eventos: [evento({ id: 31, tipo: 'cancelacion', delta: 1 }), evento({ id: 30 })],
            products: [prod({ stock: 1 })],
            barcodes,
        });
        expect(plan.operaciones.map(o => o.eventoId)).toEqual([30, 31]);
        expect(plan.operaciones[0].stockNuevo).toBe(0);
        expect(plan.operaciones[1].stockNuevo).toBe(1);
        expect(plan.operaciones[1].unidadesALiberar.map(u => u.id)).toEqual([12]);
    });

    it('producto inexistente → huérfano (no bloquea la página); ultimoId igual avanza', () => {
        const plan = planificarAplicacionEventos({
            eventos: [evento({ id: 40, globalId: 'g-nope' }), evento({ id: 41 })],
            products: [prod()], barcodes: [],
        });
        expect(plan.huerfanos).toHaveLength(1);
        expect(plan.huerfanos[0]).toMatchObject({ eventoId: 40, motivo: expect.stringMatching(/g-nope/) });
        expect(plan.operaciones).toHaveLength(1);
        expect(plan.ultimoId).toBe(41);
    });

    it('evento sin globalId cae por código (venta anterior al bootstrap); con globalId NO usa el código', () => {
        const conCodigo = planificarAplicacionEventos({
            eventos: [evento({ id: 50, globalId: '', codigo: '00001' })], products: [prod()], barcodes: [],
        });
        expect(conCodigo.operaciones).toHaveLength(1);

        const otroGlobal = planificarAplicacionEventos({
            eventos: [evento({ id: 51, globalId: 'g-otro', codigo: '00001' })], products: [prod()], barcodes: [],
        });
        expect(otroGlobal.operaciones).toHaveLength(0);
        expect(otroGlobal.huerfanos).toHaveLength(1);
    });

    it('no muta los productos ni las unidades recibidas', () => {
        const products = [prod()];
        const barcodes = [{ id: 12, productId: 1, used: false }];
        planificarAplicacionEventos({ eventos: [evento()], products, barcodes });
        expect(products[0].stock).toBe(3);
        expect(barcodes[0].used).toBe(false);
    });
});

describe('mensajeErrorHttp', () => {
    it('traduce los códigos relevantes', () => {
        expect(mensajeErrorHttp(401, {})).toMatch(/Token inválido/);
        expect(mensajeErrorHttp(503, {})).toMatch(/token configurado/);
        expect(mensajeErrorHttp(404, {})).toMatch(/v2/);
        expect(mensajeErrorHttp(409, { error: 'Snapshot incompleto' }, 'finalizar')).toBe('Snapshot incompleto (finalizar)');
        expect(mensajeErrorHttp(500, null, 'lote 2/5')).toMatch(/sin JSON/);
        expect(mensajeErrorHttp(500, { error: 'boom' })).toMatch(/boom/);
    });
});

describe('debeSincronizarAuto', () => {
    const ahora = new Date('2026-09-10T15:00:00Z');
    it('apagado → nunca', () => {
        expect(debeSincronizarAuto({ auto: false, ultimaOk: null, ahora })).toBe(false);
    });
    it('encendido sin última OK → sí', () => {
        expect(debeSincronizarAuto({ auto: true, ultimaOk: null, ahora })).toBe(true);
    });
    it('respeta el intervalo', () => {
        expect(debeSincronizarAuto({ auto: true, ultimaOk: '2026-09-10T14:55:00Z', intervaloMin: 10, ahora })).toBe(false);
        expect(debeSincronizarAuto({ auto: true, ultimaOk: '2026-09-10T14:49:00Z', intervaloMin: 10, ahora })).toBe(true);
    });
    it('fecha corrupta → sí (mejor sincronizar de más)', () => {
        expect(debeSincronizarAuto({ auto: true, ultimaOk: 'no-fecha', ahora })).toBe(true);
    });
});
