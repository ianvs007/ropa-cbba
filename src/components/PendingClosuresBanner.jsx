import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, DollarSign } from 'lucide-react';
import { regularizePendingClosures } from '../db';
import { useUser } from '../contexts/UserContext';
import { useSecureDate } from '../hooks/useSecureDate';
import { usePendingClosureDates } from '../hooks/usePendingClosureDates';

/**
 * 🔴 Banner persistente de cierres de caja pendientes.
 *
 * Visible en todas las pantallas (se monta en Layout) y para todos los roles.
 * NO es descartable: desaparece solo cuando ya no quedan días pendientes.
 * La detección vive en usePendingClosureDates (reactiva, acotada a 365 días)
 * y usa la fecha segura de useSecureDate como "hoy" (nunca new Date()).
 *
 * El botón navega a CashClose con el día pendiente MÁS ANTIGUO preseleccionado
 * (vía state del router), o permite al admin regularizar en lote.
 */
export default function PendingClosuresBanner() {
    const { user } = useUser();
    const { today } = useSecureDate();
    const navigate = useNavigate();
    const location = useLocation();
    const [busy, setBusy] = React.useState(false);

    const pendingDates = usePendingClosureDates(today) || [];

    if (pendingDates.length === 0) return null;

    const oldest = pendingDates[0];
    const newest = pendingDates[pendingDates.length - 1];
    const oldestFmt = new Date(oldest + 'T12:00:00').toLocaleDateString('es', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    });
    const newestFmt = new Date(newest + 'T12:00:00').toLocaleDateString('es', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    });

    const handleAdminRegularize = async () => {
        if (busy) return;
        const ok = window.confirm(
            `⚡ REGULARIZAR ${pendingDates.length} DÍA(S) PENDIENTES\n\n` +
            `Periodo: ${oldestFmt} al ${newestFmt}\n\n` +
            `Esta acción cerrará y cuadrará automáticamente los días anteriores sin cierre ` +
            `con sus ventas y gastos reales registrados en el sistema (quedará auditado como cierre retroactivo).\n\n` +
            `¿Deseas regularizar todos los días pendientes ahora?`
        );
        if (!ok) return;
        setBusy(true);
        try {
            await regularizePendingClosures({ dates: pendingDates, today, user });
        } catch (err) {
            console.error('Error al regularizar cierres:', err);
            window.alert('Error al regularizar: ' + (err.message || err));
        } finally {
            setBusy(false);
        }
    };

    const isOnCashPage = location.pathname === '/cash';

    return (
        <div role="alert"
            className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-2.5 shrink-0
                       bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-md">
            <p className="flex items-center gap-2 text-sm font-bold">
                <AlertTriangle size={18} className="shrink-0" />
                <span>
                    ⚠️ Tienes {pendingDates.length} día(s) anterior(es) sin cerrar caja
                    {pendingDates.length === 1 ? ` (${oldestFmt})` : ` (del ${oldestFmt} al ${newestFmt})`}
                </span>
            </p>
            <div className="flex items-center gap-2 shrink-0">
                {user?.role !== 'admin' && !isOnCashPage && (
                    <button onClick={() => navigate('/cash', { state: { pendingDate: oldest } })}
                        className="shrink-0 flex items-center gap-1.5 bg-white text-red-600 font-black text-xs uppercase
                                   tracking-widest px-4 py-2 rounded-xl shadow hover:bg-red-50 transition-colors">
                        <DollarSign size={14} strokeWidth={2.5} /> Ir a Cierre de Caja
                    </button>
                )}
                {user?.role === 'admin' && (
                    <button
                        onClick={handleAdminRegularize}
                        disabled={busy}
                        className="shrink-0 flex items-center gap-1.5 bg-white text-red-600 font-black text-xs uppercase
                                   tracking-widest px-4 py-2 rounded-xl shadow hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                        <CheckCircle size={14} strokeWidth={2.5} />
                        {busy ? 'Regularizando...' : `Regularizar ${pendingDates.length} día(s)`}
                    </button>
                )}
            </div>
        </div>
    );
}

