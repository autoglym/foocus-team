import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { AuthRequest } from '../types.js';
import { getLinkPreview, validatePublicUrl } from '../services/linkPreview.js';
import { logError } from '../utils/logger.js';

const router = Router();

// GET /unfurl?url=https://... - Link preview (title, description, image) for a public URL.
// 200 with the preview, 204 when the page has no usable metadata, 400 for disallowed URLs.
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const raw = typeof req.query.url === 'string' ? req.query.url : '';
    if (!raw || raw.length > 2048 || !validatePublicUrl(raw)) {
      res.status(400).json({ error: 'Invalid or disallowed URL' });
      return;
    }
    const preview = await getLinkPreview(raw);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (!preview) {
      res.status(204).end();
      return;
    }
    res.json(preview);
  } catch (error) {
    logError('Link preview error', error);
    res.status(204).end();
  }
});

export default router;
