import React from 'react';
import { CheckCircle, Printer, AlertCircle, Tag } from 'lucide-react';
import { formatCurrency } from '../../utils';

/**
 * 💳 PaymentPanel — Panel de cobro del POS
 *
 * @prop {number}   total         - Total a cobrar (con descuentos aplicados)
 * @prop {number}   totalDiscount - Total de descuento aplicado (0 si no hay)
 * @prop {string}   currency      - Símbolo de moneda
 * @prop {Array}    cart          - Items del carrito
 * @prop {boolean}  loading       - Si la venta está procesándose
 * @prop {boolean}  success       - Si la venta fue exitosa
 * @prop {string}   error         - Mensaje de error (vacío = sin error)
 * @prop {Function} onSell        - Callback al presionar "Cobrar"
 * @prop {Function} onClear       - Callback al limpiar el carrito
 */
export default function PaymentPanel({ total, totalDiscount = 0, currency, cart, loading, success, error, onSell, onClear }) {
    const [payment, setPayment] = React.useState('efectivo');
    const [received, setReceived] = React.useState('');
    const [showClient, setShowClient] = React.useState(false);
    const [clientName, setClientName] = React.useState('');
    const [clientPhone, setClientPhone] = React.useState('');

    const receivedVal = parseFloat(received || 0);
    const changeAmount = receivedVal - total;

    const handleSell = () => onSell({
        payment,
        received: receivedVal,
        client: clientName.trim() ? { name: clientName.trim(), phone: clientPhone.trim() } : null,
    });

    // F12 global para cobrar
    React.useEffect(() => {
        const handleKey = (e) => {
            if (e.key === 'F12') { e.preventDefault(); if (cart.length > 0 && !loading) handleSell(); }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [cart.length, loading, payment, receivedVal, clientName, clientPhone]);

    React.useEffect(() => {
        if (success) {
            setReceived('');
            setClientName('');
            setClientPhone('');
            setShowClient(false);
        }
    }, [success]);

    const lastPhoto = cart.length > 0 ? cart[cart.length - 1] : null;

    return (
        <div className="fashion-card p-4 space-y-4">
            <h2 className="font-bold text-pink-900">Resumen de Venta</h2>

            {/* Total */}
            <div className="rounded-xl p-4 text-center"
                style={{ background: 'linear-gradient(135deg, #D946A8, #A3308A)' }}>
                <p className="text-pink-200 text-xs font-medium mb-1">TOTAL A COBRAR</p>
                <p className="text-white text-4xl font-black">{formatCurrency(total, currency)}</p>
                {totalDiscount > 0 && (
                    <div className="mt-2 flex items-center justify-center gap-1.5 bg-white/15 rounded-lg px-3 py-1.5">
                        <Tag size={12} className="text-yellow-300" />
                        <span className="text-yellow-200 text-xs font-bold">
                            Rebaja aplicada: {formatCurrency(totalDiscount, currency)}
                        </span>
                    </div>
                )}
            </div>

            {/* Método de pago */}
            <div>
                <p className="text-sm font-semibold text-pink-800 mb-2">Método de pago</p>
                <div className="grid grid-cols-2 gap-2">
                    {['efectivo', 'qr'].map(m => (
                        <button key={m} onClick={() => setPayment(m)}
                            className={`py-2 px-1 rounded-xl text-xs font-semibold border transition-all capitalize
                                ${payment === m
                                    ? 'border-pink-500 bg-pink-50 text-pink-700'
                                    : 'border-gray-200 text-gray-500 hover:border-pink-300'}`}>
                            {m === 'qr' ? '📱 Pago QR' : '💵 Efectivo'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Monto recibido (solo efectivo) */}
            {payment === 'efectivo' && (
                <div className="space-y-1 pt-2 border-t border-pink-50">
                    <div className="flex justify-between items-center">
                        <label className="text-xs font-semibold text-pink-800">
                            Monto recibido ({currency})
                        </label>
                        {receivedVal > 0 && (
                            <span className={`text-xs font-bold ${changeAmount < 0 ? 'text-red-500' : 'text-green-600'}`}>
                                Cambio: {formatCurrency(Math.max(0, changeAmount), currency)}
                            </span>
                        )}
                    </div>
                    <input
                        type="number"
                        step="0.50"
                        min="0"
                        value={received}
                        onChange={e => setReceived(e.target.value)}
                        placeholder="0.00"
                        className={`fashion-input no-spinner h-10 text-sm font-bold ${
                            receivedVal > 0 && changeAmount < 0 ? 'border-red-400' : ''
                        }`}
                    />
                </div>
            )}

            {/* Cliente opcional (para que figure en el ticket) */}
            <div className="pt-2 border-t border-pink-50 space-y-2">
                <button
                    type="button"
                    onClick={() => setShowClient(v => !v)}
                    className={`w-full py-2 px-3 rounded-xl text-xs font-semibold border transition-all text-left
                        ${clientName.trim()
                            ? 'border-pink-400 bg-pink-50 text-pink-700'
                            : 'border-pink-100 text-pink-400 hover:border-pink-300'}`}>
                    {clientName.trim() ? `✓ Cliente: ${clientName.trim()}` : '➕ Añadir cliente (opcional)'}
                </button>
                {showClient && (
                    <div className="space-y-2 fade-in">
                        <input
                            type="text"
                            value={clientName}
                            onChange={e => setClientName(e.target.value)}
                            placeholder="Nombre del cliente"
                            className="fashion-input h-10 text-sm"
                        />
                        <input
                            type="tel"
                            inputMode="numeric"
                            value={clientPhone}
                            onChange={e => setClientPhone(e.target.value)}
                            placeholder="Celular"
                            className="fashion-input h-10 text-sm"
                        />
                    </div>
                )}
            </div>

            {/* Feedback de éxito */}
            {success && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                    <CheckCircle size={16} className="text-green-600 shrink-0" />
                    <p className="text-green-700 text-sm font-semibold">¡Venta registrada!</p>
                </div>
            )}

            {/* Botón cobrar */}
            <button
                id="pos-checkout"
                onClick={handleSell}
                disabled={cart.length === 0 || loading}
                className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base disabled:opacity-40 disabled:cursor-not-allowed">
                <Printer size={18} />
                {loading ? 'Procesando...' : (
                    <span className="flex items-center gap-2">
                        Cobrar
                        <kbd className="text-xs bg-white/20 border border-white/30 rounded px-1.5 py-0.5 font-mono">F12</kbd>
                    </span>
                )}
            </button>

            {/* Error */}
            {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 fade-in">
                    <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
                    <p className="text-red-700 text-xs font-bold leading-tight">{error}</p>
                </div>
            )}

            {cart.length > 0 && (
                <button onClick={onClear} className="w-full text-xs text-red-400 hover:text-red-600 transition-colors">
                    Limpiar carrito
                </button>
            )}

            {/* Imagen del último producto escaneado */}
            {lastPhoto?.photo && (
                <div className="mt-4 pt-4 border-t border-pink-100 flex flex-col items-center fade-in">
                    <p className="text-[10px] font-bold text-pink-300 uppercase tracking-widest mb-2">Articulo Detectado</p>
                    <div className="p-1 border-2 border-pink-100 rounded-2xl bg-white shadow-xl inline-block overflow-hidden transition-all transform hover:scale-105">
                        <img src={lastPhoto.photo} alt={lastPhoto.name}
                            className="w-32 h-32 xl:w-48 xl:h-48 object-cover rounded-xl" />
                    </div>
                    <p className="mt-2 text-xs font-black text-pink-950 text-center truncate w-full uppercase px-2">{lastPhoto.name}</p>
                </div>
            )}
        </div>
    );
}
