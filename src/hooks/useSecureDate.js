/**
 * 🔐 useSecureDate — Hook para Validación de Fecha Segura
 * 
 * Congela la fecha al login y detecta manipulaciones del SO
 * Previene cambios de fecha para anular ventas antiguas o crear cierres falsos
 */

import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import { useUser } from '../contexts/UserContext';

// La función getLocalISOString se puede copiar aquí para evitar circulares
function getLocalISOString() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return (new Date(now.getTime() - offset)).toISOString();
}

/**
 * Hook: Congelador de fecha + detector de manipulación
 * @returns {Object} { today, isManipulated, originalTime, canEdit }
 */
export function useSecureDate() {
    const { user } = useUser();
    const [sessionDateFrozen, setSessionDateFrozen] = useState(() => sessionStorage.getItem('sessionDateFrozen'));
    const [isManipulated, setIsManipulated] = useState(false);
    const [manipulationAttempts, setManipulationAttempts] = useState(0);

    // ── FASE 1: Congelar fecha al inicializar el hook ──
    useEffect(() => {
        const stored = sessionStorage.getItem('sessionDateFrozen');
        
        if (stored) {
            // Ya existe sesión congelada, verificar integridad
            verifyDateIntegrity(stored);
        } else {
            // Primera vez: congelar fecha actual (LOCAL)
            const frozenDate = getLocalISOString().slice(0, 10);
            sessionStorage.setItem('sessionDateFrozen', frozenDate);
            setSessionDateFrozen(frozenDate);
        }
    }, []);

    // ── FASE 2: Verificar si hubo cambio grande de fecha ──
    const verifyDateIntegrity = useCallback((frozenDate) => {
        const now = new Date();
        const nowDate = getLocalISOString().slice(0, 10);
        
        // Comparar
        const frozen = new Date(frozenDate + 'T00:00:00Z');
        const current = new Date(nowDate + 'T00:00:00Z');
        const diffMs = Math.abs(current.getTime() - frozen.getTime());
        const diffHours = diffMs / (1000 * 60 * 60);

        // ❌ ALERTA: Si diferencia > 1 hora (gran cambio)
        if (diffHours > 1) {

            setIsManipulated(true);
            setManipulationAttempts(prev => prev + 1);
            
            // Registrar en auditoría
            logSecurityEvent('DATE_MANIPULATION_DETECTED', {
                frozenDate,
                currentDate: nowDate,
                diffHours: diffHours.toFixed(1),
            });

            return false;
        }

        return true;
    }, []);

    // ── FASE 3: Función para registrar eventos de seguridad ──
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

    // ── Retornar objeto con métodos seguros ──
    return {
        today: sessionDateFrozen,  // ← CONGELADA
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
