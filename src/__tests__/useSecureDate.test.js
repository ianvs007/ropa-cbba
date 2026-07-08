/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔐 TESTS DE FECHA SEGURA — useSecureDate (lógica pura evaluateDateChange)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Bug real en producción: las sucursales dejan la app abierta días; el cambio
 * natural de día era tratado como manipulación y bloqueaba el cierre de caja.
 *
 * Reglas verificadas:
 *   (a) El avance de día (medianoche con la app abierta) NO es manipulación:
 *       produce ROLLOVER con la fecha nueva.
 *   (b) El retroceso de reloj > 10 minutos SÍ es manipulación.
 *   (c) Un retroceso pequeño (≤ 10 min, drift/NTP) se tolera.
 *   (d) Sin fecha congelada previa → congelar (primera vez).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi } from 'vitest';

// El hook importa ../db (Dexie + seed) y UserContext; se mockean para poder
// importar la función pura en entorno node sin efectos secundarios.
vi.mock('../db', () => ({ db: {} }));
vi.mock('../contexts/UserContext', () => ({ useUser: () => ({ user: null }) }));

import { evaluateDateChange } from '../hooks/useSecureDate';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Base arbitraria: 2026-07-08 20:00 (ms). Solo importan las diferencias.
const T0 = 1_780_000_000_000;

describe('evaluateDateChange', () => {
    it('(a) el avance de día NO es manipulación y actualiza la fecha (ROLLOVER)', () => {
        // App abierta desde el día anterior; el reloj avanzó pasada la medianoche
        const result = evaluateDateChange({
            frozenDate: '2026-07-08',
            lastKnownTs: T0,
            nowTs: T0 + 6 * 60 * MINUTE, // 6 horas después (ya es el día siguiente)
            nowDate: '2026-07-09',
        });

        expect(result.action).toBe('ROLLOVER');
        expect(result.from).toBe('2026-07-08');
        expect(result.to).toBe('2026-07-09');
    });

    it('(a2) varios días abiertos: cada avance sigue siendo ROLLOVER, nunca manipulación', () => {
        const result = evaluateDateChange({
            frozenDate: '2026-07-08',
            lastKnownTs: T0,
            nowTs: T0 + 3 * DAY,
            nowDate: '2026-07-11',
        });

        expect(result.action).toBe('ROLLOVER');
        expect(result.to).toBe('2026-07-11');
    });

    it('(b) el retroceso de reloj > 10 minutos SÍ es manipulación', () => {
        const result = evaluateDateChange({
            frozenDate: '2026-07-08',
            lastKnownTs: T0,
            nowTs: T0 - 11 * MINUTE,
            nowDate: '2026-07-08',
        });

        expect(result.action).toBe('MANIPULATION');
        expect(result.diffMinutes).toBe(11);
    });

    it('(b2) retroceder el reloj un día entero (fraude típico) es manipulación', () => {
        const result = evaluateDateChange({
            frozenDate: '2026-07-08',
            lastKnownTs: T0,
            nowTs: T0 - DAY,
            nowDate: '2026-07-07',
        });

        expect(result.action).toBe('MANIPULATION');
        expect(result.diffMinutes).toBe(24 * 60);
    });

    it('(c) un retroceso pequeño (≤ 10 min, ajuste NTP) se tolera', () => {
        const result = evaluateDateChange({
            frozenDate: '2026-07-08',
            lastKnownTs: T0,
            nowTs: T0 - 9 * MINUTE,
            nowDate: '2026-07-08',
        });

        expect(result.action).toBe('OK');
    });

    it('(c2) mismo día y reloj avanzando con normalidad → OK', () => {
        const result = evaluateDateChange({
            frozenDate: '2026-07-08',
            lastKnownTs: T0,
            nowTs: T0 + MINUTE,
            nowDate: '2026-07-08',
        });

        expect(result.action).toBe('OK');
    });

    it('(d) sin fecha congelada previa → FREEZE (primera vez)', () => {
        const result = evaluateDateChange({
            frozenDate: null,
            lastKnownTs: null,
            nowTs: T0,
            nowDate: '2026-07-08',
        });

        expect(result.action).toBe('FREEZE');
    });

    it('(e) tras una MANIPULATION el timestamp conocido no avanza: una recarga con el reloj aún retrocedido sigue detectándose', () => {
        // Primera evaluación: reloj retrocedido 30 min → manipulación
        const first = evaluateDateChange({
            frozenDate: '2026-07-08',
            lastKnownTs: T0,
            nowTs: T0 - 30 * MINUTE,
            nowDate: '2026-07-08',
        });
        expect(first.action).toBe('MANIPULATION');

        // El hook NO avanza lastKnownTimestamp en MANIPULATION, así que tras
        // recargar la página la evidencia sigue siendo T0 (no el reloj falso).
        // Segunda evaluación (post-recarga, reloj aún retrocedido) → sigue detectando.
        const second = evaluateDateChange({
            frozenDate: '2026-07-08',
            lastKnownTs: T0, // ← evidencia preservada, no T0 - 30min
            nowTs: T0 - 29 * MINUTE,
            nowDate: '2026-07-08',
        });
        expect(second.action).toBe('MANIPULATION');
        expect(second.diffMinutes).toBe(29);
    });

    it('(d2) sin lastKnownTimestamp guardado (sesión vieja) no marca manipulación', () => {
        // Sesiones creadas antes de este fix no tienen lastKnownTimestamp:
        // debe tratarse como avance/OK, nunca como fraude.
        const result = evaluateDateChange({
            frozenDate: '2026-07-08',
            lastKnownTs: null,
            nowTs: T0,
            nowDate: '2026-07-09',
        });

        expect(result.action).toBe('ROLLOVER');
    });
});
