import React from 'react';

/**
 * 🪝 useNotification
 * Hook centralizado para manejar mensajes temporales de éxito/error.
 * 
 * @param {number} duration - Milisegundos que dura el mensaje visible (defecto 3500)
 * @returns {Object} { msg, showMsg }
 */
export function useNotification(duration = 3500) {
    const [msg, setMsg] = React.useState(null);

    /**
     * Muestra un mensaje temporal
     * @param {'success' | 'error' | 'info'} type - Tipo de mensaje para el estilo visual
     * @param {string} text - Contenido del mensaje
     */
    const showMsg = React.useCallback((type, text) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), duration);
    }, [duration]);

    return { msg, showMsg };
}
