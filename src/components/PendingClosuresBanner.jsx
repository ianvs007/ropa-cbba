import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, DollarSign } from 'lucide-react';
import { db } from '../db';
import { useUser } from '../contexts/UserContext';
import { useSecureDate } from '../hooks/useSecureDate';
import { findPendingClosureDates } from '../utils/pendingClosures';

// Ventana de detección: consultas acotadas por el índice `date`, sin table scan
const LOOKBACK_DAYS = 60;

/**
 * 🔴 Banner persistente de cierres de caja pendientes.
 *
 * Visible en todas las pantallas (se monta en Layout) y para todos los roles.
 * NO es descartable: desaparece solo cuando ya no quedan días pendientes.
 * useLiveQuery lo recalcula automáticamente cuando cambian las tablas
 * consultadas (p. ej. al guardar un cierre) y usa la fecha segura del hook
 * useSecureDate como "hoy" (nunca new Date() directo).
 */
export default function PendingClosuresBanner() {
    const { user } = useUser();
    const { today } = useSecureDate();
    const navigate = useNavigate();

    const pendingDates = useLiveQuery(async () => {
        if (!today) return [];
        try {
            const from = new Date(today + 'T00:00:00');
            from.setDate(from.getDate() - LOOKBACK_DAYS);
            const cutoff = from.toISOString().slice(0, 10);

            // Solo registros de la ventana [hoy-60d, hoy): los de hoy quedan fuera
            // por límite superior exclusivo (las fechas con hora 'YYYY-MM-DDT…'
            // ordenan después de 'YYYY-MM-DD' en el índice)
            const [sales, payments, closures, openings] = await Promise.all([
                db.sales.where('date').between(cutoff, today, true, false).toArray(),
                db.reservationPayments.where('date').between(cutoff, today, true, false).toArray(),
                db.table('cashClosures').where('date').between(cutoff, today, true, true).toArray(),
                db.table('cashOpenings').where('date').between(cutoff, today, true, false).toArray(),
            ]);

            return findPendingClosureDates({ sales, payments, closures, openings, today });
        } catch (e) {
            // Instalación nueva o tabla ausente: no mostrar nada ni fallar
            console.error('Error detectando cierres pendientes:', e);
            return [];
        }
    }, [today]) || [];

    if (pendingDates.length === 0) return null;

    const oldest = pendingDates[0];
    const oldestFmt = new Date(oldest + 'T12:00:00').toLocaleDateString('es', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    });

    return (
        <div role="alert"
            className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-2.5 shrink-0
                       bg-gradient-to-r from-red-600 to-red-500 text-white shadow-md">
            <p className="flex items-center gap-2 text-sm font-bold">
                <AlertTriangle size={18} className="shrink-0" />
                ⚠️ Tienes {pendingDates.length} día(s) sin cerrar caja (desde el {oldestFmt})
            </p>
            {user?.role !== 'admin' && (
                <button onClick={() => navigate('/cash')}
                    className="shrink-0 flex items-center gap-1.5 bg-white text-red-600 font-black text-xs uppercase
                               tracking-widest px-4 py-2 rounded-xl shadow hover:bg-red-50 transition-colors">
                    <DollarSign size={14} strokeWidth={2.5} /> Ir a Cierre de Caja
                </button>
            )}
        </div>
    );
}
