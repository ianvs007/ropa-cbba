import React, { useEffect } from 'react';
import { Camera, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import useCamera from '../../hooks/useCamera';

/**
 * 📸 CameraCapture — Vista de webcam en vivo con captura de frame.
 *
 * Muestra el video de la cámara y un botón para capturar. Al capturar,
 * llama a onCapture con el canvas y el dataURL del frame, para que el
 * componente padre (RecognitionModal) procese color y categoría.
 *
 * No decide nada sobre el resultado: solo entrega la imagen capturada.
 *
 * @param {object} props
 * @param {(result: { canvas: HTMLCanvasElement, dataUrl: string }) => void} props.onCapture
 *        Callback con el frame capturado.
 * @param {'user'|'environment'} [props.facingMode='environment']
 * @param {boolean} [props.autoStart=true]  Encender la cámara al montar.
 */
export default function CameraCapture({ onCapture, facingMode = 'environment', autoStart = true }) {
    const { videoRef, canvasRef, status, error, start, stop, capture } = useCamera({ facingMode });

    // Enciende la cámara al montar (si autoStart) y la apaga al desmontar.
    useEffect(() => {
        if (autoStart) start();
        return stop;
    }, [autoStart, start, stop]);

    const handleCapture = () => {
        const result = capture();
        if (result && onCapture) onCapture(result);
    };

    return (
        <div className="flex flex-col items-center gap-4">
            {/* Marco del video */}
            <div className="relative w-full max-w-md aspect-[3/4] bg-gray-900 rounded-xl overflow-hidden">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                />

                {/* Guía visual: recuadro central donde encuadrar la prenda.
                    Coincide con la zona que analiza colorDetection (50% central). */}
                {status === 'streaming' && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="w-1/2 h-1/2 border-2 border-white/70 rounded-lg" />
                    </div>
                )}

                {/* Estado: iniciando */}
                {status === 'starting' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <span className="text-sm">Iniciando cámara…</span>
                    </div>
                )}

                {/* Estado: error */}
                {status === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 p-4 text-center">
                        <AlertCircle className="w-8 h-8 text-red-400" />
                        <span className="text-sm">{error}</span>
                        <button
                            onClick={start}
                            className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
                        >
                            <RefreshCw className="w-4 h-4" /> Reintentar
                        </button>
                    </div>
                )}
            </div>

            {/* Canvas oculto para capturar el frame */}
            <canvas ref={canvasRef} hidden />

            {/* Botón de captura */}
            <button
                onClick={handleCapture}
                disabled={status !== 'streaming'}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
            >
                <Camera className="w-5 h-5" /> Capturar
            </button>

            <p className="text-xs text-gray-500 text-center max-w-xs">
                Coloca la prenda dentro del recuadro central, con buena luz, y presiona Capturar.
            </p>
        </div>
    );
}
