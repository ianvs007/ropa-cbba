import { describe, it, expect } from 'vitest';
import {
    trocear,
    armarFilasSnapshot,
    planificarAplicacionEventos,
    mensajeErrorHttp,
    debeSincronizarAuto,
    PREFIJO_REF_WEB,
} from '../utils/syncV2';

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
