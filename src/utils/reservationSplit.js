/**
 * 💰 Reparto proporcional de un abono entre varias prendas reservadas juntas.
 *
 * Reparte `amount` en proporción al precio final de cada prenda, redondeando
 * cada porción a 2 decimales. La diferencia residual del redondeo se ajusta
 * en la ÚLTIMA porción, de modo que la suma de las porciones sea EXACTAMENTE
 * `amount` (cuadre al centavo).
 *
 * @param {number} amount  Monto total del abono a repartir
 * @param {number[]} prices Precios finales de cada prenda del grupo
 * @returns {number[]} Porción del abono por prenda (mismo orden que prices)
 */
export function splitProportional(amount, prices) {
    if (!Array.isArray(prices) || prices.length === 0) return [];

    const totalPrices = prices.reduce((s, p) => s + p, 0);
    if (totalPrices <= 0) return prices.map(() => 0);

    const parts = prices.map(p => Math.round((amount * p / totalPrices) * 100) / 100);

    const sum = parts.reduce((s, x) => Math.round((s + x) * 100) / 100, 0);
    const residual = Math.round((amount - sum) * 100) / 100;
    if (residual !== 0) {
        const last = parts.length - 1;
        parts[last] = Math.round((parts[last] + residual) * 100) / 100;
    }

    return parts;
}

export default splitProportional;
