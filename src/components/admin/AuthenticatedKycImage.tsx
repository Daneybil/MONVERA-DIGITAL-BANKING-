import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { fetchAuthenticatedKycBlob } from '../../services/api';

interface AuthenticatedKycImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string | null;
  alt: string;
  fallbackIcon?: React.ReactNode;
  fallbackText?: string;
  containerClassName?: string;
}

/**
 * Renders protected KYC images securely by requesting documents with
 * authorized Firebase Bearer token and X-Admin-Session header.
 * 
 * Creates an in-memory browser Object URL and automatically cleans up
 * using URL.revokeObjectURL on unmount or URL replacement to prevent memory leaks.
 */
export const AuthenticatedKycImage: React.FC<AuthenticatedKycImageProps> = ({
  src,
  alt,
  className = '',
  fallbackIcon,
  fallbackText = 'Image unavailable',
  containerClassName = '',
  onError,
  ...restProps
}) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;
    let localCreatedUrl: string | null = null;

    if (!src) {
      setObjectUrl(null);
      setLoading(false);
      setError(false);
      return;
    }

    // Direct data: or blob: URIs do not require authenticated server fetch
    if (src.startsWith('data:') || src.startsWith('blob:')) {
      setObjectUrl(src);
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);

    fetchAuthenticatedKycBlob(src)
      .then((blob) => {
        if (isCancelled) return;
        localCreatedUrl = URL.createObjectURL(blob);
        setObjectUrl(localCreatedUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error('[AuthenticatedKycImage] Error loading KYC document:', err);
        setError(true);
        setLoading(false);
      });

    return () => {
      isCancelled = true;
      if (localCreatedUrl) {
        URL.revokeObjectURL(localCreatedUrl);
      }
    };
  }, [src]);

  if (loading) {
    return (
      <div className={`w-full h-full min-h-[70px] flex flex-col items-center justify-center p-2 text-slate-400 ${containerClassName}`}>
        <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        <span className="text-[10px] text-slate-400 font-medium mt-1">Loading...</span>
      </div>
    );
  }

  if (error || !objectUrl) {
    return (
      <div className={`w-full h-full min-h-[70px] flex flex-col items-center justify-center p-2 text-center text-slate-400 ${containerClassName}`}>
        {fallbackIcon || <AlertCircle className="w-5 h-5 text-slate-400 mb-1" />}
        <span className="text-[10px] font-medium text-slate-400">{fallbackText}</span>
      </div>
    );
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className}
      onError={(e) => {
        setError(true);
        if (onError) onError(e);
      }}
      {...restProps}
    />
  );
};
