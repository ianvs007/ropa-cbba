import { useEffect, useRef, useCallback } from 'react';

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
const EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];

/**
 * Hook que cierra la sesión automáticamente tras un período de inactividad.
 * Escucha eventos de interacción del usuario y resetea el temporizador.
 */
export default function useSessionTimeout(onTimeout) {
    const timerRef = useRef(null);

    const resetTimer = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(onTimeout, TIMEOUT_MS);
    }, [onTimeout]);

    useEffect(() => {
        resetTimer();
        EVENTS.forEach(ev => window.addEventListener(ev, resetTimer, true));
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            EVENTS.forEach(ev => window.removeEventListener(ev, resetTimer, true));
        };
    }, [resetTimer]);
}
