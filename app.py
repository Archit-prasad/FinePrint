import streamlit as st
import requests
import os
import json
import re
from dotenv import load_dotenv

load_dotenv()
HF_API_KEY = os.getenv("HF_API_KEY")

# Prioritized fallback chain — tried in order until one succeeds
_MODELS = [
    "meta-llama/Llama-3.3-70B-Instruct",       # primary: stable, large capacity
    "Qwen/Qwen2.5-72B-Instruct:fastest",         # secondary: forces router policy mapping
    "Qwen/Qwen2.5-7B-Instruct",                  # tertiary: ultra-fast, highly available
]

# Status codes that mean "this model is unavailable on the router" — swap immediately
_SWAP_STATUSES = {400, 404}

# Substrings in an error body that also warrant a model swap
_SWAP_PHRASES = ("model_not_supported", "not supported", "no endpoints", "unavailable")

_SYSTEM_PROMPT = (
    "You are an elite consumer protection lawyer with a sharp, witty sense of humor. "
    "Analyze the provided contract or Terms of Service. Identify hidden catches, sneaky data tracking, "
    "or unfair terms. You MUST respond with a single, valid JSON object containing exactly three keys:\n"
    "1. 'risk_score': An integer from 0 to 100 reflecting how hostile the contract is to consumers.\n"
    "2. 'tldr': A highly concise, witty, single-sentence summary explaining the biggest hidden catch.\n"
    "3. 'red_flags': A list of objects, where each object has:\n"
    "   - 'clause': The category/name of the issue.\n"
    "   - 'severity': 'High', 'Medium', or 'Low'.\n"
    "   - 'summary': A short explanation of why this clause is bad for the user.\n"
    "   - 'alternative_action': A clear, actionable legal defense strategy or alternative tool the user should consider.\n"
    "Do not include any extra text or markdown formatting outside the JSON object."
)


# ── Backend ───────────────────────────────────────────────────────────────────

def _should_swap(status: int, body: str) -> bool:
    """Return True when the response signals the model isn't routable."""
    if status in _SWAP_STATUSES:
        return True
    body_lower = body.lower()
    return any(phrase in body_lower for phrase in _SWAP_PHRASES)


def analyze_contract(contract_text: str) -> dict:
    api_url = "https://router.huggingface.co/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {HF_API_KEY}",
        "Content-Type": "application/json",
    }
    last_error = "All models in the fallback chain failed."

    for model in _MODELS:
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": f"Analyze this text:\n\n{contract_text}"},
            ],
            "max_tokens": 1500,
            "temperature": 0.3,
        }

        try:
            # ── Cold-start retry (503 only) ───────────────────────────────
            response = None
            for attempt in range(3):
                response = requests.post(api_url, headers=headers, json=payload, timeout=60)
                if response.status_code != 503:
                    break
                print(f"[FinePrint] 503 on {model} (attempt {attempt + 1}/3) — retrying...")

            # ── Model-swap triggers ───────────────────────────────────────
            if response.status_code == 503:
                last_error = f"{model}: still returning 503 after 3 attempts."
                print(f"[FinePrint] WARNING: {last_error} Trying next model.")
                continue

            if _should_swap(response.status_code, response.text):
                last_error = f"{model}: HTTP {response.status_code} — {response.text[:180]}"
                print(f"[FinePrint] WARNING: {last_error} Trying next model.")
                continue

            # ── Non-200 that isn't a swap trigger (e.g. 429, 500) ────────
            if response.status_code != 200:
                last_error = f"{model}: HTTP {response.status_code} — {response.text[:180]}"
                print(f"[FinePrint] WARNING: {last_error} Trying next model.")
                continue

            # ── Parse response body ───────────────────────────────────────
            body = response.json()

            # Some routers return HTTP 200 with an embedded error object
            if "error" in body:
                err_detail = str(body["error"])
                if _should_swap(200, err_detail):
                    last_error = f"{model}: embedded error — {err_detail[:180]}"
                    print(f"[FinePrint] WARNING: {last_error} Trying next model.")
                    continue
                last_error = f"{model}: API error — {err_detail[:180]}"
                print(f"[FinePrint] WARNING: {last_error} Trying next model.")
                continue

            raw = body["choices"][0]["message"]["content"].strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw).strip()
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                raw = match.group(0)

            result = json.loads(raw)
            print(f"[FinePrint] SUCCESS via {model}")
            return result

        except json.JSONDecodeError as exc:
            last_error = f"{model}: JSON parse failed — {exc}"
            print(f"[FinePrint] WARNING: {last_error} Trying next model.")
        except requests.exceptions.Timeout:
            last_error = f"{model}: request timed out."
            print(f"[FinePrint] WARNING: {last_error} Trying next model.")
        except Exception as exc:
            last_error = f"{model}: unexpected error — {exc}"
            print(f"[FinePrint] WARNING: {last_error} Trying next model.")

    return {"error": f"All models failed. Last error: {last_error}"}


# ── UI helpers ────────────────────────────────────────────────────────────────

def _palette(dark: bool) -> dict:
    if dark:
        return dict(
            bg="#121212", surface="#1e1e1e", surface2="#252525",
            text_pri="#e8eaed", text_sec="#9aa0a6",
            accent="#8ab4f8", accent_hov="#aecbfa", accent_dim="rgba(138,180,248,0.12)",
            border="#2a2a2a", btn_col="#121212",
            inp_shadow="0 2px 16px rgba(0,0,0,0.4)",
            btn_shadow="0 4px 18px rgba(138,180,248,0.18)",
            card_shadow="0 4px 24px rgba(0,0,0,0.45)",
            focus_ring="rgba(138,180,248,0.22)",
            tldr_bg="#111b2e", tldr_border="#8ab4f8", tldr_text="#aecbfa",
            def_bg="#0d2118", def_border="#81c995", def_text="#81c995",
            bar_bg="#2a2a2a",
            high_bg="#3a1215", high_col="#f28b82", high_border="#5c1f1a",
            med_bg="#2a1f08",  med_col="#fdd663",  med_border="#4a3510",
            low_bg="#0e2318",  low_col="#81c995",  low_border="#1a4a2a",
        )
    return dict(
        bg="#f8f9fa", surface="#ffffff", surface2="#f1f3f4",
        text_pri="#202124", text_sec="#5f6368",
        accent="#1a73e8", accent_hov="#1557b0", accent_dim="rgba(26,115,232,0.08)",
        border="#e8eaed", btn_col="#ffffff",
        inp_shadow="0 1px 6px rgba(0,0,0,0.07)",
        btn_shadow="0 2px 10px rgba(26,115,232,0.22)",
        card_shadow="0 2px 14px rgba(0,0,0,0.08)",
        focus_ring="rgba(26,115,232,0.18)",
        tldr_bg="#e8f0fe", tldr_border="#1a73e8", tldr_text="#174ea6",
        def_bg="#e6f4ea",  def_border="#34a853",  def_text="#137333",
        bar_bg="#e8eaed",
        high_bg="#fce8e6", high_col="#c5221f", high_border="#f5c6c4",
        med_bg="#fef7e0",  med_col="#b06000",  med_border="#fce3a0",
        low_bg="#e6f4ea",  low_col="#137333",  low_border="#b7dfbf",
    )


def _inject_css(p: dict, dark: bool) -> None:
    st.markdown(f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=Google+Sans:wght@300;400;500;700&display=swap');

html, body, .stApp {{
    background-color: {p['bg']} !important;
    font-family: 'Google Sans', 'Roboto', system-ui, -apple-system, sans-serif !important;
    color: {p['text_pri']} !important;
}}

/* hide Streamlit chrome */
#MainMenu, footer, header {{ visibility: hidden; }}
.stDeployButton {{ display: none !important; }}

/* main container */
.main .block-container {{
    max-width: 820px;
    padding: 1.25rem 2rem 6rem;
    margin: 0 auto;
}}

/* theme toggle */
.stToggle > label > div > span {{
    color: {p['text_sec']} !important;
    font-size: 0.78rem !important;
    font-weight: 400 !important;
    letter-spacing: 0.03em !important;
}}

/* text area */
.stTextArea label {{ display: none !important; }}
.stTextArea textarea {{
    background-color: {p['surface']} !important;
    color: {p['text_pri']} !important;
    border: 1px solid {p['border']} !important;
    border-radius: 16px !important;
    padding: 1.2rem 1.5rem !important;
    font-family: 'Google Sans', 'Roboto', sans-serif !important;
    font-size: 0.925rem !important;
    line-height: 1.65 !important;
    box-shadow: {p['inp_shadow']} !important;
    transition: border-color 0.18s ease, box-shadow 0.18s ease !important;
    caret-color: {p['accent']} !important;
}}
.stTextArea textarea:focus {{
    border-color: {p['accent']} !important;
    box-shadow: {p['inp_shadow']}, 0 0 0 3px {p['focus_ring']} !important;
    outline: none !important;
}}
.stTextArea textarea::placeholder {{
    color: {p['text_sec']} !important;
    opacity: 0.55 !important;
}}

/* primary button */
.stButton > button {{
    background-color: {p['accent']} !important;
    color: {p['btn_col']} !important;
    border: none !important;
    border-radius: 100px !important;
    padding: 0.7rem 1.75rem !important;
    font-family: 'Google Sans', sans-serif !important;
    font-size: 0.9rem !important;
    font-weight: 500 !important;
    letter-spacing: 0.01em !important;
    box-shadow: {p['btn_shadow']} !important;
    transition: background-color 0.18s ease, transform 0.15s ease, box-shadow 0.18s ease !important;
    white-space: nowrap !important;
}}
.stButton > button:hover {{
    background-color: {p['accent_hov']} !important;
    transform: translateY(-1px) !important;
    box-shadow: {p['btn_shadow'].replace('0.22', '0.32').replace('0.18', '0.28')} !important;
}}
.stButton > button:active {{ transform: translateY(0) !important; }}

/* spinner */
div[data-testid="stSpinner"] > div {{
    border-top-color: {p['accent']} !important;
}}

/* alerts */
div[data-testid="stAlert"] {{
    border-radius: 12px !important;
    border-left-width: 3px !important;
}}

hr {{
    border: none !important;
    border-top: 1px solid {p['border']} !important;
    margin: 2rem 0 !important;
}}
</style>
""", unsafe_allow_html=True)


def _chip(severity: str, p: dict) -> str:
    cfg = {
        "High":   (p["high_col"], p["high_bg"], p["high_border"], "HIGH RISK"),
        "Medium": (p["med_col"],  p["med_bg"],  p["med_border"],  "MED RISK"),
        "Low":    (p["low_col"],  p["low_bg"],  p["low_border"],  "LOW RISK"),
    }
    col, bg, border, label = cfg.get(severity, cfg["Medium"])
    return (
        f'<span style="background:{bg};color:{col};border:1px solid {border};'
        f'border-radius:100px;padding:3px 11px;font-size:0.67rem;'
        f'font-weight:700;letter-spacing:0.08em;display:inline-block;">{label}</span>'
    )


def _score_color(risk: int, dark: bool) -> str:
    if risk >= 75:
        return "#f28b82" if dark else "#c5221f"
    if risk >= 45:
        return "#fdd663" if dark else "#e37400"
    return "#81c995" if dark else "#34a853"


def render_results(analysis: dict, dark: bool) -> None:
    p         = _palette(dark)
    risk      = int(analysis.get("risk_score", 50))
    tldr      = analysis.get("tldr", "")
    red_flags = analysis.get("red_flags", [])
    score_col = _score_color(risk, dark)
    risk_label = (
        "CRITICAL" if risk >= 75 else
        "ELEVATED" if risk >= 50 else
        "MODERATE" if risk >= 25 else
        "MINIMAL"
    )

    # ── divider ──
    st.markdown(
        f'<div style="height:1px;background:{p["border"]};margin:2rem 0 1.75rem;"></div>',
        unsafe_allow_html=True,
    )

    # ── TL;DR banner ──
    st.markdown(f"""
<div style="
    background:{p['tldr_bg']};
    border-left:3px solid {p['tldr_border']};
    border-radius:0 16px 16px 0;
    padding:1.2rem 1.5rem;
    margin-bottom:1.25rem;
">
    <div style="font-size:0.63rem;font-weight:700;letter-spacing:0.12em;
                color:{p['tldr_border']};margin-bottom:6px;">TL;DR</div>
    <div style="font-size:0.975rem;color:{p['tldr_text']};line-height:1.65;">{tldr}</div>
</div>
""", unsafe_allow_html=True)

    # ── Risk score card ──
    st.markdown(f"""
<div style="
    background:{p['surface']};
    border:1px solid {p['border']};
    border-radius:16px;
    padding:1.75rem 2rem;
    margin-bottom:1.25rem;
    box-shadow:{p['card_shadow']};
">
    <div style="font-size:0.63rem;font-weight:700;letter-spacing:0.13em;
                color:{p['text_sec']};margin-bottom:1rem;">CONSUMER RISK INDEX</div>
    <div style="display:flex;align-items:center;gap:2.5rem;flex-wrap:wrap;">
        <div style="display:flex;align-items:baseline;gap:7px;">
            <span style="
                font-size:4.75rem;font-weight:700;line-height:1;
                color:{score_col};letter-spacing:-0.03em;
            ">{risk}</span>
            <span style="font-size:1.4rem;font-weight:300;color:{p['text_sec']};">/100</span>
        </div>
        <div style="flex:1;min-width:120px;">
            <div style="height:3px;background:{p['bar_bg']};border-radius:100px;
                        overflow:hidden;margin-bottom:8px;">
                <div style="
                    height:100%;width:{risk}%;
                    background:linear-gradient(90deg,#34a853 0%,#fbbc04 50%,#ea4335 100%);
                    border-radius:100px;
                "></div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;
                             color:{score_col};">{risk_label}</span>
                <div style="display:flex;gap:12px;">
                    <span style="font-size:0.62rem;color:{p['text_sec']};opacity:0.7;">Safe</span>
                    <span style="font-size:0.62rem;color:{p['text_sec']};opacity:0.7;">Critical</span>
                </div>
            </div>
        </div>
    </div>
</div>
""", unsafe_allow_html=True)

    # ── Red flags ──
    if not red_flags:
        st.markdown(f"""
<div style="
    background:{p['surface']};border:1px solid {p['border']};border-radius:16px;
    padding:2.5rem;text-align:center;box-shadow:{p['card_shadow']};
">
    <div style="font-size:1.75rem;margin-bottom:8px;color:{p['low_col']};">&#10003;</div>
    <div style="font-size:1rem;font-weight:500;color:{p['text_pri']};">No major red flags detected</div>
    <div style="font-size:0.875rem;color:{p['text_sec']};margin-top:4px;">
        This document appears relatively consumer-friendly.
    </div>
</div>
""", unsafe_allow_html=True)
        return

    st.markdown(f"""
<div style="font-size:0.63rem;font-weight:700;letter-spacing:0.13em;
            color:{p['text_sec']};margin:1.5rem 0 0.875rem;">
    IDENTIFIED CONCERNS &nbsp;&middot;&nbsp; {len(red_flags)} FOUND
</div>
""", unsafe_allow_html=True)

    for flag in red_flags:
        severity = flag.get("severity", "Medium")
        clause   = flag.get("clause", "Unknown Clause")
        summary  = flag.get("summary", "")
        defense  = flag.get("alternative_action", "")

        st.markdown(f"""
<div style="
    background:{p['surface']};border:1px solid {p['border']};border-radius:16px;
    padding:1.5rem 1.75rem;margin-bottom:0.75rem;box-shadow:{p['card_shadow']};
">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
        {_chip(severity, p)}
        <span style="font-size:0.975rem;font-weight:500;color:{p['text_pri']};">{clause}</span>
    </div>
    <p style="font-size:0.9rem;color:{p['text_sec']};line-height:1.65;margin:0 0 1rem 0;">{summary}</p>
    <div style="
        background:{p['def_bg']};border-left:2px solid {p['def_border']};
        border-radius:0 10px 10px 0;padding:0.875rem 1.1rem;
    ">
        <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.11em;
                    color:{p['def_border']};margin-bottom:5px;">DEFENSE STRATEGY</div>
        <div style="font-size:0.875rem;color:{p['def_text']};line-height:1.6;">{defense}</div>
    </div>
</div>
""", unsafe_allow_html=True)


# ── App entry point ───────────────────────────────────────────────────────────

st.set_page_config(
    page_title="FinePrint",
    page_icon="◈",
    layout="centered",
    initial_sidebar_state="collapsed",
)

# Persist results across theme-toggle reruns
if "analysis_result" not in st.session_state:
    st.session_state.analysis_result = None

# ── Theme toggle (must be first widget) ──
dark_mode = st.toggle("Dark Mode", value=True)

p = _palette(dark_mode)
_inject_css(p, dark_mode)

# ── Header ──
st.markdown(f"""
<div style="padding:1.75rem 0 2rem;">
    <div style="font-size:0.67rem;font-weight:700;letter-spacing:0.14em;
                color:{p['accent']};margin-bottom:0.45rem;">
        CONSUMER PROTECTION TOOLKIT
    </div>
    <h1 style="
        font-size:3.25rem;font-weight:700;color:{p['text_pri']};
        margin:0;line-height:1.05;letter-spacing:-0.025em;
    ">FinePrint</h1>
    <p style="
        font-size:0.975rem;color:{p['text_sec']};margin:0.6rem 0 0;
        max-width:500px;line-height:1.6;opacity:0.85;
    ">
        AI-powered legal risk detection. Paste any Terms of Service or Privacy Policy
        to reveal what they don&rsquo;t want you to read.
    </p>
</div>
""", unsafe_allow_html=True)

# ── Input ──
contract_input = st.text_area(
    "",
    placeholder="Paste your Terms of Service, Privacy Policy, or any contract here...",
    height=220,
    label_visibility="collapsed",
)

col_btn, col_pad = st.columns([1, 3])
with col_btn:
    clicked = st.button("Analyze Document", type="primary", use_container_width=True)

# ── Logic ──
if clicked:
    if not HF_API_KEY:
        st.error("Setup required: add your HF_API_KEY to the .env file.")
        st.session_state.analysis_result = None
    elif not contract_input.strip():
        st.warning("Paste some contract text before analyzing.")
        st.session_state.analysis_result = None
    else:
        with st.spinner("Analyzing legal text..."):
            st.session_state.analysis_result = analyze_contract(contract_input)

# ── Results (survive theme-toggle reruns) ──
if st.session_state.analysis_result is not None:
    result = st.session_state.analysis_result
    if "error" in result:
        st.error(result["error"])
    else:
        render_results(result, dark_mode)
