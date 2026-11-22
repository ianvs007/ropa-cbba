import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, esHashValido, migrarContrasenasLegacy } from '../utils/crypto';

describe('crypto - hashPassword / verifyPassword', () => {
    it('genera un hash con formato salt:hash', async () => {
        const hash = await hashPassword('miPassword123');
        expect(hash).toContain(':');
        const [salt, derived] = hash.split(':');
        expect(salt.length).toBe(32); // 16 bytes = 32 hex chars
        expect(derived.length).toBe(64); // 256 bits = 32 bytes = 64 hex chars
    });

    it('genera hashes diferentes para la misma contraseña (salt aleatorio)', async () => {
        const hash1 = await hashPassword('mismaPassword');
        const hash2 = await hashPassword('mismaPassword');
        expect(hash1).not.toBe(hash2);
    });

    it('verifica correctamente una contraseña válida', async () => {
        const hash = await hashPassword('admin123');
        const result = await verifyPassword('admin123', hash);
        expect(result).toBe(true);
    });

    it('rechaza una contraseña incorrecta', async () => {
        const hash = await hashPassword('admin123');
        const result = await verifyPassword('wrongPassword', hash);
        expect(result).toBe(false);
    });

    it('ya NO acepta contraseñas legacy en texto plano', async () => {
        expect(await verifyPassword('admin123', 'admin123')).toBe(false);
        expect(await verifyPassword('wrong', 'admin123')).toBe(false);
    });

    it('rechaza valores guardados vacíos, corruptos o no string', async () => {
        expect(await verifyPassword('x', '')).toBe(false);
        expect(await verifyPassword('x', undefined)).toBe(false);
        expect(await verifyPassword('x', null)).toBe(false);
        expect(await verifyPassword('x', 'abc:def')).toBe(false);
        expect(await verifyPassword(undefined, await hashPassword('x'))).toBe(false);
    });

    it('una contraseña legacy con ":" tampoco pasa como texto plano', async () => {
        expect(await verifyPassword('a:b', 'a:b')).toBe(false);
    });
});

describe('crypto - esHashValido', () => {
    it('reconoce el formato salt:hash generado por hashPassword', async () => {
        expect(esHashValido(await hashPassword('clave'))).toBe(true);
    });

    it('rechaza texto plano y formatos incorrectos', () => {
        expect(esHashValido('admin123')).toBe(false);
        expect(esHashValido('a:b')).toBe(false);
        expect(esHashValido('')).toBe(false);
        expect(esHashValido(undefined)).toBe(false);
        expect(esHashValido(`${'a'.repeat(31)}:${'b'.repeat(64)}`)).toBe(false);
    });
});

describe('crypto - migrarContrasenasLegacy', () => {
    it('hashea solo las contraseñas en texto plano y deja intactas las demás', async () => {
        const yaHasheada = await hashPassword('segura');
        const users = [
            { id: 1, username: 'admin', password: 'admin123' },
            { id: 2, username: 'ana', password: yaHasheada },
            { id: 3, username: 'sin-clave' },
            { id: 4, username: 'vacia', password: '' },
            { id: 5, username: 'conDosPuntos', password: 'a:b' },
        ];
        const cambios = await migrarContrasenasLegacy(users);

        expect(cambios.map(c => c.id)).toEqual([1, 5]);
        expect(await verifyPassword('admin123', cambios[0].password)).toBe(true);
        expect(await verifyPassword('a:b', cambios[1].password)).toBe(true);
    });

    it('es idempotente: aplicar los cambios y volver a migrar no produce nada', async () => {
        const users = [{ id: 1, password: 'plana' }];
        const [cambio] = await migrarContrasenasLegacy(users);
        users[0].password = cambio.password;
        expect(await migrarContrasenasLegacy(users)).toEqual([]);
    });

    it('tolera listas vacías o indefinidas', async () => {
        expect(await migrarContrasenasLegacy([])).toEqual([]);
        expect(await migrarContrasenasLegacy(undefined)).toEqual([]);
    });
});
