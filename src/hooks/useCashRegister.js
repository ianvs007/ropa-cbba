import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLocalISOString } from '../db';
import { useUser } from '../contexts/UserContext';

/**
 * 💰 useCashRegister — Estado de apertura/cierre de caja del vendedor
 * Soporta MÚLTIPLES turnos por vendedor por día.
 *
 * Lógica:
 * - Busca la ÚLTIMA apertura del usuario hoy
 * - Verifica si esa apertura tiene un cierre vinculado (por openingId)
 * - isOpen: última apertura existe Y no tiene cierre
 * - isClosed: última apertura tiene cierre con closedAt
 * - needsOpen: no hay apertura, o la última ya fue cerrada
 */
export default function useCashRegister() {
    const { user } = useUser();
    const today = getLocalISOString().slice(0, 10);

    // Obtener TODAS las aperturas del usuario hoy (para encontrar la última)
    const openings = useLiveQuery(
        () => db.table('cashOpenings')
            .where('date').equals(today)
            .filter(o => o.userId === user?.id)
            .toArray(),
        [today, user?.id]
    );

    // Última apertura (la más reciente por openedAt)
    const opening = openings && openings.length > 0
        ? openings.sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || '') || (b.id - a.id))[0]
        : null;

    // Buscar si existe un cierre vinculado a esta apertura específica
    const closure = useLiveQuery(
        () => opening?.id
            ? db.table('cashClosures')
                .where('openingId').equals(opening.id)
                .first()
            : Promise.resolve(null),
        [opening?.id]
    );

    const isOpen = !!opening && !closure?.closedAt;
    const isClosed = !!opening && !!closure?.closedAt;
    const shiftId = opening?.id || null;

    const openCash = async (cashStart, notes = '') => {
        if (!user?.id) throw new Error('Usuario no identificado');

        // Verificar que el último turno esté cerrado antes de abrir uno nuevo
        if (opening && !closure?.closedAt) {
            throw new Error('Ya tienes un turno abierto. Ciérralo primero.');
        }

        return db.table('cashOpenings').add({
            date: today,
            userId: user.id,
            username: user.name || user.username,
            cashStart: parseFloat(cashStart) || 0,
            notes: (notes || '').trim().toUpperCase(),
            openedAt: new Date().toISOString(),
        });
    };

    return {
        isOpen,
        isClosed,
        opening,
        shiftId,
        openCash,
        isLoading: openings === undefined,
        shiftNumber: openings ? openings.length : 0,
    };
}
