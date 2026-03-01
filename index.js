const express = require('express');
const app = express();
app.use(express.json({limit: '20mb'}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.post('/analyze', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: req.body.messages
      })
    });

    const raw = await response.text();
    console.log('Anthropic response:', raw);

    let data;
    try {
      data = JSON.parse(raw);
    } catch(e) {
      return res.status(500).json({ error: 'Invalid JSON from Anthropic', raw: raw.slice(0, 200) });
    }

    const content = (data.content || []).map(b => b.text || '').join('');
    console.log('Content:', content);

    const clean = content.replace(/```json|```/g, '').trim();

    let foods;
    try {
      foods = JSON.parse(clean);
    } catch(e) {
      return res.status(500).json({ error: 'Could not parse food JSON', content: clean.slice(0, 200) });
    }

    res.json({ foods });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Running!'));
