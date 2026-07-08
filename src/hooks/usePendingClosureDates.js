import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { findPendingClosureDates } from '../utils/pendingClosures';

// Ventana de detección: consultas acotadas por el índice `date`, sin table scan
const LOOKBACK_DAYS = 60;

/**
 * 💰 Fechas con cierre de caja pendiente (últimos 60 días, reactivo).
 *
 * Compartido por PendingClosuresBanner y CashClose para no duplicar la
 * consulta. useLiveQuery re-ejecuta automáticamente cuando cambian sales,
 * reservationPayments, cashClosures o cashOpenings (p. ej. al guardar un
 * cierre retroactivo el banner y el panel se recalculan solos).
 *
 * @param {string|null} today Fecha segura YYYY-MM-DD (frozenToday de useSecureDate)
 * @returns {string[]|undefined} Fechas pendientes (antigua primero);
 *          undefined mientras carga la primera vez
 */
export function usePendingClosureDates(today) {
    return useLiveQuery(async () => {
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
    }, [today]);
}

export default usePendingClosureDates;
