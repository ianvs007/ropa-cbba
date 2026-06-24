import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../utils/crypto';

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

    it('soporta verificación legacy (texto plano sin :)', async () => {
        const result = await verifyPassword('admin123', 'admin123');
        expect(result).toBe(true);
    });

    it('rechaza verificación legacy incorrecta', async () => {
        const result = await verifyPassword('wrong', 'admin123');
        expect(result).toBe(false);
    });
});
