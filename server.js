const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleAuth } = require('google-auth-library');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const projectId = process.env.GCP_PROJECT_ID;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const location = process.env.GEMINI_LOCATION || 'us-central1';
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

if (!projectId && !process.env.GENERIC_GEMINI_ENDPOINT) {
  console.warn('Warning: GCP_PROJECT_ID is not set. Set it in .env or export it before starting the server.');
}

const apiEndpoint = process.env.GENERIC_GEMINI_ENDPOINT ||
  `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

async function getAccessToken() {
  if (apiKey) return null;
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse || !tokenResponse.token) {
    throw new Error('Unable to retrieve Google access token from application default credentials.');
  }
  return tokenResponse.token;
}

function extractReply(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (Array.isArray(data.predictions) && data.predictions.length > 0) {
    const prediction = data.predictions[0];
    if (typeof prediction === 'string') return prediction;
    if (prediction.content) return prediction.content;
    if (Array.isArray(prediction.outputs) && prediction.outputs.length > 0) {
      return prediction.outputs[0].content || '';
    }
  }
  if (Array.isArray(data.outputs) && data.outputs.length > 0) {
    return data.outputs[0].content || '';
  }
  if (Array.isArray(data.choices) && data.choices.length > 0) {
    const choice = data.choices[0];
    return choice.message?.content || choice.text || '';
  }
  return JSON.stringify(data);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.post('/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    const userPrompt = `You are Gemini, a helpful AI assistant. Answer naturally and keep the response relevant to the user's question.\nUser: ${message}\nAssistant:`;
    const payload = {
      instances: [
        { content: userPrompt }
      ],
      parameters: {
        temperature: 0.2,
        maxOutputTokens: 512
      }
    };

    let requestUrl = apiEndpoint;
    const headers = { 'Content-Type': 'application/json' };

    if (apiKey) {
      requestUrl += requestUrl.includes('?') ? '&' : '?';
      requestUrl += `key=${encodeURIComponent(apiKey)}`;
    } else {
      const token = await getAccessToken();
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      console.error('Gemini API error:', result);
      return res.status(500).json({
        error: 'Gemini API error',
        details: result
      });
    }

    const reply = extractReply(result);
    return res.json({ reply });
  } catch (error) {
    console.error('Chat endpoint failure:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Gemini chatbot server running at http://localhost:${port}`);
});
