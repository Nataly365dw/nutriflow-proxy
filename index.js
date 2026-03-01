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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64
                }
              },
              {
                text: 'Identify all food items in this image. Return ONLY a valid JSON array, no markdown or other text: [{"name":"food name","estimatedGrams":100,"calories":200,"protein":10,"carbs":20,"fat":8,"fiber":2,"sugar":5}]'
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 800
          }
        })
      }
    );

    const raw = await response.text();
    console.log('Gemini raw:', raw.slice(0, 300));

    let data;
    try { data = JSON.parse(raw); }
    catch(e) { return res.status(500).json({error: 'Invalid JSON: ' + raw.slice(0,200)}); }

    if(data.error) return res.status(500).json({error: JSON.stringify(data.error)});

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
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

app.listen(process.env.PORT || 3000, () => console.log('Running!'));
