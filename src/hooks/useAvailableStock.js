import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

/**
 * 🪝 useAvailableStock
 * Retorna un mapa de { [productId]: cantidadReservada } calculado
 * a partir de las reservas con status 'pending'.
 *
 * Para calcular el stock disponible:
 *   const available = product.stock - (reservedMap[product.id] || 0);
 */
export function useAvailableStock() {
    const pendingReservations = useLiveQuery(
        () => db.reservations.where('status').equals('pending').toArray(),
        []
    );

    return React.useMemo(() => {
        const map = {};
        (pendingReservations || []).forEach(r => {
            map[r.productId] = (map[r.productId] || 0) + 1;
        });
        return map;
    }, [pendingReservations]);
}
