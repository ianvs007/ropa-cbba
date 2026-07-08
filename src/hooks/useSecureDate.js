/**
 * 🔐 useSecureDate — Hook para Validación de Fecha Segura
 *
 * Congela la fecha de trabajo en sessionStorage y detecta manipulaciones del SO.
 * Previene retroceder el reloj para anular ventas antiguas o crear cierres falsos.
 *
 * El avance natural de día (medianoche con la app abierta) NO es manipulación:
 * la fecha congelada se re-congela sola a la fecha nueva (rollover). Solo el
 * RETROCESO del reloj (más allá de la tolerancia) dispara isManipulated.
 */

import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import { useUser } from '../contexts/UserContext';

// Tolerancia para retroceso de reloj (drift/NTP legítimo): 10 minutos
const ROLLBACK_TOLERANCE_MS = 10 * 60 * 1000;

// Frecuencia de verificación con la app abierta
const CHECK_INTERVAL_MS = 60 * 1000;

// La función getLocalISOString se puede copiar aquí para evitar circulares
function getLocalISOString() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return (new Date(now.getTime() - offset)).toISOString();
}

/**
 * Lógica pura de decisión sobre el cambio de fecha/reloj (testeable sin DOM).
 *
 * @param {Object} params
 * @param {string|null} params.frozenDate  Fecha congelada YYYY-MM-DD
 * @param {number|null} params.lastKnownTs Último Date.now() conocido (ms)
 * @param {number} params.nowTs            Date.now() actual (ms)
 * @param {string} params.nowDate          Fecha local actual YYYY-MM-DD
 * @returns {{action: 'FREEZE'|'MANIPULATION'|'ROLLOVER'|'OK', from?: string, to?: string, diffMinutes?: number}}
 */
export function evaluateDateChange({ frozenDate, lastKnownTs, nowTs, nowDate }) {
    if (!frozenDate) {
        return { action: 'FREEZE' };
    }

    // ❌ RETROCESO de reloj más allá de la tolerancia → fraude
    if (lastKnownTs != null && nowTs < lastKnownTs - ROLLBACK_TOLERANCE_MS) {
        return {
            action: 'MANIPULATION',
            diffMinutes: Math.round((lastKnownTs - nowTs) / 60000),
        };
    }

    // ✅ AVANCE natural de día (medianoche con la app abierta) → re-congelar
    if (nowDate > frozenDate) {
        return { action: 'ROLLOVER', from: frozenDate, to: nowDate };
    }

    return { action: 'OK' };
}

/**
 * Lógica pura del episodio de manipulación: el intento se cuenta y el evento
 * se registra UNA sola vez por episodio (primera detección), no en cada tick.
 *
 * @param {Object} params Igual que evaluateDateChange + alreadyManipulated
 * @returns {Object} Resultado de evaluateDateChange + { countAttempt, logManipulation }
 */
export function processDateCheck({ frozenDate, lastKnownTs, nowTs, nowDate, alreadyManipulated }) {
    const result = evaluateDateChange({ frozenDate, lastKnownTs, nowTs, nowDate });
    const isFirstDetection = result.action === 'MANIPULATION' && !alreadyManipulated;
    return {
        ...result,
        countAttempt: isFirstDetection,
        logManipulation: isFirstDetection,
    };
}

/**
 * Hook: Congelador de fecha + detector de manipulación
 * @returns {Object} { today, isManipulated, manipulationAttempts, verifyIntegrity, logEvent, canPerformAction }
 */
export function useSecureDate() {
    const { user } = useUser();
    const [sessionDateFrozen, setSessionDateFrozen] = useState(() => sessionStorage.getItem('sessionDateFrozen'));
    const [isManipulated, setIsManipulated] = useState(false);
    const [manipulationAttempts, setManipulationAttempts] = useState(0);

    // ── Registrar eventos de seguridad en auditoría ──
    const logSecurityEvent = useCallback(async (eventType, details) => {
        try {
            // Crear tabla de logs si no existe
            if (!db.securityLogs) {

                return;
            }

            await db.securityLogs.add({
                eventType,
                details,
                timestamp: new Date().toISOString(),
                userId: user?.username || 'unknown',
                sessionDate: sessionDateFrozen,
            });
        } catch (err) {
            console.error('Error logging security event:', err);
        }
    }, [sessionDateFrozen]);

    // ── Evaluar estado del reloj/fecha y aplicar la acción que corresponda ──
    const runCheck = useCallback(() => {
        const nowTs = Date.now();
        const nowDate = getLocalISOString().slice(0, 10);
        const frozenDate = sessionStorage.getItem('sessionDateFrozen');
        const lastKnownRaw = sessionStorage.getItem('lastKnownTimestamp');
        const lastKnownTs = lastKnownRaw ? Number(lastKnownRaw) : null;

        const result = processDateCheck({
            frozenDate,
            lastKnownTs,
            nowTs,
            nowDate,
            alreadyManipulated: isManipulated,
        });

        switch (result.action) {
            case 'FREEZE':
                sessionStorage.setItem('sessionDateFrozen', nowDate);
                setSessionDateFrozen(nowDate);
                break;

            case 'MANIPULATION':
                setIsManipulated(true);
                // Un intento y un log por episodio, no por tick de 60 s
                if (result.countAttempt) {
                    setManipulationAttempts(prev => prev + 1);
                }
                if (result.logManipulation) {
                    logSecurityEvent('DATE_MANIPULATION_DETECTED', {
                        frozenDate,
                        currentDate: nowDate,
                        diffMinutes: result.diffMinutes,
                    });
                }
                break;

            case 'ROLLOVER':
                // Cambio natural de día: re-congelar, es informativo (no fraude)
                sessionStorage.setItem('sessionDateFrozen', result.to);
                setSessionDateFrozen(result.to);
                logSecurityEvent('DATE_ROLLOVER', { from: result.from, to: result.to });
                break;

            default:
                break;
        }

        // En MANIPULATION no se avanza el timestamp: la evidencia del último
        // reloj legítimo debe sobrevivir a recargas de página
        if (result.action !== 'MANIPULATION') {
            sessionStorage.setItem('lastKnownTimestamp', String(nowTs));
        }
        return result.action !== 'MANIPULATION';
    }, [logSecurityEvent, isManipulated]);

    // ── Verificación al montar + cada minuto mientras la app sigue abierta ──
    useEffect(() => {
        runCheck();
        const intervalId = setInterval(runCheck, CHECK_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, [runCheck]);

    // ── Verificación bajo demanda: solo marca manipulación en RETROCESO ──
    const verifyDateIntegrity = useCallback(() => {
        return runCheck();
    }, [runCheck]);

    // ── Retornar objeto con métodos seguros ──
    return {
        today: sessionDateFrozen,  // ← CONGELADA (se re-congela sola al cambiar el día)
        isManipulated,
        manipulationAttempts,
        verifyIntegrity: verifyDateIntegrity,
        logEvent: logSecurityEvent,
        canPerformAction: !isManipulated || manipulationAttempts < 3,
    };
}

/**
 * Función: Validar si puede anular una venta hoy
 */
export function canAnnulSale(saleDate, frozenToday) {
    return saleDate === frozenToday;
}

/**
 * Función: Validar si puede cerrar caja (solo HOY)
 */
export function canCloseCashRegister(selectedDate, frozenToday, userRole) {
    // ❌ No permite cerrar fecha anterior
    if (selectedDate !== frozenToday) {
        return {
            allowed: false,
            reason: `Solo puedes cerrar caja de HOY (${frozenToday}), no de ${selectedDate}`,
        };
    }

    // ❌ Solo admin puede cerrar cierres viejos
    if (userRole !== 'admin') {
        return {
            allowed: true,
            reason: null,
        };
    }

    return { allowed: true, reason: null };
}

/**
 * Función: Validar si puede registrar gasto
 */
export function canRegisterExpense(expenseDate, frozenToday) {
    // ❌ Solo gastos de HOY
    if (expenseDate !== frozenToday) {
        return {
            allowed: false,
            reason: `Solo puedes registrar gastos de HOY (${frozenToday}), no de ${expenseDate}`,
        };
    }

    return { allowed: true, reason: null };
}

export default useSecureDate;
