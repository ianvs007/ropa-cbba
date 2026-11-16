import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    X,
    Store,
    Search,
    PlusCircle,
    PackageCheck,
    RefreshCw,
    AlertTriangle,
    CheckCircle2,
    ArrowRight,
    Cloud,
    Upload,
} from 'lucide-react';
import { db } from '../db';
import { useUser } from '../contexts/UserContext';
import {
    normalizarCodigoSucursal,
    evaluarCodigoSucursal,
    sugerirCodigoLibre,
} from '../utils/branchTransferIn';
import {
    aplicarRecepcionPaqueteLocal,
    consultarTrasladosEntrantesNube,
    obtenerSucursalLocal,
} from '../utils/cloudBranchClient';
import { validarPaqueteTraslado } from '../utils/cloudBranchTransfers';

/**
 * 🏬 BranchReceiveModal — Asistente rápido para recibir mercadería de sucursal
 *
 * Permite:
 *  1. Consultar el Buzón en la Nube (envíos en camino desde otras sucursales) o
 *     cargar un archivo `.traslado.json` para recibir con 1 clic.
 *  2. Ingresar manualmente el código corto de la etiqueta física de la sucursal.
 */
export default function BranchReceiveModal({
    onClose,
    onSelectExistingProduct,
    onCreateNewFromBranch,
}) {
    const { user } = useUser() || {};
    const products = useLiveQuery(() => db.products.orderBy('name').toArray(), []);
    const barcodes = useLiveQuery(() => db.barcodes.toArray(), []);

    const [rawCode, setRawCode] = React.useState('');
    const [productSearch, setProductSearch] = React.useState('');

    // Estado de buzón en la nube / archivo .traslado.json
    const [localBranch, setLocalBranch] = React.useState('TIENDA PRINCIPAL');
    const [cloudTransfers, setCloudTransfers] = React.useState([]);
    const [cloudLoading, setCloudLoading] = React.useState(false);
    const [cloudMsg, setCloudMsg] = React.useState(null);
    const [receivingUid, setReceivingUid] = React.useState(null);
    const fileInputRef = React.useRef(null);

    React.useEffect(() => {
        obtenerSucursalLocal().then(setLocalBranch).catch(() => {});
    }, []);

    const handleBuscarNube = async () => {
        setCloudLoading(true);
        setCloudMsg(null);
        try {
            const res = await consultarTrasladosEntrantesNube();
            setLocalBranch(res.localBranch);
            setCloudTransfers(res.pendientes || []);
            if (!res.pendientes || res.pendientes.length === 0) {
                setCloudMsg({
                    type: 'info',
                    text: `No hay envíos pendientes en el buzón para ${res.localBranch}.`,
                });
            }
        } catch (err) {
            setCloudMsg({ type: 'error', text: err.message });
        } finally {
            setCloudLoading(false);
        }
    };

    const handleArchivoSeleccionado = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(String(ev.target?.result || ''));
                const check = validarPaqueteTraslado(parsed);
                if (!check.valido) {
                    setCloudMsg({ type: 'error', text: check.error });
                    return;
                }
                setCloudTransfers((prev) => {
                    const exists = prev.some((p) => p.transferUid === check.paquete.transferUid);
                    return exists ? prev : [check.paquete, ...prev];
                });
                setCloudMsg({
                    type: 'info',
                    text: `Paquete cargado desde archivo (${check.paquete.originBranch} → ${check.paquete.destinationBranch}). Revísalo y confirma la recepción.`,
                });
            } catch {
                setCloudMsg({ type: 'error', text: 'El archivo seleccionado no es un .traslado.json válido.' });
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleConfirmarPaquete = async (paquete) => {
        setReceivingUid(paquete.transferUid);
        setCloudMsg(null);
        try {
            const res = await aplicarRecepcionPaqueteLocal(paquete, { user });
            setCloudTransfers((prev) => prev.filter((p) => p.transferUid !== paquete.transferUid));
            const resumen = res.items.map((i) => `${i.name} (Cód ${i.shortCode})`).join(', ');
            setCloudMsg({
                type: 'success',
                text: `✅ Recibido desde ${res.originBranch}: ${resumen}.${
                    res.cloudConfirmed ? ' Confirmado en la nube.' : ''
                }`,
            });
        } catch (err) {
            setCloudMsg({ type: 'error', text: err.message });
        } finally {
            setReceivingUid(null);
        }
    };

    const activeProducts = React.useMemo(
        () => (products || []).filter((p) => p.active !== false),
        [products]
    );

    const evaluacion = React.useMemo(() => {
        if (!rawCode.trim()) return null;
        return evaluarCodigoSucursal({
            rawCode,
            products: products || [],
            barcodes: barcodes || [],
            targetProductId: null,
        });
    }, [rawCode, products, barcodes]);

    const codigoNormalizado = normalizarCodigoSucursal(rawCode) || '';
    const codigoLibreSugerido = React.useMemo(() => {
        if (evaluacion?.status !== 'colision') return '';
        try {
            return sugerirCodigoLibre(products || [], barcodes || [], []);
        } catch {
            return '';
        }
    }, [evaluacion, products, barcodes]);

    const filteredProducts = React.useMemo(() => {
        const q = productSearch.trim().toLowerCase();
        if (!q) return activeProducts.slice(0, 12);
        return activeProducts
            .filter(
                (p) =>
                    p.name?.toLowerCase().includes(q) ||
                    p.brand?.toLowerCase().includes(q) ||
                    p.color?.toLowerCase().includes(q) ||
                    p.size?.toLowerCase().includes(q) ||
                    p.shortCode === q
            )
            .slice(0, 15);
    }, [activeProducts, productSearch]);

    const codigoParaPasar =
        evaluacion?.valido && evaluacion?.shortCode
            ? evaluacion.shortCode
            : codigoLibreSugerido || codigoNormalizado;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full overflow-hidden border-2 border-amber-100 fade-in my-8">
                {/* Cabecera */}
                <div className="px-7 py-5 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md">
                            <Store size={22} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-amber-950 uppercase tracking-tight">
                                Recibir Mercadería de Sucursal
                            </h2>
                            <p className="text-xs font-bold text-amber-700">
                                Recibe envíos desde la nube con 1 clic o ingresa el código corto manualmente
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full bg-white border border-amber-200 flex items-center justify-center text-amber-700 hover:bg-amber-100 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-7 space-y-6 max-h-[80vh] overflow-y-auto">
                    {/* Sección 0: Buzón de Traslados en la Nube / Archivo */}
                    <div className="rounded-2xl border-2 border-sky-200 bg-sky-50/50 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <Cloud size={18} className="text-sky-600" />
                                <div>
                                    <p className="text-xs font-black text-sky-950 uppercase tracking-wider">
                                        Buzón en la Nube · Destino: {localBranch}
                                    </p>
                                    <p className="text-[11px] font-semibold text-sky-700">
                                        Consulta envíos en camino desde sucursales remotas o carga un archivo .traslado.json
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleBuscarNube}
                                    disabled={cloudLoading}
                                    className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-black flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                                >
                                    <RefreshCw size={14} className={cloudLoading ? 'animate-spin' : ''} />
                                    {cloudLoading ? 'Consultando...' : 'Buscar en Nube'}
                                </button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".json"
                                    onChange={handleArchivoSeleccionado}
                                    className="hidden"
                                />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="px-3.5 py-2 rounded-xl bg-white border border-sky-300 hover:bg-sky-100 text-sky-800 text-xs font-black flex items-center gap-1.5"
                                >
                                    <Upload size={14} />
                                    Cargar .traslado.json
                                </button>
                            </div>
                        </div>

                        {cloudMsg && (
                            <div
                                className={`px-3 py-2 rounded-xl text-xs font-bold border ${
                                    cloudMsg.type === 'success'
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                        : cloudMsg.type === 'error'
                                            ? 'bg-rose-50 border-rose-200 text-rose-800'
                                            : 'bg-white border-sky-200 text-sky-800'
                                }`}
                            >
                                {cloudMsg.text}
                            </div>
                        )}

                        {cloudTransfers.length > 0 && (
                            <div className="space-y-2 pt-1">
                                {cloudTransfers.map((pkg) => {
                                    const item = pkg.items?.[0];
                                    const isBusy = receivingUid === pkg.transferUid;
                                    return (
                                        <div
                                            key={pkg.transferUid}
                                            className="bg-white rounded-xl border border-sky-200 p-3 flex flex-wrap items-center justify-between gap-3"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-xs font-black text-pink-950 uppercase">
                                                    {item?.name}{' '}
                                                    <span className="text-amber-700">· Cód {item?.shortCode}</span>
                                                </p>
                                                <p className="text-[11px] font-bold text-sky-700">
                                                    Desde {pkg.originBranch} · Enviado por {pkg.sentBy}
                                                    {item?.size ? ` · Talla ${item.size}` : ''}
                                                    {item?.color ? ` · ${item.color}` : ''}
                                                    {` · Bs. ${Number(item?.price || 0).toFixed(2)}`}
                                                </p>
                                                {pkg.notes && (
                                                    <p className="text-[10px] font-semibold text-gray-500 mt-0.5">
                                                        Nota: {pkg.notes}
                                                    </p>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                disabled={isBusy}
                                                onClick={() => handleConfirmarPaquete(pkg)}
                                                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1.5 shrink-0 disabled:opacity-50 shadow-sm"
                                            >
                                                <CheckCircle2 size={14} />
                                                {isBusy ? 'Recibiendo...' : 'Confirmar Recepción'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Paso 1: Código corto de la etiqueta de sucursal */}
                    <div className="space-y-2">
                        <label className="text-xs font-black text-amber-900 uppercase tracking-widest block">
                            1. Código corto que trae la prenda desde la sucursal
                        </label>
                        <input
                            type="text"
                            inputMode="numeric"
                            maxLength={5}
                            value={rawCode}
                            onChange={(e) => setRawCode(e.target.value)}
                            onBlur={() => {
                                const norm = normalizarCodigoSucursal(rawCode);
                                if (norm) setRawCode(norm);
                            }}
                            placeholder="Ej: 01450"
                            className="w-full fashion-input text-3xl font-black text-center tracking-[0.3em] py-4 border-amber-200 focus:border-amber-500"
                            autoFocus
                        />

                        {/* Estado de validación del código */}
                        {evaluacion && (
                            <div
                                className={`p-4 rounded-2xl border-2 mt-2 ${
                                    evaluacion.status === 'retorno_mismo_producto'
                                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                                        : evaluacion.valido
                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                            : 'bg-rose-50 border-rose-200 text-rose-900'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-2.5 text-xs font-bold">
                                        {evaluacion.status === 'retorno_mismo_producto' ? (
                                            <RefreshCw size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                        ) : evaluacion.valido ? (
                                            <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                                        ) : (
                                            <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                                        )}
                                        <div>
                                            <p>{evaluacion.mensaje}</p>
                                            {evaluacion.status === 'colision' && codigoLibreSugerido && (
                                                <p className="text-[11px] text-rose-700 mt-1">
                                                    Como la sucursal trabaja offline, este número ya existe localmente. Si es otra prenda distinta, puedes usar el código libre sugerido:{' '}
                                                    <span className="font-black underline">{codigoLibreSugerido}</span>.
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {evaluacion.status === 'retorno_mismo_producto' && evaluacion.conflictProduct && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onSelectExistingProduct(
                                                    evaluacion.conflictProduct,
                                                    evaluacion.shortCode,
                                                    evaluacion.originBranchSuggested
                                                )
                                            }
                                            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black flex items-center gap-1.5 shrink-0 shadow-md"
                                        >
                                            Reingresar retorno <ArrowRight size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Paso 2: Elegir si es Producto Nuevo o Producto ya Registrado */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-amber-100">
                        {/* Opción A: Producto Nuevo en la tienda principal */}
                        <div className="p-5 rounded-2xl border-2 border-amber-200 bg-amber-50/40 flex flex-col justify-between space-y-4">
                            <div>
                                <span className="inline-block text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-900 mb-2">
                                    Opción A · Modelo Nuevo
                                </span>
                                <h3 className="font-black text-amber-950 text-base">
                                    La prenda NO está registrada en esta tienda
                                </h3>
                                <p className="text-xs text-amber-700 mt-1">
                                    Abre el formulario de Nuevo Producto en modo Sucursal, conservando el código{' '}
                                    <span className="font-black">{codigoParaPasar || 'de la etiqueta'}</span> y alineándolo con la Tienda Virtual.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onCreateNewFromBranch(codigoParaPasar)}
                                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all"
                            >
                                <PlusCircle size={17} />
                                Registrar como Producto Nuevo
                            </button>
                        </div>

                        {/* Opción B: Producto ya registrado en la tienda principal */}
                        <div className="p-5 rounded-2xl border-2 border-pink-100 bg-pink-50/30 flex flex-col justify-between space-y-3">
                            <div>
                                <span className="inline-block text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-pink-200 text-pink-900 mb-2">
                                    Opción B · Modelo Existente
                                </span>
                                <h3 className="font-black text-pink-950 text-base">
                                    El modelo YA existe en esta tienda
                                </h3>
                                <p className="text-xs text-pink-700 mt-1">
                                    Busca la prenda abajo para sumarle stock desde sucursal conservando el código{' '}
                                    <span className="font-black">{codigoParaPasar || 'de su etiqueta'}</span>.
                                </p>
                            </div>
                            <div className="relative">
                                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-pink-400" />
                                <input
                                    type="text"
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                    placeholder="Buscar prenda por nombre, talla, color..."
                                    className="fashion-input pl-9 py-2.5 text-xs font-bold"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Lista rápida de productos existentes para Opción B */}
                    <div className="space-y-2">
                        <p className="text-[11px] font-black text-pink-800 uppercase tracking-widest">
                            Seleccionar producto existente ({filteredProducts.length} mostrados)
                        </p>
                        <div className="border border-pink-100 rounded-2xl divide-y divide-pink-50 max-h-60 overflow-y-auto">
                            {filteredProducts.length === 0 ? (
                                <p className="py-6 text-center text-xs text-pink-400">
                                    No se encontraron productos con ese criterio. Usa la Opción A para registrarlo como nuevo.
                                </p>
                            ) : (
                                filteredProducts.map((p) => (
                                    <div
                                        key={p.id}
                                        className="px-4 py-2.5 hover:bg-amber-50/50 flex items-center justify-between gap-3 transition-colors"
                                    >
                                        <div>
                                            <p className="font-bold text-pink-950 text-sm">{p.name}</p>
                                            <p className="text-[11px] text-pink-500 font-semibold">
                                                {[p.brand, p.size && `Talla ${p.size}`, p.color]
                                                    .filter(Boolean)
                                                    .join(' · ') || 'Sin variante'}{' '}
                                                · Stock actual: <span className="font-black text-pink-800">{p.stock}</span>
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onSelectExistingProduct(
                                                    p,
                                                    codigoParaPasar,
                                                    evaluacion?.originBranchSuggested || ''
                                                )
                                            }
                                            className="px-3.5 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-xs font-black flex items-center gap-1.5 shrink-0 transition-colors"
                                        >
                                            <PackageCheck size={14} /> Sumar aquí
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
