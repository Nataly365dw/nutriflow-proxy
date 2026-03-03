const express = require('express');
const app = express();
app.use(express.json({limit: '20mb'}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/ping', (req, res) => res.json({status:'ok'}));

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
              image_url: {
                url: `data:${mimeType};base64,${base64}`
              }
            },
            {
              type: 'text',
              text: 'Identify all food items in this image. Return ONLY a valid JSON array, no markdown or other text: [{"name":"food name","estimatedGrams":100,"calories":200,"protein":10,"carbs":20,"fat":8,"fiber":2,"sugar":5}]'
            }
          ]
        }]
      })
    });

    const raw = await response.text();
    console.log('Groq raw:', raw.slice(0, 300));

    let data;
    try { data = JSON.parse(raw); }
    catch(e) { return res.status(500).json({error: 'Invalid JSON: ' + raw.slice(0,200)}); }

    if(data.error) return res.status(500).json({error: JSON.stringify(data.error)});

    const content = data.choices?.[0]?.message?.content || '';
    console.log('Content:', content.slice(0, 300));

    const clean = content.replace(/```json|```/g, '').trim();

    let foods;
    try { foods = JSON.parse(clean); }
    catch(e) { return res.status(500).json({error: 'Could not parse: ' + clean.slice(0,200)}); }

    res.json({foods});
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({error: err.message});
  }
});

app.get('/off-search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Missing query' });

  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=10&fields=product_name,nutriments,brands,serving_size`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Running!'));
