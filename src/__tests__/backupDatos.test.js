/**
 * El backup tiene que poder restaurar caja y usuarios.
 * Enmascarar la clave con *** impide volver a entrar: el archivo completo
 * guarda el hash. La copia sin secretos los omite y lo dice.
 */

import { describe, it, expect } from 'vitest';
import {
    TABLAS_CAJA,
    VERSION_BACKUP,
    armarBackup,
    armarBackupSinSecretos,
    planificarImportacion,
} from '../utils/backupDatos';

const HASH = 'aabbccdd:00112233445566778899aabbccddeeff';

function tablasDePrueba() {
    return {
        products: [{ id: 1, name: 'POLERA', shortCode: '00001', globalId: 'gid-1', stock: 3 }],
        sales: [{ id: 1, total: 25, paymentMethod: 'efectivo', received: 30 }],
        users: [
            { id: 1, username: 'admin', name: 'Administrador', role: 'admin', password: HASH },
            { id: 2, username: 'cajera', name: 'Cajera', role: 'seller', password: HASH },
        ],
        settings: [
            { key: 'storeName', value: 'Tienda CBBA' },
            { key: 'currency', value: 'Bs.' },
            { key: 'syncToken', value: 'token-secreto' },
        ],
        cashOpenings: [{ id: 1, date: '2026-11-22', userId: 2, openingAmount: 100 }],
        cashClosures: [{ id: 4, date: '2026-11-22', userId: 2, expectedCash: 150 }],
        cashClosureHistory: [{ id: 1, closureId: 4, date: '2026-11-22' }],
        securityLogs: [{ id: 9, eventType: 'login', userId: 2 }],
        webEventos: [],
    };
}

describe('armarBackup', () => {
    it('incluye aperturas, cierres, historial y logs', () => {
        const backup = armarBackup(tablasDePrueba(), { exportedAt: '2026-11-22T12:00:00.000Z' });
        expect(backup.version).toBe(VERSION_BACKUP);
        for (const tabla of TABLAS_CAJA) {
            expect(backup.data[tabla].length).toBeGreaterThan(0);
        }
        expect(backup.data.cashOpenings[0].openingAmount).toBe(100);
        expect(backup.data.cashClosures[0].expectedCash).toBe(150);
    });

    it('no reemplaza el hash de la contraseña por ***', () => {
        const backup = armarBackup(tablasDePrueba(), { exportedAt: '2026-11-22T12:00:00.000Z' });
        expect(backup.data.users[0].password).toBe(HASH);
        expect(JSON.stringify(backup.data.users)).not.toContain('***');
        expect(backup.secretos.incluyeHashesDeClave).toBe(true);
        expect(backup.secretos.settingsSecretos).toContain('syncToken');
    });

    it('no muta las tablas de origen', () => {
        const tablas = tablasDePrueba();
        armarBackup(tablas, { exportedAt: '2026-11-22T12:00:00.000Z' });
        expect(tablas.users[0].password).toBe(HASH);
    });
});

describe('armarBackupSinSecretos', () => {
    it('omite hashes y syncToken y deja un aviso explícito', () => {
        const backup = armarBackupSinSecretos(tablasDePrueba(), { exportedAt: '2026-11-22T12:00:00.000Z' });
        expect(backup.sinSecretos).toBe(true);
        expect(backup.aviso).toMatch(/omitieron/i);
        expect(backup.aviso).toMatch(/inicio de sesión/i);
        expect(backup.data.users.every(u => u.password === '***')).toBe(true);
        expect(backup.data.settings.map(s => s.key)).not.toContain('syncToken');
        expect(backup.data.settings.map(s => s.key)).toContain('storeName');
        expect(backup.data.cashClosures).toHaveLength(1);
        expect(backup.data.cashOpenings).toHaveLength(1);
        const ids = backup.omitidos.map(o => o.id);
        expect(ids).toContain('admin');
        expect(ids).toContain('syncToken');
    });
});

describe('planificarImportacion', () => {
    it('restaura caja y conserva el hash de la clave', () => {
        const backup = armarBackup(tablasDePrueba(), { exportedAt: '2026-11-22T12:00:00.000Z' });
        const plan = planificarImportacion(backup, { usuariosActuales: [] });
        expect(plan.ok).toBe(true);
        expect(plan.tablas.cashOpenings).toHaveLength(1);
        expect(plan.tablas.cashClosures[0].id).toBe(4);
        expect(plan.tablas.cashClosureHistory).toHaveLength(1);
        expect(plan.tablas.securityLogs).toHaveLength(1);
        expect(plan.tablas.users[0].password).toBe(HASH);
        expect(plan.tablas.settings.find(s => s.key === 'syncToken').value).toBe('token-secreto');
    });

    it('un archivo viejo con *** no pisa el hash que ya está en la máquina', () => {
        const viejo = {
            version: 10,
            data: {
                users: [{ id: 1, username: 'admin', role: 'admin', password: '***' }],
                sales: [{ id: 1, total: 25 }],
            },
        };
        const plan = planificarImportacion(viejo, {
            usuariosActuales: [{ id: 1, username: 'admin', password: HASH }],
        });
        expect(plan.ok).toBe(true);
        expect(plan.tablas.users[0].password).toBe(HASH);
        expect(plan.avisos.join(' ')).toMatch(/conservó la contraseña/i);
        expect(plan.tablas.cashClosures).toBeUndefined();
    });

    it('un usuario que solo existe enmascarado no se importa con ***', () => {
        const viejo = {
            version: 10,
            data: {
                users: [{ id: 8, username: 'nueva', role: 'seller', password: '***' }],
            },
        };
        const plan = planificarImportacion(viejo, { usuariosActuales: [] });
        expect(plan.tablas.users).toHaveLength(0);
        expect(plan.usuariosOmitidos.map(u => u.username)).toContain('nueva');
        expect(plan.avisos.join(' ')).toMatch(/sin contraseña utilizable/i);
    });

    it('la copia sin secretos no borra el syncToken al restaurar', () => {
        const backup = armarBackupSinSecretos(tablasDePrueba(), { exportedAt: '2026-11-22T12:00:00.000Z' });
        const plan = planificarImportacion(backup, {
            usuariosActuales: [{ id: 1, username: 'admin', password: HASH }],
            settingsActuales: [{ key: 'syncToken', value: 'token-vivo' }, { key: 'storeName', value: 'Vieja' }],
        });
        expect(plan.tablas.users.find(u => u.username === 'admin').password).toBe(HASH);
        expect(plan.tablas.settings.find(s => s.key === 'syncToken').value).toBe('token-vivo');
        expect(plan.tablas.settings.find(s => s.key === 'storeName').value).toBe('Tienda CBBA');
        expect(plan.avisos.join(' ')).toMatch(/secretos/i);
    });

    it('rechaza un archivo sin data', () => {
        const plan = planificarImportacion({ version: 11 }, {});
        expect(plan.ok).toBe(false);
    });
});
