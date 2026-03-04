const express = require('express');
const app = express();
app.use(express.json({ limit: '20mb' }));

// ── CORS ──────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── In-memory cache ───────────────────────────────────────────────────────
// Server-side: all users share the same cache, so the 2nd person to search
// "chicken breast" gets an instant response with no OFF request at all.
const CACHE = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function cacheGet(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) {
  if (CACHE.size > 500) {
    // Evict oldest 100 entries when cache fills up
    [...CACHE.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 100)
      .forEach(([k]) => CACHE.delete(k));
  }
  CACHE.set(key, { ts: Date.now(), data });
}

// ── Keep-alive self-ping (prevents Render free tier cold starts) ──────────
// Set RENDER_EXTERNAL_URL env var in Render dashboard to enable this.
const SELF_URL = process.env.RENDER_EXTERNAL_URL || null;
if (SELF_URL) {
  setInterval(() => {
    require('https').get(`${SELF_URL}/ping`, r => r.resume()).on('error', () => {});
  }, 10 * 60 * 1000); // every 10 minutes
  console.log('Self-ping enabled:', SELF_URL);
}

// ── /ping ─────────────────────────────────────────────────────────────────
app.get('/ping', (req, res) => res.json({ status: 'ok', cached: CACHE.size }));

// ── /analyze (Groq / Llama vision) ───────────────────────────────────────
app.post('/analyze', async (req, res) => {
  try {
    const imageData = req.body.messages[0].content[0].source;
    const base64 = imageData.data;
    const mimeType = imageData.media_type || 'image/jpeg';

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` }
            },
            {
              type: 'text',
              text: 'Identify all food items in this image. Return ONLY a valid JSON array, no markdown or other text: [{"name":"food name","estimatedGrams":100,"calories":200,"protein":10,"carbs":20,"fat":8,"fiber":2,"sugar":5}]'
            }
          ]
        }]
      }),
      signal: AbortSignal.timeout(30000),
    });

    const raw = await response.text();
    console.log('Groq raw:', raw.slice(0, 300));

    let data;
    try { data = JSON.parse(raw); }
    catch (e) { return res.status(500).json({ error: 'Invalid JSON: ' + raw.slice(0, 200) }); }

    if (data.error) return res.status(500).json({ error: JSON.stringify(data.error) });

    const content = data.choices?.[0]?.message?.content || '';
    console.log('Content:', content.slice(0, 300));

    const clean = content.replace(/```json|```/g, '').trim();
    let foods;
    try { foods = JSON.parse(clean); }
    catch (e) { return res.status(500).json({ error: 'Could not parse: ' + clean.slice(0, 200) }); }

    res.json({ foods });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── /off-search ───────────────────────────────────────────────────────────
app.get('/off-search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query' });

  // Check server-side cache first
  const cacheKey = 'search:' + q.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&fields=product_name,nutriments,brands,serving_size`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'NutriFlow/1.0 (Android app)' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    cacheSet(cacheKey, data);
    res.setHeader('X-Cache', 'MISS');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /off-barcode ──────────────────────────────────────────────────────────
app.get('/off-barcode', async (req, res) => {
  const code = (req.query.code || '').trim().replace(/\D/g, '');
  if (!code) return res.status(400).json({ error: 'Missing barcode' });

  // Check cache first (barcode lookups are very cache-friendly — product data never changes)
  const cacheKey = 'barcode:' + code;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'NutriFlow/1.0 (Android app)' },
      signal: AbortSignal.timeout(6000),
    });
    const data = await response.json();
    if (data.status === 1 && data.product) {
      cacheSet(cacheKey, data);
      res.setHeader('X-Cache', 'MISS');
      res.json(data);
    } else {
      res.status(404).json({ error: 'Product not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(process.env.PORT || 3000, () => console.log('NutriFlow proxy running!'));
