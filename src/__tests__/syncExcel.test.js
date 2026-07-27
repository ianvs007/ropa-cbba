/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔄 TESTS DE SINCRONIZACIÓN CON TIENDA VIRTUAL — utils/syncExcel
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Lógica pura del ritual diario de sincronización (exportar stock / importar
 * ventas en línea). Se ejecuta en Node.js sin IndexedDB ni XLSX:
 *  - filasStockParaExportar: filtra inactivos y productos sin shortCode.
 *  - parsearVentasEnLinea: tolera encabezados con tildes/alias; las filas
 *    inválidas van a `errores` sin bloquear el resto.
 *  - cruzarVentas: cruce por shortCode, ya-importada, código no encontrado,
 *    stock insuficiente y caso feliz.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { filasStockParaExportar, parsearVentasEnLinea, cruzarVentas } from '../utils/syncExcel';

// ──────────────────────────────────────────────────────────────────────────────
// filasStockParaExportar
// ──────────────────────────────────────────────────────────────────────────────

describe('filasStockParaExportar', () => {
    const products = [
        { id: 1, shortCode: '00001', name: 'Vestido Floral', size: 'M', color: 'Rojo', stock: 5 },
        { id: 2, shortCode: '00002', name: 'Pantalón Jean', size: '32', color: 'Azul', stock: 0, active: false }, // inactivo
        { id: 3, shortCode: '', name: 'Blusa sin código', size: 'S', color: 'Blanco', stock: 3 },                 // sin shortCode
        { id: 4, shortCode: '00004', name: 'Falda Plisada', size: 'L', color: 'Negro', stock: 2.7 },              // stock decimal
        { id: 5, name: 'Sin campo shortCode', stock: -4 },                                                        // sin shortCode + stock negativo
    ];

    it('exporta solo productos activos con shortCode, con stock entero ≥ 0', () => {
        const { filas } = filasStockParaExportar(products);
        expect(filas).toHaveLength(2);
        expect(filas[0]).toEqual({
            codigo: '00001', nombre: 'Vestido Floral', talla: 'M', color: 'Rojo', stock: 5,
        });
        // El stock decimal se sanea a entero
        expect(filas[1]).toEqual({
            codigo: '00004', nombre: 'Falda Plisada', talla: 'L', color: 'Negro', stock: 2,
        });
    });

    it('devuelve aparte los activos sin shortCode para advertir', () => {
        const { sinCodigo } = filasStockParaExportar(products);
        expect(sinCodigo).toHaveLength(2);
        expect(sinCodigo.map(p => p.id)).toEqual([3, 5]);
    });

    it('con lista vacía devuelve ambos arrays vacíos', () => {
        expect(filasStockParaExportar([])).toEqual({ filas: [], sinCodigo: [] });
        expect(filasStockParaExportar()).toEqual({ filas: [], sinCodigo: [] });
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// parsearVentasEnLinea
// ──────────────────────────────────────────────────────────────────────────────

describe('parsearVentasEnLinea', () => {
    it('parsea las columnas EXACTAS que exporta la nube', () => {
        const rows = [{
            codigo: '00001', nombre: 'Vestido Floral', talla: 'M', color: 'Rojo',
            cantidad: 2, precio_unit: 150, estado: 'pagado',
            pedido: 'AB12CD34', fecha: '2026-07-27 10:30:00',
        }];
        const { ventas, errores } = parsearVentasEnLinea(rows);
        expect(errores).toHaveLength(0);
        expect(ventas).toEqual([{
            codigo: '00001', nombre: 'Vestido Floral', talla: 'M', color: 'Rojo',
            cantidad: 2, precioUnit: 150, estado: 'pagado',
            pedido: 'AB12CD34', fecha: '2026-07-27 10:30:00',
        }]);
    });

    it('acepta encabezados con tildes, mayúsculas y alias', () => {
        const rows = [{
            'Código': '00007', 'Producto': 'Polo', 'Size': 'L', 'COLOR': 'Verde',
            'Cant': 3, 'Precio Unitario': 80, 'ESTADO': 'PENDIENTE_PAGO',
            'Referencia': 'ZX98CV76', 'Fecha': '2026-07-26 18:00:00',
        }];
        const { ventas, errores } = parsearVentasEnLinea(rows);
        expect(errores).toHaveLength(0);
        expect(ventas).toHaveLength(1);
        expect(ventas[0].codigo).toBe('00007');
        expect(ventas[0].nombre).toBe('Polo');
        expect(ventas[0].talla).toBe('L');
        expect(ventas[0].cantidad).toBe(3);
        expect(ventas[0].precioUnit).toBe(80);
        expect(ventas[0].estado).toBe('pendiente_pago'); // normalizado a minúsculas
        expect(ventas[0].pedido).toBe('ZX98CV76');
    });

    it('las filas inválidas van a errores y no bloquean las válidas', () => {
        const rows = [
            { codigo: '00001', cantidad: 1, fecha: '2026-07-27 09:00:00' },  // válida
            { codigo: '', cantidad: 2 },                                      // sin código
            { codigo: '00003', cantidad: 0 },                                 // cantidad cero
            { codigo: '00004', cantidad: 2.5 },                               // cantidad no entera
            { codigo: '00005', cantidad: 'dos' },                             // cantidad no numérica
            { codigo: '00006', cantidad: 4, fecha: '2026-07-27 11:00:00' },  // válida
        ];
        const { ventas, errores } = parsearVentasEnLinea(rows);
        expect(ventas.map(v => v.codigo)).toEqual(['00001', '00006']);
        expect(errores).toHaveLength(4);
        // Los errores mencionan la fila real de Excel (1 = encabezados)
        expect(errores[0]).toContain('Fila 3');
        expect(errores[1]).toContain('Fila 4');
    });

    it('codigo numérico de Excel se convierte a string para el cruce', () => {
        const { ventas } = parsearVentasEnLinea([{ codigo: 1, cantidad: 1 }]);
        expect(ventas[0].codigo).toBe('1');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// cruzarVentas
// ──────────────────────────────────────────────────────────────────────────────

describe('cruzarVentas', () => {
    const products = [
        { id: 10, shortCode: '00001', name: 'Vestido Floral', stock: 5 },
        { id: 11, shortCode: '00002', name: 'Pantalón Jean', stock: 1 },
    ];

    const ventaBase = {
        codigo: '00001', nombre: 'Vestido', talla: 'M', color: 'Rojo',
        cantidad: 2, precioUnit: 150, estado: 'pagado',
        pedido: 'AB12CD34', fecha: '2026-07-27 10:00:00',
    };

    it('caso feliz: cruza por shortCode y descuenta la cantidad completa', () => {
        const [fila] = cruzarVentas([ventaBase], products, null);
        expect(fila.productId).toBe(10);
        expect(fila.nombreLocal).toBe('Vestido Floral');
        expect(fila.stockActual).toBe(5);
        expect(fila.aDescontar).toBe(2);
        expect(fila.aviso).toBeNull();
    });

    it('ya importada: fecha <= ultimaImportacion no vuelve a descontar', () => {
        const ultima = '2026-07-27 10:00:00'; // igual a la fecha de la venta
        const [fila] = cruzarVentas([ventaBase], products, ultima);
        expect(fila.aDescontar).toBe(0);
        expect(fila.aviso).toBe('Ya importada anteriormente');
    });

    it('código no encontrado: no descuenta y avisa', () => {
        const venta = { ...ventaBase, codigo: '99999' };
        const [fila] = cruzarVentas([venta], products, null);
        expect(fila.productId).toBeNull();
        expect(fila.aDescontar).toBe(0);
        expect(fila.aviso).toBe('Código no encontrado en el sistema local');
    });

    it('stock insuficiente: descuenta solo lo que hay y avisa', () => {
        const venta = { ...ventaBase, codigo: '00002', cantidad: 3 };
        const [fila] = cruzarVentas([venta], products, null);
        expect(fila.productId).toBe(11);
        expect(fila.stockActual).toBe(1);
        expect(fila.aDescontar).toBe(1);
        expect(fila.aviso).toBe('Stock insuficiente: se descuenta 1 de 3');
    });

    it('el aviso de ya-importada tiene prioridad sobre los demás', () => {
        const venta = { ...ventaBase, codigo: '99999', fecha: '2026-07-20 08:00:00' };
        const [fila] = cruzarVentas([venta], products, '2026-07-27 00:00:00');
        expect(fila.aviso).toBe('Ya importada anteriormente');
        expect(fila.aDescontar).toBe(0);
    });

    it('la comparación de fechas es por string (YYYY-MM-DD HH:MM:SS)', () => {
        // Venta POSTERIOR a la última importación → sí descuenta
        const venta = { ...ventaBase, fecha: '2026-07-27 10:00:01' };
        const [fila] = cruzarVentas([venta], products, '2026-07-27 10:00:00');
        expect(fila.aDescontar).toBe(2);
        expect(fila.aviso).toBeNull();
    });
});
