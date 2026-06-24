import React from 'react';

/**
 * 🎨 TypeaheadInput — Autocompletado con navegación por teclado
 * Componente genérico reutilizable para cualquier campo con sugerencias.
 *
 * @prop {string}   value       - Valor actual del campo
 * @prop {Function} onChange    - Callback al cambiar el valor
 * @prop {string}   label       - Etiqueta visible del campo
 * @prop {string}   placeholder - Placeholder del input
 * @prop {string[]} options     - Lista de sugerencias
 * @prop {boolean}  required    - Si el campo es obligatorio
 */
export default function TypeaheadInput({
    value, onChange, placeholder, label, options = [], required = false
}) {
    const [focused, setFocused] = React.useState(false);
    const [selectedIndex, setSelectedIndex] = React.useState(-1);
    const listRef = React.useRef(null);

    const filtered = React.useMemo(() =>
        options.filter(o => o.toLowerCase().includes((value || '').toLowerCase())),
        [options, value]
    );
    const showMenu = focused
        && filtered.length > 0
        && !(filtered.length === 1 && filtered[0].toLowerCase() === (value || '').toLowerCase());

    React.useEffect(() => { setSelectedIndex(-1); }, [value, showMenu]);

    const handleKeyDown = (e) => {
        if (!showMenu) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            onChange(filtered[selectedIndex]);
            setFocused(false);
        } else if (e.key === 'Escape') {
            setFocused(false);
        }
    };

    React.useEffect(() => {
        if (selectedIndex >= 0 && listRef.current) {
            const el = listRef.current.children[selectedIndex];
            if (el) el.scrollIntoView({ block: 'nearest' });
        }
    }, [selectedIndex]);

    return (
        <div className="relative w-full">
            <label className="block text-sm font-semibold text-pink-800 mb-1">
                {label} {required && '*'}
            </label>
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setTimeout(() => setFocused(false), 300)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="fashion-input"
                required={required}
                autoComplete="off"
            />
            {showMenu && (
                <div
                    ref={listRef}
                    className="absolute z-50 w-full mt-1 bg-white border border-pink-100 rounded-xl shadow-lg max-h-48 overflow-y-auto"
                >
                    {filtered.map((opt, i) => (
                        <button
                            key={opt}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); onChange(opt); setFocused(false); }}
                            className={`w-full text-left px-3 py-2.5 text-sm transition-colors font-medium
                                ${selectedIndex === i
                                    ? 'bg-pink-100 text-pink-900'
                                    : 'hover:bg-pink-50 text-pink-700'}`}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
