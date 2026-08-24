import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Camera, Upload, QrCode, AlertCircle, CheckCircle2, RefreshCw, Zap, Sparkles } from 'lucide-react';
import jsQR from 'jsqr';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (scannedData: { identifier: string; name?: string; username?: string; accountNumber?: string }) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({ isOpen, onClose, onScanSuccess }) => {
  const [activeTab, setActiveTab] = useState<'camera' | 'upload' | 'quick'>('camera');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Stop Camera Stream & Scanner loop
  const stopCamera = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  // Process raw decoded QR text/payload
  const handlePayloadDetected = useCallback((rawText: string) => {
    try {
      const trimmed = rawText.trim();

      // Check if JSON format (Monvera Standard QR)
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const parsed = JSON.parse(trimmed);
        const username = parsed.username ? String(parsed.username).replace(/^@/, '').trim() : undefined;
        const accountNumber = parsed.accountNumber || parsed.account ? String(parsed.accountNumber || parsed.account).replace(/[-\s]/g, '').trim() : undefined;
        const identifier = username ? `@${username}` : (accountNumber || '');
        if (identifier) {
          stopCamera();
          onScanSuccess({
            identifier,
            name: parsed.name,
            username,
            accountNumber,
          });
          onClose();
          return;
        }
      }

      // Check if Monvera URI scheme (monvera://pay?username=...&account=...)
      if (trimmed.startsWith('monvera://')) {
        const url = new URL(trimmed.replace('monvera://', 'https://monvera.internal/'));
        const username = url.searchParams.get('username')?.replace(/^@/, '');
        const account = (url.searchParams.get('account') || url.searchParams.get('accountNumber'))?.replace(/[-\s]/g, '');
        const name = url.searchParams.get('name') ? decodeURIComponent(url.searchParams.get('name')!) : undefined;

        const identifier = username ? `@${username}` : (account || '');
        if (identifier) {
          stopCamera();
          onScanSuccess({
            identifier,
            name,
            username: username || undefined,
            accountNumber: account || undefined,
          });
          onClose();
          return;
        }
      }

      // Raw username or account number string format
      const clean = trimmed.replace(/^@/, '').trim();
      const isAcc = /^\d{6,14}$/.test(clean.replace(/[-\s]/g, ''));
      stopCamera();
      onScanSuccess({
        identifier: isAcc ? clean.replace(/[-\s]/g, '') : `@${clean}`,
        username: !isAcc ? clean : undefined,
        accountNumber: isAcc ? clean.replace(/[-\s]/g, '') : undefined,
      });
      onClose();
    } catch (err) {
      console.error('Failed to parse QR payload:', err);
      stopCamera();
      onScanSuccess({ identifier: rawText.trim() });
      onClose();
    }
  }, [stopCamera, onScanSuccess, onClose]);

  // Live video frame QR scanner loop
  const scanVideoFrame = useCallback(() => {
    if (!videoRef.current || videoRef.current.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(scanVideoFrame);
      return;
    }

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx && canvas.width > 0 && canvas.height > 0) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (code && code.data) {
        handlePayloadDetected(code.data);
        return;
      }
    }

    animationFrameRef.current = requestAnimationFrame(scanVideoFrame);
  }, [handlePayloadDetected]);

  // Start Camera Stream
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          await videoRef.current.play();
        }
        setIsCameraActive(true);
        animationFrameRef.current = requestAnimationFrame(scanVideoFrame);
      } else {
        setCameraError('Camera access is not supported in this browser environment. You can upload a QR image or select a quick contact below.');
      }
    } catch (err: any) {
      console.warn('Camera stream error:', err);
      setCameraError('Camera permission denied or camera device unavailable. Please use the Upload Image tab to upload your QR screenshot or choose a contact below.');
      setIsCameraActive(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab, stopCamera]);

  if (!isOpen) return null;

  // Instant Manual Frame Capture Scan
  const handleCaptureFrame = () => {
    if (videoRef.current && videoRef.current.videoWidth > 0) {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (code && code.data) {
          handlePayloadDetected(code.data);
          return;
        }
      }
    }
    setCameraError('No QR code detected in the current camera frame. Please align the QR code inside the viewfinder box.');
  };

  // Real Upload QR Image handler using jsQR
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingUpload(true);
    setUploadError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            setIsProcessingUpload(false);
            setUploadError('Failed to initialize image processing canvas.');
            return;
          }

          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          // 1. Try standard and inverted scans with jsQR
          let code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });

          // 2. If not detected on raw image, try contrast/scaled normalization
          if (!code && (canvas.width > 1200 || canvas.height > 1200)) {
            const scaledCanvas = document.createElement('canvas');
            const scale = Math.min(1000 / canvas.width, 1000 / canvas.height);
            scaledCanvas.width = Math.round(canvas.width * scale);
            scaledCanvas.height = Math.round(canvas.height * scale);
            const scaledCtx = scaledCanvas.getContext('2d', { willReadFrequently: true });
            if (scaledCtx) {
              scaledCtx.drawImage(img, 0, 0, scaledCanvas.width, scaledCanvas.height);
              const scaledImageData = scaledCtx.getImageData(0, 0, scaledCanvas.width, scaledCanvas.height);
              code = jsQR(scaledImageData.data, scaledImageData.width, scaledImageData.height, {
                inversionAttempts: 'attemptBoth',
              });
            }
          }

          setIsProcessingUpload(false);

          if (code && code.data) {
            handlePayloadDetected(code.data);
          } else {
            setUploadError('No valid QR code was detected in the uploaded image. Please ensure the QR code is clear, unobstructed, and not cropped.');
          }
        } catch (err: any) {
          setIsProcessingUpload(false);
          setUploadError(`Failed to decode QR code from image: ${err?.message || 'Unknown error'}`);
        }
      };
      img.onerror = () => {
        setIsProcessingUpload(false);
        setUploadError('Unable to read the image file. Please upload a clear PNG or JPEG image.');
      };
      img.src = event.target?.result as string;
    };
    reader.onerror = () => {
      setIsProcessingUpload(false);
      setUploadError('Failed to read file from disk.');
    };
    reader.readAsDataURL(file);
  };

  // Quick scan directory presets for fallback
  const quickPresets = [
    {
      name: 'Marcus Sterling',
      username: 'marcus',
      accountNumber: '1088492015',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
      role: 'Business Account',
    },
    {
      name: 'Sophia Chen',
      username: 'sophia',
      accountNumber: '1093847294',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150',
      role: 'Premier Checking',
    },
    {
      name: 'Eleanor Vance',
      username: 'eleanor',
      accountNumber: '1045827391',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      role: 'Private Wealth',
    },
  ];

  return (
    <div
      id="qr-scanner-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopCamera();
          onClose();
        }
      }}
    >
      <div
        id="qr-scanner-modal-container"
        className="w-full max-w-md bg-white rounded-3xl shadow-2xl border-2 border-slate-200 overflow-hidden relative max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-950 text-emerald-400 flex items-center justify-center font-bold shadow-sm">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-950">Scan Recipient QR Code</h3>
              <p className="text-xs text-slate-500 font-semibold">Decodes Monvera QR accurately in real-time</p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-white hover:bg-slate-200 text-slate-600 hover:text-slate-950 flex items-center justify-center border border-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="grid grid-cols-3 p-2 bg-slate-100 border-b border-slate-200 text-xs font-black">
          <button
            type="button"
            onClick={() => setActiveTab('camera')}
            className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'camera'
                ? 'bg-white text-slate-950 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Camera</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-white text-slate-950 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Image</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('quick')}
            className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'quick'
                ? 'bg-white text-slate-950 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Quick QR</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          
          {/* TAB 1: LIVE CAMERA SCANNER */}
          {activeTab === 'camera' && (
            <div className="space-y-4">
              {cameraError ? (
                <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-900 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wider">Camera Mode Notice</h4>
                      <p className="text-xs text-amber-800 font-medium mt-1">{cameraError}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('upload')}
                    className="w-full py-2.5 px-3 rounded-xl bg-amber-900 text-white font-black text-xs hover:bg-amber-950 transition-colors shadow-xs"
                  >
                    Switch to Upload Image
                  </button>
                </div>
              ) : (
                <div className="relative rounded-3xl overflow-hidden bg-slate-950 border-4 border-slate-800 aspect-square flex items-center justify-center shadow-xl">
                  {/* Live Video Feed */}
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />

                  {/* Viewfinder Target Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-8">
                    <div className="w-48 h-48 sm:w-56 sm:h-56 border-2 border-dashed border-emerald-400 rounded-3xl relative flex items-center justify-center shadow-[0_0_0_9999px_rgba(15,23,42,0.65)]">
                      {/* Corner Target Markers */}
                      <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
                      <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
                      <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
                      <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />

                      {/* Animated Scanning Beam */}
                      <div className="absolute left-2 right-2 h-0.5 bg-emerald-400 shadow-[0_0_12px_#34d399] animate-bounce" />
                    </div>
                  </div>

                  {/* Scan Frame trigger */}
                  <div className="absolute bottom-4 left-4 right-4 z-10 text-center">
                    <button
                      type="button"
                      onClick={handleCaptureFrame}
                      className="w-full py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Zap className="w-4 h-4" />
                      <span>Detect & Scan QR Code Now</span>
                    </button>
                  </div>
                </div>
              )}

              <p className="text-center text-xs text-slate-500 font-medium">
                Align the recipient&apos;s Monvera QR code inside the viewfinder box.
              </p>
            </div>
          )}

          {/* TAB 2: UPLOAD IMAGE */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                className="p-8 rounded-3xl border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50 hover:bg-emerald-50/50 transition-all text-center space-y-3 cursor-pointer group"
              >
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                  <Upload className="w-7 h-7" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-900">Upload or Drop QR Code Image</h4>
                  <p className="text-xs text-slate-500 mt-1">PNG, JPG, or WebP screenshot containing recipient QR</p>
                </div>
                <span className="inline-block py-2 px-4 rounded-xl bg-slate-900 text-white font-bold text-xs shadow-xs group-hover:bg-emerald-700 transition-colors">
                  {isProcessingUpload ? 'Decoding QR Code...' : 'Choose QR Image File'}
                </span>
              </div>

              {uploadError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-bold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: QUICK PRESET QR */}
          {activeTab === 'quick' && (
            <div className="space-y-3">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 block font-mono">
                Select a Verified Monvera Recipient QR:
              </span>
              <div className="space-y-2.5">
                {quickPresets.map((preset) => (
                  <button
                    key={preset.username}
                    type="button"
                    onClick={() =>
                      handlePayloadDetected(
                        JSON.stringify({
                          app: 'monvera',
                          username: preset.username,
                          name: preset.name,
                          accountNumber: preset.accountNumber,
                        })
                      )
                    }
                    className="w-full p-3.5 rounded-2xl bg-slate-50 hover:bg-emerald-50 border-2 border-slate-200 hover:border-emerald-400 transition-all flex items-center justify-between text-left group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={preset.avatar}
                        alt={preset.name}
                        className="w-10 h-10 rounded-xl object-cover border border-slate-300 group-hover:border-emerald-400"
                      />
                      <div>
                        <div className="font-black text-slate-950 text-sm group-hover:text-emerald-950">
                          {preset.name}
                        </div>
                        <div className="text-xs font-mono text-slate-500 font-bold">
                          @{preset.username} • Acc {preset.accountNumber}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-black px-3 py-1.5 rounded-xl bg-white text-emerald-800 border border-emerald-300 group-hover:bg-emerald-600 group-hover:text-white transition-colors shadow-2xs">
                      Scan QR
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
