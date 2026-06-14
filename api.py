"""
FinePrint – Flask API  (local development)
Run:  python api.py
API:  POST http://localhost:5000/api/analyze
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests as http
import os, json, re
from dotenv import load_dotenv

load_dotenv()
HF_API_KEY = os.getenv("HF_API_KEY")

app = Flask(__name__)
CORS(app, origins=["http://localhost:5173"])   # Vite dev server

# ── Model fallback chain ──────────────────────────────────────────────────────

_MODELS = [
    "meta-llama/Llama-3.3-70B-Instruct",
    "Qwen/Qwen2.5-72B-Instruct:fastest",
    "Qwen/Qwen2.5-7B-Instruct",
]
_SWAP_STATUSES = {400, 404}
_SWAP_PHRASES  = ("model_not_supported", "not supported", "no endpoints", "unavailable")

_SYSTEM_PROMPT = (
    "You are an elite consumer protection lawyer with a sharp, witty sense of humor. "
    "Analyze the provided contract or Terms of Service. Identify hidden catches, sneaky "
    "data tracking, or unfair terms. You MUST respond with a single, valid JSON object "
    "containing exactly three keys:\n"
    "1. 'risk_score': An integer from 0 to 100 reflecting how hostile the contract is to consumers.\n"
    "2. 'tldr': A highly concise, witty, single-sentence summary explaining the biggest hidden catch.\n"
    "3. 'red_flags': A list of objects, where each object has:\n"
    "   - 'clause': The category/name of the issue.\n"
    "   - 'severity': 'High', 'Medium', or 'Low'.\n"
    "   - 'summary': A short explanation of why this clause is bad for the user.\n"
    "   - 'alternative_action': A clear, actionable legal defense strategy or alternative "
    "tool the user should consider.\n"
    "Do not include any extra text or markdown formatting outside the JSON object."
)


def _should_swap(status: int, body: str) -> bool:
    if status in _SWAP_STATUSES:
        return True
    return any(p in body.lower() for p in _SWAP_PHRASES)


def analyze_contract(contract_text: str) -> dict:
    api_url = "https://router.huggingface.co/v1/chat/completions"
    headers = {"Authorization": f"Bearer {HF_API_KEY}", "Content-Type": "application/json"}
    last_error = "All models in the fallback chain failed."

    for model in _MODELS:
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": f"Analyze this text:\n\n{contract_text}"},
            ],
            "max_tokens": 1500,
            "temperature": 0.3,
        }
        try:
            response = None
            for attempt in range(3):
                response = http.post(api_url, headers=headers, json=payload, timeout=60)
                if response.status_code != 503:
                    break
                print(f"[API] 503 on {model} attempt {attempt + 1}/3")

            if response.status_code == 503:
                last_error = f"{model}: 503 after 3 attempts"
                print(f"[API] SWAP → {last_error}")
                continue

            if _should_swap(response.status_code, response.text):
                last_error = f"{model}: HTTP {response.status_code} — {response.text[:180]}"
                print(f"[API] SWAP → {last_error}")
                continue

            if response.status_code != 200:
                last_error = f"{model}: HTTP {response.status_code}"
                print(f"[API] SWAP → {last_error}")
                continue

            body = response.json()
            if "error" in body:
                last_error = f"{model}: embedded error — {str(body['error'])[:180]}"
                print(f"[API] SWAP → {last_error}")
                continue

            raw = body["choices"][0]["message"]["content"].strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw).strip()
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            if m:
                raw = m.group(0)

            result = json.loads(raw)
            print(f"[API] SUCCESS via {model}")
            return result

        except json.JSONDecodeError as e:
            last_error = f"{model}: JSON parse error — {e}"
        except http.exceptions.Timeout:
            last_error = f"{model}: request timed out"
        except Exception as e:
            last_error = f"{model}: {e}"
        print(f"[API] SWAP → {last_error}")

    return {"error": f"All models failed. Last: {last_error}"}


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "No text provided"}), 400
    if not HF_API_KEY:
        return jsonify({"error": "HF_API_KEY not configured in .env"}), 500
    result = analyze_contract(text)
    return jsonify(result), (500 if "error" in result else 200)


@app.route("/health")
def health():
    return jsonify({"status": "ok"}), 200


if __name__ == "__main__":
    print("\n  FinePrint API")
    print("  ─────────────────────────────────────────")
    print("  API  →  POST http://localhost:5000/api/analyze")
    print("  ─────────────────────────────────────────\n")
    app.run(debug=True, port=5000, host="127.0.0.1")
