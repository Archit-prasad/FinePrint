"""
FinePrint – Flask API  (local development)
Run:  python api.py
API:  POST http://localhost:5000/api/analyze

Pipeline
  1. Split the pasted document into sentences.
  2. A fine-tuned LegalBERT classifier (./fineprint_model) flags sentences that
     look like unfair Terms-of-Service clauses.
  3. Only the flagged clauses are sent to the LLM, which explains them in plain
     English and suggests defences.
  4. If the LLM is unavailable, the classifier results are still returned.
  5. If the model folder is missing, the app behaves like the original version
     (whole document -> LLM).
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

# ── Trained classifier settings ───────────────────────────────────────────────

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "fineprint_model")

# Same order as the training notebook (LexGLUE unfair_tos label ids 0..7)
LABEL_NAMES = [
    "Limitation of liability",
    "Unilateral termination",
    "Unilateral change",
    "Content removal",
    "Contract by using",
    "Choice of law",
    "Jurisdiction",
    "Arbitration",
]
THRESHOLD           = 0.5   # probability needed to flag a clause
MAX_PER_LABEL       = 3     # best examples per clause type sent to the LLM
MAX_FLAGGED_FOR_LLM = 24    # hard cap on clauses sent to the LLM
MAX_UI_CLAUSES      = 50    # flagged clauses returned to the frontend

_DEFAULT_ACTIONS = {
    "Limitation of liability": "Keep your own backups and check whether your local consumer law overrides this cap.",
    "Unilateral termination":  "Back up your data and purchases; do not rely on the account for anything irreplaceable.",
    "Unilateral change":       "Save a dated copy of the terms and review change notices; stop using the service if you object.",
    "Content removal":         "Keep local copies of anything you upload or buy; they can be removed at any time.",
    "Contract by using":       "Read the terms before first use; simply using the service counts as agreeing.",
    "Choice of law":           "Check whether your local consumer-protection law still applies to you.",
    "Jurisdiction":            "Disputes must be heard in the stated courts; look for an opt-out or local-court right.",
    "Arbitration":             "Look for an opt-out window (often 30 days) and note you may lose the right to sue in court.",
}

_tok = None
_clf = None
_clf_error = None


def load_classifier():
    """Load the fine-tuned model once at startup. Safe to fail."""
    global _tok, _clf, _clf_error
    if not os.path.isdir(MODEL_DIR):
        _clf_error = f"model folder not found: {MODEL_DIR}"
        print(f"[MODEL] {_clf_error} - running in LLM-only mode")
        return
    try:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        _tok = AutoTokenizer.from_pretrained(MODEL_DIR)
        _clf = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
        _clf.eval()
        n_out = _clf.config.num_labels
        if n_out != len(LABEL_NAMES):
            raise ValueError(f"model has {n_out} outputs, expected {len(LABEL_NAMES)}")
        print("[MODEL] fine-tuned classifier loaded")
    except Exception as e:
        _tok = _clf = None
        _clf_error = str(e)
        print(f"[MODEL] could not load classifier: {e} - running in LLM-only mode")


def split_sentences(text: str):
    text = re.sub(r"[ \t]+", " ", text)
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    seen, out = set(), []
    for p in parts:
        s = p.strip()
        if len(s) < 25:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def classify(sentences, batch_size=32):
    """Return a list of probability vectors, one per sentence (same order)."""
    import torch
    order = sorted(range(len(sentences)), key=lambda i: len(sentences[i]))
    probs_out = [None] * len(sentences)
    with torch.inference_mode():
        for start in range(0, len(order), batch_size):
            idx = order[start:start + batch_size]
            batch = [sentences[i] for i in idx]
            enc = _tok(batch, return_tensors="pt", padding=True,
                       truncation=True, max_length=128)
            probs = torch.sigmoid(_clf(**enc).logits).cpu().numpy()
            for i, p in zip(idx, probs):
                probs_out[i] = p
    return probs_out


def find_flags(sentences, probs):
    flags = []
    for s, p in zip(sentences, probs):
        for i, name in enumerate(LABEL_NAMES):
            if p[i] >= THRESHOLD:
                flags.append({"text": s, "category": name,
                              "confidence": round(float(p[i]), 2)})
    return flags


def pick_for_llm(flags):
    by_cat = {}
    for f in sorted(flags, key=lambda f: -f["confidence"]):
        lst = by_cat.setdefault(f["category"], [])
        if len(lst) < MAX_PER_LABEL:
            lst.append(f)
    picked = [f for lst in by_cat.values() for f in lst]
    return picked[:MAX_FLAGGED_FOR_LLM]


def local_result(flags, n_sentences):
    """Result built only from the classifier (used when the LLM is unavailable)."""
    best = {}
    for f in flags:
        if f["category"] not in best or f["confidence"] > best[f["category"]]["confidence"]:
            best[f["category"]] = f
    red_flags = []
    for cat, f in best.items():
        sev = "High" if f["confidence"] >= 0.9 else "Medium" if f["confidence"] >= 0.75 else "Low"
        red_flags.append({
            "clause": cat,
            "severity": sev,
            "summary": "Flagged by the trained model: " + f["text"][:240],
            "alternative_action": _DEFAULT_ACTIONS.get(cat, "Review this clause carefully before agreeing."),
        })
    red_flags.sort(key=lambda r: {"High": 0, "Medium": 1, "Low": 2}[r["severity"]])
    score = min(95, 10 + 12 * len(best))
    return {
        "risk_score": score,
        "tldr": f"The trained model found {len(best)} type(s) of potentially unfair clause in this document.",
        "red_flags": red_flags,
    }


# ── LLM (Hugging Face router) ─────────────────────────────────────────────────

_MODELS = [
    "meta-llama/Llama-3.3-70B-Instruct",
    "Qwen/Qwen2.5-72B-Instruct:fastest",
    "Qwen/Qwen2.5-7B-Instruct",
]
_SWAP_STATUSES = {400, 404}
_SWAP_PHRASES  = ("model_not_supported", "not supported", "no endpoints", "unavailable")

_JSON_SPEC = (
    "You MUST respond with a single, valid JSON object "
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

# Used when the whole document is sent (no trained model available)
_SYSTEM_PROMPT = (
    "You are an elite consumer protection lawyer with a sharp, witty sense of humor. "
    "Analyze the provided contract or Terms of Service. Identify hidden catches, sneaky "
    "data tracking, or unfair terms. " + _JSON_SPEC
)

# Used when a trained classifier has already pre-selected the risky clauses
_FLAGGED_PROMPT = (
    "You are an elite consumer protection lawyer with a sharp, witty sense of humor. "
    "A trained classifier has scanned a contract or Terms of Service and flagged the "
    "clauses below as potentially unfair. Each clause is tagged with its detected "
    "category in square brackets. Base your analysis only on these clauses: explain why "
    "each issue is bad for the consumer, merge duplicates of the same issue into one "
    "red flag, and set the risk_score using how many clauses were flagged compared with "
    "the document size. " + _JSON_SPEC
)


def _should_swap(status: int, body: str) -> bool:
    if status in _SWAP_STATUSES:
        return True
    return any(p in body.lower() for p in _SWAP_PHRASES)


def call_llm(system_prompt: str, user_content: str) -> dict:
    api_url = "https://router.huggingface.co/v1/chat/completions"
    headers = {"Authorization": f"Bearer {HF_API_KEY}", "Content-Type": "application/json"}
    last_error = "All models in the fallback chain failed."

    for model in _MODELS:
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_content},
            ],
            "max_tokens": 1800,
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


# ── Main analysis pipeline ────────────────────────────────────────────────────

def analyze_contract(text: str) -> dict:
    # No trained model available -> original behaviour
    if _clf is None:
        result = call_llm(_SYSTEM_PROMPT, f"Analyze this text:\n\n{text[:30000]}")
        if "error" not in result:
            result["analysis_mode"] = "llm-only"
        return result

    sentences = split_sentences(text)
    if not sentences:
        return {"error": "Could not find any sentences to analyze."}

    probs = classify(sentences)
    flags = find_flags(sentences, probs)
    print(f"[MODEL] {len(flags)} flags in {len(sentences)} sentences")

    stats = {"sentences_scanned": len(sentences), "clauses_flagged": len(flags)}
    ui_clauses = sorted(flags, key=lambda f: -f["confidence"])[:MAX_UI_CLAUSES]
    ui_clauses = [{**f, "text": f["text"][:300]} for f in ui_clauses]

    if not flags:
        return {
            "risk_score": 5,
            "tldr": "The trained model found no clauses matching known unfair-term patterns.",
            "red_flags": [],
            "flagged_clauses": [],
            "stats": stats,
            "analysis_mode": "model-only",
        }

    picked = pick_for_llm(flags)
    lines = [f"[{f['category']}] {f['text'][:500]}" for f in picked]
    user_content = (
        f"The document had {len(sentences)} sentences; the classifier flagged "
        f"{len(flags)} of them. The most relevant flagged clauses:\n\n" + "\n\n".join(lines)
    )

    result = call_llm(_FLAGGED_PROMPT, user_content)
    if "error" in result:
        # LLM unavailable -> still return the trained model's findings
        fallback = local_result(flags, len(sentences))
        fallback["analysis_mode"] = "model-only"
        fallback["llm_error"] = result["error"]
        result = fallback
    else:
        result["analysis_mode"] = "model+llm"

    result["flagged_clauses"] = ui_clauses
    result["stats"] = stats
    return result


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "No text provided"}), 400
    if not HF_API_KEY and _clf is None:
        return jsonify({"error": "HF_API_KEY not configured in .env"}), 500
    result = analyze_contract(text)
    return jsonify(result), (500 if "error" in result else 200)


@app.route("/health")
def health():
    return jsonify({"status": "ok", "classifier_loaded": _clf is not None,
                    "classifier_error": _clf_error}), 200


if __name__ == "__main__":
    print("\n  FinePrint API")
    print("  -----------------------------------------")
    print("  API  ->  POST http://localhost:5000/api/analyze")
    print("  -----------------------------------------\n")
    load_classifier()
    # use_reloader=False so the 400 MB model is loaded once, not twice
    app.run(debug=True, use_reloader=False, port=5000, host="127.0.0.1")