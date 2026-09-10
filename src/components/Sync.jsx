import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    db, getLocalISOString, fixDuplicateProductShortCodes,
    previsualizarAlineacionEtiquetas, alinearCodigosEtiquetas,
} from '../db';
import {
    RefreshCw, Download, FileSpreadsheet, AlertTriangle, CheckCircle, X, Loader2,
    Globe, KeyRound, Pencil, Zap, Wrench, Tags, Clock, Power,
} from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import { filasStockParaExportar, codigosDuplicadosEnFilas } from '../utils/syncExcel';
import { CLAVES_SYNC_V2, INTERVALO_AUTO_DEFAULT_MIN, armarFilasSnapshot } from '../utils/syncV2';
import { sincronizarV2, estaSincronizando, URL_TIENDA_DEFAULT } from '../utils/syncV2Cliente';

/**
 * 🔄 Sync — Sincronización con la tienda virtual (protocolo v2 por eventos).
 *
 *  Sincronizar (1 clic o automática): baja las ventas/cancelaciones web como
 *  eventos con id (idempotente: nunca descuenta dos veces), sube el stock por
 *  globalId en lotes y la nube desactiva lo que ya no existe en el POS.
 *  Cualquier corte se resuelve volviendo a sincronizar. No toca caja ni `sales`.
 *
 *  Exportar stock a Excel queda solo como respaldo de lectura.
 *  Diseño completo: docs/DISENO_SYNC_EVENTOS.md
 */
const ETIQUETA_FASE = {
    preparando: 'Preparando…',
    bajando: 'Bajando ventas web…',
    subiendo: 'Subiendo stock…',
    finalizando: 'Cerrando sesión en la nube…',
    bajando_final: 'Revisando ventas de último momento…',
    ok: 'Listo',
};

export default function Sync() {
    const { msg, showMsg } = useNotification();

    // ── Productos (conteos) ──
    const products = useLiveQuery(() => db.products.toArray(), []);
    const [exportando, setExportando] = React.useState(false);

    // ── Códigos cortos duplicados (bloquea sync/exportación) ──
    const [duplicadosLocales, setDuplicadosLocales] = React.useState(null);   // [{codigo, filas}]
    const [reparandoDuplicados, setReparandoDuplicados] = React.useState(false);
    const [reparacionDuplicados, setReparacionDuplicados] = React.useState(null);

    // ── Alineación etiqueta ↔ producto (prendas únicas) ──
    const [previaAlineacion, setPreviaAlineacion] = React.useState(null);
    const [calculandoAlineacion, setCalculandoAlineacion] = React.useState(false);
    const [aplicandoAlineacion, setAplicandoAlineacion] = React.useState(false);
    const [resultadoAlineacion, setResultadoAlineacion] = React.useState(null);

    // ── Conexión con la nube ──
    const syncUrlSetting = useLiveQuery(() => db.settings.get('syncUrl'), []);
    const syncTokenSetting = useLiveQuery(() => db.settings.get('syncToken'), []);
    const [editandoConfig, setEditandoConfig] = React.useState(false);
    const [urlInput, setUrlInput] = React.useState(URL_TIENDA_DEFAULT);
    const [tokenInput, setTokenInput] = React.useState('');
    const [guardandoConfig, setGuardandoConfig] = React.useState(false);
    const configOk = Boolean(syncUrlSetting?.value && syncTokenSetting?.value);

    // ── Estado sync v2 ──
    const ultimaOkSetting = useLiveQuery(() => db.settings.get(CLAVES_SYNC_V2.ultimaOk), []);
    const ultimoErrorSetting = useLiveQuery(() => db.settings.get(CLAVES_SYNC_V2.ultimoError), []);
    const autoSetting = useLiveQuery(() => db.settings.get(CLAVES_SYNC_V2.auto), []);
    const intervaloSetting = useLiveQuery(() => db.settings.get(CLAVES_SYNC_V2.intervaloMin), []);
    const ackSetting = useLiveQuery(() => db.settings.get(CLAVES_SYNC_V2.ultimoEventoAck), []);
    const eventosAplicados = useLiveQuery(() => db.webEventos.count(), []);
    const [sincronizando, setSincronizando] = React.useState(false);
    const [progreso, setProgreso] = React.useState(null); // { fase, hechas, total, eventos }
    const [resultado, setResultado] = React.useState(null);

    const autoOn = String(autoSetting?.value ?? '') === '1';
    const intervaloMin = Number(intervaloSetting?.value) >= 1 ? Number(intervaloSetting.value) : INTERVALO_AUTO_DEFAULT_MIN;

    const { totalExportables, sinCodigoCount, sinGlobalIdCount } = React.useMemo(() => {
        const { filas, sinCodigo, sinGlobalId } = armarFilasSnapshot(products || []);
        return { totalExportables: filas.length, sinCodigoCount: sinCodigo.length, sinGlobalIdCount: sinGlobalId.length };
    }, [products]);

    // ══════════════════ SINCRONIZAR (v2) ══════════════════
    const handleSincronizar = async () => {
        if (estaSincronizando()) {
            showMsg('error', 'Ya hay una sincronización en curso (puede ser la automática). Espera a que termine.');
            return;
        }
        setSincronizando(true);
        setResultado(null);
        setProgreso({ fase: 'preparando' });
        try {
            const r = await sincronizarV2({ onProgreso: setProgreso });
            setResultado(r);
            setDuplicadosLocales(null);
            const ev = r.eventos;
            showMsg('success',
                `✓ Sincronizado (${String(r.fecha).replace('T', ' ').slice(0, 19)}): ` +
                `${ev.aplicados} evento(s) web aplicados · ` +
                `${r.snapshot.actualizadas} variante(s) ajustadas en la web` +
                `${r.snapshot.creadasProductos ? ` · ${r.snapshot.creadasProductos} prenda(s) nuevas en la web` : ''}` +
                `${r.finalizar.desactivados ? ` · ${r.finalizar.desactivados} desactivada(s) en la web` : ''}`);
        } catch (err) {
            console.error('Error en sincronización v2:', err);
            if (Array.isArray(err?.duplicados) && err.duplicados.length > 0) {
                setDuplicadosLocales(err.duplicados);
                setReparacionDuplicados(null);
            }
            showMsg('error', err?.message || String(err) || 'Error desconocido al sincronizar');
        } finally {
            setSincronizando(false);
            setProgreso(null);
        }
    };

    const handleToggleAuto = async () => {
        await db.settings.put({ key: CLAVES_SYNC_V2.auto, value: autoOn ? '0' : '1' });
        showMsg('success', autoOn
            ? 'Sincronización automática apagada.'
            : `Sincronización automática encendida: cada ${intervaloMin} min mientras el POS esté abierto (solo en esta máquina).`);
    };

    const handleIntervalo = async (e) => {
        const n = Math.max(1, Math.min(240, Number(e.target.value) || INTERVALO_AUTO_DEFAULT_MIN));
        await db.settings.put({ key: CLAVES_SYNC_V2.intervaloMin, value: String(n) });
    };

    // ══════════════════ CONFIGURACIÓN ══════════════════
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

    // ══════════════════ EXPORTAR STOCK (respaldo) ══════════════════
    const handleExportar = async () => {
        setExportando(true);
        try {
            const todos = await db.products.toArray();
            const { filas, sinCodigo } = filasStockParaExportar(todos);
            if (filas.length === 0) {
                showMsg('error', 'No hay productos activos con código corto para exportar');
                return;
            }
            const dups = codigosDuplicadosEnFilas(filas);
            if (dups.length > 0) {
                setDuplicadosLocales(dups);
                setReparacionDuplicados(null);
                showMsg('error', `Exportación bloqueada: ${dups.length} código(s) corto(s) duplicado(s). Repáralos antes de continuar.`);
                return;
            }
            const XLSX = await import('xlsx');
            const hoja = XLSX.utils.json_to_sheet(filas, {
                header: ['globalId', 'codigo', 'nombre', 'talla', 'color', 'stock', 'precio'],
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

    // ══════════════════ REPARAR CÓDIGOS DUPLICADOS ══════════════════
    const handleRepararDuplicados = async () => {
        const grupos = duplicadosLocales || [];
        const prendas = grupos.reduce((s, g) => s + g.filas.length, 0);
        const confirmado = window.confirm(
            `Se encontraron ${grupos.length} código(s) corto(s) duplicado(s) (${prendas} prendas involucradas).\n\n` +
            `La reparación CONSERVA el código en la prenda más antigua de cada grupo y asigna códigos nuevos a las demás.\n` +
            `La identidad con la tienda virtual es el globalId, así que las prendas no se desvinculan; solo cambia su código visible.\n\n` +
            `¿Reparar ahora?`
        );
        if (!confirmado) return;

        setReparandoDuplicados(true);
        try {
            const reasignaciones = await fixDuplicateProductShortCodes();
            setReparacionDuplicados(reasignaciones);
            setDuplicadosLocales(null);
            showMsg('success', reasignaciones.length > 0
                ? `Reparación lista: ${reasignaciones.length} prenda(s) recibieron código nuevo ✓ Vuelve a sincronizar.`
                : 'No quedaban duplicados por reparar ✓');
        } catch (err) {
            showMsg('error', `No se pudo reparar: ${err.message}`);
        } finally {
            setReparandoDuplicados(false);
        }
    };

    // ══════════════════ ALINEAR ETIQUETA ↔ PRODUCTO ══════════════════
    const handlePrevisualizarAlineacion = async () => {
        setCalculandoAlineacion(true);
        setResultadoAlineacion(null);
        try {
            const plan = await previsualizarAlineacionEtiquetas();
            setPreviaAlineacion(plan);
            if ((plan.reasignaciones?.length || 0) === 0 && (plan.bloqueos?.length || 0) === 0) {
                showMsg('success', 'No hay prendas únicas por alinear: ya coinciden con su etiqueta o son multi-unidad.');
            }
        } catch (err) {
            console.error(err);
            showMsg('error', err?.message || 'No se pudo calcular la alineación');
        } finally {
            setCalculandoAlineacion(false);
        }
    };

    const handleAplicarAlineacion = async () => {
        const plan = previaAlineacion;
        if (!plan) return;
        const n = plan.reasignaciones?.length || 0;
        const bloqueos = plan.bloqueos?.length || 0;
        const confirmado = window.confirm(
            `Se van a reasignar ${n} código(s) de producto para que coincidan con la etiqueta física impresa.\n` +
            (bloqueos > 0 ? `Hay ${bloqueos} bloqueo(s) que NO se tocarán (etiquetas o códigos duplicados: repáralos antes).\n` : '') +
            `\nLas etiquetas ya impresas NO se reimprimen: el producto adopta el número de la etiqueta.\n` +
            `Prendas con varias unidades NO se alinean (quedan igual).\n\n` +
            `Después sincroniza de nuevo con la tienda virtual.\n\n¿Continuar?`
        );
        if (!confirmado) return;

        setAplicandoAlineacion(true);
        try {
            const aplicado = await alinearCodigosEtiquetas();
            setResultadoAlineacion(aplicado);
            setPreviaAlineacion(null);
            showMsg('success', aplicado.reasignaciones.length > 0
                ? `Alineación lista: ${aplicado.reasignaciones.length} prenda(s) actualizadas ✓ Ahora sincroniza con la nube.`
                : 'No había reasignaciones pendientes ✓');
        } catch (err) {
            console.error(err);
            showMsg('error', err?.message || 'No se pudo aplicar la alineación');
        } finally {
            setAplicandoAlineacion(false);
        }
    };

    const porcentaje = progreso?.total
        ? Math.round((Math.min(progreso.hechas || 0, progreso.total) / progreso.total) * 100)
        : null;

    return (
        <div className="max-w-7xl mx-auto fade-in h-full flex flex-col">
            <div className="flex items-center justify-between gap-3 mb-5 shrink-0">
                <h1 className="text-2xl font-bold text-pink-900 flex items-center gap-2">
                    <RefreshCw size={24} strokeWidth={1.8} className="text-pink-600" />
                    Sincronización con tienda virtual
                </h1>
            </div>

            {msg && (
                <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                    ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700'
                        : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <X size={16} />}
                    {msg.text}
                </div>
            )}

            {/* ══════════ BLOQUEO: CÓDIGOS CORTOS DUPLICADOS ══════════ */}
            {duplicadosLocales && duplicadosLocales.length > 0 && (
                <div className="mb-4 bg-red-50 border-2 border-red-400 rounded-xl p-4 fade-in">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={22} className="text-red-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-black text-red-800 uppercase tracking-tight">
                                Sincronización bloqueada: códigos cortos duplicados
                            </p>
                            <p className="text-xs text-red-700 mt-1">
                                Estos códigos los usan 2 o más prendas distintas. La tienda online no puede publicar
                                dos prendas con el mismo código. Repáralos antes de sincronizar o exportar.
                            </p>
                            <ul className="mt-3 space-y-2">
                                {duplicadosLocales.map(g => (
                                    <li key={g.codigo} className="bg-white/70 border border-red-200 rounded-lg px-3 py-2">
                                        <p className="font-mono font-black text-red-700 text-sm">Código {g.codigo}</p>
                                        <ul className="mt-1 space-y-0.5">
                                            {g.filas.map((f, i) => (
                                                <li key={i} className="text-xs text-red-800">
                                                    • <span className="font-bold">{f.nombre}</span>
                                                    {f.talla ? ` · Talla ${f.talla}` : ''}
                                                    {f.color ? ` · ${f.color}` : ''}
                                                </li>
                                            ))}
                                        </ul>
                                    </li>
                                ))}
                            </ul>
                            <button onClick={handleRepararDuplicados} disabled={reparandoDuplicados}
                                className="mt-3 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-60">
                                {reparandoDuplicados ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />}
                                {reparandoDuplicados ? 'Reparando…' : '🔧 Reparar códigos duplicados ahora'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {reparacionDuplicados && reparacionDuplicados.length > 0 && (
                <div className="mb-4 bg-green-50 border border-green-300 rounded-xl p-4 fade-in">
                    <div className="flex items-start gap-3">
                        <CheckCircle size={20} className="text-green-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-black text-green-800 uppercase tracking-tight">Códigos reparados ✓</p>
                            <ul className="mt-2 space-y-1">
                                {reparacionDuplicados.map(r => (
                                    <li key={r.id} className="text-xs text-green-800">
                                        <span className="font-bold">{r.name}</span>:{' '}
                                        <span className="font-mono line-through text-red-500">{r.codigoAnterior}</span>
                                        {' → '}
                                        <span className="font-mono font-black">{r.codigoNuevo}</span>
                                    </li>
                                ))}
                            </ul>
                            <p className="text-[11px] text-green-700 font-semibold mt-2">
                                Vuelve a presionar "Sincronizar ahora" para subir los códigos corregidos a la tienda.
                            </p>
                        </div>
                        <button onClick={() => setReparacionDuplicados(null)} className="text-green-500 hover:text-green-700 shrink-0">
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* ══════════ SINCRONIZACIÓN v2 ══════════ */}
            <div className="fashion-card p-6 mb-4 border-2 border-pink-300 relative fade-in">
                <span className="absolute -top-3 left-6 badge-rose shadow-sm">Protocolo v2 · a prueba de cortes</span>

                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-pink-600 flex items-center justify-center shrink-0">
                        <Zap size={18} strokeWidth={1.8} className="text-white" />
                    </div>
                    <div>
                        <h2 className="font-black text-pink-950 uppercase tracking-tight">Sincronizar con la tienda virtual</h2>
                        <p className="text-xs text-pink-500 font-medium">
                            Baja las ventas web (sin repetir ninguna), sube el stock por identidad estable y la nube apaga lo que ya no existe
                        </p>
                    </div>
                </div>

                {(!configOk || editandoConfig) ? (
                    <div className="bg-pink-50/60 border border-pink-100 rounded-xl p-4 mb-4 space-y-3">
                        <div>
                            <label className="flex items-center gap-1.5 text-xs font-bold text-pink-700 mb-1">
                                <Globe size={13} /> URL de la tienda
                            </label>
                            <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                                placeholder={URL_TIENDA_DEFAULT}
                                className="w-full px-3 py-2 rounded-xl border border-pink-200 text-sm focus:outline-none focus:border-pink-400 bg-white" />
                        </div>
                        <div>
                            <label className="flex items-center gap-1.5 text-xs font-bold text-pink-700 mb-1">
                                <KeyRound size={13} /> Token de sincronización
                            </label>
                            <input type="password" value={tokenInput} onChange={e => setTokenInput(e.target.value)}
                                placeholder="Lo generas en el admin web → Ajustes"
                                className="w-full px-3 py-2 rounded-xl border border-pink-200 text-sm focus:outline-none focus:border-pink-400 bg-white" />
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

                {/* Estado */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    {[
                        { label: 'Última sync OK', value: ultimaOkSetting?.value ? String(ultimaOkSetting.value).replace('T', ' ').slice(0, 16) : '—' },
                        { label: 'Prendas a publicar', value: totalExportables },
                        { label: 'Eventos web aplicados', value: eventosAplicados ?? '—' },
                        { label: 'Último evento confirmado', value: ackSetting?.value ? `#${ackSetting.value}` : '—' },
                    ].map(({ label, value }) => (
                        <div key={label} className="bg-pink-50/60 border border-pink-100 rounded-xl p-3 text-center">
                            <p className="text-lg font-black text-pink-900 truncate">{value}</p>
                            <p className="text-[10px] text-pink-500 font-bold uppercase tracking-wide">{label}</p>
                        </div>
                    ))}
                </div>

                {ultimoErrorSetting?.value && !sincronizando && (
                    <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-300 rounded-xl px-3 py-2.5">
                        <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-red-800">
                            <span className="font-bold">Último error:</span> {String(ultimoErrorSetting.value)}
                            <span className="block text-[11px] text-red-500 mt-0.5">Vuelve a sincronizar: el protocolo retoma donde quedó.</span>
                        </p>
                    </div>
                )}

                {(sinCodigoCount > 0 || sinGlobalIdCount > 0) && (
                    <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                        <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800">
                            {sinCodigoCount > 0 && (
                                <span><span className="font-bold">{sinCodigoCount} producto(s) activo(s) sin código corto</span> no se publican. </span>
                            )}
                            {sinGlobalIdCount > 0 && (
                                <span><span className="font-bold">{sinGlobalIdCount} sin identidad (globalId)</span>: se completan solos al sincronizar.</span>
                            )}
                        </p>
                    </div>
                )}

                <button onClick={handleSincronizar}
                    disabled={!configOk || sincronizando || editandoConfig}
                    className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-60">
                    {sincronizando ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                    {sincronizando ? (ETIQUETA_FASE[progreso?.fase] || 'Sincronizando…') : '🔄 Sincronizar ahora'}
                </button>
                {progreso && (
                    <div className="mt-3 fade-in">
                        <div className="h-2.5 w-full rounded-full bg-pink-100 overflow-hidden">
                            <div className={`h-full rounded-full bg-pink-600 transition-all ${porcentaje === null ? 'animate-pulse w-1/3' : ''}`}
                                style={porcentaje !== null ? { width: `${porcentaje}%` } : undefined} />
                        </div>
                        <p className="text-[11px] text-pink-500 font-semibold text-center mt-1">
                            {ETIQUETA_FASE[progreso.fase] || 'Sincronizando…'}
                            {progreso.fase === 'subiendo' && progreso.total
                                ? ` ${Math.min(progreso.hechas, progreso.total)} de ${progreso.total} prendas (${porcentaje}%)` : ''}
                            {progreso.fase === 'bajando' && progreso.eventos ? ` · ${progreso.eventos} evento(s)` : ''}
                            {' — no cierres esta ventana'}
                        </p>
                    </div>
                )}
                {!configOk && !editandoConfig && (
                    <p className="text-[11px] text-pink-400 font-semibold text-center mt-2">
                        Guarda la URL y el token para habilitar el botón.
                    </p>
                )}

                {/* Automática */}
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-pink-50/60 border border-pink-100 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-pink-900">
                        <Clock size={16} className="text-pink-500" />
                        <span className="font-semibold">Sincronización automática</span>
                        <span className="text-xs text-pink-500">cada</span>
                        <input type="number" min={1} max={240} defaultValue={intervaloMin} key={intervaloMin}
                            onBlur={handleIntervalo}
                            className="w-16 px-2 py-1 rounded-lg border border-pink-200 text-sm text-center bg-white" />
                        <span className="text-xs text-pink-500">min mientras el POS esté abierto (solo esta máquina)</span>
                    </div>
                    <button onClick={handleToggleAuto} disabled={!configOk}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50
                            ${autoOn ? 'bg-green-600 text-white hover:bg-green-700' : 'border border-pink-300 text-pink-700 hover:bg-pink-100'}`}>
                        <Power size={14} /> {autoOn ? 'Encendida' : 'Apagada'}
                    </button>
                </div>

                {/* Resultado */}
                {resultado && (
                    <div className="mt-4 fade-in">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                            {[
                                { label: 'Ventas web descontadas', value: resultado.eventos.unidadesDescontadas },
                                { label: 'Reposiciones web', value: resultado.eventos.unidadesRepuestas },
                                { label: 'Variantes ajustadas en la web', value: resultado.snapshot.actualizadas },
                                { label: 'Prendas nuevas en la web', value: resultado.snapshot.creadasProductos },
                                { label: 'Identidades adoptadas', value: resultado.snapshot.adoptados },
                                { label: 'Desactivadas en la web', value: resultado.finalizar.desactivados },
                                { label: 'Eventos repetidos (ignorados)', value: resultado.eventos.saltados },
                                { label: 'Avisos', value: resultado.eventos.avisos + resultado.eventos.huerfanos + resultado.snapshot.detalle.length + resultado.snapshot.rechazadas },
                            ].map(({ label, value }) => (
                                <div key={label} className="bg-pink-50/60 border border-pink-100 rounded-xl p-3 text-center">
                                    <p className="text-2xl font-black text-pink-900">{value}</p>
                                    <p className="text-[10px] text-pink-500 font-bold uppercase tracking-wide">{label}</p>
                                </div>
                            ))}
                        </div>

                        {resultado.eventos.huerfanosDetalle.length > 0 && (
                            <div className="mb-3 flex items-start gap-2 bg-red-50 border-2 border-red-400 rounded-xl px-3 py-2.5">
                                <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                                <div className="text-xs text-red-800">
                                    <p className="font-black uppercase mb-1">
                                        ⚠ {resultado.eventos.huerfanosDetalle.length} venta(s) web sin prenda en este POS
                                    </p>
                                    <p className="mb-1">Se vendió en la web una prenda que este POS no reconoce. Revisa a mano y corrige el stock.</p>
                                    <ul className="space-y-0.5 list-disc list-inside">
                                        {resultado.eventos.huerfanosDetalle.slice(0, 20).map((h, i) => (
                                            <li key={i}>
                                                evento #{h.eventoId} · <span className="font-bold">{h.nombre || '(sin nombre)'}</span>
                                                {h.codigo ? ` · ${h.codigo}` : ''} — {h.motivo}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        )}

                        {resultado.eventos.detalleAvisos.length > 0 && (
                            <details className="mb-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                                <summary className="text-xs font-bold text-amber-800 cursor-pointer">
                                    Avisos al aplicar ventas web ({resultado.eventos.detalleAvisos.length})
                                </summary>
                                <ul className="text-xs text-amber-800 mt-2 space-y-0.5 list-disc list-inside">
                                    {resultado.eventos.detalleAvisos.map((a, i) => <li key={i}>{a}</li>)}
                                </ul>
                            </details>
                        )}

                        {resultado.snapshot.detalle.length > 0 && (
                            <details className="mb-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                                <summary className="text-xs font-bold text-amber-800 cursor-pointer">
                                    Avisos de la tienda al recibir el stock ({resultado.snapshot.detalle.length})
                                </summary>
                                <ul className="text-xs text-amber-800 mt-2 space-y-0.5 list-disc list-inside">
                                    {resultado.snapshot.detalle.slice(0, 30).map((d, i) => (
                                        <li key={i}>
                                            <span className="font-mono font-bold">{d.codigo || '—'}</span> {d.nombre}
                                            {d.talla ? ` · ${d.talla}` : ''}{d.color ? ` · ${d.color}` : ''} — {d.aviso}
                                        </li>
                                    ))}
                                    {resultado.snapshot.detalle.length > 30 && <li>…y {resultado.snapshot.detalle.length - 30} más</li>}
                                </ul>
                            </details>
                        )}

                        <p className="text-[11px] text-gray-400 text-center">
                            {resultado.snapshot.filas} variante(s) en {resultado.snapshot.lotes} lote(s) · {Math.round(resultado.duracionMs / 100) / 10}s
                            {resultado.globalIdsCompletados ? ` · ${resultado.globalIdsCompletados} identidad(es) completadas antes de enviar` : ''}
                        </p>
                    </div>
                )}
            </div>

            {/* ══════════ ALINEACIÓN ETIQUETA ↔ PRODUCTO ══════════ */}
            <div className="fashion-card p-6 mb-4 border-2 border-amber-300 relative fade-in">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
                        <Tags size={18} strokeWidth={1.8} className="text-white" />
                    </div>
                    <div>
                        <h2 className="font-black text-amber-950 uppercase tracking-tight">Alinear etiqueta ↔ producto</h2>
                        <p className="text-xs text-amber-700 font-medium">
                            En prendas de 1 unidad, el código web pasa a ser el de la etiqueta ya impresa
                        </p>
                    </div>
                </div>
                <p className="text-xs text-amber-800 mb-4">
                    No reimprime etiquetas. Las prendas con varias unidades no se tocan. Después, sincroniza.
                </p>
                <div className="flex flex-wrap gap-2">
                    <button onClick={handlePrevisualizarAlineacion}
                        disabled={calculandoAlineacion || aplicandoAlineacion}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-amber-600 text-white hover:bg-amber-700 transition-all disabled:opacity-60">
                        {calculandoAlineacion ? <Loader2 size={16} className="animate-spin" /> : <Tags size={16} />}
                        {calculandoAlineacion ? 'Calculando…' : 'Previsualizar alineación'}
                    </button>
                    {previaAlineacion && (previaAlineacion.reasignaciones?.length || 0) > 0 && (
                        <button onClick={handleAplicarAlineacion} disabled={aplicandoAlineacion}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-green-700 text-white hover:bg-green-800 transition-all disabled:opacity-60">
                            {aplicandoAlineacion ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                            {aplicandoAlineacion ? 'Aplicando…' : `Aplicar ${previaAlineacion.reasignaciones.length} cambio(s)`}
                        </button>
                    )}
                </div>

                {previaAlineacion && (
                    <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 space-y-2">
                        <p className="font-bold">
                            Vista previa · alineaciones: {previaAlineacion.resumen?.alineadas ?? 0} ·
                            desalojos: {previaAlineacion.resumen?.desalojadas ?? 0} ·
                            ya OK: {previaAlineacion.resumen?.yaAlineadas ?? 0} ·
                            multi-unidad: {previaAlineacion.resumen?.variasUnidades ?? 0} ·
                            bloqueos: {previaAlineacion.bloqueos?.length ?? 0}
                        </p>
                        {(previaAlineacion.reasignaciones || []).slice(0, 25).map(r => (
                            <p key={`${r.id}-${r.codigoNuevo}`}>
                                <span className="font-bold">{r.name}</span>{' '}
                                <span className="font-mono line-through text-red-500">{r.codigoAnterior || '(vacío)'}</span>
                                {' → '}
                                <span className="font-mono font-black">{r.codigoNuevo}</span>
                                <span className="text-amber-600"> ({r.motivo})</span>
                            </p>
                        ))}
                        {(previaAlineacion.reasignaciones?.length || 0) > 25 && (
                            <p className="text-amber-600">… y {previaAlineacion.reasignaciones.length - 25} más</p>
                        )}
                        {(previaAlineacion.bloqueos || []).slice(0, 10).map((b, i) => (
                            <p key={`b-${b.id}-${i}`} className="text-red-700">
                                Bloqueo: {b.name} ({b.codigo}) — {b.motivo}
                            </p>
                        ))}
                    </div>
                )}

                {resultadoAlineacion && (
                    <div className="mt-4 bg-green-50 border border-green-300 rounded-xl p-3 text-xs text-green-900">
                        <p className="font-black uppercase tracking-tight mb-2">Alineación aplicada ✓</p>
                        <p>{resultadoAlineacion.reasignaciones?.length || 0} reasignación(es). Ahora pulsa "Sincronizar ahora".</p>
                        <button onClick={() => setResultadoAlineacion(null)} className="mt-2 text-green-600 hover:text-green-800 font-semibold">
                            Cerrar
                        </button>
                    </div>
                )}
            </div>

            {/* ══════════ RESPALDO: EXPORTAR STOCK A EXCEL ══════════ */}
            <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-2">
                Respaldo de solo lectura
            </p>
            <div className="fashion-card p-6 mb-4">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-pink-100 flex items-center justify-center shrink-0">
                        <Download size={18} strokeWidth={1.8} className="text-pink-600" />
                    </div>
                    <div>
                        <h2 className="font-black text-pink-950 uppercase tracking-tight">Exportar stock a Excel</h2>
                        <p className="text-xs text-pink-500 font-medium">Copia del stock que se publica (globalId · código · nombre · talla · color · stock · precio)</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 mb-4">
                    <span className="badge-rose">{totalExportables} producto(s)</span>
                    {sinCodigoCount > 0 && <span className="badge-gold">{sinCodigoCount} sin código</span>}
                </div>
                <button onClick={handleExportar} disabled={exportando}
                    className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-60">
                    {exportando ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
                    {exportando ? 'Generando…' : 'Generar Excel de stock'}
                </button>
                <p className="text-[11px] text-pink-400 font-semibold text-center mt-2">
                    La importación de ventas por Excel se retiró: las ventas web llegan solas al sincronizar.
                </p>
            </div>
        </div>
    );
}
