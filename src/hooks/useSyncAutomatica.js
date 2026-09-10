import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { CLAVES_SYNC_V2, INTERVALO_AUTO_DEFAULT_MIN, debeSincronizarAuto } from '../utils/syncV2';
import { sincronizarV2, estaSincronizando } from '../utils/syncV2Cliente';

const TICK_MS = 60 * 1000;

/**
 * Sincronización automática con la tienda virtual (protocolo v2).
 * Solo corre si `habilitado` (admin) y `syncV2.auto` = '1'. Cada minuto revisa
 * si venció el intervalo desde la última sync OK y, si sí, lanza
 * `sincronizarV2()` en segundo plano. Nunca se solapa con una manual
 * (`estaSincronizando`). Los errores quedan en `syncV2.ultimoError`.
 *
 * @returns {{ auto: boolean, enCurso: boolean, ultimaOk: string|null, ultimoError: string|null }}
 */
export function useSyncAutomatica(habilitado) {
    const autoSetting = useLiveQuery(() => db.settings.get(CLAVES_SYNC_V2.auto), []);
    const intervaloSetting = useLiveQuery(() => db.settings.get(CLAVES_SYNC_V2.intervaloMin), []);
    const ultimaOkSetting = useLiveQuery(() => db.settings.get(CLAVES_SYNC_V2.ultimaOk), []);
    const ultimoErrorSetting = useLiveQuery(() => db.settings.get(CLAVES_SYNC_V2.ultimoError), []);
    const tokenSetting = useLiveQuery(() => db.settings.get('syncToken'), []);
    const [enCurso, setEnCurso] = React.useState(false);

    const auto = String(autoSetting?.value ?? '') === '1';
    const intervaloMin = Number(intervaloSetting?.value) >= 1 ? Number(intervaloSetting.value) : INTERVALO_AUTO_DEFAULT_MIN;
    const ultimaOk = ultimaOkSetting?.value || null;
    const configOk = Boolean(String(tokenSetting?.value || '').trim());

    // Refs para que el intervalo lea siempre el valor vigente sin reiniciarse.
    const estado = React.useRef({ auto, intervaloMin, ultimaOk, configOk, habilitado });
    estado.current = { auto, intervaloMin, ultimaOk, configOk, habilitado };

    React.useEffect(() => {
        if (!habilitado) return undefined;
        let cancelado = false;

        const tick = async () => {
            const s = estado.current;
            if (cancelado || !s.habilitado || !s.auto || !s.configOk) return;
            if (estaSincronizando()) return;
            if (!debeSincronizarAuto({ auto: s.auto, ultimaOk: s.ultimaOk, intervaloMin: s.intervaloMin })) return;
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
            setEnCurso(true);
            try {
                await sincronizarV2();
            } catch (err) {
                // Ya quedó registrado en settings.syncV2.ultimoError por sincronizarV2.
                console.warn('Sync automática falló:', err?.message || err);
            } finally {
                if (!cancelado) setEnCurso(false);
            }
        };

        // Primer chequeo a los 20 s de abrir (deja cargar el POS), luego cada minuto.
        const primero = setTimeout(tick, 20 * 1000);
        const intervalo = setInterval(tick, TICK_MS);
        return () => {
            cancelado = true;
            clearTimeout(primero);
            clearInterval(intervalo);
        };
    }, [habilitado]);

    return { auto, enCurso, ultimaOk, ultimoError: ultimoErrorSetting?.value || null };
}
