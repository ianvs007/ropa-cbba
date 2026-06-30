import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * 📷 useCamera — Hook para gestionar la webcam con getUserMedia.
 *
 * Responsabilidades:
 *   - Encender la cámara (start) y conectar el stream a un <video>.
 *   - Capturar un frame a un <canvas> y devolver el canvas + un dataURL.
 *   - Apagar y liberar la cámara (stop) — IMPORTANTE para no dejar
 *     la luz de la webcam encendida ni bloquear el dispositivo.
 *
 * Uso típico:
 *   const { videoRef, canvasRef, status, error, start, stop, capture } = useCamera();
 *   // <video ref={videoRef} autoPlay playsInline muted />
 *   // <canvas ref={canvasRef} hidden />
 *
 * @param {object} [options]
 * @param {'user'|'environment'} [options.facingMode='environment']
 *        'environment' = cámara trasera (mejor para fotografiar prendas en celular);
 *        'user' = cámara frontal.
 * @returns {{
 *   videoRef: React.RefObject<HTMLVideoElement>,
 *   canvasRef: React.RefObject<HTMLCanvasElement>,
 *   status: 'idle'|'starting'|'streaming'|'error',
 *   error: string|null,
 *   start: () => Promise<void>,
 *   stop: () => void,
 *   capture: () => { canvas: HTMLCanvasElement, dataUrl: string } | null,
 * }}
 */
export default function useCamera({ facingMode = 'environment' } = {}) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);

    const [status, setStatus] = useState('idle');
    const [error, setError] = useState(null);

    /** Apaga la cámara y libera todos los tracks del stream. */
    const stop = useCallback(() => {
        const stream = streamRef.current;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setStatus('idle');
    }, []);

    /** Enciende la cámara y la conecta al elemento <video>. */
    const start = useCallback(async () => {
        setError(null);
        setStatus('starting');

        // Verifica soporte del navegador.
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus('error');
            setError('Tu navegador no soporta acceso a la cámara.');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode },
                audio: false,
            });
            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                // Espera a que el video tenga dimensiones reales antes de marcar streaming.
                await videoRef.current.play().catch(() => { /* algunos navegadores requieren gesto del usuario */ });
            }
            setStatus('streaming');
        } catch (err) {
            setStatus('error');
            // Mensajes claros según el tipo de error.
            if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
                setError('Permiso de cámara denegado. Habilítalo en el navegador.');
            } else if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
                setError('No se encontró ninguna cámara en el dispositivo.');
            } else if (err && err.name === 'NotReadableError') {
                setError('La cámara está siendo usada por otra aplicación.');
            } else {
                setError('No se pudo acceder a la cámara.');
            }
        }
    }, [facingMode]);

    /**
     * Captura el frame actual del <video> a un <canvas>.
     * @returns {{ canvas: HTMLCanvasElement, dataUrl: string } | null}
     */
    const capture = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !video.videoWidth) return null;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        return { canvas, dataUrl };
    }, []);

    // Garantiza liberar la cámara si el componente se desmonta.
    useEffect(() => stop, [stop]);

    return { videoRef, canvasRef, status, error, start, stop, capture };
}
