/**
 * Cobro del POS. Efectivo solo se registra si el monto recibido cubre el total.
 * Un campo vacío no cuenta como 0: hay que escribir el monto (aunque la venta sea 0).
 * QR no mueve el cajón y no exige monto.
 */

function round2(n) {
    return Math.round(n * 100) / 100;
}

function parseMonto(received) {
    if (typeof received === 'number') {
        return Number.isFinite(received) ? received : null;
    }
    if (received == null) return null;
    const texto = String(received).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(texto)) return null;
    return Number(texto);
}

/**
 * @returns {{ ok: true, received: number, change: number } | { ok: false, error: string }}
 */
export function validarCobro({ payment, received, total }) {
    const totalNum = Number(total);
    if (!Number.isFinite(totalNum) || totalNum < 0) {
        return { ok: false, error: 'El total de la venta no es válido' };
    }

    if (payment !== 'efectivo') {
        return { ok: true, received: round2(totalNum), change: 0 };
    }

    const vacio = received == null || (typeof received === 'string' && received.trim() === '');
    if (vacio) {
        return { ok: false, error: 'Ingresa el monto recibido. Debe cubrir el total.' };
    }

    const receivedNum = parseMonto(received);
    if (receivedNum == null) {
        return { ok: false, error: 'El monto recibido no es un número válido' };
    }

    const recCents = Math.round(receivedNum * 100);
    const totCents = Math.round(totalNum * 100);
    if (recCents < totCents) {
        return { ok: false, error: 'El monto recibido no alcanza el total' };
    }

    return {
        ok: true,
        received: recCents / 100,
        change: (recCents - totCents) / 100,
    };
}

/**
 * Al reimprimir, un recibido 0 es un dato real. Solo se usa el total
 * cuando la venta vieja no trae el campo.
 */
export function montoImpresoRecibido(sale) {
    if (!sale) return 0;
    if (sale.received === 0 || (sale.received != null && sale.received !== '')) {
        const n = Number(sale.received);
        if (Number.isFinite(n)) return n;
    }
    return Number(sale.total) || 0;
}
