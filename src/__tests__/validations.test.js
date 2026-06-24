import { describe, it, expect } from 'vitest';
import {
    validateRequired,
    validateMinLength,
    validatePositiveNumber,
    validateNonNegativeNumber,
    validateMaxValue,
    validateAll,
    normalizeText,
    normalizeUsername,
    safeParseFloat,
    safeParseInt,
} from '../utils/validations';

describe('validations', () => {
    describe('validateRequired', () => {
        it('retorna error para valores vacíos', () => {
            expect(validateRequired('', 'Nombre')).toBe('Nombre es obligatorio');
            expect(validateRequired('   ', 'Nombre')).toBe('Nombre es obligatorio');
            expect(validateRequired(null, 'Nombre')).toBe('Nombre es obligatorio');
            expect(validateRequired(undefined, 'Nombre')).toBe('Nombre es obligatorio');
        });

        it('retorna null para valores válidos', () => {
            expect(validateRequired('hola')).toBeNull();
            expect(validateRequired('  texto  ')).toBeNull();
        });
    });

    describe('validateMinLength', () => {
        it('retorna error si es menor al mínimo', () => {
            expect(validateMinLength('ab', 3, 'Usuario')).toBe('Usuario debe tener al menos 3 caracteres');
        });

        it('retorna null si cumple el mínimo', () => {
            expect(validateMinLength('abc', 3)).toBeNull();
            expect(validateMinLength('abcd', 3)).toBeNull();
        });
    });

    describe('validatePositiveNumber', () => {
        it('retorna error para valores no positivos', () => {
            expect(validatePositiveNumber(0, 'Precio')).toBe('Precio debe ser mayor a 0');
            expect(validatePositiveNumber(-5, 'Precio')).toBe('Precio debe ser mayor a 0');
            expect(validatePositiveNumber('abc', 'Precio')).toBe('Precio debe ser mayor a 0');
        });

        it('retorna null para valores positivos', () => {
            expect(validatePositiveNumber(1)).toBeNull();
            expect(validatePositiveNumber(0.01)).toBeNull();
            expect(validatePositiveNumber('15.50')).toBeNull();
        });
    });

    describe('validateNonNegativeNumber', () => {
        it('rechaza negativos', () => {
            expect(validateNonNegativeNumber(-1, 'Stock')).toBe('Stock no puede ser negativo');
        });

        it('acepta cero y positivos', () => {
            expect(validateNonNegativeNumber(0)).toBeNull();
            expect(validateNonNegativeNumber(10)).toBeNull();
        });
    });

    describe('validateMaxValue', () => {
        it('rechaza valores que superan el máximo', () => {
            expect(validateMaxValue(150, 100, 'Descuento')).toBe('Descuento no puede superar 100');
        });

        it('acepta valores dentro del rango', () => {
            expect(validateMaxValue(50, 100)).toBeNull();
            expect(validateMaxValue(100, 100)).toBeNull();
        });
    });

    describe('validateAll', () => {
        it('retorna el primer error encontrado', () => {
            const result = validateAll(
                null,
                null,
                'Error aquí',
                'Otro error',
            );
            expect(result).toBe('Error aquí');
        });

        it('retorna null si todas las validaciones pasan', () => {
            expect(validateAll(null, null, null)).toBeNull();
        });
    });

    describe('normalizeText', () => {
        it('limpia y convierte a mayúsculas', () => {
            expect(normalizeText('  hola mundo  ')).toBe('HOLA MUNDO');
            expect(normalizeText(null)).toBe('');
            expect(normalizeText(undefined)).toBe('');
        });
    });

    describe('normalizeUsername', () => {
        it('limpia y convierte a minúsculas', () => {
            expect(normalizeUsername('  Admin  ')).toBe('admin');
        });
    });

    describe('safeParseFloat / safeParseInt', () => {
        it('parsea correctamente', () => {
            expect(safeParseFloat('15.50')).toBe(15.5);
            expect(safeParseInt('10')).toBe(10);
        });

        it('retorna fallback para valores inválidos', () => {
            expect(safeParseFloat('abc')).toBe(0);
            expect(safeParseFloat('abc', 99)).toBe(99);
            expect(safeParseInt('xyz', -1)).toBe(-1);
        });
    });
});
