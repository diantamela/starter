const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleAuth } = require('google-auth-library');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const location = process.env.GEMINI_LOCATION || 'us-central1';
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const genericEndpoint = process.env.GENERIC_GEMINI_ENDPOINT || '';

if (!projectId && !genericEndpoint) {
  console.warn('Warning: GCP_PROJECT_ID is not set. The server will start, but /api/chat requests require either GCP_PROJECT_ID or GENERIC_GEMINI_ENDPOINT.');
}

function getApiEndpoint() {
  if (genericEndpoint) return genericEndpoint;
  if (!projectId) return null;
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

async function getAccessToken() {
  if (apiKey) return null;
  try {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (!tokenResponse || !tokenResponse.token) {
      throw new Error('Unable to retrieve Google access token from application default credentials.');
    }
    return tokenResponse.token;
  } catch (error) {
    throw new Error(`Failed to get Google access token. Set GOOGLE_APPLICATION_CREDENTIALS or run gcloud auth application-default login. ${error.message}`);
  }
}

function normalizeGeminiMessage(message) {
  const role = String(message?.role || '').toLowerCase();
  const text = String(message?.content ?? message?.message ?? message?.text ?? '').trim();
  if (!text) return null;

  const geminiRole = role === 'assistant' ? 'ASSISTANT'
    : role === 'system' ? 'SYSTEM'
    : 'USER';

  return { role: geminiRole, parts: [text] };
}

function extractReply(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (Array.isArray(data.predictions) && data.predictions.length > 0) {
    const prediction = data.predictions[0];
    if (typeof prediction === 'string') return prediction;
    if (prediction.content) return prediction.content;
    if (Array.isArray(prediction.candidates) && prediction.candidates.length > 0) {
      const candidate = prediction.candidates[0];
      if (candidate.content && Array.isArray(candidate.content) && candidate.content.length > 0) {
        return candidate.content[0].text || '';
      }
      if (candidate.text) return candidate.text;
    }
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

app.get('/favicon.ico', (req, res) => {
  res.sendStatus(204);
});

app.use(express.static(path.join(__dirname)));

app.post('/api/chat', async (req, res) => {
  const messages = req.body?.conversation;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'conversation must be an array.' });
  }

  const systemInstruction = process.env.GEMINI_SYSTEM_INSTRUCTION ||
    'You are Gemini, a helpful AI assistant. Answer naturally and keep responses concise and relevant.';
  const temperature = Number(process.env.GEMINI_TEMPERATURE ?? 0.2);

  const geminiMessages = [
    { role: 'SYSTEM', parts: [systemInstruction] },
    ...messages
      .map(normalizeGeminiMessage)
      .filter(Boolean)
  ];

  if (geminiMessages.length === 1) {
    return res.status(400).json({ error: 'Messages array must contain at least one valid message.' });
  }

  try {
    const payload = {
      instances: [{ content: geminiMessages }],
      parameters: {
        temperature,
        maxOutputTokens: 512,
        systemInstruction
      }
    };

    const requestUrl = getApiEndpoint();
    if (!requestUrl) {
      return res.status(500).json({
        error: 'Server configuration error. Set GCP_PROJECT_ID or GENERIC_GEMINI_ENDPOINT in .env.'
      });
    }

    const headers = { 'Content-Type': 'application/json' };

    if (apiKey) {
      const urlWithKey = requestUrl + (requestUrl.includes('?') ? '&' : '?') + `key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(urlWithKey, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) {
        console.error('Gemini API error:', result);
        return res.status(500).json({ error: 'Gemini API error', details: result });
      }

      const reply = extractReply(result);
      return res.json({ result: reply });
    }

    const token = await getAccessToken();
    headers.Authorization = `Bearer ${token}`;
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      console.error('Gemini API error:', result);
      return res.status(500).json({ error: 'Gemini API error', details: result });
    }

    const reply = extractReply(result);
    return res.json({ result: reply });
  } catch (error) {
    console.error('Gemini /api/chat failure:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

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

    const requestUrl = getApiEndpoint();
    if (!requestUrl) {
      return res.status(500).json({
        error: 'Server configuration error. Set GCP_PROJECT_ID or GENERIC_GEMINI_ENDPOINT in .env.'
      });
    }

    const headers = { 'Content-Type': 'application/json' };

    if (apiKey) {
      const urlWithKey = requestUrl + (requestUrl.includes('?') ? '&' : '?') + `key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(urlWithKey, {
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
    }

    const token = await getAccessToken();
    headers.Authorization = `Bearer ${token}`;
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

function startServer(currentPort, attempts = 0) {
  const server = app.listen(currentPort, () => {
    console.log(`Gemini chatbot server running at http://localhost:${currentPort}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempts < 2) {
      const nextPort = currentPort + 1;
      console.warn(`Port ${currentPort} is already in use. Trying port ${nextPort}...`);
      startServer(nextPort, attempts + 1);
    } else {
      console.error('Server failed to start:', error);
      process.exit(1);
    }
  });
}

startServer(port);
