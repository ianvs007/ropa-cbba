/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔐 TESTS DE PERMISOS GRANULARES — Tienda de Ropas
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * permissions.js es JS puro sin dependencias de DOM/Dexie, así que aquí importamos
 * y probamos la función REAL hasPermission() (no un modelo).
 *
 * Reglas verificadas:
 *   (a) El admin principal (username 'admin') puede TODO.
 *   (b) Un admin secundario con permissions {} no puede NADA (acceso mínimo).
 *   (c) Un admin secundario solo puede lo que tenga tildado.
 *   (d) Un seller nunca puede (no usa este sistema).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { hasPermission, PERMISSIONS, PERMISSION_LABELS } from '../utils/permissions';

const ALL_PERMS = Object.values(PERMISSIONS);

describe('hasPermission', () => {
    it('(a) el admin principal (username "admin") puede TODO', () => {
        const admin = { username: 'admin', role: 'admin' }; // incluso sin objeto permissions
        ALL_PERMS.forEach(perm => {
            expect(hasPermission(admin, perm)).toBe(true);
        });
        // Y también si por error tuviera permissions vacío
        expect(hasPermission({ username: 'admin', role: 'admin', permissions: {} }, PERMISSIONS.BACKUP)).toBe(true);
    });

    it('(b) un admin secundario con permissions {} no puede NADA', () => {
        const sub = { username: 'maria', role: 'admin', permissions: {} };
        ALL_PERMS.forEach(perm => {
            expect(hasPermission(sub, perm)).toBe(false);
        });
        // permissions undefined se trata como {} → tampoco puede
        const subSinPerms = { username: 'jose', role: 'admin' };
        expect(hasPermission(subSinPerms, PERMISSIONS.SETTINGS)).toBe(false);
    });

    it('(c) un admin secundario solo puede lo que tenga tildado', () => {
        const sub = { username: 'maria', role: 'admin', permissions: { [PERMISSIONS.SETTINGS]: true } };
        expect(hasPermission(sub, PERMISSIONS.SETTINGS)).toBe(true);
        // El resto sigue bloqueado
        expect(hasPermission(sub, PERMISSIONS.BACKUP)).toBe(false);
        expect(hasPermission(sub, PERMISSIONS.MANAGE_USERS)).toBe(false);
        expect(hasPermission(sub, PERMISSIONS.EDIT_PRODUCTS)).toBe(false);
        expect(hasPermission(sub, PERMISSIONS.DELETE_PRODUCT)).toBe(false);
        // false explícito también bloquea
        const sub2 = { username: 'ana', role: 'admin', permissions: { [PERMISSIONS.BACKUP]: false } };
        expect(hasPermission(sub2, PERMISSIONS.BACKUP)).toBe(false);
    });

    it('(d) un seller nunca puede, aunque traiga permissions tildados', () => {
        const seller = { username: 'vendedor1', role: 'seller', permissions: { [PERMISSIONS.SETTINGS]: true } };
        ALL_PERMS.forEach(perm => {
            expect(hasPermission(seller, perm)).toBe(false);
        });
    });

    it('usuario nulo/indefinido devuelve false (sin crashear)', () => {
        expect(hasPermission(null, PERMISSIONS.SETTINGS)).toBe(false);
        expect(hasPermission(undefined, PERMISSIONS.BACKUP)).toBe(false);
    });

    it('PERMISSIONS y PERMISSION_LABELS están alineados (mismas llaves)', () => {
        // Cada valor de PERMISSIONS debe tener su etiqueta legible
        ALL_PERMS.forEach(permValue => {
            expect(PERMISSION_LABELS[permValue]).toBeTruthy();
        });
        expect(Object.keys(PERMISSION_LABELS).sort()).toEqual([...ALL_PERMS].sort());
    });
});
