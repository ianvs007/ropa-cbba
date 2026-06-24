import React from 'react';
import { ShoppingCart, Plus, Minus, Trash2, Package, Check, X, AlertCircle } from 'lucide-react';
import { formatCurrency } from '../../utils';

/**
 * 🛒 CartPanel — Panel del carrito de compras
 * La edición de precio usa botones Confirmar/Cancelar explícitos (no onBlur)
 * para evitar que autoFocus + onBlur cierre el input antes de que el usuario escriba.
 */
export default function CartPanel({ cart, currency, maxDiscount = 0, onQtyChange, onRemove, onPriceEdit, onError }) {
    const [editingId, setEditingId] = React.useState(null);
    const [editValue, setEditValue] = React.useState('');
    const [editError, setEditError] = React.useState('');

    const openEdit = (item) => {
        setEditingId(item.productId);
        setEditValue(String(item.price));
        setEditError('');
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditValue('');
        setEditError('');
    };

    const commitPrice = (item) => {
        const val = parseFloat(editValue);
        if (isNaN(val) || val <= 0) {
            setEditError('Precio inválido');
            return;
        }
        if (val <= item.cost) {
            setEditError(`Mín: ${formatCurrency(item.cost + 0.01, currency)}`);
            return;
        }
        if (maxDiscount > 0 && (item.originalPrice - val) > maxDiscount) {
            setEditError(`Rebaja máx: ${formatCurrency(maxDiscount, currency)}`);
            return;
        }
        onPriceEdit(item.productId, String(val));
        setEditingId(null);
        setEditError('');
    };

    return (
        <div className="fashion-card overflow-hidden">
            <div className="px-4 py-3 border-b border-pink-100 flex items-center gap-2">
                <ShoppingCart size={16} className="text-pink-500" />
                <span className="font-semibold text-pink-900 text-sm">
                    Carrito ({cart.length} {cart.length === 1 ? 'item' : 'items'})
                </span>
            </div>

            {cart.length === 0 ? (
                <div className="py-12 text-center text-pink-300">
                    <ShoppingCart size={40} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Agrega productos para comenzar</p>
                </div>
            ) : (
                <div className="divide-y divide-pink-50">
                    {cart.map(item => {
                        const itemDiscount = Math.round((item.originalPrice - item.price) * 100) / 100;
                        const isEditing = editingId === item.productId;

                        return (
                            <div key={item.productId} className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                    {/* Foto */}
                                    {item.photo ? (
                                        <img src={item.photo} alt={item.name}
                                            className="w-12 h-12 rounded-xl object-cover shrink-0 border border-pink-100 shadow-sm" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-xl bg-pink-50 flex items-center justify-center shrink-0 border border-pink-100">
                                            <Package size={20} className="text-pink-300" />
                                        </div>
                                    )}

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-pink-900 text-sm truncate">{item.name}</p>
                                        <p className="text-xs text-pink-400">
                                            {item.size && `T: ${item.size}`}{item.color && ` · ${item.color}`}
                                        </p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <p className="text-xs text-pink-600 font-medium">
                                                {formatCurrency(item.price, currency)} c/u
                                            </p>
                                            {itemDiscount > 0 && (
                                                <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 rounded-full border border-green-100">
                                                    -{formatCurrency(itemDiscount, currency)}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Controles cantidad */}
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button onClick={() => onQtyChange(item.productId, -1)}
                                            className="w-7 h-7 rounded-lg bg-pink-100 text-pink-700 hover:bg-pink-200 flex items-center justify-center transition-colors">
                                            <Minus size={13} />
                                        </button>
                                        <span className="w-7 text-center font-bold text-pink-900 text-sm">{item.qty}</span>
                                        <button onClick={() => onQtyChange(item.productId, 1)}
                                            className="w-7 h-7 rounded-lg bg-pink-100 text-pink-700 hover:bg-pink-200 flex items-center justify-center transition-colors">
                                            <Plus size={13} />
                                        </button>
                                    </div>

                                    {/* Total + editar */}
                                    <div className="w-28 text-right shrink-0">
                                        {!isEditing ? (
                                            <div>
                                                <span className="font-bold text-pink-800 block">
                                                    {formatCurrency(item.price * item.qty, currency)}
                                                </span>
                                                {itemDiscount > 0 && (
                                                    <span className="text-[9px] text-green-600 font-bold block">
                                                        -{formatCurrency(itemDiscount * item.qty, currency)}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => openEdit(item)}
                                                    className="text-[10px] text-pink-400 hover:text-pink-600 underline underline-offset-2 transition-colors mt-0.5">
                                                    Editar precio
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>

                                    <button onClick={() => onRemove(item.productId)}
                                        className="text-red-400 hover:text-red-600 transition-colors shrink-0">
                                        <Trash2 size={15} />
                                    </button>
                                </div>

                                {/* Panel de edición de precio — se despliega debajo del ítem */}
                                {isEditing && (
                                    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
                                        <p className="text-xs font-bold text-amber-700 mb-2">
                                            Editar precio — original: {formatCurrency(item.originalPrice, currency)}
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editValue}
                                                onChange={e => { setEditValue(e.target.value); setEditError(''); }}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') commitPrice(item);
                                                    if (e.key === 'Escape') cancelEdit();
                                                }}
                                                autoFocus
                                                className="fashion-input no-spinner h-9 text-sm font-bold flex-1"
                                                placeholder={item.price?.toFixed(2)}
                                            />
                                            <button
                                                onClick={() => commitPrice(item)}
                                                className="w-9 h-9 rounded-xl bg-green-500 hover:bg-green-600 text-white flex items-center justify-center shrink-0 transition-colors">
                                                <Check size={16} />
                                            </button>
                                            <button
                                                onClick={cancelEdit}
                                                className="w-9 h-9 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-600 flex items-center justify-center shrink-0 transition-colors">
                                                <X size={16} />
                                            </button>
                                        </div>
                                        {editError && (
                                            <p className="text-[10px] text-red-600 font-bold mt-1.5 flex items-center gap-1">
                                                <AlertCircle size={10} />{editError}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
