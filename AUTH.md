Authentication for Gemini / Vertex AI

Summary
- This project must use OAuth2 credentials (Application Default Credentials or a service account). API keys will cause 401 UNAUTHENTICATED errors.

Options

1) Use a service account JSON (recommended for servers)
   - Create a service account with access to Vertex AI (e.g., `roles/aiplatform.user` or more permissive if needed).
   - Download the JSON key and place it in the project folder (example: `service-account.json`).
   - Set the env var before starting the server:

```
export GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
node server.js
```

On Windows PowerShell:

```
$env:GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json"
node server.js
```

2) Use ADC via `gcloud` (developer/local use)
   - Install and authenticate the Cloud SDK and run:

```
gcloud auth application-default login
node server.js
```

Testing the `/api/chat` endpoint

Start the server and then test with curl:

```
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say hi"}]}'
```

Notes
- If you still see 401 errors, ensure `GOOGLE_API_KEY` / `GEMINI_API_KEY` are unset or commented in `.env` so the server uses OAuth2.
- If you must call a custom Gemini endpoint, set `GENERIC_GEMINI_ENDPOINT` in `.env` instead.
