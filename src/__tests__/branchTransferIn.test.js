import { describe, it, expect } from 'vitest';
import {
    normalizarCodigoSucursal,
    sugerirCodigoLibre,
    evaluarCodigoSucursal,
    evaluarLoteCodigosSucursal,
    construirNotaKardexSucursal,
    planificarIngresoSucursal,
} from '../utils/branchTransferIn';

describe('branchTransferIn — ingreso de mercadería desde sucursal', () => {
    describe('normalizarCodigoSucursal', () => {
        it('rellena a 5 dígitos cuando recibe de 1 a 5 dígitos válidos', () => {
            expect(normalizarCodigoSucursal('7')).toBe('00007');
            expect(normalizarCodigoSucursal('145')).toBe('00145');
            expect(normalizarCodigoSucursal('02797')).toBe('02797');
            expect(normalizarCodigoSucursal(99999)).toBe('99999');
        });

        it('rechaza vacíos, ceros, letras o más de 5 dígitos', () => {
            expect(normalizarCodigoSucursal('')).toBeNull();
            expect(normalizarCodigoSucursal('   ')).toBeNull();
            expect(normalizarCodigoSucursal('0')).toBeNull();
            expect(normalizarCodigoSucursal('00000')).toBeNull();
            expect(normalizarCodigoSucursal('12A45')).toBeNull();
            expect(normalizarCodigoSucursal('100000')).toBeNull();
        });
    });

    describe('evaluarCodigoSucursal', () => {
        const products = [
            { id: 10, name: 'VESTIDO GALA', size: 'M', color: 'ROJO', shortCode: '00100', stock: 1 },
            { id: 20, name: 'BLUSA SEDA', size: 'S', color: 'BLANCO', shortCode: '00200', stock: 0 },
        ];
        const barcodes = [
            { id: 1, productId: 10, shortCode: '00101', barcode: '2000000000101', used: false },
            { id: 2, productId: 10, shortCode: '00102', barcode: '2000000000102', used: true },
            {
                id: 3,
                productId: 20,
                shortCode: '00201',
                barcode: '2000000000201',
                used: true,
                transferStatus: 'traslado',
                transferTo: 'SUCURSAL NORTE',
            },
        ];

        it('aprueba un código libre y lo normaliza a 5 dígitos', () => {
            const res = evaluarCodigoSucursal({
                rawCode: '350',
                products,
                barcodes,
            });
            expect(res.valido).toBe(true);
            expect(res.status).toBe('disponible');
            expect(res.action).toBe('insert');
            expect(res.shortCode).toBe('00350');
        });

        it('detecta colisión cuando el código pertenece a una unidad activa en la tienda principal', () => {
            const res = evaluarCodigoSucursal({
                rawCode: '101',
                products,
                barcodes,
                targetProductId: 20,
            });
            expect(res.valido).toBe(false);
            expect(res.status).toBe('colision');
            expect(res.conflictType).toBe('unidad_activa');
            expect(res.conflictProduct?.name).toBe('VESTIDO GALA');
        });

        it('detecta colisión cuando el código pertenece a una unidad ya vendida localmente', () => {
            const res = evaluarCodigoSucursal({
                rawCode: '00102',
                products,
                barcodes,
                targetProductId: 10,
            });
            expect(res.valido).toBe(false);
            expect(res.status).toBe('colision');
            expect(res.conflictType).toBe('unidad_vendida');
        });

        it('detecta colisión cuando el código es el shortCode de modelo de otro producto', () => {
            const res = evaluarCodigoSucursal({
                rawCode: '00100',
                products,
                barcodes,
                targetProductId: 20,
            });
            expect(res.valido).toBe(false);
            expect(res.status).toBe('colision');
            expect(res.conflictType).toBe('codigo_modelo');
            expect(res.conflictProduct?.id).toBe(10);
        });

        it('permite usar el mismo shortCode del modelo destino cuando se ingresa stock a ese mismo producto', () => {
            const res = evaluarCodigoSucursal({
                rawCode: '00200',
                products,
                barcodes,
                targetProductId: 20,
            });
            expect(res.valido).toBe(true);
            expect(res.status).toBe('disponible');
            expect(res.shortCode).toBe('00200');
        });

        it('reconoce como retorno válido una unidad que había salido a sucursal del mismo producto', () => {
            const res = evaluarCodigoSucursal({
                rawCode: '201',
                products,
                barcodes,
                targetProductId: 20,
            });
            expect(res.valido).toBe(true);
            expect(res.status).toBe('retorno_mismo_producto');
            expect(res.action).toBe('reactivate');
            expect(res.existingUnit?.id).toBe(3);
            expect(res.originBranchSuggested).toBe('SUCURSAL NORTE');
        });

        it('advierte si el código es de un traslado previo pero de otro producto distinto', () => {
            const res = evaluarCodigoSucursal({
                rawCode: '201',
                products,
                barcodes,
                targetProductId: 10,
            });
            expect(res.valido).toBe(false);
            expect(res.status).toBe('retorno_otro_producto');
            expect(res.conflictProduct?.id).toBe(20);
        });
    });

    describe('evaluarLoteCodigosSucursal', () => {
        it('marca error si se repite el mismo código dentro del mismo lote', () => {
            const lote = evaluarLoteCodigosSucursal({
                rawCodes: ['00500', '500'],
                products: [],
                barcodes: [],
            });
            expect(lote.valido).toBe(false);
            expect(lote.erroresCount).toBe(2);
            expect(lote.items[0].status).toBe('duplicado_en_lote');
            expect(lote.items[1].status).toBe('duplicado_en_lote');
        });

        it('aprueba un lote multi-unidad con códigos nuevos y retornos combinados', () => {
            const products = [{ id: 5, name: 'JEAN CLASICO', shortCode: '00050', stock: 1 }];
            const barcodes = [
                {
                    id: 99,
                    productId: 5,
                    shortCode: '00051',
                    barcode: '2000000000051',
                    used: true,
                    transferStatus: 'traslado',
                    transferTo: 'SUCURSAL SUR',
                },
            ];
            const lote = evaluarLoteCodigosSucursal({
                rawCodes: ['00051', '00890'],
                products,
                barcodes,
                targetProductId: 5,
            });
            expect(lote.valido).toBe(true);
            expect(lote.retornosCount).toBe(1);
            expect(lote.nuevosCount).toBe(1);
        });
    });

    describe('planificarIngresoSucursal', () => {
        it('alinea automáticamente product.shortCode = unit.shortCode cuando es producto nuevo de 1 prenda', () => {
            let eanCounter = 1;
            const plan = planificarIngresoSucursal({
                modo: 'producto_nuevo',
                originBranch: 'Sucursal 1',
                notes: 'Pedido cliente web',
                rawCodes: ['1450'],
                products: [{ id: 1, shortCode: '00010' }],
                barcodes: [{ id: 1, productId: 1, shortCode: '00010' }],
                fallbackModelShortCode: '00011',
                buildEAN: () => `200000000000${eanCounter++}`,
            });

            expect(plan.originBranch).toBe('SUCURSAL 1');
            expect(plan.modelShortCode).toBe('01450');
            expect(plan.stockNuevo).toBe(1);
            expect(plan.unidadesAInsertar).toEqual([
                {
                    shortCode: '01450',
                    barcode: '2000000000001',
                    originBranch: 'SUCURSAL 1',
                },
            ]);
            expect(plan.kardexNotes).toBe('INGRESO DESDE SUCURSAL 1 — PEDIDO CLIENTE WEB');
        });

        it('asigna un shortCode de modelo libre cuando un producto nuevo trae varias unidades de sucursal', () => {
            let eanCounter = 1;
            const plan = planificarIngresoSucursal({
                modo: 'producto_nuevo',
                originBranch: 'Sucursal Centro',
                rawCodes: ['00011', '00012'],
                products: [{ id: 1, shortCode: '00010' }],
                barcodes: [],
                fallbackModelShortCode: '00011', // colisiona con la primera unidad del lote
                buildEAN: () => `200000000000${eanCounter++}`,
            });

            expect(plan.modelShortCode).toBe('00013');
            expect(plan.unidadesAInsertar.map((u) => u.shortCode)).toEqual(['00011', '00012']);
            expect(plan.stockNuevo).toBe(2);
        });

        it('planifica inserciones y reactivaciones de retorno sobre un producto existente', () => {
            const targetProduct = { id: 7, name: 'CHAMARRA CUERO', shortCode: '00700', stock: 2 };
            const barcodes = [
                {
                    id: 40,
                    productId: 7,
                    shortCode: '00701',
                    barcode: '2009999999701',
                    used: true,
                    transferStatus: 'traslado',
                    transferTo: 'SUCURSAL 2',
                },
            ];
            const plan = planificarIngresoSucursal({
                modo: 'producto_existente',
                originBranch: 'Sucursal 2',
                notes: 'Devolución de temporada',
                rawCodes: ['00701', '00950'],
                products: [targetProduct],
                barcodes,
                targetProduct,
                buildEAN: () => '2009999999950',
            });

            expect(plan.stockAnterior).toBe(2);
            expect(plan.stockNuevo).toBe(4);
            expect(plan.unidadesAReactivar).toHaveLength(1);
            expect(plan.unidadesAReactivar[0]).toMatchObject({
                id: 40,
                shortCode: '00701',
                barcode: '2009999999701',
                originBranch: 'SUCURSAL 2',
            });
            expect(plan.unidadesAInsertar).toHaveLength(1);
            expect(plan.unidadesAInsertar[0]).toMatchObject({
                shortCode: '00950',
                barcode: '2009999999950',
                originBranch: 'SUCURSAL 2',
            });
            expect(plan.kardexNotes).toBe('RETORNO/INGRESO DESDE SUCURSAL 2 — DEVOLUCIÓN DE TEMPORADA');
        });
    });

    describe('sugerirCodigoLibre y construirNotaKardexSucursal', () => {
        it('sugiere max + 1 considerando products, barcodes y el lote en edición', () => {
            const codigo = sugerirCodigoLibre(
                [{ shortCode: '00005' }],
                [{ shortCode: '00008' }],
                ['00009']
            );
            expect(codigo).toBe('00010');
        });

        it('construye nota limpia cuando no hay motivo extra', () => {
            expect(construirNotaKardexSucursal({ originBranch: 'Sucursal 1' })).toBe(
                'INGRESO DESDE SUCURSAL 1'
            );
        });
    });
});
