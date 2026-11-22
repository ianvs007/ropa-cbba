import React from 'react';
import {
    exportDatabase,
    exportDatabaseSinSecretos,
    importDatabase,
    resetForProduction,
    deleteEntireDatabase,
    getDiskDbStatus,
    forcePushBrowserToDisk,
    forcePullDiskToBrowser,
    triggerDiskBackupNow,
    subscribeDiskSyncStatus,
} from '../db';
import { Database, Download, Upload, AlertTriangle, CheckCircle, X, Trash2, HardDrive, RefreshCw, Save } from 'lucide-react';

/**
 * Backup — Copias de seguridad: exportar e importar toda la base de datos
 */
export default function Backup() {
    const [loading, setLoading] = React.useState(false);
    const [msg, setMsg] = React.useState(null);
    const [confirmImport, setConfirmImport] = React.useState(null);
    const [confirmReset, setConfirmReset] = React.useState(false);
    const [confirmWipe, setConfirmWipe] = React.useState(false);
    const [diskStatus, setDiskStatus] = React.useState(null);
    const fileRef = React.useRef(null);

    const showMsg = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); };

    React.useEffect(() => {
        const unsub = subscribeDiskSyncStatus((st) => setDiskStatus(st));
        getDiskDbStatus();
        return () => unsub();
    }, []);

    const handleDiskBackupNow = async () => {
        setLoading(true);
        try {
            const info = await triggerDiskBackupNow();
            showMsg('success', `✅ Copia guardada en disco: ${info.fileName}`);
        } catch (err) {
            showMsg('error', `Error creando respaldo en disco: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handlePushToDisk = async () => {
        setLoading(true);
        try {
            await forcePushBrowserToDisk();
            await getDiskDbStatus();
            showMsg('success', '✅ Datos de este navegador guardados en el archivo central en disco.');
        } catch (err) {
            showMsg('error', `Error al enviar a disco: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handlePullFromDisk = async () => {
        setLoading(true);
        try {
            await forcePullDiskToBrowser();
            await getDiskDbStatus();
            showMsg('success', '✅ Datos recargados desde el archivo central en disco.');
        } catch (err) {
            showMsg('error', `Error al leer desde disco: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    // ── EXPORTAR ──
    const handleExport = async () => {
        setLoading(true);
        try {
            const data = await exportDatabase();
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            const fecha = new Date().toISOString().slice(0, 10);
            anchor.href = url;
            anchor.download = `backup_tienda_ropa_${fecha}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            showMsg('success', '✅ Backup exportado. Incluye caja y hashes de contraseña: guárdalo en privado.');
        } catch (err) {
            showMsg('error', `Error al exportar: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleExportSinSecretos = async () => {
        setLoading(true);
        try {
            const data = await exportDatabaseSinSecretos();
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            const fecha = new Date().toISOString().slice(0, 10);
            anchor.href = url;
            anchor.download = `backup_tienda_ropa_sin_secretos_${fecha}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            showMsg('success', '✅ Copia sin secretos exportada. No restaura contraseñas ni el token de sincronización.');
        } catch (err) {
            showMsg('error', `Error al exportar: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    // ── IMPORTAR ──
    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const obj = JSON.parse(ev.target.result);
                if (!obj.data) { showMsg('error', 'Archivo de backup inválido'); return; }
                setConfirmImport(obj);
            } catch {
                showMsg('error', 'No se pudo leer el archivo. ¿Es un backup válido?');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleImportConfirm = async () => {
        if (!confirmImport) return;
        setLoading(true);
        try {
            const resultado = await importDatabase(confirmImport);
            setConfirmImport(null);
            const aviso = resultado?.avisos?.length ? ` ${resultado.avisos[0]}` : '';
            showMsg('success', `✅ Datos importados correctamente.${aviso} Recarga la página para ver los cambios.`);
        } catch (err) {
            showMsg('error', `Error al importar: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    // ── RESET PARA PRODUCCIÓN ──
    const handleResetConfirm = async () => {
        setLoading(true);
        try {
            await resetForProduction();
            setConfirmReset(false);
            showMsg('success', '✅ Sistema limpiado para producción. Recarga la página para aplicar los cambios.');
        } catch (err) {
            showMsg('error', `Error al limpiar: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    // ── BORRAR TODA LA BD ──
    const handleWipeConfirm = async () => {
        setLoading(true);
        try {
            await deleteEntireDatabase();
        } catch (err) {
            showMsg('error', `Error al borrar: ${err.message}`);
            setLoading(false);
        }
    };

    // ════════════════════════════════════════════════════════
    // RENDER (EARLY RETURNS)
    // ════════════════════════════════════════════════════════

    // ── VISTA CONFIRMACIÓN RESET PRODUCCIÓN ──
    if (confirmReset) {
        return (
            <div className="max-w-2xl mx-auto p-6 pb-40 fade-in">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-red-100 rounded-2xl text-red-600">
                            <Trash2 size={24} strokeWidth={2.5} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-pink-900 uppercase tracking-tight">Limpiar para Producción</h2>
                            <p className="text-red-500 font-bold text-sm tracking-widest uppercase">BORRADO IRREVERSIBLE</p>
                        </div>
                    </div>
                    <button onClick={() => setConfirmReset(false)} 
                        className="w-12 h-12 bg-pink-50 text-pink-400 rounded-2xl flex items-center justify-center hover:bg-pink-100 transition-all">
                        <X size={24} />
                    </button>
                </div>

                <div className="fashion-card p-10 bg-red-50 border-2 border-red-200 mb-10">
                    <p className="text-red-800 font-black text-xs uppercase tracking-widest mb-6 text-center">Se eliminarán los siguientes datos</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        {[
                            'Historial de ventas',
                            'Reservas y sus pagos',
                            'Cierres de caja',
                            'Historial de cierres',
                            'Gastos registrados',
                            'Movimientos de kardex',
                            'Códigos de barras unitarios',
                            'Logs de seguridad',
                        ].map((item, i) => (
                            <div key={i} className="flex items-center gap-2 text-red-700">
                                <X size={14} className="text-red-400" />
                                <span className="font-bold">{item}</span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-8 pt-6 border-t border-red-200">
                        <p className="text-green-700 font-black text-xs uppercase tracking-widest mb-3 text-center">Se conservarán</p>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            {[
                                'Productos (stock en 0)',
                                'Usuarios y contraseñas',
                                'Configuración de tienda',
                                'Categorías y marcas',
                            ].map((item, i) => (
                                <div key={i} className="flex items-center gap-2 text-green-700">
                                    <CheckCircle size={14} className="text-green-400" />
                                    <span className="font-bold">{item}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="bg-red-50 border border-red-100 rounded-[2rem] p-6 text-center mb-12">
                    <p className="text-red-600 font-black text-xs uppercase tracking-widest leading-loose">
                        ⚠️ ESTA ACCIÓN NO SE PUEDE DESHACER. Asegúrate de haber exportado un backup antes de continuar.
                    </p>
                </div>

                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-lg px-6 z-50">
                    <div className="bg-white/90 backdrop-blur-2xl border-2 border-red-100 p-4 rounded-[2.5rem] shadow-2xl flex gap-4">
                        <button onClick={() => setConfirmReset(false)} 
                            className="px-8 py-5 border-2 border-pink-100 text-pink-400 font-black rounded-3xl text-xs uppercase tracking-widest hover:bg-pink-50 transition-all">
                            CANCELAR
                        </button>
                        <button onClick={handleResetConfirm} disabled={loading}
                            className="flex-1 bg-gradient-to-r from-red-600 to-rose-600 text-white font-black py-5 rounded-3xl text-sm shadow-xl uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all">
                            {loading ? 'LIMPIANDO...' : '🗑️ CONFIRMAR LIMPIEZA'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── VISTA CONFIRMACIÓN IMPORTACIÓN ──
    if (confirmImport) {
        return (
            <div className="max-w-2xl mx-auto p-6 pb-40 fade-in">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 rounded-2xl text-blue-600">
                            <Upload size={24} strokeWidth={2.5} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-pink-900 uppercase tracking-tight">Restaurar Backup</h2>
                            <p className="text-blue-500 font-bold text-sm tracking-widest uppercase">REEMPLAZO DE DATOS</p>
                        </div>
                    </div>
                    <button onClick={() => setConfirmImport(null)} 
                        className="w-12 h-12 bg-pink-50 text-pink-400 rounded-2xl flex items-center justify-center hover:bg-pink-100 transition-all">
                        <X size={24} />
                    </button>
                </div>

                <div className="fashion-card p-10 bg-amber-50 border-2 border-amber-200 mb-10">
                    <p className="text-amber-800 font-black text-xs uppercase tracking-widest mb-8 text-center">Resumen del Archivo</p>
                    <div className="grid grid-cols-2 gap-8">
                        {[
                            { label: 'Prendas', val: confirmImport.data?.products?.length || 0 },
                            { label: 'Ventas', val: confirmImport.data?.sales?.length || 0 },
                            { label: 'Movimientos', val: confirmImport.data?.kardex?.length || 0 },
                            { label: 'Usuarios', val: confirmImport.data?.users?.length || 0 },
                            { label: 'Aperturas', val: Array.isArray(confirmImport.data?.cashOpenings) ? confirmImport.data.cashOpenings.length : '—' },
                            { label: 'Cierres', val: Array.isArray(confirmImport.data?.cashClosures) ? confirmImport.data.cashClosures.length : '—' },
                        ].map((stat, i) => (
                            <div key={i} className="text-center group">
                                <p className="text-3xl font-black text-amber-900 group-hover:scale-110 transition-transform">{stat.val}</p>
                                <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mt-1">{stat.label}</p>
                            </div>
                        ))}
                    </div>
                    {confirmImport.sinSecretos && (
                        <p className="mt-6 text-xs font-bold text-amber-800 text-center leading-relaxed">{confirmImport.aviso}</p>
                    )}
                    {!confirmImport.sinSecretos && confirmImport.data?.users?.some(u => u.password === '***') && (
                        <p className="mt-6 text-xs font-bold text-amber-800 text-center leading-relaxed">
                            Este archivo trae contraseñas enmascaradas (***). Se conservan las claves actuales de esta máquina. Un usuario que solo existe así no se puede restaurar.
                        </p>
                    )}
                    {!Array.isArray(confirmImport.data?.cashClosures) && (
                        <p className="mt-6 text-xs font-bold text-amber-800 text-center leading-relaxed">
                            Este archivo no trae caja ni cierres. La caja de esta máquina no se modifica.
                        </p>
                    )}
                </div>

                <div className="bg-red-50 border border-red-100 rounded-[2rem] p-6 text-center mb-12">
                    <p className="text-red-600 font-black text-xs uppercase tracking-widest leading-loose">
                        ⚠️ ATENCIÓN: Esta operación borrará todos los datos actuales y los reemplazará por los del archivo.
                    </p>
                </div>

                {/* Footer Flotante Acciones */}
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-lg px-6 z-50">
                    <div className="bg-white/90 backdrop-blur-2xl border-2 border-pink-100 p-4 rounded-[2.5rem] shadow-2xl flex gap-4">
                        <button onClick={() => setConfirmImport(null)} 
                            className="px-8 py-5 border-2 border-pink-100 text-pink-400 font-black rounded-3xl text-xs uppercase tracking-widest hover:bg-pink-50 transition-all">
                            CANCELAR
                        </button>
                        <button onClick={handleImportConfirm} disabled={loading}
                            className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black py-5 rounded-3xl text-sm shadow-xl uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all">
                            {loading ? 'RESTAURANDO...' : '✓ CONFIRMAR RESTAURACIÓN'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-6 flex items-center gap-2">
                <Database size={24} strokeWidth={1.8} className="text-pink-600" />
                Copias de Seguridad
            </h1>

            {msg && (
                <div className={`mb-5 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                    ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <X size={16} />}
                    <span>{msg.text}</span>
                </div>
            )}

            {/* BASE DE DATOS EN DISCO LOCAL (MULTI-NAVEGADOR Y RED LOCAL) */}
            <div className="fashion-card p-6 mb-4 border-2 border-emerald-200 bg-emerald-50/30">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                        <HardDrive size={22} className="text-emerald-700" />
                    </div>
                    <div className="flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <h2 className="font-bold text-pink-900">Base de Datos Central en Disco Local</h2>
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                diskStatus?.connected
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                            }`}>
                                {diskStatus?.connected ? '🟢 Conectada en Disco' : '🟡 Solo Navegador'}
                            </span>
                        </div>
                        <p className="text-sm text-pink-600 mb-3">
                            Todos los navegadores (Chrome, Edge, perfiles distintos) y otras PCs de la red local
                            comparten automáticamente el mismo archivo físico en disco en tiempo real.
                        </p>

                        {diskStatus?.connected && (
                            <div className="bg-white/90 border border-emerald-200 rounded-xl p-3 mb-4 text-xs text-pink-800 space-y-1.5">
                                <div>
                                    <strong>Archivo en disco:</strong>{' '}
                                    <code className="bg-emerald-50 px-1.5 py-0.5 rounded text-[11px] break-all">
                                        {diskStatus.dbPath || 'datos-pos/pos-db.json'}
                                    </code>
                                </div>
                                {diskStatus.stats && (
                                    <div className="flex flex-wrap gap-3 pt-1 text-emerald-900 font-semibold">
                                        <span>Prendas: {diskStatus.stats.products}</span>
                                        <span>•</span>
                                        <span>Unidades: {diskStatus.stats.barcodes}</span>
                                        <span>•</span>
                                        <span>Ventas: {diskStatus.stats.sales}</span>
                                        <span>•</span>
                                        <span>Respaldos en disco: {diskStatus.backupsCount || 0}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={handleDiskBackupNow}
                                disabled={loading || !diskStatus?.connected}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50 transition-all">
                                <Save size={15} />
                                Guardar Copia en Disco Ahora
                            </button>
                            <button
                                type="button"
                                onClick={handlePushToDisk}
                                disabled={loading || !diskStatus?.connected}
                                className="bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-800 font-bold py-2 px-3.5 rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50 transition-all">
                                <Upload size={14} />
                                Enviar este Navegador → Disco
                            </button>
                            <button
                                type="button"
                                onClick={handlePullFromDisk}
                                disabled={loading || !diskStatus?.connected}
                                className="bg-white border border-pink-200 hover:bg-pink-50 text-pink-700 font-bold py-2 px-3.5 rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50 transition-all">
                                <RefreshCw size={14} />
                                Recargar desde Disco
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* EXPORTAR */}
            <div className="fashion-card p-6 mb-4">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-pink-100 rounded-xl flex items-center justify-center shrink-0">
                        <Download size={22} className="text-pink-600" />
                    </div>

                    <div className="flex-1">
                        <h2 className="font-bold text-pink-900 mb-1">Exportar Backup</h2>
                        <p className="text-sm text-pink-500 mb-4">
                            Descarga un archivo <code className="bg-pink-100 px-1 rounded text-xs">.json</code> con
                            productos, ventas, inventario, gastos, aperturas y cierres de caja, usuarios y configuración.
                            El archivo completo guarda el hash de cada contraseña (no lo cambia por ***) y puede incluir
                            el token de sincronización, para poder restaurar el inicio de sesión.
                        </p>
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2">
                            <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-700">
                                <strong>Recomendación:</strong> Realiza backups diarios y guárdalos en un lugar privado
                                o en un USB externo. Nunca elimines backups anteriores. Quien tenga el archivo completo
                                puede restaurar el acceso a las cuentas.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                id="backup-export"
                                onClick={handleExport}
                                disabled={loading}
                                className="btn-primary flex items-center gap-2 disabled:opacity-50">
                                <Download size={18} />
                                {loading ? 'Exportando...' : 'Descargar Backup'}
                            </button>
                            <button
                                id="backup-export-seguro"
                                type="button"
                                onClick={handleExportSinSecretos}
                                disabled={loading}
                                className="btn-secondary flex items-center gap-2 disabled:opacity-50">
                                <Download size={18} />
                                Copia sin secretos
                            </button>
                        </div>
                        <p className="text-xs text-pink-400 mt-3">
                            La copia sin secretos omite hashes de contraseña y el token de la tienda virtual, y lo avisa
                            dentro del archivo. Sirve para revisar datos. No restaura el inicio de sesión ni la sincronización.
                            La caja y los cierres sí van en las dos copias.
                        </p>
                    </div>
                </div>
            </div>

            {/* IMPORTAR */}
            <div className="fashion-card p-6">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                        <Upload size={22} className="text-blue-600" />
                    </div>
                    <div className="flex-1">
                        <h2 className="font-bold text-pink-900 mb-1">Importar Backup</h2>
                        <p className="text-sm text-pink-500 mb-4">
                            Restaura todos los datos desde un archivo de backup previamente exportado.
                        </p>
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-start gap-2">
                            <AlertTriangle size={15} className="text-red-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-red-700">
                                <strong>¡Atención!</strong> Esta acción <strong>reemplazará</strong> todos los datos
                                actuales. Asegúrate de haber hecho un backup antes de continuar.
                            </p>
                        </div>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".json"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="backup-import-file"
                        />
                        <button
                            id="backup-import"
                            onClick={() => fileRef.current?.click()}
                            disabled={loading}
                            className="btn-secondary flex items-center gap-2 disabled:opacity-50">
                            <Upload size={18} />
                            Seleccionar Archivo de Backup
                        </button>
                    </div>
                </div>
            </div>

            {/* LIMPIAR PARA PRODUCCIÓN */}
            <div className="fashion-card p-6 mt-4">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
                        <Trash2 size={22} className="text-red-600" />
                    </div>
                    <div className="flex-1">
                        <h2 className="font-bold text-pink-900 mb-1">Limpiar para Producción</h2>
                        <p className="text-sm text-pink-500 mb-4">
                            Elimina todas las ventas, reservas, cierres de caja, gastos, kardex y logs de prueba.
                            Conserva los productos (con stock en 0), usuarios y configuración.
                        </p>
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-start gap-2">
                            <AlertTriangle size={15} className="text-red-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-red-700">
                                <strong>¡Irreversible!</strong> Antes de limpiar, exporta un backup de seguridad.
                                Esta acción dejará el sistema listo para empezar a operar desde cero.
                            </p>
                        </div>
                        <button
                            id="backup-reset"
                            onClick={() => setConfirmReset(true)}
                            disabled={loading}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-5 rounded-xl text-sm flex items-center gap-2 disabled:opacity-50 transition-all">
                            <Trash2 size={18} />
                            Limpiar Sistema
                        </button>
                    </div>
                </div>
            </div>

            {/* BORRAR TODA LA BASE DE DATOS */}
            <div className="fashion-card p-6 mt-4 border-2 border-red-200">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-red-200 rounded-xl flex items-center justify-center shrink-0">
                        <Database size={22} className="text-red-700" />
                    </div>
                    <div className="flex-1">
                        <h2 className="font-bold text-red-900 mb-1">Borrar Toda la Base de Datos</h2>
                        <p className="text-sm text-red-500 mb-4">
                            Elimina <strong>absolutamente todo</strong>: productos, usuarios, ventas, configuración.
                            La base de datos se re-creará desde cero con los datos iniciales por defecto.
                            Útil cuando se instala una versión nueva sobre un equipo que tenía una versión anterior.
                        </p>
                        <div className="bg-red-50 border border-red-300 rounded-xl p-3 mb-4 flex items-start gap-2">
                            <AlertTriangle size={15} className="text-red-700 shrink-0 mt-0.5" />
                            <p className="text-xs text-red-800">
                                <strong>PELIGRO:</strong> Se perderán TODOS los datos sin excepción.
                                La página se recargará automáticamente y el sistema arrancará como nuevo.
                            </p>
                        </div>
                        {!confirmWipe ? (
                            <button
                                onClick={() => setConfirmWipe(true)}
                                disabled={loading}
                                className="bg-red-700 hover:bg-red-800 text-white font-bold py-2.5 px-5 rounded-xl text-sm flex items-center gap-2 disabled:opacity-50 transition-all">
                                <Trash2 size={18} />
                                Borrar Todo
                            </button>
                        ) : (
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleWipeConfirm}
                                    disabled={loading}
                                    className="bg-red-800 hover:bg-red-900 text-white font-black py-3 px-6 rounded-xl text-sm flex items-center gap-2 disabled:opacity-50 transition-all animate-pulse">
                                    {loading ? 'BORRANDO...' : '⚠️ SÍ, BORRAR TODO'}
                                </button>
                                <button
                                    onClick={() => setConfirmWipe(false)}
                                    className="border-2 border-pink-200 text-pink-400 font-bold py-3 px-6 rounded-xl text-sm hover:bg-pink-50 transition-all">
                                    Cancelar
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

        </div>
    );
}
