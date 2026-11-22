import { describe, it, expect, vi } from 'vitest';
import { confirmarContrasenaAdmin } from '../utils/adminAuth';
import { hashPassword } from '../utils/crypto';

describe('confirmarContrasenaAdmin', () => {
    it('acepta la contraseña correcta de un admin activo (con hash real)', async () => {
        const admin = { id: 1, role: 'admin', active: true, password: await hashPassword('Tienda-2026!') };
        expect(await confirmarContrasenaAdmin(admin, 'Tienda-2026!')).toEqual({ ok: true });
    });

    it('rechaza una contraseña incorrecta', async () => {
        const admin = { id: 1, role: 'admin', password: await hashPassword('Tienda-2026!') };
        expect(await confirmarContrasenaAdmin(admin, 'otra')).toEqual({ ok: false, error: 'Contraseña incorrecta' });
    });

    it('rechaza contraseña vacía sin llegar a verificar', async () => {
        const verificar = vi.fn();
        const r = await confirmarContrasenaAdmin({ role: 'admin', password: 'x' }, '', verificar);
        expect(r.ok).toBe(false);
        expect(verificar).not.toHaveBeenCalled();
    });

    it('rechaza a un vendedor aunque la contraseña sea correcta', async () => {
        const verificar = vi.fn().mockResolvedValue(true);
        const r = await confirmarContrasenaAdmin({ role: 'seller', password: 'h' }, 'clave', verificar);
        expect(r.ok).toBe(false);
        expect(verificar).not.toHaveBeenCalled();
    });

    it('rechaza a un admin desactivado o inexistente', async () => {
        const verificar = vi.fn().mockResolvedValue(true);
        expect((await confirmarContrasenaAdmin({ role: 'admin', active: false, password: 'h' }, 'c', verificar)).ok).toBe(false);
        expect((await confirmarContrasenaAdmin(undefined, 'c', verificar)).ok).toBe(false);
        expect((await confirmarContrasenaAdmin(null, 'c', verificar)).ok).toBe(false);
        expect(verificar).not.toHaveBeenCalled();
    });

    it('un usuario con contraseña legacy en texto plano no puede confirmar', async () => {
        const r = await confirmarContrasenaAdmin({ role: 'admin', password: 'admin123' }, 'admin123');
        expect(r.ok).toBe(false);
    });
});
