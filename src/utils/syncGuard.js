/**
 * Guardia de sync: si la nube ya recibió el stock pero el POS falló al
 * descontar las ventas web, NO se debe volver a enviar stock (sobreventa).
 * Las ventas pendientes se guardan en settings para reintentar el descuento.
 */

export const CLAVE_VENTAS_WEB_PENDIENTES = 'ventasWebPendientesDescuento';
export const CLAVE_SYNC_DESCUENTO_PENDIENTE = 'syncDescuentoLocalPendiente';

/**
 * @param {string|null|undefined} flagValue - settings.syncDescuentoLocalPendiente
 * @param {unknown} ventasPendientes - settings.ventasWebPendientesDescuento (array o JSON)
 * @returns {{ bloqueado: boolean, cantidad: number, motivo: string|null }}
 */
export function estadoBloqueoSyncPorDescuentoPendiente(flagValue, ventasPendientes) {
    const flagOn = flagValue === true || flagValue === 1 || String(flagValue || '') === '1';
    let lista = [];
    if (Array.isArray(ventasPendientes)) lista = ventasPendientes;
    else if (typeof ventasPendientes === 'string' && ventasPendientes.trim()) {
        try {
            const parsed = JSON.parse(ventasPendientes);
            if (Array.isArray(parsed)) lista = parsed;
        } catch {
            lista = [];
        }
    }
    const cantidad = lista.length;
    if (!flagOn && cantidad === 0) {
        return { bloqueado: false, cantidad: 0, motivo: null };
    }
    return {
        bloqueado: true,
        cantidad,
        motivo:
            'La nube ya se actualizó pero el POS no terminó de descontar las ventas web. ' +
            'Reintenta el descuento local antes de volver a sincronizar (si envías stock otra vez, puedes sobrevender).',
    };
}
