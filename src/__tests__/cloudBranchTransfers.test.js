import { describe, it, expect } from 'vitest';
import {
    normalizarNombreSucursal,
    crearPaqueteTraslado,
    validarPaqueteTraslado,
    filtrarBandejaEntrante,
    buscarProductoCompatibleLocal,
} from '../utils/cloudBranchTransfers';

describe('Buzón de Traslados en la Nube (cloudBranchTransfers)', () => {
    it('normaliza nombres de sucursal a mayúsculas sin espacios laterales', () => {
        expect(normalizarNombreSucursal('  sucursal 1 ')).toBe('SUCURSAL 1');
        expect(normalizarNombreSucursal(null)).toBe('');
    });

    it('crea y valida un paquete estándar de traslado entre sucursales', () => {
        const pkg = crearPaqueteTraslado({
            originBranch: 'sucursal 1',
            destinationBranch: 'tienda principal',
            notes: 'reposicion urgente',
            user: { id: 3, name: 'Ana' },
            product: {
                id: 12,
                globalId: 'gid-123',
                name: 'Vestido Gala',
                category: 'Vestidos',
                brand: 'Zara',
                size: 'M',
                color: 'Rojo',
                cost: 120,
                price: 250,
            },
            unit: {
                id: 88,
                shortCode: '450',
                barcode: '2001234567890',
            },
            transferUid: 'uid-test-1',
            createdAt: '2026-11-15T12:00:00.000Z',
        });

        expect(pkg.originBranch).toBe('SUCURSAL 1');
        expect(pkg.destinationBranch).toBe('TIENDA PRINCIPAL');
        expect(pkg.status).toBe('en_transito');
        expect(pkg.items[0].shortCode).toBe('00450');
        expect(pkg.items[0].globalId).toBe('gid-123');

        const check = validarPaqueteTraslado(pkg);
        expect(check.valido).toBe(true);
        expect(check.paquete.items[0].name).toBe('VESTIDO GALA');
    });

    it('rechaza paquetes incompletos o con códigos cortos inválidos', () => {
        expect(validarPaqueteTraslado(null).valido).toBe(false);
        expect(
            validarPaqueteTraslado({
                transferUid: 'u1',
                originBranch: 'SUCURSAL 1',
                destinationBranch: 'TIENDA PRINCIPAL',
                items: [{ shortCode: 'ABC', name: 'BLUSA' }],
            }).valido
        ).toBe(false);
    });

    it('filtra la bandeja entrante por tienda destino y excluye los ya recibidos', () => {
        const envios = [
            {
                transferUid: 't-1',
                originBranch: 'SUCURSAL 1',
                destinationBranch: 'TIENDA PRINCIPAL',
                status: 'en_transito',
                createdAt: '2026-11-15T10:00:00Z',
                items: [{ shortCode: '00101', name: 'BLUSA' }],
            },
            {
                transferUid: 't-2',
                originBranch: 'SUCURSAL 1',
                destinationBranch: 'SUCURSAL 2',
                status: 'en_transito',
                createdAt: '2026-11-15T11:00:00Z',
                items: [{ shortCode: '00102', name: 'JEAN' }],
            },
            {
                transferUid: 't-3',
                originBranch: 'SUCURSAL 2',
                destinationBranch: 'TIENDA PRINCIPAL',
                status: 'en_transito',
                createdAt: '2026-11-15T12:00:00Z',
                items: [{ shortCode: '00103', name: 'POLERA' }],
            },
        ];

        const bandeja = filtrarBandejaEntrante(envios, 'TIENDA PRINCIPAL', new Set(['t-1']));
        expect(bandeja).toHaveLength(1);
        expect(bandeja[0].transferUid).toBe('t-3');
    });

    it('encuentra producto compatible en el catálogo local por globalId o por nombre+talla+color', () => {
        const products = [
            { id: 1, globalId: 'g-1', name: 'FALDA', size: 'S', color: 'NEGRO', active: true },
            { id: 2, globalId: 'g-2', name: 'BLUSA', size: 'M', color: 'BLANCO', active: true },
            { id: 3, globalId: 'g-3', name: 'BLUSA', size: 'M', color: 'ROJO', active: false },
        ];

        expect(buscarProductoCompatibleLocal({ globalId: 'g-1', name: 'OTRO' }, products)?.id).toBe(1);
        expect(
            buscarProductoCompatibleLocal({ name: 'blusa', size: 'm', color: 'blanco' }, products)?.id
        ).toBe(2);
        expect(
            buscarProductoCompatibleLocal({ name: 'blusa', size: 'm', color: 'rojo' }, products)
        ).toBeNull();
    });
});
