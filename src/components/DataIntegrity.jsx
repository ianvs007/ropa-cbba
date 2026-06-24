import React from 'react';
import { db, checkDataIntegrity, getAuditStats, automaticcorrectDataIntegrity } from '../db';
import { AlertTriangle, CheckCircle, AlertCircle, RefreshCw, Zap } from 'lucide-react';
import { useNotification } from '../hooks/useNotification';

/**
 * 🔍 DataIntegrity — Validador de Integridad de Datos y Auditoría
 * Verifica que no haya datos huérfanos, inconsistencias, etc.
 */
export default function DataIntegrity({ user }) {
    const { msg, showMsg } = useNotification();
    const [loading, setLoading] = React.useState(false);
    const [issues, setIssues] = React.useState([]);
    const [auditStats, setAuditStats] = React.useState(null);
    const [autoFixLoading, setAutoFixLoading] = React.useState(false);

    const handleCheckIntegrity = async () => {
        setLoading(true);
        try {
            const result = await checkDataIntegrity();
            setIssues(result);
            
            if (result.length === 0) {
                showMsg('success', '✅ Sistema íntegro: No hay problemas detectados');
            } else {
                const critical = result.filter(i => i.severity === 'critical');
                const warnings = result.filter(i => i.severity === 'warning');
                showMsg('warning', `Encontrados: ${critical.length} críticos, ${warnings.length} advertencias`);
            }
        } catch (err) {
            showMsg('error', 'Error al validar: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLoadAuditStats = async () => {
        try {
            const stats = await getAuditStats(30);
            setAuditStats(stats);
        } catch (err) {
            console.error('Error al cargar auditoría:', err);
            showMsg('error', 'Error al cargar auditoría');
        }
    };

    const handleAutoFix = async () => {
        if (!window.confirm(
            '⚠️ ADVERTENCIA\n\n' +
            'Esto aplicará correcciones automáticas:\n' +
            '• Stock negativo → 0\n' +
            '• Pagos huérfanos → Eliminar\n\n' +
            '¿Deseas continuar?\n\n' +
            '💡 Se recomienda hacer BACKUP antes'
        )) return;

        setAutoFixLoading(true);
        try {
            const results = await automaticcorrectDataIntegrity();
            showMsg('success', `Correcciones aplicadas: ${results.length}`);
            handleCheckIntegrity(); // Revalidar
        } catch (err) {
            showMsg('error', 'Error al aplicar correcciones: ' + err.message);
        } finally {
            setAutoFixLoading(false);
        }
    };

    const getSeverityColor = (severity) => {
        switch (severity) {
            case 'critical': return 'bg-red-50 border-red-200 text-red-700';
            case 'warning': return 'bg-yellow-50 border-yellow-200 text-yellow-700';
            default: return 'bg-blue-50 border-blue-200 text-blue-700';
        }
    };

    const getSeverityIcon = (severity) => {
        switch (severity) {
            case 'critical': return <AlertTriangle size={18} />;
            case 'warning': return <AlertCircle size={18} />;
            default: return <CheckCircle size={18} />;
        }
    };

    return (
        <div className="max-w-6xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-6 flex items-center gap-2">
                <AlertCircle size={28} className="text-pink-600" />
                Integridad de Datos y Auditoría
            </h1>

            {/* Notificación */}
            {msg && (
                <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in border
                    ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
                      msg.type === 'warning' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
                      'bg-red-50 border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                    {msg.text}
                </div>
            )}

            {/* Botones de Acción */}
            <div className="fashion-card p-6 mb-6">
                <div className="flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={handleCheckIntegrity}
                        disabled={loading}
                        className="flex-1 px-6 py-3 bg-pink-600 text-white rounded-xl font-bold hover:bg-pink-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        Verificar Integridad
                    </button>
                    <button
                        onClick={handleLoadAuditStats}
                        className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 flex items-center justify-center gap-2 transition-colors"
                    >
                        <Zap size={18} />
                        Ver Auditoría
                    </button>
                    {user?.role === 'admin' && (
                        <button
                            onClick={handleAutoFix}
                            disabled={autoFixLoading || issues.length === 0}
                            className="flex-1 px-6 py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                        >
                            <Zap size={18} />
                            Corregir Automáticamente
                        </button>
                    )}
                </div>
            </div>

            {/* Resultados de Validación */}
            {issues.length > 0 && (
                <div className="fashion-card p-6 mb-6">
                    <h2 className="text-lg font-bold text-pink-900 mb-4">
                        {issues.filter(i => i.severity === 'critical').length > 0
                            ? '🔴 Problemas Detectados'
                            : '🟡 Advertencias'}
                    </h2>

                    <div className="space-y-3">
                        {issues.map((issue, idx) => (
                            <div
                                key={idx}
                                className={`p-4 rounded-lg border flex items-start gap-3 ${getSeverityColor(issue.severity)}`}
                            >
                                {getSeverityIcon(issue.severity)}
                                <div className="flex-1">
                                    <div className="font-bold text-sm">
                                        {issue.type}
                                        {issue.count && ` (${issue.count})`}
                                    </div>
                                    <div className="text-sm leading-relaxed">{issue.message}</div>
                                    {issue.details && (
                                        <div className="mt-2 text-xs space-y-1">
                                            {issue.details.map((d, i) => (
                                                <div key={i}>ID {d.id}: {d.name} (Stock: {d.stock})</div>
                                            ))}
                                        </div>
                                    )}
                                    {issue.ids && issue.ids.length <= 5 && (
                                        <div className="mt-2 text-xs">
                                            IDs: {issue.ids.join(', ')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Estadísticas de Auditoría */}
            {auditStats && !auditStats.error && (
                <div className="fashion-card p-6">
                    <h2 className="text-lg font-bold text-pink-900 mb-4">📊 Auditoría (Últimos 30 días)</h2>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                            <div className="text-sm text-blue-600 font-bold">CAMBIOS REGISTRADOS</div>
                            <div className="text-3xl font-black text-blue-900">{auditStats.totalChanges}</div>
                        </div>
                        <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                            <div className="text-sm text-purple-600 font-bold">CIERRES MODIFICADOS</div>
                            <div className="text-3xl font-black text-purple-900">{auditStats.closuresModified}</div>
                        </div>
                        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                            <div className="text-sm text-green-600 font-bold">USUARIOS ACTIVOS</div>
                            <div className="text-3xl font-black text-green-900">{Object.keys(auditStats.changesByUser).length}</div>
                        </div>
                    </div>

                    {Object.keys(auditStats.changesByUser).length > 0 && (
                        <div className="mb-6">
                            <h3 className="font-bold text-sm text-pink-700 mb-3">Cambios por Usuario:</h3>
                            <div className="space-y-2">
                                {Object.entries(auditStats.changesByUser).map(([user, count]) => (
                                    <div key={user} className="flex items-center justify-between p-2 bg-pink-50 rounded">
                                        <span className="text-sm font-medium text-pink-900">{user}</span>
                                        <span className="bg-pink-200 text-pink-800 px-3 py-1 rounded-full text-xs font-bold">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {auditStats.recentChanges && auditStats.recentChanges.length > 0 && (
                        <div>
                            <h3 className="font-bold text-sm text-pink-700 mb-3">Cambios Recientes:</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="bg-pink-100 text-pink-800">
                                            <th className="px-3 py-2 text-left">Fecha</th>
                                            <th className="px-3 py-2 text-left">Usuario</th>
                                            <th className="px-3 py-2 text-left">Cambio</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-pink-100">
                                        {auditStats.recentChanges.map((change, idx) => (
                                            <tr key={idx} className="hover:bg-pink-50">
                                                <td className="px-3 py-2">
                                                    {new Date(change.changedAt).toLocaleString('es')}
                                                </td>
                                                <td className="px-3 py-2 font-medium">{change.changedBy}</td>
                                                <td className="px-3 py-2">{change.changeType}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Mensaje si No hay problemas */}
            {issues.length === 0 && issues.length > 0 && !loading && (
                <div className="fashion-card p-6 text-center">
                    <CheckCircle size={48} className="text-green-500 mx-auto mb-3" />
                    <h2 className="text-xl font-bold text-green-700 mb-2">Sistema Íntegro</h2>
                    <p className="text-green-600">No se detectaron problemas de integridad de datos.</p>
                </div>
            )}
        </div>
    );
}
