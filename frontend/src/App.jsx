import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText, Shield, Lock, Eye, Zap, ArrowLeft,
  Copy, Download, Share2, Mail, Clock, Trash2,
  Columns2, BarChart2, Check, AlertCircle,
  ChevronRight, X, RotateCcw, History, Scale,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS & CONFIG
═══════════════════════════════════════════════════════════════════════════ */

const SEVERITY_CFG = {
  High:   { label: 'HIGH RISK', bg: 'rgba(220,38,38,0.14)',   border: 'rgba(220,38,38,0.38)',   color: '#f87171' },
  Medium: { label: 'MED RISK',  bg: 'rgba(245,158,11,0.14)',  border: 'rgba(245,158,11,0.38)',  color: '#fbbf24' },
  Low:    { label: 'LOW RISK',  bg: 'rgba(255,221,0,0.11)',   border: 'rgba(255,221,0,0.32)',   color: '#fde68a' },
};

const FLOAT_CFG = [
  { Icon: FileText, cls: 'animate-float-a', top: '9%',  left: '5%',    size: 54 },
  { Icon: Shield,   cls: 'animate-float-b', top: '14%', right: '5%',   size: 62 },
  { Icon: Scale,    cls: 'animate-float-c', top: '58%', left: '3.5%',  size: 50 },
  { Icon: Lock,     cls: 'animate-float-d', top: '68%', right: '5%',   size: 46 },
  { Icon: Eye,      cls: 'animate-float-e', top: '37%', left: '2%',    size: 58 },
  { Icon: Zap,      cls: 'animate-float-f', top: '40%', right: '2.5%', size: 52 },
];

const LOADING_STEPS = [
  { until: 6,        msg: 'Parsing document structure...'  },
  { until: 18,       msg: 'Identifying risk patterns...'   },
  { until: 35,       msg: 'Generating legal analysis...'   },
  { until: Infinity, msg: 'Finalizing results...'          },
];

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════════════════ */

function genId() {
  return `fp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatLen(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${n} chars`;
}

function calculateConfidence(analysis, textLen) {
  let score = 55;
  const flags     = analysis.red_flags || [];
  const riskScore = analysis.risk_score || 50;

  // More distinct flags → clearer patterns
  if (flags.length >= 7) score += 18;
  else if (flags.length >= 4) score += 12;
  else if (flags.length >= 2) score += 7;
  else if (flags.length >= 1) score += 3;

  // Extreme risk = clearer signal
  const dev = Math.abs(riskScore - 50);
  if (dev >= 40) score += 14;
  else if (dev >= 25) score += 9;
  else if (dev >= 15) score += 4;

  // Longer docs → more data
  if (textLen >= 8000) score += 12;
  else if (textLen >= 4000) score += 8;
  else if (textLen >= 1500) score += 4;
  else if (textLen < 300) score -= 10;

  // High-severity flags increase certainty
  const highCount = flags.filter(f => f.severity === 'High').length;
  if (highCount >= 3) score += 6;
  else if (highCount >= 1) score += 3;

  return Math.min(97, Math.max(28, score));
}

function findCommon(flagsA, flagsB) {
  const norm = s => s.toLowerCase().trim();
  return flagsA.filter(a =>
    flagsB.some(b => {
      const na = norm(a.clause), nb = norm(b.clause);
      return na === nb || na.includes(nb) || nb.includes(na);
    })
  );
}

function scoreColor(s) {
  if (s <= 20) return '#10b981';
  if (s <= 50) return '#f59e0b';
  if (s <= 75) return '#f97316';
  return '#dc2626';
}

function riskLabel(s) {
  if (s <= 20) return 'MINIMAL';
  if (s <= 50) return 'MODERATE';
  if (s <= 75) return 'ELEVATED';
  return 'CRITICAL';
}

function confColor(c) {
  if (c >= 90) return '#10b981';
  if (c >= 70) return '#f59e0b';
  return '#f87171';
}

/* ═══════════════════════════════════════════════════════════════════════════
   PDF EXPORT  (jsPDF text-based, dark-themed)
═══════════════════════════════════════════════════════════════════════════ */

async function exportPDF(entry) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw   = doc.internal.pageSize.getWidth();
  const ph   = doc.internal.pageSize.getHeight();
  const mg   = 18;
  const cw   = pw - mg * 2;
  let y      = mg;

  const addPageIfNeeded = (needed = 14) => {
    if (y + needed > ph - 14) { doc.addPage(); y = mg; }
  };

  // Dark background
  doc.setFillColor(15, 15, 35);
  doc.rect(0, 0, pw, ph, 'F');

  // Header bar
  doc.setFillColor(59, 130, 246, 0.8);
  doc.rect(0, 0, pw, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('FINEPRINT — AI Legal Risk Analysis', mg, 8);
  doc.text(new Date().toLocaleString(), pw - mg, 8, { align: 'right' });
  y = 22;

  // Title
  doc.setFontSize(22);
  doc.setTextColor(240, 245, 255);
  doc.text(entry.documentName, mg, y);
  y += 7;

  doc.setFontSize(9);
  doc.setTextColor(150, 150, 180);
  doc.text(`${formatLen(entry.textLength)} · ${formatDate(entry.timestamp)}`, mg, y);
  y += 12;

  // Risk + Confidence strip
  doc.setFillColor(30, 30, 60);
  doc.roundedRect(mg, y, cw, 16, 3, 3, 'F');
  const [sr, sg, sb] = entry.risk_score >= 75 ? [220,38,38] : entry.risk_score >= 50 ? [245,158,11] : entry.risk_score >= 25 ? [249,115,22] : [16,185,129];
  doc.setTextColor(sr, sg, sb);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`Risk: ${entry.risk_score}/100  ${riskLabel(entry.risk_score)}`, mg + 5, y + 10);
  doc.setTextColor(52, 211, 153);
  doc.text(`Confidence: ${entry.confidence}%`, pw - mg - 5, y + 10, { align: 'right' });
  y += 24;

  // TL;DR
  doc.setFontSize(10);
  doc.setTextColor(96, 165, 250);
  doc.setFont('helvetica', 'bold');
  doc.text('TL;DR', mg, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 210, 240);
  const tldrLines = doc.splitTextToSize(entry.tldr, cw);
  doc.text(tldrLines, mg, y);
  y += tldrLines.length * 5 + 10;

  // Red flags
  doc.setFontSize(11);
  doc.setTextColor(96, 165, 250);
  doc.setFont('helvetica', 'bold');
  doc.text(`Identified Concerns  (${(entry.red_flags || []).length})`, mg, y);
  y += 8;

  (entry.red_flags || []).forEach(flag => {
    addPageIfNeeded(30);
    // Shade the flag card
    doc.setFillColor(25, 25, 50);
    const cardH = 8 + doc.splitTextToSize(flag.summary, cw - 10).length * 4.5
                    + doc.splitTextToSize(flag.alternative_action, cw - 10).length * 4.5 + 14;
    doc.roundedRect(mg, y - 3, cw, Math.max(cardH, 22), 2, 2, 'F');

    const sev = SEVERITY_CFG[flag.severity] || SEVERITY_CFG.Medium;
    const hexToRgb = hex => {
      const m = hex.replace('#','').match(/.{2}/g);
      return m.map(h => parseInt(h, 16));
    };
    const [cr, cg, cb] = hexToRgb(sev.color);
    doc.setTextColor(cr, cg, cb);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(sev.label, mg + 3, y + 3);
    doc.setTextColor(220, 225, 255);
    doc.setFontSize(10);
    doc.text(flag.clause, mg + 3 + doc.getTextWidth(sev.label) + 5, y + 3);
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(160, 165, 200);
    const sumLines = doc.splitTextToSize(flag.summary, cw - 10);
    doc.text(sumLines, mg + 4, y);
    y += sumLines.length * 4.5 + 4;

    doc.setTextColor(52, 211, 153);
    doc.setFont('helvetica', 'bolditalic');
    doc.text('Defense: ', mg + 4, y);
    doc.setFont('helvetica', 'normal');
    const defLines = doc.splitTextToSize(flag.alternative_action, cw - 10);
    doc.text(defLines, mg + 4 + doc.getTextWidth('Defense: '), y);
    y += defLines.length * 4.5 + 10;
  });

  // Footer
  addPageIfNeeded(10);
  doc.setFontSize(7.5);
  doc.setTextColor(80, 80, 110);
  doc.text('Generated by FinePrint  ·  AI-powered consumer protection  ·  Not legal advice', mg, ph - 8);

  doc.save(`FinePrint-${entry.documentName.slice(0, 20).replace(/\s/g, '_')}-${Date.now()}.pdf`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   BACKGROUND & FLOATING ICONS
═══════════════════════════════════════════════════════════════════════════ */

function DiagonalBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      <div style={{ position:'absolute', left:'-6%', top:'50%', transform:'translateY(-50%)', fontSize:'26vw', fontWeight:900, lineHeight:1, color:'rgba(255,255,255,0.022)', letterSpacing:'-0.04em', userSelect:'none' }}>Fine</div>
      <div style={{ position:'absolute', right:'-6%', top:'50%', transform:'translateY(-50%)', fontSize:'26vw', fontWeight:900, lineHeight:1, color:'rgba(255,255,255,0.022)', letterSpacing:'-0.04em', userSelect:'none' }}>Print</div>

      <div className="animate-line-pulse absolute w-[200%] h-px left-[-50%]"
           style={{ background:'linear-gradient(90deg,transparent 0%,rgba(59,130,246,0.3) 30%,rgba(139,92,246,0.3) 70%,transparent 100%)', top:'50%', transform:'rotate(-22deg)', animationName:'linePulse', animationDuration:'5s', animationTimingFunction:'ease-in-out', animationIterationCount:'infinite' }} />
      <div className="absolute w-[200%] h-px left-[-50%]"
           style={{ background:'linear-gradient(90deg,transparent 0%,rgba(139,92,246,0.12) 50%,transparent 100%)', top:'35%', transform:'rotate(-22deg)', animation:'linePulse 7s ease-in-out infinite 1.5s' }} />

      <div className="absolute rounded-full" style={{ top:'-10%', left:'-10%', width:'55vw', height:'55vw', background:'radial-gradient(circle,rgba(59,130,246,0.045) 0%,transparent 65%)' }} />
      <div className="absolute rounded-full" style={{ bottom:'-10%', right:'-10%', width:'55vw', height:'55vw', background:'radial-gradient(circle,rgba(139,92,246,0.045) 0%,transparent 65%)' }} />
    </div>
  );
}

function FloatingIcons() {
  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 1 }}>
      {FLOAT_CFG.map(({ Icon, cls, size, ...pos }) => (
        <div key={cls} className={`absolute ${cls} text-white`} style={{ ...pos, opacity: 0.12 }}>
          <Icon size={size} strokeWidth={1.25} />
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SMALL REUSABLE COMPONENTS
═══════════════════════════════════════════════════════════════════════════ */

function CircularProgress({ score, size = 148 }) {
  const r    = 52;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(Math.max(score, 0), 100);
  const off  = circ * (1 - pct / 100);
  const col  = scoreColor(pct);

  return (
    <svg width={size} height={size} viewBox="0 0 120 120" style={{ flexShrink: 0 }}>
      <defs>
        <filter id="glow-ring">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round"
              strokeDasharray={circ} strokeDashoffset={off}
              transform="rotate(-90 60 60)" filter="url(#glow-ring)"
              style={{ transition: 'stroke-dashoffset 0.65s cubic-bezier(0.34,1.2,0.64,1), stroke 0.4s ease' }} />
      <text x="60" y="54" textAnchor="middle" fill="white" fontSize="23" fontWeight="800" fontFamily="system-ui,sans-serif">{Math.round(pct)}</text>
      <text x="60" y="70" textAnchor="middle" fill="rgba(255,255,255,0.32)" fontSize="10" fontFamily="system-ui,sans-serif">/ 100</text>
    </svg>
  );
}

function ConfidenceBar({ confidence }) {
  const col = confColor(confidence);
  const label = confidence >= 90 ? 'High Confidence'
              : confidence >= 70 ? 'Moderate Confidence'
              : 'Lower Confidence';
  return (
    <div style={{ minWidth: 180 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
        <span className="section-label">Confidence</span>
        <span style={{ color: col, fontSize:'0.8rem', fontWeight:700 }}>{confidence}%</span>
      </div>
      <div style={{ height:4, background:'rgba(255,255,255,0.08)', borderRadius:100, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${confidence}%`, background:col, borderRadius:100,
                      transition:'width 0.65s cubic-bezier(0.34,1.2,0.64,1)', boxShadow:`0 0 8px ${col}60` }} />
      </div>
      <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.3)', marginTop:4 }}>{label}</div>
    </div>
  );
}

function SeverityChip({ severity }) {
  const cfg = SEVERITY_CFG[severity] || SEVERITY_CFG.Medium;
  return (
    <span style={{ background:cfg.bg, border:`1px solid ${cfg.border}`, color:cfg.color,
                   borderRadius:100, padding:'3px 12px', fontSize:'0.67rem', fontWeight:700,
                   letterSpacing:'0.08em', whiteSpace:'nowrap', display:'inline-block' }}>
      {cfg.label}
    </span>
  );
}

function MiniScore({ score, size = 56 }) {
  const col = scoreColor(score);
  const r   = 22;
  const c   = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 50 50">
      <circle cx="25" cy="25" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
      <circle cx="25" cy="25" r={r} fill="none" stroke={col} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
              transform="rotate(-90 25 25)"
              style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      <text x="25" y="29" textAnchor="middle" fill="white" fontSize="11" fontWeight="800" fontFamily="system-ui,sans-serif">{score}</text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB NAVIGATION
═══════════════════════════════════════════════════════════════════════════ */

function TabNav({ active, setActive, historyCount }) {
  const tabs = [
    { id: 'analysis', label: 'Analysis',  Icon: BarChart2 },
    { id: 'history',  label: `History`,   Icon: History,   badge: historyCount || null },
    { id: 'compare',  label: 'Compare',   Icon: Columns2 },
  ];
  return (
    <div style={{ display:'flex', gap:4, marginBottom:28, background:'rgba(255,255,255,0.04)', borderRadius:14, padding:4, border:'1px solid rgba(255,255,255,0.07)' }}>
      {tabs.map(({ id, label, Icon, badge }) => {
        const isActive = active === id;
        return (
          <button key={id} onClick={() => setActive(id)} style={{
            flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:7,
            padding:'10px 6px', borderRadius:10, border:'none', cursor:'pointer',
            fontFamily:'inherit', fontSize:'0.85rem', fontWeight:isActive ? 600 : 400,
            background: isActive ? 'linear-gradient(135deg,rgba(59,130,246,0.25),rgba(139,92,246,0.25))' : 'transparent',
            color: isActive ? 'white' : 'rgba(255,255,255,0.45)',
            borderBottom: isActive ? '2px solid rgba(139,92,246,0.6)' : '2px solid transparent',
            transition:'all 0.2s ease',
            position:'relative',
          }}>
            <Icon size={15} strokeWidth={isActive ? 2 : 1.5} />
            {label}
            {badge > 0 && (
              <span style={{ background:'rgba(59,130,246,0.7)', color:'white', borderRadius:100,
                             padding:'1px 7px', fontSize:'0.62rem', fontWeight:700, minWidth:18, textAlign:'center' }}>
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RED FLAG CARD
═══════════════════════════════════════════════════════════════════════════ */

function RedFlagCard({ flag, index }) {
  return (
    <div className="glass animate-slide-up" style={{ borderRadius:16, padding:'20px 22px', marginBottom:12, animationDelay:`${index * 110}ms` }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:12 }}>
        <SeverityChip severity={flag.severity} />
        <span style={{ color:'rgba(255,255,255,0.9)', fontWeight:600, fontSize:'0.95rem' }}>{flag.clause}</span>
      </div>
      <p style={{ color:'rgba(255,255,255,0.52)', fontSize:'0.875rem', lineHeight:1.7, margin:'0 0 14px' }}>{flag.summary}</p>
      <div className="glass-green" style={{ padding:'12px 16px' }}>
        <div style={{ color:'#34d399', fontSize:'0.61rem', fontWeight:700, letterSpacing:'0.12em', marginBottom:5 }}>DEFENSE STRATEGY</div>
        <p style={{ color:'rgba(110,231,183,0.85)', fontSize:'0.85rem', lineHeight:1.65, margin:0 }}>{flag.alternative_action}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORT / SHARE BAR
═══════════════════════════════════════════════════════════════════════════ */

function ExportShareBar({ entry }) {
  const [copied, setCopied]   = useState(false);
  const [exporting, setExp]   = useState(false);

  const copyText = `FinePrint Analysis: ${entry.documentName}
Risk Score: ${entry.risk_score}/100 — ${riskLabel(entry.risk_score)}
Confidence: ${entry.confidence}%

TL;DR: ${entry.tldr}

Red Flags (${(entry.red_flags || []).length}):
${(entry.red_flags || []).map(f => `• [${f.severity}] ${f.clause}: ${f.summary}`).join('\n')}

Analyzed by FinePrint — AI-powered legal risk detection.`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = copyText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePDF = async () => {
    setExp(true);
    try { await exportPDF(entry); } catch (e) { console.error('PDF error:', e); }
    finally { setExp(false); }
  };

  const tweetText = encodeURIComponent(
    `I just analyzed a legal document with #FinePrint AI and it scored ${entry.risk_score}/100 on the consumer risk index.\n\n"${entry.tldr.slice(0, 100)}..."\n\nKnow what you're agreeing to:`
  );
  const liUrl = encodeURIComponent('https://github.com/your-org/fineprint');
  const liTitle = encodeURIComponent(`FinePrint Analysis: ${entry.documentName} — Risk ${entry.risk_score}/100`);
  const mailBody = encodeURIComponent(`Hi,\n\nI used FinePrint to analyze "${entry.documentName}" and wanted to share the results:\n\n${copyText}`);

  const btnStyle = {
    display:'flex', alignItems:'center', gap:6,
    padding:'9px 14px', borderRadius:10,
    fontSize:'0.8rem', fontWeight:500,
  };

  return (
    <div style={{ marginTop:20 }}>
      <div className="section-label" style={{ marginBottom:10 }}>Export & Share</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
        <button className="btn-ghost" style={btnStyle} onClick={handleCopy}>
          {copied ? <><Check size={14} color="#10b981"/> <span style={{ color:'#10b981' }}>Copied!</span></> : <><Copy size={14}/> Copy Results</>}
        </button>

        <button className="btn-ghost" style={btnStyle} onClick={handlePDF} disabled={exporting}>
          <Download size={14}/> {exporting ? 'Generating...' : 'Export PDF'}
        </button>

        <a href={`https://twitter.com/intent/tweet?text=${tweetText}`} target="_blank" rel="noreferrer"
           className="btn-ghost" style={{ ...btnStyle, textDecoration:'none', color:'rgba(255,255,255,0.7)' }}>
          <Share2 size={14}/> Twitter
        </a>

        <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${liUrl}&title=${liTitle}`} target="_blank" rel="noreferrer"
           className="btn-ghost" style={{ ...btnStyle, textDecoration:'none', color:'rgba(255,255,255,0.7)' }}>
          <Share2 size={14}/> LinkedIn
        </a>

        <a href={`mailto:?subject=FinePrint: ${entry.documentName}&body=${mailBody}`}
           className="btn-ghost" style={{ ...btnStyle, textDecoration:'none', color:'rgba(255,255,255,0.7)' }}>
          <Mail size={14}/> Email
        </a>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   LOADING VIEW
═══════════════════════════════════════════════════════════════════════════ */

function LoadingView({ elapsed, onCancel }) {
  const step      = LOADING_STEPS.find(s => elapsed < s.until) ?? LOADING_STEPS.at(-1);
  const stepIdx   = LOADING_STEPS.indexOf(step);
  const pct       = Math.min(95, (elapsed / 45) * 100); // fake progress cap at 95%

  return (
    <div className="animate-fade-in glass" style={{ borderRadius:20, padding:'44px 36px', textAlign:'center' }}>
      {/* Spinner */}
      <div style={{ position:'relative', width:72, height:72, margin:'0 auto 24px' }}>
        <svg width="72" height="72" viewBox="0 0 72 72" className="animate-spin-ring" style={{ position:'absolute', inset:0 }}>
          <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
          <circle cx="36" cy="36" r="30" fill="none" stroke="url(#spinGrad)" strokeWidth="5"
                  strokeLinecap="round" strokeDasharray="188.5" strokeDashoffset="47" />
          <defs>
            <linearGradient id="spinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:'0.75rem', color:'rgba(255,255,255,0.5)', fontWeight:600 }}>
          {Math.round(pct)}%
        </div>
      </div>

      <h3 style={{ fontSize:'1.1rem', fontWeight:600, color:'white', marginBottom:6 }}>{step.msg}</h3>

      {/* Step dots */}
      <div style={{ display:'flex', justifyContent:'center', gap:8, margin:'14px 0' }}>
        {LOADING_STEPS.slice(0, -1).map((_, i) => (
          <div key={i} style={{
            width: i === stepIdx ? 20 : 8, height:8, borderRadius:100,
            background: i <= stepIdx ? 'rgba(59,130,246,0.8)' : 'rgba(255,255,255,0.12)',
            transition:'all 0.4s ease',
          }} />
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ height:3, background:'rgba(255,255,255,0.07)', borderRadius:100, overflow:'hidden', margin:'14px 0 20px' }}>
        <div style={{ height:'100%', width:`${pct}%`, borderRadius:100,
                      background:'linear-gradient(90deg,#3b82f6,#8b5cf6)',
                      transition:'width 1s ease' }} />
      </div>

      {/* Timer */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                    color:'rgba(255,255,255,0.35)', fontSize:'0.82rem' }}>
        <Clock size={13} />
        Processing… {elapsed}s
      </div>

      <button onClick={onCancel} className="btn-ghost"
              style={{ marginTop:18, padding:'8px 20px', borderRadius:10, fontSize:'0.82rem', display:'inline-flex', alignItems:'center', gap:6 }}>
        <X size={13} /> Cancel Analysis
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESULTS SECTION
═══════════════════════════════════════════════════════════════════════════ */

function ResultsSection({ entry, animScore, animConf, onBack, onSave, isSaved }) {
  return (
    <div className="animate-fade-in">
      {/* Back */}
      <button onClick={onBack} style={{
        display:'flex', alignItems:'center', gap:8, background:'none', border:'none',
        cursor:'pointer', color:'rgba(255,255,255,0.38)', fontSize:'0.85rem',
        padding:'0 0 22px', fontFamily:'inherit', transition:'color 0.2s',
      }}
        onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.75)'}
        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.38)'}>
        <ArrowLeft size={16} /> Analyze another document
      </button>

      {/* TL;DR */}
      <div className="glass-blue animate-slide-up" style={{ borderRadius:'0 16px 16px 0', borderLeft:'3px solid rgba(96,165,250,0.65)', padding:'20px 24px', marginBottom:14, animationDelay:'0ms' }}>
        <div className="eyebrow" style={{ marginBottom:8, fontSize:'0.62rem' }}>TL;DR</div>
        <p style={{ color:'rgba(255,255,255,0.88)', fontSize:'1rem', lineHeight:1.7, margin:0 }}>{entry.tldr}</p>
      </div>

      {/* Risk + Confidence card */}
      <div className="glass animate-slide-up" style={{ borderRadius:20, padding:'30px 34px', marginBottom:14, animationDelay:'80ms' }}>
        <div className="section-label" style={{ marginBottom:22 }}>Consumer Risk Index</div>
        <div style={{ display:'flex', alignItems:'center', gap:32, flexWrap:'wrap' }}>
          <CircularProgress score={animScore} />
          <div style={{ flex:1, minWidth:180 }}>
            <div style={{ fontSize:'clamp(2rem,4.5vw,3.5rem)', fontWeight:900, letterSpacing:'-0.04em', lineHeight:1,
                          color:scoreColor(animScore), marginBottom:8, transition:'color 0.4s ease' }}>
              {riskLabel(animScore)}
            </div>
            <p style={{ color:'rgba(255,255,255,0.4)', fontSize:'0.875rem', lineHeight:1.65, marginBottom:20, maxWidth:240 }}>
              Scores <span style={{ color:'white', fontWeight:700 }}>{entry.risk_score}/100</span> on the consumer hostility index.
            </p>
            <ConfidenceBar confidence={animConf} />
          </div>
        </div>
      </div>

      {/* Red flags */}
      {(entry.red_flags || []).length > 0 ? (
        <div>
          <div className="section-label" style={{ margin:'24px 0 10px' }}>
            Identified Concerns &nbsp;·&nbsp; {entry.red_flags.length} Found
          </div>
          {entry.red_flags.map((f, i) => <RedFlagCard key={i} flag={f} index={i + 2} />)}
        </div>
      ) : (
        <div className="glass animate-slide-up" style={{ borderRadius:16, padding:44, textAlign:'center', animationDelay:'160ms' }}>
          <div style={{ color:'#10b981', marginBottom:10 }}><Check size={40} /></div>
          <div style={{ color:'white', fontWeight:600, marginBottom:6 }}>No major red flags detected</div>
          <div style={{ color:'rgba(255,255,255,0.38)', fontSize:'0.875rem' }}>This document appears relatively consumer-friendly.</div>
        </div>
      )}

      {/* Save + Export */}
      <div className="glass" style={{ borderRadius:16, padding:'20px 22px', marginTop:16 }}>
        {!isSaved ? (
          <button className="btn-primary" onClick={onSave}
                  style={{ padding:'10px 22px', borderRadius:10, fontSize:'0.875rem', marginBottom:entry.id ? 0 : 14 }}>
            Save to History
          </button>
        ) : (
          <div style={{ display:'flex', alignItems:'center', gap:6, color:'#34d399', fontSize:'0.875rem', marginBottom:14 }}>
            <Check size={15} /> Saved to history
          </div>
        )}
        <ExportShareBar entry={entry} />
      </div>

      <p style={{ textAlign:'center', color:'rgba(255,255,255,0.15)', fontSize:'0.7rem', lineHeight:1.6, padding:'28px 0' }}>
        AI-generated analysis · Not legal advice · Consult a qualified attorney for important decisions.
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   HISTORY TAB
═══════════════════════════════════════════════════════════════════════════ */

function HistoryItem({ entry, onView, onDelete, onSelectCompare, compareMode, isSelectedForCompare }) {
  const col = scoreColor(entry.risk_score);
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <div className="glass glass-hover" style={{
      borderRadius:14, padding:'16px 18px', marginBottom:10,
      border: isSelectedForCompare ? '1px solid rgba(59,130,246,0.5)' : '1px solid rgba(255,255,255,0.1)',
      boxShadow: isSelectedForCompare ? '0 0 0 2px rgba(59,130,246,0.25)' : 'none',
    }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'white', fontWeight:600, fontSize:'0.925rem', marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {entry.documentName}
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center' }}>
            <MiniScore score={entry.risk_score} size={40} />
            <div>
              <div style={{ color:col, fontWeight:700, fontSize:'0.8rem' }}>{riskLabel(entry.risk_score)} · {entry.risk_score}/100</div>
              <div style={{ color:'rgba(255,255,255,0.35)', fontSize:'0.72rem', marginTop:2 }}>
                {formatDate(entry.timestamp)} · {formatLen(entry.textLength)} · {entry.confidence}% confidence
              </div>
            </div>
          </div>
          <p style={{ color:'rgba(255,255,255,0.4)', fontSize:'0.78rem', lineHeight:1.55, marginTop:8,
                      display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
            {entry.tldr}
          </p>
        </div>
      </div>

      <div style={{ display:'flex', gap:6, marginTop:12, flexWrap:'wrap' }}>
        <button className="btn-ghost" style={{ padding:'7px 14px', borderRadius:8, fontSize:'0.78rem', display:'flex', alignItems:'center', gap:5 }}
                onClick={() => onView(entry)}>
          <Eye size={13} /> View
        </button>
        {compareMode ? (
          <button onClick={() => onSelectCompare(entry.id)}
                  style={{
                    padding:'7px 14px', borderRadius:8, fontSize:'0.78rem', border:'none', cursor:'pointer',
                    display:'flex', alignItems:'center', gap:5, fontFamily:'inherit',
                    background: isSelectedForCompare ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.06)',
                    color: isSelectedForCompare ? '#93c5fd' : 'rgba(255,255,255,0.6)',
                  }}>
            {isSelectedForCompare ? <><Check size={13}/> Selected</> : <><Columns2 size={13}/> Select</>}
          </button>
        ) : (
          <button className="btn-ghost" style={{ padding:'7px 14px', borderRadius:8, fontSize:'0.78rem', display:'flex', alignItems:'center', gap:5 }}
                  onClick={() => { onSelectCompare(entry.id); }}>
            <Columns2 size={13} /> Compare
          </button>
        )}
        {confirmDel ? (
          <>
            <button onClick={() => onDelete(entry.id)}
                    style={{ padding:'7px 14px', borderRadius:8, fontSize:'0.78rem', border:'1px solid rgba(220,38,38,0.4)', background:'rgba(220,38,38,0.15)', color:'#f87171', cursor:'pointer', fontFamily:'inherit' }}>
              Confirm Delete
            </button>
            <button className="btn-ghost" style={{ padding:'7px 10px', borderRadius:8, fontSize:'0.78rem' }}
                    onClick={() => setConfirmDel(false)}>
              <X size={13} />
            </button>
          </>
        ) : (
          <button className="btn-ghost" style={{ padding:'7px 10px', borderRadius:8, fontSize:'0.78rem', display:'flex', alignItems:'center' }}
                  onClick={() => setConfirmDel(true)}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function HistoryTab({ history, onView, onDelete, compareIds, onSelectCompare, compareMode, onClearHistory }) {
  const [search, setSearch] = useState('');
  const filtered = history.filter(h =>
    h.documentName.toLowerCase().includes(search.toLowerCase()) ||
    h.tldr.toLowerCase().includes(search.toLowerCase())
  );

  if (history.length === 0) {
    return (
      <div style={{ textAlign:'center', padding:'60px 20px' }}>
        <History size={48} style={{ color:'rgba(255,255,255,0.1)', margin:'0 auto 16px', display:'block' }} />
        <div style={{ color:'rgba(255,255,255,0.4)', fontSize:'1rem', fontWeight:500, marginBottom:6 }}>No analyses yet</div>
        <div style={{ color:'rgba(255,255,255,0.22)', fontSize:'0.875rem' }}>Analyze a document to start building your history.</div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display:'flex', gap:10, marginBottom:16, alignItems:'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
               placeholder="Search history..."
               style={{ flex:1, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)',
                        borderRadius:10, padding:'10px 14px', color:'white', fontFamily:'inherit',
                        fontSize:'0.875rem', outline:'none' }} />
        {history.length > 0 && (
          <button className="btn-ghost" style={{ padding:'10px 14px', borderRadius:10, fontSize:'0.78rem', display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap' }}
                  onClick={onClearHistory}>
            <RotateCcw size={13}/> Clear All
          </button>
        )}
      </div>

      {compareMode && (
        <div style={{ background:'rgba(59,130,246,0.1)', border:'1px solid rgba(59,130,246,0.25)', borderRadius:10,
                      padding:'10px 14px', marginBottom:14, fontSize:'0.82rem', color:'#93c5fd' }}>
          Select 2 documents to compare · {compareIds.filter(Boolean).length}/2 selected
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ color:'rgba(255,255,255,0.3)', textAlign:'center', padding:'40px 0', fontSize:'0.875rem' }}>No results match your search.</div>
      ) : (
        filtered.map(entry => (
          <HistoryItem key={entry.id} entry={entry}
                       onView={onView} onDelete={onDelete}
                       onSelectCompare={onSelectCompare}
                       compareMode={compareMode}
                       isSelectedForCompare={compareIds.includes(entry.id)} />
        ))
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPARE TAB
═══════════════════════════════════════════════════════════════════════════ */

function ComparePane({ entry, side }) {
  const col = scoreColor(entry.risk_score);
  return (
    <div style={{ flex:1, minWidth:0 }}>
      <div className="glass" style={{ borderRadius:14, padding:'16px 18px', marginBottom:12 }}>
        <div className="section-label" style={{ marginBottom:8 }}>Document {side}</div>
        <div style={{ color:'white', fontWeight:700, fontSize:'0.95rem', marginBottom:12, wordBreak:'break-word' }}>{entry.documentName}</div>
        <div style={{ display:'flex', gap:14, alignItems:'center', flexWrap:'wrap' }}>
          <CircularProgress score={entry.risk_score} size={90} />
          <div>
            <div style={{ color:col, fontWeight:800, fontSize:'1.4rem', letterSpacing:'-0.02em' }}>{riskLabel(entry.risk_score)}</div>
            <div style={{ color:'rgba(255,255,255,0.4)', fontSize:'0.78rem', marginTop:4 }}>{entry.risk_score}/100 · {entry.confidence}% conf.</div>
            <div style={{ color:'rgba(255,255,255,0.3)', fontSize:'0.72rem', marginTop:3 }}>{formatDate(entry.timestamp)}</div>
          </div>
        </div>
        <p style={{ color:'rgba(255,255,255,0.45)', fontSize:'0.8rem', lineHeight:1.6, marginTop:12 }}>{entry.tldr}</p>
      </div>
    </div>
  );
}

function CompareTab({ history, compareIds, onSelectCompare, onClearCompare, onView }) {
  const [a, b] = compareIds.map(id => history.find(h => h.id === id));

  if (history.length < 2) {
    return (
      <div style={{ textAlign:'center', padding:'60px 20px' }}>
        <Columns2 size={48} style={{ color:'rgba(255,255,255,0.1)', margin:'0 auto 16px', display:'block' }} />
        <div style={{ color:'rgba(255,255,255,0.4)', fontSize:'1rem', fontWeight:500, marginBottom:6 }}>Not enough analyses</div>
        <div style={{ color:'rgba(255,255,255,0.22)', fontSize:'0.875rem' }}>Analyze at least 2 documents to compare them.</div>
      </div>
    );
  }

  if (!a || !b) {
    return (
      <div className="animate-fade-in">
        <div style={{ color:'rgba(255,255,255,0.5)', fontSize:'0.875rem', marginBottom:16 }}>
          Select 2 documents from History to compare side-by-side. Use the <strong style={{ color:'rgba(255,255,255,0.7)' }}>Compare</strong> button on any history item.
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:10 }}>
          {history.map(entry => (
            <button key={entry.id} className="glass glass-hover"
                    onClick={() => onSelectCompare(entry.id)}
                    style={{
                      textAlign:'left', cursor:'pointer', border:'none', borderRadius:12,
                      padding:'14px 16px', fontFamily:'inherit',
                      borderColor: compareIds.includes(entry.id) ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)',
                      boxShadow: compareIds.includes(entry.id) ? '0 0 0 2px rgba(59,130,246,0.3)' : 'none',
                    }}>
              <div style={{ color:'white', fontWeight:600, fontSize:'0.875rem', marginBottom:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{entry.documentName}</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <MiniScore score={entry.risk_score} size={36}/>
                <span style={{ color:scoreColor(entry.risk_score), fontSize:'0.78rem', fontWeight:700 }}>{entry.risk_score}/100</span>
                {compareIds.includes(entry.id) && <Check size={14} color="#60a5fa"/>}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Both selected — show comparison
  const common   = findCommon(a.red_flags || [], b.red_flags || []);
  const onlyA    = (a.red_flags || []).filter(fa => !common.some(c => c.clause === fa.clause));
  const onlyB    = (b.red_flags || []).filter(fb => !common.some(c => c.clause === fb.clause));
  const winner   = a.risk_score <= b.risk_score ? 'A' : 'B';

  return (
    <div className="animate-fade-in">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div className="section-label">Side-by-Side Comparison</div>
        <button className="btn-ghost" onClick={onClearCompare}
                style={{ padding:'7px 12px', borderRadius:8, fontSize:'0.78rem', display:'flex', alignItems:'center', gap:5 }}>
          <X size={13}/> Clear
        </button>
      </div>

      {/* Score summary banner */}
      <div className="glass" style={{ borderRadius:14, padding:'14px 18px', marginBottom:16,
                                       border:`1px solid ${winner==='A' ? 'rgba(16,185,129,0.3)' : 'rgba(220,38,38,0.2)'}` }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ color:'rgba(255,255,255,0.5)', fontSize:'0.82rem' }}>
            Score difference: <strong style={{ color:'white' }}>{Math.abs(a.risk_score - b.risk_score)} pts</strong>
          </span>
          <span style={{ color:'#34d399', fontSize:'0.82rem', fontWeight:600 }}>
            Document {winner} is safer ({winner === 'A' ? a.risk_score : b.risk_score}/100)
          </span>
        </div>
      </div>

      {/* Side-by-side headers */}
      <div style={{ display:'flex', gap:12, marginBottom:16 }}>
        <ComparePane entry={a} side="A" />
        <ComparePane entry={b} side="B" />
      </div>

      {/* Common concerns */}
      {common.length > 0 && (
        <div className="glass" style={{ borderRadius:14, padding:'16px 18px', marginBottom:12 }}>
          <div style={{ color:'#fbbf24', fontWeight:700, fontSize:'0.78rem', letterSpacing:'0.1em', marginBottom:10 }}>
            SHARED CONCERNS ({common.length})
          </div>
          {common.map((f, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              <SeverityChip severity={f.severity} />
              <span style={{ color:'rgba(255,255,255,0.7)', fontSize:'0.85rem' }}>{f.clause}</span>
            </div>
          ))}
        </div>
      )}

      {/* Unique to each */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        {[{ label:'Only in A', flags:onlyA, col:'rgba(96,165,250,0.7)' }, { label:'Only in B', flags:onlyB, col:'rgba(167,139,250,0.7)' }].map(({ label, flags, col }) => (
          flags.length > 0 && (
            <div key={label} className="glass" style={{ flex:1, minWidth:180, borderRadius:14, padding:'14px 16px' }}>
              <div style={{ color:col, fontWeight:700, fontSize:'0.75rem', letterSpacing:'0.1em', marginBottom:8 }}>{label.toUpperCase()}</div>
              {flags.map((f, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
                  <SeverityChip severity={f.severity} />
                  <span style={{ color:'rgba(255,255,255,0.65)', fontSize:'0.82rem' }}>{f.clause}</span>
                </div>
              ))}
            </div>
          )
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSIS TAB
═══════════════════════════════════════════════════════════════════════════ */

function AnalysisTab({ text, setText, docName, setDocName, loading, elapsed, result, error, confidence,
                       animScore, animConf, onAnalyze, onCancel, onBack, onSave, savedId }) {
  if (loading) return <LoadingView elapsed={elapsed} onCancel={onCancel} />;

  if (result) {
    const entry = { ...result, documentName: docName || 'Untitled Document', confidence, textLength: text.length, timestamp: new Date().toISOString(), id: savedId || genId() };
    return <ResultsSection entry={entry} animScore={animScore} animConf={animConf} onBack={onBack}
                            onSave={onSave} isSaved={!!savedId} />;
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
        <div className="eyebrow" style={{ marginBottom:14 }}>Consumer Protection Toolkit</div>
        <h1 style={{ fontSize:'clamp(3rem,8.5vw,5.2rem)', fontWeight:900, letterSpacing:'-0.045em', lineHeight:1.03, margin:'0 0 18px' }}>
          <span style={{ background:'linear-gradient(135deg,#60a5fa 0%,#a78bfa 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>Fine</span>
          <span style={{ color:'#f1f5f9' }}>Print</span>
        </h1>
        <p style={{ fontSize:'1rem', color:'rgba(255,255,255,0.42)', maxWidth:420, margin:'0 auto', lineHeight:1.7 }}>
          AI-powered legal risk detection. Know what you're agreeing to before you click <em style={{ color:'rgba(255,255,255,0.6)', fontStyle:'normal', fontWeight:500 }}>Accept</em>.
        </p>
      </div>

      {/* Input card */}
      <div className="glass" style={{ borderRadius:20, padding:'22px 24px', marginBottom:12 }}>
        <input value={docName} onChange={e => setDocName(e.target.value)}
               placeholder="Document name (optional)..."
               style={{ width:'100%', background:'transparent', border:'none', borderBottom:'1px solid rgba(255,255,255,0.08)',
                        color:'rgba(255,255,255,0.7)', fontFamily:'inherit', fontSize:'0.82rem',
                        padding:'0 0 10px', marginBottom:14, outline:'none' }} />
        <textarea value={text} onChange={e => setText(e.target.value)}
                  placeholder="Copy and paste entire Terms of Service, Privacy Policy, or any legal document here..."
                  style={{ minHeight:210 }} />
        {text.length > 0 && (
          <div style={{ marginTop:8, fontSize:'0.7rem', color:'rgba(255,255,255,0.25)', textAlign:'right' }}>
            {text.length.toLocaleString()} characters
          </div>
        )}
      </div>

      {/* Button */}
      <div style={{ display:'flex', justifyContent:'center', marginBottom:14 }}>
        <button onClick={onAnalyze} disabled={!text.trim()} className="btn-primary"
                style={{ padding:'14px 52px', borderRadius:100, fontSize:'0.95rem' }}>
          Uncover the Truth
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background:'rgba(220,38,38,0.1)', border:'1px solid rgba(220,38,38,0.3)', borderRadius:12,
                      padding:'14px 18px', marginBottom:14, color:'#fca5a5', fontSize:'0.875rem', display:'flex', gap:10, alignItems:'flex-start' }}>
          <AlertCircle size={16} style={{ flexShrink:0, marginTop:1 }} /> {error}
        </div>
      )}

      {/* Feature cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, marginTop:26 }}>
        {[
          { Icon:Shield,   title:'Risk Scoring',    desc:'Quantified consumer hostility index 0–100' },
          { Icon:Eye,      title:'Hidden Clauses',  desc:'AI surfaces what the fine print buries' },
          { Icon:Zap,      title:'Instant Results', desc:'Full legal breakdown in seconds' },
        ].map(({ Icon, title, desc }) => (
          <div key={title} className="glass glass-hover" style={{ borderRadius:14, padding:'18px 16px', textAlign:'center' }}>
            <div style={{ color:'rgba(147,197,253,0.75)', width:28, height:28, margin:'0 auto 10px' }}><Icon size={28} strokeWidth={1.4}/></div>
            <div style={{ color:'rgba(255,255,255,0.8)', fontSize:'0.78rem', fontWeight:600, marginBottom:4 }}>{title}</div>
            <div style={{ color:'rgba(255,255,255,0.35)', fontSize:'0.72rem', lineHeight:1.45 }}>{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════════════════════════ */

export default function App() {
  // ── Tab state ──
  const [activeTab, setActiveTab] = useState('analysis');

  // ── Analysis state ──
  const [text,          setText        ] = useState('');
  const [docName,       setDocName     ] = useState('');
  const [loading,       setLoading     ] = useState(false);
  const [elapsed,       setElapsed     ] = useState(0);
  const [result,        setResult      ] = useState(null);
  const [error,         setError       ] = useState(null);
  const [confidence,    setConfidence  ] = useState(0);
  const [animScore,     setAnimScore   ] = useState(0);
  const [animConf,      setAnimConf    ] = useState(0);
  const [savedId,       setSavedId     ] = useState(null);

  // ── History ──
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fineprint-history') || '[]'); }
    catch { return []; }
  });

  // ── Compare ──
  const [compareIds,    setCompareIds  ] = useState([null, null]);
  const [compareMode,   setCompareMode ] = useState(false);

  const abortRef = useRef(null);

  // Persist history
  useEffect(() => {
    localStorage.setItem('fineprint-history', JSON.stringify(history));
  }, [history]);

  // Score animation
  useEffect(() => {
    if (!result) return;
    const targetScore = result.risk_score;
    const targetConf  = confidence;
    const dur = 700, fps = 60;
    const frames = Math.round((dur / 1000) * fps);
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      const t = frame / frames;
      const e = 1 - Math.pow(1 - t, 3);
      setAnimScore(Math.min(Math.round(targetScore * e), targetScore));
      setAnimConf(Math.min(Math.round(targetConf * e), targetConf));
      if (frame >= frames) clearInterval(id);
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [result, confidence]);

  // Elapsed timer
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // ── Analyze ──
  const analyze = useCallback(async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setError(null);
    setAnimScore(0);
    setAnimConf(0);
    setSavedId(null);
    abortRef.current = new AbortController();

    try {
      const res  = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: abortRef.current.signal,
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        const conf = calculateConfidence(data, text.length);
        setConfidence(conf);
        setResult(data);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError('Cannot reach the analysis server. Make sure api.py is running on http://localhost:5000.');
      }
    } finally {
      setLoading(false);
    }
  }, [text, loading]);

  const cancelAnalysis = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const goBack = () => {
    setResult(null);
    setAnimScore(0);
    setAnimConf(0);
    setSavedId(null);
  };

  // ── History ops ──
  const saveToHistory = useCallback(() => {
    if (!result) return;
    const id = genId();
    const entry = {
      id,
      timestamp:    new Date().toISOString(),
      documentName: docName.trim() || `Document ${history.length + 1}`,
      textLength:   text.length,
      confidence,
      ...result,
    };
    setHistory(prev => [entry, ...prev].slice(0, 50));
    setSavedId(id);
  }, [result, docName, text.length, confidence, history.length]);

  const deleteFromHistory = (id) => {
    setHistory(prev => prev.filter(h => h.id !== id));
    setCompareIds(prev => prev.map(cid => cid === id ? null : cid));
  };

  const viewFromHistory = (entry) => {
    const conf = entry.confidence ?? calculateConfidence(entry, entry.textLength);
    setConfidence(conf);
    setResult(entry);
    setSavedId(entry.id);
    setDocName(entry.documentName);
    setActiveTab('analysis');
  };

  const clearHistory = () => {
    setHistory([]);
    setCompareIds([null, null]);
  };

  // ── Compare ops ──
  const handleSelectCompare = (id) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.map(c => c === id ? null : c);
      if (!prev[0]) return [id, prev[1]];
      if (!prev[1]) return [prev[0], id];
      return [id, null]; // reset and start fresh
    });
    setCompareMode(true);
  };

  const clearCompare = () => {
    setCompareIds([null, null]);
    setCompareMode(false);
  };

  return (
    <div style={{ minHeight:'100vh', background:'#0f0f23' }}>
      <DiagonalBackground />
      <FloatingIcons />

      <main style={{ position:'relative', zIndex:10, maxWidth:780, margin:'0 auto', padding:'56px 20px 90px' }}>
        <TabNav active={activeTab} setActive={setActiveTab} historyCount={history.length} />

        {activeTab === 'analysis' && (
          <AnalysisTab
            text={text}           setText={setText}
            docName={docName}     setDocName={setDocName}
            loading={loading}     elapsed={elapsed}
            result={result}       error={error}
            confidence={confidence}
            animScore={animScore} animConf={animConf}
            onAnalyze={analyze}   onCancel={cancelAnalysis}
            onBack={goBack}       onSave={saveToHistory}
            savedId={savedId}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            history={history}
            onView={viewFromHistory}
            onDelete={deleteFromHistory}
            compareIds={compareIds}
            onSelectCompare={(id) => { handleSelectCompare(id); setActiveTab('compare'); }}
            compareMode={compareMode}
            onClearHistory={clearHistory}
          />
        )}

        {activeTab === 'compare' && (
          <CompareTab
            history={history}
            compareIds={compareIds}
            onSelectCompare={handleSelectCompare}
            onClearCompare={clearCompare}
            onView={viewFromHistory}
          />
        )}
      </main>
    </div>
  );
}
