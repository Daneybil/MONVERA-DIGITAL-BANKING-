import type { Request, Response } from 'express';
import app from '../server';

export default function handler(req: Request, res: Response) {
  if (req.url) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const subPath = parsedUrl.searchParams.get('__path');
      if (subPath) {
        parsedUrl.searchParams.delete('__path');
        const cleanSubPath = subPath.startsWith('/') ? subPath : `/${subPath}`;
        const remainingQuery = parsedUrl.searchParams.toString();
        req.url = `/api${cleanSubPath}${remainingQuery ? `?${remainingQuery}` : ''}`;
      } else if (!req.url.startsWith('/api')) {
        req.url = `/api${req.url}`;
      }
    } catch {
      if (!req.url.startsWith('/api')) {
        req.url = `/api${req.url}`;
      }
    }
  }

  return app(req, res);
}
