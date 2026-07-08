import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, DollarSign } from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { useSecureDate } from '../hooks/useSecureDate';
import { usePendingClosureDates } from '../hooks/usePendingClosureDates';

/**
 * 🔴 Banner persistente de cierres de caja pendientes.
 *
 * Visible en todas las pantallas (se monta en Layout) y para todos los roles.
 * NO es descartable: desaparece solo cuando ya no quedan días pendientes.
 * La detección vive en usePendingClosureDates (reactiva, acotada a 60 días)
 * y usa la fecha segura de useSecureDate como "hoy" (nunca new Date()).
 *
 * El botón navega a CashClose con el día pendiente MÁS ANTIGUO preseleccionado
 * (vía state del router).
 */
export default function PendingClosuresBanner() {
    const { user } = useUser();
    const { today } = useSecureDate();
    const navigate = useNavigate();

    const pendingDates = usePendingClosureDates(today) || [];

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
                <button onClick={() => navigate('/cash', { state: { pendingDate: oldest } })}
                    className="shrink-0 flex items-center gap-1.5 bg-white text-red-600 font-black text-xs uppercase
                               tracking-widest px-4 py-2 rounded-xl shadow hover:bg-red-50 transition-colors">
                    <DollarSign size={14} strokeWidth={2.5} /> Ir a Cierre de Caja
                </button>
            )}
        </div>
    );
}
