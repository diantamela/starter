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

function isPublicGeminiApi() {
  // Public Gemini API is detected when genericEndpoint is set (includes generativelanguage.googleapis.com)
  return genericEndpoint && genericEndpoint.includes('generativelanguage.googleapis.com');
}

function normalizeGeminiMessage(message, isPublic = false) {
  const role = String(message?.role || '').toLowerCase();
  const text = String(message?.content ?? message?.message ?? message?.text ?? '').trim();
  if (!text) return null;

  if (isPublic) {
    // Public Gemini API uses 'user' and 'model' roles
    const publicRole = role === 'assistant' || role === 'model' ? 'model' : 'user';
    return { role: publicRole, parts: [{ text }] };
  }

  // Vertex AI uses 'USER', 'ASSISTANT', 'SYSTEM' roles
  const geminiRole = role === 'assistant' ? 'ASSISTANT'
    : role === 'system' ? 'SYSTEM'
    : 'USER';

  return { role: geminiRole, parts: [text] };
}

function buildPublicGeminiPayload(messages, systemInstruction, temperature) {
  // Convert messages to public API format
  const contents = messages
    .map(msg => normalizeGeminiMessage(msg, true))
    .filter(Boolean);

  return {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: 512
    },
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    }
  };
}

function buildVertexAiPayload(messages, systemInstruction, temperature) {
  // Vertex AI format
  return {
    instances: [{ content: messages }],
    parameters: {
      temperature,
      maxOutputTokens: 512,
      systemInstruction
    }
  };
}

function extractReply(data, isPublic = false) {
  if (!data) return '';
  if (typeof data === 'string') return data;

  // Public Gemini API format
  if (isPublic && Array.isArray(data.candidates) && data.candidates.length > 0) {
    const candidate = data.candidates[0];
    if (candidate.content && Array.isArray(candidate.content.parts) && candidate.content.parts.length > 0) {
      return candidate.content.parts[0].text || '';
    }
  }

  // Vertex AI format
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

  const isPublic = isPublicGeminiApi();

  // Filter out system messages for public API
  const conversationMessages = isPublic
    ? messages.filter(m => String(m?.role || '').toLowerCase() !== 'system')
    : messages;

  try {
    let payload;
    if (isPublic) {
      payload = buildPublicGeminiPayload(conversationMessages, systemInstruction, temperature);
    } else {
      const geminiMessages = [
        { role: 'SYSTEM', parts: [systemInstruction] },
        ...conversationMessages
          .map(msg => normalizeGeminiMessage(msg, false))
          .filter(Boolean)
      ];

      if (geminiMessages.length === 1) {
        return res.status(400).json({ error: 'Messages array must contain at least one valid message.' });
      }

      payload = buildVertexAiPayload(geminiMessages, systemInstruction, temperature);
    }

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

      const reply = extractReply(result, isPublic);
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

    const reply = extractReply(result, isPublic);
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
    const isPublic = isPublicGeminiApi();
    const systemInstruction = 'You are Gemini, a helpful AI assistant. Answer naturally and keep the response relevant to the user\'s question.';

    let payload;
    if (isPublic) {
      // Public Gemini API format
      payload = {
        contents: [
          { role: 'user', parts: [{ text: message }] }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512
        },
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        }
      };
    } else {
      // Vertex AI format
      payload = {
        instances: [
          { content: message }
        ],
        parameters: {
          temperature: 0.2,
          maxOutputTokens: 512
        }
      };
    }

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

      const reply = extractReply(result, isPublic);
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

    const reply = extractReply(result, isPublic);
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
