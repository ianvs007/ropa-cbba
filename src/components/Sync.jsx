import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLocalISOString } from '../db';
import {
    RefreshCw, Download, Upload, FileSpreadsheet, AlertTriangle,
    CheckCircle, X, Loader2, Globe, KeyRound, Pencil, Zap
} from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import {
    filasStockParaExportar, parsearVentasEnLinea, cruzarVentas, ventasDesdeApi
} from '../utils/syncExcel';
import { aplicarVentas } from '../utils/syncAplicar';

/** URL por defecto de la tienda virtual (configurable en la tarjeta ③) */
const URL_TIENDA_DEFAULT = 'https://tienda-virtual-26n.pages.dev';

/**
 * 🔄 Sync — Sincronización con la tienda virtual (ritual diario al cierre).
 *
 *  ③ Sincronización directa (1 clic, RECOMENDADA): envía el stock por API y
 *    aplica las ventas web devueltas, sin archivos Excel.
 *  ① Exportar stock (respaldo): genera un Excel (codigo | nombre | talla |
 *    color | stock | precio) que se sube de inmediato en el admin web → Sincronizar.
 *  ② Importar ventas en línea (respaldo): lee el Excel que devuelve la nube y
 *    descuenta el stock local.
 *  Tanto ② como ③ descuentan en UNA transacción (products + barcodes +
 *  kardex, vía `aplicarVentas`) y NO crean registros en `sales`: el dinero de
 *  la web no entra a la caja física, solo baja stock (decisión del dueño).
 */
export default function Sync() {
    const { msg, showMsg } = useNotification();

    // ── Estado: exportación ──
    const products = useLiveQuery(() => db.products.toArray(), []);
    const [exportando, setExportando] = React.useState(false);

    // ── Estado: importación ──
    const fileInputRef = React.useRef(null);
    const [archivo, setArchivo] = React.useState(null);      // nombre del archivo elegido
    const [preview, setPreview] = React.useState(null);      // filas cruzadas (vista previa)
    const [erroresParseo, setErroresParseo] = React.useState([]);
    const [aplicando, setAplicando] = React.useState(false);
    const [reporte, setReporte] = React.useState(null);      // resumen tras confirmar

    // ── Estado: sincronización directa (API) ──
    const syncUrlSetting = useLiveQuery(() => db.settings.get('syncUrl'), []);
    const syncTokenSetting = useLiveQuery(() => db.settings.get('syncToken'), []);
    const ultimaSyncSetting = useLiveQuery(() => db.settings.get('ultimaSyncDirecta'), []);
    const [editandoConfig, setEditandoConfig] = React.useState(false);
    const [urlInput, setUrlInput] = React.useState(URL_TIENDA_DEFAULT);
    const [tokenInput, setTokenInput] = React.useState('');
    const [guardandoConfig, setGuardandoConfig] = React.useState(false);
    const [sincronizando, setSincronizando] = React.useState(false);
    const [progresoDirecta, setProgresoDirecta] = React.useState(null); // { hechas, total }
    const [resultadoDirecta, setResultadoDirecta] = React.useState(null); // resumen tras sincronizar

    const configOk = Boolean(syncUrlSetting?.value && syncTokenSetting?.value);

    // Conteo de productos activos sin código corto (advertencia en tarjeta ①)
    const { totalExportables, sinCodigoCount } = React.useMemo(() => {
        const { filas, sinCodigo } = filasStockParaExportar(products || []);
        return { totalExportables: filas.length, sinCodigoCount: sinCodigo.length };
    }, [products]);

    // ══════════════════ ① EXPORTAR STOCK ══════════════════
    const handleExportar = async () => {
        setExportando(true);
        try {
            const todos = await db.products.toArray();
            const { filas, sinCodigo } = filasStockParaExportar(todos);
            if (filas.length === 0) {
                showMsg('error', 'No hay productos activos con código corto para exportar');
                return;
            }

            const XLSX = await import('xlsx');
            const hoja = XLSX.utils.json_to_sheet(filas, {
                header: ['codigo', 'nombre', 'talla', 'color', 'stock', 'precio'],
            });
            const libro = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(libro, hoja, 'stock');
            const fecha = getLocalISOString().slice(0, 10);
            XLSX.writeFile(libro, `stock-para-tienda-virtual-${fecha}.xlsx`);

            showMsg('success',
                `Excel generado con ${filas.length} producto(s)` +
                (sinCodigo.length > 0 ? ` · ${sinCodigo.length} sin código omitido(s)` : ''));
        } catch (err) {
            showMsg('error', `No se pudo generar el Excel: ${err.message}`);
        } finally {
            setExportando(false);
        }
    };

    // ══════════════════ ② IMPORTAR VENTAS EN LÍNEA ══════════════════
    const limpiarImportacion = () => {
        setArchivo(null);
        setPreview(null);
        setErroresParseo([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleArchivo = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // permite volver a elegir el mismo archivo
        if (!file) return;

        setReporte(null);
        try {
            const XLSX = await import('xlsx');
            const buffer = await file.arrayBuffer();
            const libro = XLSX.read(buffer, { type: 'array' });
            const hoja = libro.Sheets[libro.SheetNames[0]];
            const filasCrudas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

            const { ventas, errores } = parsearVentasEnLinea(filasCrudas);
            setErroresParseo(errores);

            if (ventas.length === 0) {
                setPreview(null);
                setArchivo(file.name);
                showMsg('error', 'El archivo no contiene ventas válidas');
                return;
            }

            const [todos, ultima] = await Promise.all([
                db.products.toArray(),
                db.settings.get('ultimaImportacionVentas'),
            ]);
            setPreview(cruzarVentas(ventas, todos, ultima?.value || null));
            setArchivo(file.name);
        } catch (err) {
            limpiarImportacion();
            showMsg('error', `No se pudo leer el archivo: ${err.message}`);
        }
    };

    const handleConfirmar = async () => {
        const aplicables = (preview || []).filter(f => f.aDescontar > 0);
        if (aplicables.length === 0) {
            showMsg('error', 'No hay filas por aplicar');
            return;
        }

        setAplicando(true);
        try {
            // UNA transacción (en `aplicarVentas`): si algo falla a la mitad,
            // Dexie hace rollback completo y el stock nunca queda descontado
            // parcialmente. La misma función usa la sincronización directa (③).
            const { unidades: unidadesDescontadas } = await aplicarVentas(preview);

            setReporte({
                aplicadas: aplicables.length,
                conAviso: preview.filter(f => f.aviso).length,
                unidades: unidadesDescontadas,
            });
            limpiarImportacion();
            showMsg('success', `Sincronización aplicada: ${unidadesDescontadas} unidad(es) descontadas ✓`);
        } catch (err) {
            showMsg('error', `Error al aplicar la sincronización: ${err.message}`);
        } finally {
            setAplicando(false);
        }
    };

    const totalADescontar = (preview || []).reduce((s, f) => s + (f.aDescontar || 0), 0);

    // ══════════════════ ③ SINCRONIZACIÓN DIRECTA (API) ══════════════════
    const handleEditarConfig = () => {
        setUrlInput(syncUrlSetting?.value || URL_TIENDA_DEFAULT);
        setTokenInput(syncTokenSetting?.value || '');
        setEditandoConfig(true);
    };

    const handleGuardarConfig = async () => {
        const url = (urlInput.trim() || URL_TIENDA_DEFAULT).replace(/\/+$/, '');
        const token = tokenInput.trim();
        if (!token) {
            showMsg('error', 'Pega el token de sincronización (admin web → Ajustes)');
            return;
        }
        setGuardandoConfig(true);
        try {
            await db.settings.put({ key: 'syncUrl', value: url });
            await db.settings.put({ key: 'syncToken', value: token });
            setEditandoConfig(false);
            showMsg('success', 'Configuración guardada ✓');
        } catch (err) {
            showMsg('error', `No se pudo guardar la configuración: ${err.message}`);
        } finally {
            setGuardandoConfig(false);
        }
    };

    const handleSincronizarAhora = async () => {
        const base = (syncUrlSetting?.value || URL_TIENDA_DEFAULT).replace(/\/+$/, '');
        const token = syncTokenSetting?.value;
        if (!base || !token) {
            showMsg('error', 'Configura primero la URL y el token de la tienda');
            return;
        }

        setSincronizando(true);
        setResultadoDirecta(null);
        setProgresoDirecta(null);
        try {
            // a) Armar las filas de stock (solo activos con código corto)
            const todos = await db.products.toArray();
            const { filas: filasStock, sinCodigo } = filasStockParaExportar(todos);
            if (filasStock.length === 0) {
                showMsg('error', 'No hay productos activos con código corto para sincronizar');
                return;
            }
            if (filasStock.length > 5000) {
                showMsg('error', `Hay ${filasStock.length} variantes; la API acepta máximo 5000 por sincronización`);
                return;
            }
            // Se envían también nombre y precio: si la prenda no existe en la
            // web, la tienda la CREA en el mismo clic (carga inicial incluida).
            const filas = filasStock.map(({ codigo, nombre, talla, color, stock, precio }) => ({ codigo, nombre, talla, color, stock, precio }));

            // b) POST a la API en LOTES de 250 para mostrar el avance en %.
            // Solo el último lote va con finalizar: true (la tienda recién ahí
            // cierra la ventana de ventas y las devuelve). Reintentar tras un
            // fallo es seguro: lo ya creado/ajustado se recalcula igual.
            const TAM_LOTE = 250;
            let creadas = 0, actualizadas = 0, advertencias = 0;
            const detalleAvisos = [];
            let ventasApi = [];
            setProgresoDirecta({ hechas: 0, total: filas.length });
            for (let i = 0; i < filas.length; i += TAM_LOTE) {
                const esUltimo = i + TAM_LOTE >= filas.length;
                let resp;
                try {
                    resp = await fetch(`${base}/api/sync`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ filas: filas.slice(i, i + TAM_LOTE), finalizar: esUltimo }),
                    });
                } catch {
                    throw new Error('Sin internet o la tienda está caída. Revisa tu conexión y vuelve a presionar "Sincronizar ahora": continuará sin duplicar nada.');
                }
                if (resp.status === 401) throw new Error('Token inválido: revísalo en el admin web → Ajustes.');
                if (resp.status === 503) throw new Error('La tienda aún no tiene token configurado (admin web → Ajustes).');
                if (resp.status === 400) {
                    const data400 = await resp.json().catch(() => null);
                    throw new Error(`La tienda rechazó las filas: ${data400?.error || 'datos inválidos'}.`);
                }
                if (!resp.ok) throw new Error(`La tienda respondió con error ${resp.status}. Vuelve a presionar "Sincronizar ahora": continuará sin duplicar nada.`);
                const data = await resp.json();
                creadas += data.creadas ?? 0;
                actualizadas += data.actualizadas ?? 0;
                advertencias += (data.advertencias ?? 0) + (Array.isArray(data.avisosImportacion) ? data.avisosImportacion.length : 0);
                if (Array.isArray(data.detalle)) detalleAvisos.push(...data.detalle.filter(d => d.aviso));
                if (esUltimo) ventasApi = data.ventas || [];
                setProgresoDirecta({ hechas: Math.min(i + TAM_LOTE, filas.length), total: filas.length });
            }

            // c) Aplicar las ventas devueltas con la MISMA lógica de la tarjeta ②.
            // El guard `ultimaImportacionVentas` (que actualiza `aplicarVentas`)
            // evita el doble descuento si se reintenta tras un fallo a mitad de camino.
            const { ventas, errores } = ventasDesdeApi(ventasApi);
            const [productosFrescos, ultima] = await Promise.all([
                db.products.toArray(),
                db.settings.get('ultimaImportacionVentas'),
            ]);
            const cruzadas = cruzarVentas(ventas, productosFrescos, ultima?.value || null);
            const { unidades } = await aplicarVentas(cruzadas);

            // d) Persistir la fecha de la última sync directa exitosa
            const fechaSync = getLocalISOString();
            await db.settings.put({ key: 'ultimaSyncDirecta', value: fechaSync });

            const aplicables = cruzadas.filter(f => f.aDescontar > 0);
            setResultadoDirecta({
                creadas,
                actualizadas,
                advertencias,
                detalle: detalleAvisos,
                omitidos: sinCodigo.length,
                ventasRecibidas: ventas.length,
                ventasAplicadas: aplicables.length,
                unidades,
                avisosVentas: cruzadas.filter(f => f.aviso).length,
                erroresVentas: errores,
            });
            showMsg('success',
                `✓ Sincronizado: ${creadas ? `${creadas} prendas nuevas creadas en la web · ` : ''}` +
                `${actualizadas} variantes ajustadas en la web · ` +
                `${unidades} ítem(s) vendidos web descontados localmente`);
        } catch (err) {
            showMsg('error', err.message);
        } finally {
            setSincronizando(false);
            setProgresoDirecta(null);
        }
    };

    return (
        <div className="max-w-7xl mx-auto fade-in h-full flex flex-col">
            <div className="flex items-center justify-between gap-3 mb-5 shrink-0">
                <h1 className="text-2xl font-bold text-pink-900 flex items-center gap-2">
                    <RefreshCw size={24} strokeWidth={1.8} className="text-pink-600" />
                    Sincronización con tienda virtual
                </h1>
            </div>

            {/* Notificación */}
            {msg && (
                <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                    ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700'
                        : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <X size={16} />}
                    {msg.text}
                </div>
            )}

            {/* ══════════ TARJETA ③ SINCRONIZACIÓN DIRECTA (RECOMENDADA) ══════════ */}
            <div className="fashion-card p-6 mb-4 border-2 border-pink-300 relative fade-in">
                <span className="absolute -top-3 left-6 badge-rose shadow-sm">Recomendada</span>

                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-pink-600 flex items-center justify-center shrink-0">
                        <Zap size={18} strokeWidth={1.8} className="text-white" />
                    </div>
                    <div>
                        <h2 className="font-black text-pink-950 uppercase tracking-tight">Sincronización directa (1 clic)</h2>
                        <p className="text-xs text-pink-500 font-medium">Sin archivos Excel: sube el stock a la web y baja las ventas web por API</p>
                    </div>
                </div>

                {/* Configuración (una sola vez) */}
                {(!configOk || editandoConfig) ? (
                    <div className="bg-pink-50/60 border border-pink-100 rounded-xl p-4 mb-4 space-y-3">
                        <div>
                            <label className="flex items-center gap-1.5 text-xs font-bold text-pink-700 mb-1">
                                <Globe size={13} /> URL de la tienda
                            </label>
                            <input
                                type="url"
                                value={urlInput}
                                onChange={e => setUrlInput(e.target.value)}
                                placeholder={URL_TIENDA_DEFAULT}
                                className="w-full px-3 py-2 rounded-xl border border-pink-200 text-sm focus:outline-none focus:border-pink-400 bg-white"
                            />
                        </div>
                        <div>
                            <label className="flex items-center gap-1.5 text-xs font-bold text-pink-700 mb-1">
                                <KeyRound size={13} /> Token de sincronización
                            </label>
                            <input
                                type="password"
                                value={tokenInput}
                                onChange={e => setTokenInput(e.target.value)}
                                placeholder="Lo generas en el admin web → Ajustes"
                                className="w-full px-3 py-2 rounded-xl border border-pink-200 text-sm focus:outline-none focus:border-pink-400 bg-white"
                            />
                        </div>
                        <div className="flex gap-2 justify-end">
                            {configOk && (
                                <button onClick={() => setEditandoConfig(false)} disabled={guardandoConfig}
                                    className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-500 hover:border-pink-300 transition-all">
                                    Cancelar
                                </button>
                            )}
                            <button onClick={handleGuardarConfig} disabled={guardandoConfig}
                                className="btn-primary flex items-center gap-2 px-5 py-2 text-sm disabled:opacity-60">
                                {guardandoConfig ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                                {guardandoConfig ? 'Guardando…' : 'Guardar configuración'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4">
                        <p className="text-sm text-green-700 font-semibold flex items-center gap-2 min-w-0">
                            <CheckCircle size={16} className="shrink-0" />
                            <span className="truncate">Configurado ✓ · {syncUrlSetting?.value}</span>
                        </p>
                        <button onClick={handleEditarConfig}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-green-300 text-green-700 hover:bg-green-100 transition-all shrink-0">
                            <Pencil size={13} /> Editar
                        </button>
                    </div>
                )}

                {ultimaSyncSetting?.value && (
                    <p className="text-[11px] text-pink-400 font-semibold mb-4">
                        Última sincronización directa: {String(ultimaSyncSetting.value).replace('T', ' ').slice(0, 19)}
                    </p>
                )}

                <button onClick={handleSincronizarAhora} disabled={!configOk || sincronizando || editandoConfig}
                    className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-60">
                    {sincronizando ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                    {sincronizando ? 'Sincronizando…' : '🔄 Sincronizar ahora'}
                </button>
                {progresoDirecta && (
                    <div className="mt-3 fade-in">
                        <div className="h-2.5 w-full rounded-full bg-pink-100 overflow-hidden">
                            <div className="h-full rounded-full bg-pink-600 transition-all"
                                style={{ width: `${Math.round((progresoDirecta.hechas / progresoDirecta.total) * 100)}%` }} />
                        </div>
                        <p className="text-[11px] text-pink-500 font-semibold text-center mt-1">
                            Sincronizando {progresoDirecta.hechas} de {progresoDirecta.total} prendas
                            ({Math.round((progresoDirecta.hechas / progresoDirecta.total) * 100)}%) — no cierres esta ventana
                        </p>
                    </div>
                )}
                {!configOk && !editandoConfig && (
                    <p className="text-[11px] text-pink-400 font-semibold text-center mt-2">
                        Guarda la URL y el token para habilitar el botón.
                    </p>
                )}

                {/* Resultado de la última sincronización */}
                {resultadoDirecta && (
                    <div className="mt-4 fade-in">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                            {[
                                { label: 'Prendas nuevas creadas en la web', value: resultadoDirecta.creadas },
                                { label: 'Variantes ajustadas en la web', value: resultadoDirecta.actualizadas },
                                { label: 'Ítems web descontados', value: resultadoDirecta.unidades },
                                { label: 'Ventas web recibidas', value: resultadoDirecta.ventasRecibidas },
                                { label: 'Avisos', value: resultadoDirecta.advertencias + resultadoDirecta.avisosVentas },
                            ].map(({ label, value }) => (
                                <div key={label} className="bg-pink-50/60 border border-pink-100 rounded-xl p-3 text-center">
                                    <p className="text-2xl font-black text-pink-900">{value}</p>
                                    <p className="text-[10px] text-pink-500 font-bold uppercase tracking-wide">{label}</p>
                                </div>
                            ))}
                        </div>

                        {resultadoDirecta.omitidos > 0 && (
                            <div className="mb-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-800">
                                    <span className="font-bold">{resultadoDirecta.omitidos} producto(s) activo(s) sin código corto</span>{' '}
                                    no se enviaron; su stock web quedará desactualizado.
                                </p>
                            </div>
                        )}

                        {resultadoDirecta.detalle.length > 0 && (
                            <details className="mb-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                                <summary className="text-xs font-bold text-amber-800 cursor-pointer">
                                    Ver detalle de advertencias de la tienda ({resultadoDirecta.detalle.length})
                                </summary>
                                <ul className="text-xs text-amber-800 mt-2 space-y-0.5 list-disc list-inside">
                                    {resultadoDirecta.detalle.slice(0, 20).map((d, i) => (
                                        <li key={i}>{typeof d === 'string' ? d : JSON.stringify(d)}</li>
                                    ))}
                                    {resultadoDirecta.detalle.length > 20 && <li>…y {resultadoDirecta.detalle.length - 20} más</li>}
                                </ul>
                            </details>
                        )}

                        {resultadoDirecta.erroresVentas.length > 0 && (
                            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                                <div className="text-xs text-amber-800">
                                    <p className="font-bold mb-1">{resultadoDirecta.erroresVentas.length} venta(s) de la API ignorada(s) por datos inválidos:</p>
                                    <ul className="space-y-0.5 list-disc list-inside">
                                        {resultadoDirecta.erroresVentas.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                                        {resultadoDirecta.erroresVentas.length > 5 && <li>…y {resultadoDirecta.erroresVentas.length - 5} más</li>}
                                    </ul>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-2">
                Respaldo: flujo con archivos Excel
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                {/* ══════════ TARJETA ① EXPORTAR STOCK ══════════ */}
                <div className="fashion-card p-6 flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-pink-100 flex items-center justify-center shrink-0">
                            <Download size={18} strokeWidth={1.8} className="text-pink-600" />
                        </div>
                        <div>
                            <h2 className="font-black text-pink-950 uppercase tracking-tight">Exportar stock para la tienda virtual</h2>
                            <p className="text-xs text-pink-500 font-medium">Paso 1 del ritual de cierre diario</p>
                        </div>
                    </div>

                    <p className="text-sm text-gray-600 mb-4">
                        Genera un Excel con el stock actual (una fila por variante con código corto)
                        listo para subir al admin web.
                    </p>

                    <div className="flex items-center gap-2 mb-4">
                        <span className="badge-rose">{totalExportables} producto(s) exportables</span>
                        {sinCodigoCount > 0 && (
                            <span className="badge-gold">{sinCodigoCount} sin código</span>
                        )}
                    </div>

                    {sinCodigoCount > 0 && (
                        <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800">
                                Hay <span className="font-bold">{sinCodigoCount} producto(s) activo(s) sin código corto</span>:
                                no se incluirán en el Excel y su stock web quedará desactualizado.
                            </p>
                        </div>
                    )}

                    <div className="mt-auto space-y-3">
                        <button onClick={handleExportar} disabled={exportando}
                            className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-60">
                            {exportando ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
                            {exportando ? 'Generando…' : 'Generar Excel de stock'}
                        </button>
                        <p className="text-[11px] text-pink-400 font-semibold text-center">
                            Súbelo de inmediato en el admin web → Sincronizar; un Excel viejo descuadra el stock.
                        </p>
                    </div>
                </div>

                {/* ══════════ TARJETA ② IMPORTAR VENTAS EN LÍNEA ══════════ */}
                <div className="fashion-card p-6 flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                            <Upload size={18} strokeWidth={1.8} className="text-purple-600" />
                        </div>
                        <div>
                            <h2 className="font-black text-pink-950 uppercase tracking-tight">Importar ventas en línea</h2>
                            <p className="text-xs text-pink-500 font-medium">Paso 2: baja del stock lo vendido en la web</p>
                        </div>
                    </div>

                    <p className="text-sm text-gray-600 mb-4">
                        Selecciona el Excel <span className="font-mono text-xs">ventas-en-linea-YYYY-MM-DD.xlsx</span>{' '}
                        descargado del admin web. Solo se descuenta stock; el dinero de la web no entra a esta caja.
                    </p>

                    <div className="mt-auto space-y-3">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx"
                            onChange={handleArchivo}
                            className="hidden"
                        />
                        <button onClick={() => fileInputRef.current?.click()} disabled={aplicando}
                            className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-60">
                            <Upload size={18} />
                            Elegir archivo .xlsx
                        </button>
                        {archivo && (
                            <p className="text-xs text-pink-600 font-semibold text-center truncate">
                                📄 {archivo}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Errores de parseo (filas inválidas no bloquean el resto) */}
            {erroresParseo.length > 0 && (
                <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800">
                        <p className="font-bold mb-1">{erroresParseo.length} fila(s) ignorada(s) por datos inválidos:</p>
                        <ul className="text-xs space-y-0.5 list-disc list-inside">
                            {erroresParseo.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                            {erroresParseo.length > 5 && <li>…y {erroresParseo.length - 5} más</li>}
                        </ul>
                    </div>
                </div>
            )}

            {/* ══════════ VISTA PREVIA DE LA IMPORTACIÓN ══════════ */}
            {preview && (
                <div className="fashion-card flex-1 flex flex-col min-h-0 relative mb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-b border-pink-50">
                        <p className="text-sm font-bold text-pink-900">
                            Vista previa: {preview.length} fila(s) · {totalADescontar} unidad(es) a descontar
                        </p>
                        <div className="flex gap-2">
                            <button onClick={limpiarImportacion} disabled={aplicando}
                                className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-500 hover:border-pink-300 transition-all">
                                Cancelar
                            </button>
                            <button onClick={handleConfirmar} disabled={aplicando || totalADescontar === 0}
                                className="btn-primary flex items-center gap-2 px-6 py-2 disabled:opacity-60">
                                {aplicando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                                {aplicando ? 'Aplicando…' : 'Confirmar descuento'}
                            </button>
                        </div>
                    </div>
                    <div className="overflow-x-auto flex-1 h-full scrollbar-thin">
                        <table className="w-full min-w-[900px] text-sm">
                            <thead className="bg-pink-50/80 sticky top-0 z-10 backdrop-blur-sm shadow-sm">
                                <tr className="text-pink-700 text-left">
                                    <th className="px-4 py-3 font-semibold">Código</th>
                                    <th className="px-4 py-3 font-semibold">Nombre</th>
                                    <th className="px-4 py-3 font-semibold">Talla</th>
                                    <th className="px-4 py-3 font-semibold">Color</th>
                                    <th className="px-4 py-3 font-semibold text-center">Cant.</th>
                                    <th className="px-4 py-3 font-semibold text-center">A descontar</th>
                                    <th className="px-4 py-3 font-semibold">Pedido</th>
                                    <th className="px-4 py-3 font-semibold">Aviso</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-pink-50">
                                {preview.map((f, i) => (
                                    <tr key={`${f.codigo}-${f.pedido}-${i}`} className="hover:bg-pink-50/50 transition-colors">
                                        <td className="px-4 py-3 font-mono font-bold text-pink-800">{f.codigo}</td>
                                        <td className="px-4 py-3">
                                            <p className="font-semibold text-pink-900">{f.nombre || '-'}</p>
                                            {f.nombreLocal && f.nombreLocal !== f.nombre && (
                                                <p className="text-[10px] text-gray-400">Local: {f.nombreLocal}</p>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-pink-700">{f.talla || '-'}</td>
                                        <td className="px-4 py-3 text-pink-700">{f.color || '-'}</td>
                                        <td className="px-4 py-3 text-center font-semibold text-pink-800">{f.cantidad}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`text-lg font-black ${f.aDescontar > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                                                {f.aDescontar}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-pink-600">{f.pedido || '-'}</td>
                                        <td className="px-4 py-3">
                                            {f.aviso
                                                ? <span className={f.aDescontar > 0 ? 'badge-gold' : 'badge-red'}>{f.aviso}</span>
                                                : <span className="badge-green">OK</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ══════════ REPORTE FINAL ══════════ */}
            {reporte && (
                <div className="fashion-card p-6 fade-in">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                            <CheckCircle size={18} strokeWidth={1.8} className="text-green-600" />
                        </div>
                        <h2 className="font-black text-pink-950 uppercase tracking-tight">Sincronización aplicada</h2>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: 'Filas aplicadas', value: reporte.aplicadas },
                            { label: 'Filas con aviso', value: reporte.conAviso },
                            { label: 'Unidades descontadas', value: reporte.unidades },
                        ].map(({ label, value }) => (
                            <div key={label} className="bg-pink-50/60 border border-pink-100 rounded-xl p-3 text-center">
                                <p className="text-2xl font-black text-pink-900">{value}</p>
                                <p className="text-[10px] text-pink-500 font-bold uppercase tracking-wide">{label}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-3 text-center">
                        Los movimientos quedaron registrados en el kárdex como "VENTA EN LÍNEA".
                    </p>
                </div>
            )}
        </div>
    );
}
