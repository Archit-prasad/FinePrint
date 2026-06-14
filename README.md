# FinePrint — AI Legal Risk Detector

> *Know what you're agreeing to before you click "Accept."*

FinePrint is a consumer-protection hackathon project that uses large language models to instantly surface hidden risks in Terms of Service, Privacy Policies, contracts, and other legal documents. Paste any wall of legalese and get back a plain-English risk breakdown with actionable defence strategies — in seconds.

---

## The Problem

The average Terms of Service is ~5,000 words and takes over 20 minutes to read. Nobody reads it. Companies exploit this by burying auto-renewal traps, arbitration waivers, broad data licences, and one-sided liability clauses where they know consumers won't look. FinePrint uses AI to do the reading for you and flags exactly what you should care about.

---

## Features

| Feature | Details |
|---|---|
| **Risk Score (0–100)** | Consumer hostility index rendered as an animated SVG progress ring |
| **TL;DR** | One-sentence witty summary of the biggest catch |
| **Red Flag Cards** | Each clause identified with severity (High / Medium / Low), explanation, and defence strategy |
| **Confidence Score** | Client-side heuristic (flag count × risk extremity × document length); capped at 97% |
| **Export / Share** | Clipboard copy, PDF (jsPDF text API), Twitter, LinkedIn, email |
| **Loading state** | Step-by-step progress indicator, elapsed timer, cancel button (AbortController) |
| **Results History** | Persisted in `localStorage` (max 50); full delete / clear-all |
| **Comparison View** | Side-by-side diff of two saved analyses — shared vs. unique clauses highlighted |
| **Resilient backend** | 3-model fallback chain, 503 cold-start retry, JSON fence stripping |

---

## Architecture

```
FinePrint/
├── api.py                # Flask API + static file server (port 5000)
├── app.py                # Streamlit prototype (port 8501) — kept for reference
├── .env                  # HF_API_KEY (never commit)
└── frontend/
    ├── index.html        # Vite entry point
    ├── package.json
    ├── vite.config.js    # Proxy /api → localhost:5000 in dev
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
        ├── main.jsx      # React 18 root
        ├── index.css     # Tailwind + glassmorphism utilities
        └── App.jsx       # Main component (~750 loc)
```

### Request flow

```
Browser  →  POST /api/analyze  →  Flask (api.py)
                                      │
                              Model fallback loop
                                      │
                    ┌─────────────────┼──────────────────────┐
                    │                 │                        │
         Llama-3.3-70B      Qwen2.5-72B:fastest      Qwen2.5-7B
                    │
              Hugging Face Router API
              (router.huggingface.co)
                    │
              JSON response  →  Flask  →  Browser
```

---

## Tech Stack

**Backend**
- Python 3.10+
- Flask + flask-cors
- `requests` (HTTP client with 503 retry)
- Hugging Face Router API (`/v1/chat/completions`, OpenAI-compatible)
- python-dotenv

**Frontend**
- React 18 (Vite)
- Tailwind CSS 3
- Lucide React (icons)
- jsPDF (PDF export, text API)
- Native `fetch` + AbortController

**LLM models (in priority order)**
1. `meta-llama/Llama-3.3-70B-Instruct`
2. `Qwen/Qwen2.5-72B-Instruct:fastest`
3. `Qwen/Qwen2.5-7B-Instruct`

---

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- A [Hugging Face account](https://huggingface.co) with a free API token

### 1 — Clone & configure

```bash
git clone https://github.com/your-org/fineprint.git
cd fineprint
```

Create `.env` in the project root:

```
HF_API_KEY=hf_your_token_here
```

### 2 — Backend

```bash
pip install flask flask-cors requests python-dotenv
python api.py
```

The server starts at `http://localhost:5000`.

### 3a — Frontend (development, hot-reload)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to Flask.

### 3b — Frontend (production build)

```bash
cd frontend
npm run build          # outputs frontend/dist/
```

Then visit `http://localhost:5000` — Flask auto-detects the `dist/` folder and serves it.

### Optional: Streamlit prototype

```bash
pip install streamlit
streamlit run app.py   # http://localhost:8501
```

---

## API Reference

### `POST /api/analyze`

**Request**

```json
{
  "text": "<full document text>"
}
```

**Response (success)**

```json
{
  "risk_score": 72,
  "tldr": "They own your data, your soul, and probably your houseplants.",
  "red_flags": [
    {
      "clause": "Arbitration Waiver",
      "severity": "High",
      "summary": "You give up the right to sue in court and must use their arbitrator.",
      "alternative_action": "Look for services with standard court jurisdiction, or add a written opt-out within 30 days of signing."
    }
  ]
}
```

**Response (error)**

```json
{ "error": "All models failed. Last: meta-llama/Llama-3.3-70B-Instruct: request timed out" }
```

HTTP status 500 if all models fail; 400 if `text` is missing.

---

## Confidence Score

Calculated entirely client-side after receiving the AI response. Formula:

| Signal | Points |
|---|---|
| Base | 55 |
| 7+ red flags | +18 |
| 4–6 red flags | +12 |
| 2–3 red flags | +7 |
| 1 red flag | +3 |
| Risk score ≥ 40 points from centre (≤10 or ≥90) | +14 |
| Risk score ≥ 25 points from centre | +9 |
| Document ≥ 8 000 chars | +12 |
| Document ≥ 4 000 chars | +8 |
| Document < 300 chars | −10 |
| 3+ High-severity flags | +6 |

Capped at 97% — we never claim 100% certainty.

---

## Usage Tips

- **Longer is better** — paste the full document, not excerpts. Confidence improves significantly above 4 000 characters.
- **Name your documents** — the optional name field makes your history easier to navigate and exports look cleaner.
- **Compare before you sign** — analyze two versions of a contract (or two competing services) and use the Compare tab to spot which is less hostile.
- **Read the defence strategies** — these are the most actionable output. They tell you exactly what to ask for or opt out of.

---

## Limitations

- **Not legal advice.** AI analysis is a starting point, not a substitute for a qualified attorney.
- **JSON reliability.** Smaller fallback models occasionally produce malformed JSON. The backend strips markdown fences and uses a greedy regex to extract the object, but very large or complex documents may still fail on the smallest model.
- **Context window.** Documents > ~30 000 characters may be truncated by the model. Split very long contracts into sections.
- **Cold starts.** Hugging Face serverless endpoints occasionally return 503 during model warm-up. The backend retries up to 3 times per model automatically.
- **Confidence is heuristic.** The score reflects structural confidence signals, not model calibration. Treat it as a rough signal.

---

## Future Enhancements

- [ ] Multi-page PDF support (chunked analysis + result merge)
- [ ] Browser extension to auto-detect and analyze ToS pages
- [ ] Side-by-side clause diff for document versions (e.g., ToS change notifications)
- [ ] Shareable result links via server-side storage
- [ ] User-defined clause watchlist (e.g., "always flag GDPR data retention")
- [ ] Dark/light theme toggle in the React frontend

---

## Contributing

1. Fork the repo and create a feature branch.
2. Run `npm run dev` (frontend) and `python api.py` (backend) in separate terminals.
3. Submit a PR with a clear description of what changed and why.

Please do not commit `.env` or any file containing API keys.

---

## License

MIT — see `LICENSE`.

---

*Built for hackathon purposes. FinePrint is not affiliated with any legal practice.*
