import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateUniqueBarcode } from '../db';

import {
    Settings as SettingsIcon, Save, CheckCircle, Printer,
    MessageSquare, FileSpreadsheet, Upload, Download,
    AlertTriangle, Image, Trash2, Camera, Loader2
} from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { getEmbedding } from '../utils/garmentClassifier';


/**
 * Settings — Configuración general + Importación masiva de productos
 */
export default function Settings() {
    const { user } = useUser();
    const settingsRaw = useLiveQuery(() => db.settings.toArray(), []);
    const [form, setForm] = React.useState({});
    const [saved, setSaved] = React.useState(false);
    const fileRef = React.useRef(null);
    const logoRef = React.useRef(null);
    const [logoError, setLogoError] = React.useState(null); // ── BUG FIX: Error de logo en UI ──

    // ── Reindexado de fotos para "Buscar por foto" ──
    const [reindexing, setReindexing] = React.useState(false);
    const [reindexProgress, setReindexProgress] = React.useState({ done: 0, total: 0 });
    const [reindexMsg, setReindexMsg] = React.useState(null);

    React.useEffect(() => {
        if (!settingsRaw) return;
        const obj = {};
        settingsRaw.forEach(s => { obj[s.key] = s.value; });
        if (obj.printTicket === undefined) obj.printTicket = 'true';
        if (!obj.ticketMessage) obj.ticketMessage = '¡Gracias por su compra!';
        if (!obj.returnDays) obj.returnDays = '15';
        if (!obj.returnMessage) obj.returnMessage = 'Cambios y devoluciones válidos hasta 15 días desde la fecha de compra, presentando este comprobante. Pasado este plazo, no se aceptarán devoluciones.';
        if (!obj.reservationExpiryMessage) obj.reservationExpiryMessage = 'RESERVA VIGENTE POR 15 DÍAS. Transcurrido este plazo sin efectuar el pago total, la reserva quedará anulada y el anticipo ingresará como ingreso a favor de la tienda. Condición aceptada al momento de la reserva.';
        if (!obj.maxDiscount) obj.maxDiscount = '10';
        setForm(obj);
    }, [settingsRaw]);

    const handleSave = async (e) => {
        e.preventDefault();
        for (const [key, value] of Object.entries(form)) {
            await db.settings.put({ key, value });
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    // Carga un dataURL en un <img> y genera su embedding visual.
    const embedFromPhoto = (dataUrl) => new Promise(resolve => {
        const img = new window.Image();
        img.onload = async () => {
            try { resolve(await getEmbedding(img)); }
            catch (e) { console.warn('Embedding falló:', e); resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });

    // Indexa los productos con foto que aún no tienen huella visual.
    const handleReindex = async () => {
        setReindexMsg(null);
        setReindexing(true);
        try {
            const pending = await db.products.where('hasEmbedding').notEqual(1).toArray();
            const withPhoto = pending.filter(p => p.photo);
            setReindexProgress({ done: 0, total: withPhoto.length });

            if (withPhoto.length === 0) {
                setReindexMsg('No hay productos con foto pendientes de indexar. ✓');
                return;
            }

            let done = 0, ok = 0;
            for (const p of withPhoto) {
                try {
                    const vec = await embedFromPhoto(p.photo);
                    if (vec) { await db.products.update(p.id, { embedding: vec, hasEmbedding: 1 }); ok++; }
                } catch (e) {
                    console.warn('No se pudo indexar el producto', p.id, e);
                }
                done++;
                setReindexProgress({ done, total: withPhoto.length });
                // Cede el hilo entre productos para no congelar la UI.
                await new Promise(r => setTimeout(r, 0));
            }
            setReindexMsg(`Indexación completada: ${ok} de ${withPhoto.length} productos. ✓`);
        } catch (e) {
            console.error('Error reindexando fotos:', e);
            setReindexMsg('Error durante la indexación: ' + (e.message || e));
        } finally {
            setReindexing(false);
        }
    };

    const textFields = [
        { key: 'storeName', label: 'Nombre de la Tienda', type: 'text', placeholder: 'Mi Tienda de Ropa' },
        { key: 'storePhone', label: 'Teléfono', type: 'tel', placeholder: '591-xxxxxxx' },
        { key: 'storeAddress', label: 'Dirección', type: 'text', placeholder: 'Calle, N°, Ciudad' },
        { key: 'currency', label: 'Moneda (símbolo)', type: 'text', placeholder: 'Bs.' },
        { key: 'lowStockAlert', label: 'Alerta de stock bajo (unidades)', type: 'number', placeholder: '5' },
    ];

    /** Maneja la carga del logo y lo convierte a base64 */
    const handleLogoChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setLogoError('Por favor seleccione una imagen válida (JPG, PNG, etc.)');
            setTimeout(() => setLogoError(null), 4000);
            return;
        }
        if (file.size > 500 * 1024) {
            setLogoError('La imagen es muy grande. Use una imagen de menos de 500KB.');
            setTimeout(() => setLogoError(null), 4000);
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => setForm(p => ({ ...p, storeLogo: ev.target.result }));
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    // ══════════════════════════════════════════════════════
    // ── RENDER ──
    // ══════════════════════════════════════════════════════
    return (
        <div className="max-w-2xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-6 flex items-center gap-2">
                <SettingsIcon size={24} strokeWidth={1.8} className="text-pink-600" />
                Configuración de la Tienda
            </h1>

            {saved && (
                <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 fade-in">
                    <CheckCircle size={16} className="text-green-600" />
                    <span className="text-green-700 text-sm font-semibold">Configuración guardada exitosamente</span>
                </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
                {/* ── Datos generales ── */}
                <div className="fashion-card p-6">
                    <h2 className="font-bold text-pink-900 mb-4 text-sm uppercase tracking-wide">
                        Datos de la Tienda
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {textFields.map(({ key, label, type, placeholder }) => (
                            <div key={key}>
                                <label className="block text-sm font-semibold text-pink-800 mb-1.5">{label}</label>
                                <input
                                    type={type}
                                    value={form[key] || ''}
                                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                                    placeholder={placeholder}
                                    className="fashion-input"
                                    step={type === 'number' ? 'any' : undefined}
                                    min={type === 'number' ? '0' : undefined}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Logo de la Tienda ── */}
                <div className="fashion-card p-6">
                    <h2 className="font-bold text-pink-900 mb-4 text-sm uppercase tracking-wide flex items-center gap-2">
                        <Image size={15} className="text-pink-500" /> Logo de la Tienda
                    </h2>
                    <div className="flex items-center gap-6">
                        {form.storeLogo ? (
                            <div className="flex flex-col items-center gap-2">
                                <img src={form.storeLogo} alt="Logo" className="h-20 w-auto object-contain border border-pink-100 rounded-xl p-1" />
                                <button type="button"
                                    onClick={() => setForm(p => ({ ...p, storeLogo: '' }))}
                                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
                                    <Trash2 size={12} /> Eliminar logo
                                </button>
                            </div>
                        ) : (
                            <div className="w-24 h-20 border-2 border-dashed border-pink-200 rounded-xl flex items-center justify-center text-pink-300">
                                <Image size={28} />
                            </div>
                        )}
                        <div>
                            <p className="text-sm text-pink-700 font-semibold mb-1">Imagen del logotipo</p>
                            <p className="text-xs text-pink-400 mb-3">Aparece en tickets de venta y reservas. Máximo 500KB. (JPG, PNG)</p>
                            {/* ── BUG FIX: Mostrar error de logo en UI ── */}
                            {logoError && (
                                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                                    <AlertTriangle size={12} /> {logoError}
                                </div>
                            )}
                            <button type="button" onClick={() => logoRef.current?.click()}
                                className="btn-secondary flex items-center gap-2 text-sm">
                                <Upload size={14} /> Subir Logo
                            </button>
                            <input ref={logoRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                        </div>
                    </div>
                </div>

                {/* ── Ticket de Venta ── */}
                <div className="fashion-card p-6">
                    <h2 className="font-bold text-pink-900 mb-4 text-sm uppercase tracking-wide flex items-center gap-2">
                        <Printer size={15} className="text-pink-500" /> Nota de Venta
                    </h2>
                    <div className="flex items-center justify-between p-4 bg-pink-50 rounded-xl mb-4">
                        <div>
                            <p className="font-semibold text-pink-900 text-sm">Imprimir nota de venta automáticamente</p>
                            <p className="text-xs text-pink-400 mt-0.5">Si está activo, al confirmar la venta se abre el PDF.</p>
                        </div>
                        <button
                            type="button"
                            id="toggle-print-ticket"
                            onClick={() => setForm(p => ({ ...p, printTicket: p.printTicket === 'false' ? 'true' : 'false' }))}
                            className={`relative w-12 h-6 rounded-full transition-colors duration-300
                                ${form.printTicket !== 'false' ? 'bg-pink-500' : 'bg-gray-300'}`}
                        >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow
                                transition-transform duration-300
                                ${form.printTicket !== 'false' ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                    {/* Mensaje al pie del ticket */}
                    <div>
                        <label className="block text-sm font-semibold text-pink-800 mb-1.5 flex items-center gap-1">
                            <MessageSquare size={13} className="text-pink-500" /> Mensaje al pie de la nota
                        </label>
                        <input
                            type="text"
                            value={form.ticketMessage || ''}
                            onChange={e => setForm(p => ({ ...p, ticketMessage: e.target.value }))}
                            placeholder="¡Gracias por su compra!"
                            className="fashion-input"
                            maxLength={80}
                        />
                    </div>
                    {/* Rebaja máxima para cajeras */}
                    <div className="pt-4 border-t border-pink-100">
                        <label className="block text-sm font-semibold text-pink-800 mb-1">
                            Rebaja máxima permitida por venta (en moneda)
                        </label>
                        <input
                            type="number" min="0" step="0.50"
                            value={form.maxDiscount || '10'}
                            onChange={e => setForm(p => ({ ...p, maxDiscount: e.target.value }))}
                            className="fashion-input w-40"
                        />
                        <p className="text-xs text-pink-400 mt-1">
                            Máximo descuento en Bs. que la cajera puede aplicar por ítem. Cero = sin límite manual (solo validación costo).
                        </p>
                    </div>
                </div>

                {/* ── Políticas de Devolución y Reservas ── */}
                <div className="fashion-card p-6">
                    <h2 className="font-bold text-pink-900 mb-4 text-sm uppercase tracking-wide flex items-center gap-2">
                        <AlertTriangle size={15} className="text-pink-500" /> Políticas y Vigencias
                    </h2>
                    
                    {/* Ventas */}
                    <div className="mb-6">
                        <label className="block text-sm font-semibold text-pink-800 mb-1.5 flex items-center gap-1">
                            Aviso de cambios/devoluciones en Nota de Venta
                        </label>
                        <textarea
                            value={form.returnMessage || ''}
                            onChange={e => setForm(p => ({ ...p, returnMessage: e.target.value }))}
                            className="fashion-input resize-none"
                            rows={2}
                            placeholder="Ej: Solo cambios hasta 15 días con ticket..."
                        />
                        <p className="text-xs text-pink-400 mt-1">Este mensaje aparecerá al pie de cada nota de venta.</p>
                    </div>

                    <div className="border-t border-pink-100 pt-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-pink-800 mb-1.5">
                                    Días de Vigencia (Reserva)
                                </label>
                                <input
                                    type="number" min="1" max="365"
                                    value={form.returnDays || '15'}
                                    onChange={e => setForm(p => ({ ...p, returnDays: e.target.value }))}
                                    className="fashion-input"
                                />
                                <p className="text-[10px] text-pink-400 mt-1">Días antes de que el apartado expire.</p>
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-sm font-semibold text-pink-800 mb-1.5">
                                    Aviso de vigencia en Reservas (Plantilla)
                                </label>
                                <textarea
                                    value={form.reservationExpiryMessage || ''}
                                    onChange={e => setForm(p => ({ ...p, reservationExpiryMessage: e.target.value }))}
                                    className="fashion-input resize-none"
                                    rows={3}
                                />
                                <p className="text-xs text-pink-400 mt-1">Texto pre-llenado al crear una nueva reserva.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end">
                    <button type="submit" id="settings-save" className="btn-primary flex items-center gap-2 px-8">
                        <Save size={18} /> Guardar Configuración
                    </button>
                </div>
            </form>

            {/* ── Búsqueda por foto: reindexar productos antiguos ── */}
            <div className="fashion-card p-6 mt-4">
                <h2 className="font-bold text-pink-900 mb-2 text-sm uppercase tracking-wide flex items-center gap-2">
                    <Camera size={15} className="text-pink-500" /> Búsqueda por foto
                </h2>
                <p className="text-xs text-pink-400 mb-4">
                    Genera la huella visual de los productos con foto que aún no la tienen, para que
                    aparezcan en "Buscar por foto". Los productos nuevos se indexan solos al registrarlos.
                </p>

                {reindexing && reindexProgress.total > 0 && (
                    <div className="mb-4">
                        <div className="flex justify-between text-xs text-pink-600 font-semibold mb-1">
                            <span>Indexando…</span>
                            <span>{reindexProgress.done} de {reindexProgress.total}</span>
                        </div>
                        <div className="w-full h-2 bg-pink-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-pink-500 to-rose-500 transition-all duration-200"
                                style={{ width: `${Math.round((reindexProgress.done / reindexProgress.total) * 100)}%` }}
                            />
                        </div>
                    </div>
                )}

                {reindexMsg && !reindexing && (
                    <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-green-700 text-xs font-medium">
                        <CheckCircle size={14} /> {reindexMsg}
                    </div>
                )}

                <button
                    type="button"
                    onClick={handleReindex}
                    disabled={reindexing}
                    className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {reindexing
                        ? <><Loader2 size={14} className="animate-spin" /> Indexando…</>
                        : <><Camera size={14} /> Reindexar fotos para búsqueda</>}
                </button>
            </div>
        </div>
    );
}
