import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensureBranchExists } from '../../db';
import { Store, Plus, Check, X } from 'lucide-react';

/**
 * 🏬 BranchSelect — Selector de sucursal configurable con alta rápida in-situ.
 *
 * Lee las sucursales desde `db.branches` y permite agregar una nueva sucursal
 * directamente sin abandonar el formulario actual.
 */
export default function BranchSelect({
    value = '',
    onChange,
    label = 'Sucursal de Origen',
    placeholder = 'Seleccionar sucursal...',
    required = false,
}) {
    const branchesDB = useLiveQuery(() => (db.branches ? db.branches.orderBy('name').toArray() : []), []);
    const [addingNew, setAddingNew] = React.useState(false);
    const [newBranchName, setNewBranchName] = React.useState('');
    const [error, setError] = React.useState('');

    // Si el valor actual vino pre-llenado (ej. retorno detectado) y aún no está en la lista visual, incluirlo
    const options = React.useMemo(() => {
        const names = new Set((branchesDB || []).map((b) => b.name));
        if (value && value.trim()) {
            names.add(value.trim().toUpperCase());
        }
        if (names.size === 0) {
            names.add('SUCURSAL 1');
            names.add('SUCURSAL 2');
        }
        return Array.from(names).sort();
    }, [branchesDB, value]);

    const handleCreateBranch = async () => {
        const clean = newBranchName.trim().toUpperCase();
        if (!clean) {
            setError('Escribe el nombre de la sucursal');
            return;
        }
        try {
            const saved = await ensureBranchExists(clean);
            onChange(saved);
            setNewBranchName('');
            setAddingNew(false);
            setError('');
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <label className="text-xs font-black text-amber-900 uppercase tracking-widest flex items-center gap-1.5">
                    <Store size={14} className="text-amber-600" />
                    {label} {required && <span className="text-rose-500">*</span>}
                </label>
                {!addingNew && (
                    <button
                        type="button"
                        onClick={() => { setAddingNew(true); setError(''); }}
                        className="text-[11px] font-bold text-amber-700 hover:text-amber-900 bg-amber-100/70 hover:bg-amber-200/70 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors"
                    >
                        <Plus size={12} /> Nueva sucursal
                    </button>
                )}
            </div>

            {addingNew ? (
                <div className="space-y-1.5">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleCreateBranch();
                                } else if (e.key === 'Escape') {
                                    setAddingNew(false);
                                    setError('');
                                }
                            }}
                            placeholder="EJ: SUCURSAL CENTRO, SUCURSAL NORTE..."
                            className="fashion-input flex-1 border-amber-300 focus:border-amber-500 font-bold text-amber-900"
                            autoFocus
                        />
                        <button
                            type="button"
                            onClick={handleCreateBranch}
                            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl text-xs flex items-center gap-1 transition-colors"
                        >
                            <Check size={15} /> Guardar
                        </button>
                        <button
                            type="button"
                            onClick={() => { setAddingNew(false); setError(''); }}
                            className="px-3 py-2 border border-amber-200 text-amber-600 hover:bg-amber-50 rounded-xl text-xs font-bold"
                        >
                            <X size={15} />
                        </button>
                    </div>
                    {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
                </div>
            ) : (
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    required={required}
                    className="fashion-input font-bold text-amber-900 border-amber-200 focus:border-amber-500 bg-white"
                >
                    <option value="">{placeholder}</option>
                    {options.map((branch) => (
                        <option key={branch} value={branch}>
                            {branch}
                        </option>
                    ))}
                </select>
            )}
        </div>
    );
}
