import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { ListTree, Plus, Trash2, Tag, Layers, Settings2, AlertCircle, CheckCircle, Palette, Award } from 'lucide-react';

export default function ProductOptions() {
    const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), []);
    const productNames = useLiveQuery(() => db.productNames.orderBy('name').toArray(), []);
    const extraDataDB = useLiveQuery(() => db.productFields.orderBy('name').toArray(), []);
    const brandsDB = useLiveQuery(() => db.brands.orderBy('name').toArray(), []);
    const colorsDB = useLiveQuery(() => db.colors.orderBy('name').toArray(), []);

    const [msg, setMsg] = React.useState(null);

    React.useEffect(() => {
        // Limpiar duplicados y normalizar a mayúsculas
        const cleanTable = async (table) => {
            const items = await table.toArray();
            const seen = new Set();
            for (const item of items) {
                const upper = item.name?.toUpperCase().trim();
                if (!upper) {
                    await table.delete(item.id);
                    continue;
                }
                if (seen.has(upper)) {
                    await table.delete(item.id);
                } else {
                    seen.add(upper);
                    if (item.name !== upper) {
                        await table.update(item.id, { name: upper });
                    }
                }
            }
        };
        cleanTable(db.categories);
        cleanTable(db.productNames);
        cleanTable(db.productFields);
        cleanTable(db.brands);
        cleanTable(db.colors);
        // ── BUG FIX: Ejecutar solo al montar el componente ──
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const showMsg = (type, text) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 3000);
    };

    const [newCat, setNewCat] = React.useState('');
    const [newName, setNewName] = React.useState('');
    const [newExtra, setNewExtra] = React.useState('');
    const [newBrand, setNewBrand] = React.useState('');
    const [newColor, setNewColor] = React.useState('');

    const handleAddCategory = async (e) => {
        e.preventDefault();
        const val = newCat.trim().toUpperCase();
        if (!val) return;
        try {
            const exists = await db.categories.where('name').equals(val).first();
            if (exists) { showMsg('error', 'La categoría ya existe'); return; }
            await db.categories.add({ name: val });
            setNewCat('');
            showMsg('success', 'Categoría agregada');
        } catch (err) {
            showMsg('error', err.message);
        }
    };

    const handleDeleteCategory = async (id) => {
        await db.categories.delete(id);
        showMsg('success', 'Categoría eliminada');
    };

    const handleAddName = async (e) => {
        e.preventDefault();
        const val = newName.trim().toUpperCase();
        if (!val) return;
        try {
            const exists = await db.productNames.where('name').equals(val).first();
            if (exists) { showMsg('error', 'El nombre ya existe'); return; }
            await db.productNames.add({ name: val });
            setNewName('');
            showMsg('success', 'Nombre agregado');
        } catch (err) {
            showMsg('error', err.message);
        }
    };

    const handleDeleteName = async (id) => {
        await db.productNames.delete(id);
        showMsg('success', 'Nombre eliminado');
    };

    const handleAddExtra = async (e) => {
        e.preventDefault();
        const val = newExtra.trim().toUpperCase();
        if (!val) return;
        try {
            const exists = await db.productFields.where('name').equals(val).first();
            if (exists) { showMsg('error', 'El dato extra ya existe'); return; }
            await db.productFields.add({ name: val, type: 'text' });
            setNewExtra('');
            showMsg('success', 'Dato extra agregado');
        } catch (err) {
            showMsg('error', err.message);
        }
    };

    const handleDeleteExtra = async (id) => {
        await db.productFields.delete(id);
        showMsg('success', 'Dato extra eliminado');
    };

    const handleAddBrand = async (e) => {
        e.preventDefault();
        const val = newBrand.trim().toUpperCase();
        if (!val) return;
        try {
            const exists = await db.brands.where('name').equals(val).first();
            if (exists) { showMsg('error', 'La marca ya existe'); return; }
            await db.brands.add({ name: val });
            setNewBrand('');
            showMsg('success', 'Marca agregada');
        } catch (err) {
            showMsg('error', err.message);
        }
    };

    const handleDeleteBrand = async (id) => {
        await db.brands.delete(id);
        showMsg('success', 'Marca eliminada');
    };

    const handleAddColor = async (e) => {
        e.preventDefault();
        const val = newColor.trim().toUpperCase();
        if (!val) return;
        try {
            const exists = await db.colors.where('name').equals(val).first();
            if (exists) { showMsg('error', 'El color ya existe'); return; }
            await db.colors.add({ name: val });
            setNewColor('');
            showMsg('success', 'Color agregado');
        } catch (err) {
            showMsg('error', err.message);
        }
    };

    const handleDeleteColor = async (id) => {
        await db.colors.delete(id);
        showMsg('success', 'Color eliminado');
    };

    return (
        <div className="max-w-5xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-6 flex items-center gap-2">
                <ListTree size={24} strokeWidth={1.8} className="text-pink-600" />
                Catálogo Base
            </h1>

            {msg && (
                <div className={`mb-6 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                    ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {msg.text}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                {/* NOMBRES BASE */}
                <div className="fashion-card flex flex-col h-[500px]">
                    <div className="p-4 border-b border-pink-100 flex items-center gap-2 bg-pink-50/50">
                        <Tag size={18} className="text-pink-600" />
                        <h2 className="font-bold text-pink-900">Nombres de Prendas</h2>
                    </div>
                    <form onSubmit={handleAddName} className="p-4 border-b border-pink-50 flex gap-2 shrink-0">
                        <input value={newName} onChange={e => setNewName(e.target.value.toUpperCase())}
                               placeholder="Nuevo nombre..." className="fashion-input text-sm flex-1" />
                        <button type="submit" className="btn-primary px-3 p-2 shrink-0" disabled={!newName.trim()}><Plus size={16} /></button>
                    </form>
                    <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                        {(productNames || []).map(n => (
                            <div key={n.id} className="flex justify-between items-center px-3 py-2 hover:bg-pink-50 rounded-lg group transition-colors">
                                <span className="text-sm font-semibold text-pink-900">{n.name}</span>
                                <button onClick={() => handleDeleteName(n.id)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                        {productNames?.length === 0 && <p className="text-xs text-center text-pink-300 mt-4">Sin nombres guardados</p>}
                    </div>
                </div>

                {/* CATEGORIAS */}
                <div className="fashion-card flex flex-col h-[500px]">
                    <div className="p-4 border-b border-pink-100 flex items-center gap-2 bg-pink-50/50">
                        <Layers size={18} className="text-pink-600" />
                        <h2 className="font-bold text-pink-900">Categorías de Ropa</h2>
                    </div>
                    <form onSubmit={handleAddCategory} className="p-4 border-b border-pink-50 flex gap-2 shrink-0">
                        <input value={newCat} onChange={e => setNewCat(e.target.value.toUpperCase())}
                               placeholder="Nueva categoría..." className="fashion-input text-sm flex-1" />
                        <button type="submit" className="btn-primary px-3 p-2 shrink-0" disabled={!newCat.trim()}><Plus size={16} /></button>
                    </form>
                    <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                        {(categories || []).map(c => (
                            <div key={c.id} className="flex justify-between items-center px-3 py-2 hover:bg-pink-50 rounded-lg group transition-colors">
                                <span className="text-sm font-semibold text-pink-900">{c.name}</span>
                                <button onClick={() => handleDeleteCategory(c.id)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                        {categories?.length === 0 && <p className="text-xs text-center text-pink-300 mt-4">Sin categorías</p>}
                    </div>
                </div>

                {/* MARCAS */}
                <div className="fashion-card flex flex-col h-[500px]">
                    <div className="p-4 border-b border-pink-100 flex items-center gap-2 bg-pink-50/50">
                        <Award size={18} className="text-pink-600" />
                        <h2 className="font-bold text-pink-900">Marcas</h2>
                    </div>
                    <form onSubmit={handleAddBrand} className="p-4 border-b border-pink-50 flex gap-2 shrink-0">
                        <input value={newBrand} onChange={e => setNewBrand(e.target.value.toUpperCase())}
                               placeholder="Nueva marca..." className="fashion-input text-sm flex-1" />
                        <button type="submit" className="btn-primary px-3 p-2 shrink-0" disabled={!newBrand.trim()}><Plus size={16} /></button>
                    </form>
                    <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                        {(brandsDB || []).map(b => (
                            <div key={b.id} className="flex justify-between items-center px-3 py-2 hover:bg-pink-50 rounded-lg group transition-colors">
                                <span className="text-sm font-semibold text-pink-900">{b.name}</span>
                                <button onClick={() => handleDeleteBrand(b.id)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                        {brandsDB?.length === 0 && <p className="text-xs text-center text-pink-300 mt-4">Sin marcas registradas</p>}
                    </div>
                </div>

                {/* COLORES */}
                <div className="fashion-card flex flex-col h-[500px]">
                    <div className="p-4 border-b border-pink-100 flex items-center gap-2 bg-pink-50/50">
                        <Palette size={18} className="text-pink-600" />
                        <h2 className="font-bold text-pink-900">Colores</h2>
                    </div>
                    <form onSubmit={handleAddColor} className="p-4 border-b border-pink-50 flex gap-2 shrink-0">
                        <input value={newColor} onChange={e => setNewColor(e.target.value.toUpperCase())}
                               placeholder="Nuevo color..." className="fashion-input text-sm flex-1" />
                        <button type="submit" className="btn-primary px-3 p-2 shrink-0" disabled={!newColor.trim()}><Plus size={16} /></button>
                    </form>
                    <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                        {(colorsDB || []).map(c => (
                            <div key={c.id} className="flex justify-between items-center px-3 py-2 hover:bg-pink-50 rounded-lg group transition-colors">
                                <span className="text-sm font-semibold text-pink-900">{c.name}</span>
                                <button onClick={() => handleDeleteColor(c.id)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                        {colorsDB?.length === 0 && <p className="text-xs text-center text-pink-300 mt-4">Sin colores registrados</p>}
                    </div>
                </div>

                {/* DATOS EXTRAS */}
                <div className="fashion-card flex flex-col h-[500px]">
                    <div className="p-4 border-b border-pink-100 flex items-center gap-2 bg-pink-50/50">
                        <Settings2 size={18} className="text-pink-600" />
                        <div>
                            <h2 className="font-bold text-pink-900 leading-tight">Datos Extras</h2>
                            <p className="text-[10px] text-pink-500 leading-tight mt-0.5">Ej: Masculino, Verano, Algodón</p>
                        </div>
                    </div>
                    <form onSubmit={handleAddExtra} className="p-4 border-b border-pink-50 flex gap-2 shrink-0">
                        <input value={newExtra} onChange={e => setNewExtra(e.target.value.toUpperCase())}
                               placeholder="Nuevo dato extra..." className="fashion-input text-sm flex-1" />
                        <button type="submit" className="btn-primary px-3 p-2 shrink-0" disabled={!newExtra.trim()}><Plus size={16} /></button>
                    </form>
                    <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                        {(extraDataDB || []).map(f => (
                            <div key={f.id} className="flex justify-between items-center px-3 py-2 hover:bg-pink-50 rounded-lg group transition-colors">
                                <span className="text-sm font-semibold text-pink-900">{f.name}</span>
                                <button onClick={() => handleDeleteExtra(f.id)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                        {extraDataDB?.length === 0 && <p className="text-xs text-center text-pink-300 mt-4">Sin datos extras registrados</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}
