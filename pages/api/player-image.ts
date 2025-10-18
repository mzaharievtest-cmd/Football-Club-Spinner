import type { NextApiRequest, NextApiResponse } from 'next';
import { playerImage } from '../../lib/wikimedia-player'; // adjust path if you put lib elsewhere

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const q = (req.query.q as string) || (req.body?.q as string);
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q" (player name)' });

    const width = Number(req.query.width || req.body?.width) || 800;
    const img = await playerImage(q, width);
    return res.status(200).json(img);
  } catch (err: any) {
    console.error('player-image error', err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
}
