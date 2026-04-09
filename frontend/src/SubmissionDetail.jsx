// src/SubmissionDetail.jsx
// View a submitted KPI sheet — mirrors the table structure of SubmissionForm.jsx
// Shows all KPI tables in read-only, with live-recalculated scores.
//
// ══════════════════════════════════════════════════════════════
// SCORING SYNC — updated to match SubmissionForm.jsx audit fixes
// [FIX 1] Publications use tiered calcPubPoints() (patents included)
// [FIX 2] Grants: step-based 2+(amount-10K)/5K, cap 40 for AP12
// [FIX 3] Sec 14+15 share combined cap (20 AP12 / 25 AP3)
// [FIX 4] Pass %: step-based calcPassMarks (81%=2M, every 0.5%=+1)
// [FIX 5] Feedback: step-based calcFbMarks (3.1=2M, every 0.1=+2)
// Theme: Light mode matching SubmissionForm.jsx (#1a7f4f green accents)
// ══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import SubmissionForm from "./SubmissionForm";

/* ══════════════════════════════════════════════════════════════
   PURE HELPERS
══════════════════════════════════════════════════════════════ */
const _clamp   = (v, a, b) => Math.max(a, Math.min(b, v));
const _toInt   = (v) => { const n = parseInt(v, 10);  return Number.isFinite(n) ? n : 0; };
const _toFloat = (v) => { const n = parseFloat(v);    return Number.isFinite(n) ? n : 0; };

function getRankType(rank) {
  const r = (rank || "").toUpperCase();
  if (r.includes("HOD") || r.includes("PG COORDINATOR")) return "HOD";
  if (r.includes("CFRD"))                                  return "CFRD";
  if (r.includes("PHYSICAL"))                              return "PE";
  if (r.includes("NON-TEACHING") && r.includes("LAB"))    return "NTL";
  if (r.includes("NON-TEACHING"))                          return "NTP";
  if (r.includes("AP III") || r.includes("AP (III)"))     return "AP3";
  if (r.includes("ASP") || r.includes("PROF"))            return "ASP";
  return "AP12";
}

/* [FIX 4] Pass % step-based: 81%=2M, 81.5%=3M … ≥95%=30M */
function calcPassMarks(passPercent, passMax) {
  if (passPercent < 81) return 0;
  return _clamp(Math.round((passPercent - 81) / 0.5) + 2, 0, passMax);
}

/* [FIX 5] Feedback step-based: 3.1=2M, 3.2=4M … ≥4.5=30M */
function calcFbMarks(fb, fbMax) {
  if (fb < 3.1) return 0;
  return _clamp(Math.round(((fb - 3.1) / 0.1)) * 2 + 2, 0, fbMax);
}

/* [FIX 2] Grant amount step-based: 10K=2M, every ₹5K=+1M */
function calcGrantAmountMarks(amount, max) {
  if (amount < 10000) return 0;
  return _clamp(Math.round(2 + (amount - 10000) / 5000), 0, max);
}

/* [FIX 1] Tiered publication scoring — patents included */
function calcPubPoints(pubRows) {
  return (pubRows || []).reduce((total, r) => {
    if (!r.title && !r.journal) return total;
    const idx = (r.indexing || "").toUpperCase();
    const IF  = _toFloat(r.impactFactor);
    let pts = 0;
    if      (idx.includes("SCI") && (idx.includes("Q3") || idx.includes("Q4"))) pts = 20;
    else if (idx.includes("SCI"))                                                  pts = 25;
    else if (idx.includes("WOS") || idx.includes("WEB OF"))                       pts = 15;
    else if (idx.includes("SCOPUS"))                                               pts = 15;
    else if (idx.includes("CONFERENCE"))                                           pts = 10;
    else if (idx.includes("BOOK-INT") || idx === "BOOK-INTERNATIONAL")            pts = 50;
    else if (idx.includes("BOOK-NAT") || idx === "BOOK-NATIONAL")                 pts = 30;
    else if (idx.includes("EDITED"))                                               pts = 20;
    else if (idx.includes("CHAPTER"))                                              pts = 15;
    else if (idx.includes("PATENT") && idx.includes("GRANT"))                     pts = 30;
    else if (idx.includes("PATENT"))                                               pts = 10;
    else if (idx.includes("UGC"))                                                  pts = 10;
    else pts = (r.title || r.journal) ? 15 : 0;
    if (IF > 5) pts += 5;
    return total + pts;
  }, 0);
}

function pubRowPtsLabel(r) {
  if (!r.title && !r.journal) return "—";
  const idx = (r.indexing || "").toUpperCase();
  const IF = _toFloat(r.impactFactor);
  let p = 0;
  if      (idx.includes("SCI") && (idx.includes("Q3") || idx.includes("Q4"))) p = 20;
  else if (idx.includes("SCI"))                                                  p = 25;
  else if (idx.includes("WOS") || idx.includes("WEB OF"))                       p = 15;
  else if (idx.includes("SCOPUS"))                                               p = 15;
  else if (idx.includes("CONFERENCE"))                                           p = 10;
  else if (idx.includes("BOOK-INT") || idx === "BOOK-INTERNATIONAL")            p = 50;
  else if (idx.includes("BOOK-NAT") || idx === "BOOK-NATIONAL")                 p = 30;
  else if (idx.includes("EDITED"))                                               p = 20;
  else if (idx.includes("CHAPTER"))                                              p = 15;
  else if (idx.includes("PATENT") && idx.includes("GRANT"))                     p = 30;
  else if (idx.includes("PATENT"))                                               p = 10;
  else if (idx.includes("UGC"))                                                  p = 10;
  else p = (r.title || r.journal) ? 15 : 0;
  if (IF > 5) p += 5;
  return <strong style={{ color: "#1a7f4f" }}>{p}</strong>;
}

function fdpDaysFromRows(rows, mode) {
  return (rows || [])
    .filter((r) => r.mode === mode || (mode === "Physical" && r.mode === "F2F"))
    .reduce((s, r) => {
      const f = r.from ? new Date(r.from) : null;
      const t = r.to   ? new Date(r.to)   : null;
      return s + (f && t && !isNaN(f) && !isNaN(t) && t >= f
        ? Math.round((t - f) / 86400000) + 1 : 1);
    }, 0);
}

/* ══════════════════════════════════════════════════════════════
   SCORE CALCULATOR
══════════════════════════════════════════════════════════════ */
function calcScore(rankType, inp) {
  const {
    passPercent, studentFeedback, onlineVideos, sdgActivities, vacHours,
    pubRows, citations, kprietCitations, consultancyRevenue,
    sponsoredGrantsCount, sponsoredGrantsAmount,
    researchVisits, membershipsCount,
    fdpDaysPhys, fdpDaysOnline, mooc4w, mandatoryCourses,
    convenerDays, convenerOnlineDays, guestHours, committeeEvents,
    eventsA, eventsB, eventsC,
    headCount, memberCount,
    outreachActivities, resourceOutsideHours, resourceInsideHours,
    trainingDays, awardsCount, editorialCount, reviewsCount,
  } = inp;

  let MAXS, passMax, fbMax, pubMax, citMax, consultMax,
      grantsProposalMax, grantsAmountMax, grantsCombinedMax,
      visitMax, fdpMax, convenerEventsMax, respMax, communityMax, trainingMax;

  if (rankType === "AP3") {
    MAXS = { academic:125, research:225, admin:75, outreach:75 };
    passMax=20; fbMax=20; pubMax=80; citMax=20;
    consultMax=25; grantsProposalMax=40; grantsAmountMax=10; grantsCombinedMax=50;
    visitMax=15; fdpMax=15; convenerEventsMax=25; respMax=35; communityMax=15; trainingMax=20;
  } else if (rankType === "ASP") {
    MAXS = { academic:150, research:200, admin:50, outreach:100 };
    passMax=30; fbMax=30; pubMax=75; citMax=15;
    consultMax=20; grantsProposalMax=15; grantsAmountMax=40; grantsCombinedMax=40;
    visitMax=10; fdpMax=20; convenerEventsMax=30; respMax=30; communityMax=30; trainingMax=30;
  } else {
    // AP12, HOD, CFRD, PE, NT variants
    MAXS = { academic:150, research:200, admin:50, outreach:100 };
    passMax=30; fbMax=30; pubMax=75; citMax=15;
    consultMax=20; grantsProposalMax=15; grantsAmountMax=40; grantsCombinedMax=40;
    visitMax=10; fdpMax=20; convenerEventsMax=20; respMax=30; communityMax=30; trainingMax=30;
  }

  // A: Academic
  const passMarks   = calcPassMarks(passPercent, passMax);
  const fbMarks     = calcFbMarks(studentFeedback, fbMax);
  const videosMarks = _clamp(10 * onlineVideos,  0, 30);
  const sdgMarks    = _clamp(4  * sdgActivities, 0, 30);
  const vacMarks    = _clamp(1  * vacHours,       0, 9999);
  const academicTotal = _clamp(passMarks + fbMarks + videosMarks + sdgMarks + vacMarks, 0, MAXS.academic);

  // B: Research
  const rawPubPts        = calcPubPoints(pubRows);
  const pubsMarks        = _clamp(rawPubPts, 0, pubMax);
  const cit7aRaw         = (rankType === "AP3" ? 0.5 : 1) * citations;
  const cit7bRaw         = 0.5 * kprietCitations;
  const citationsMarks   = _clamp(cit7aRaw + cit7bRaw, 0, citMax);
  const consultancyMarks = _clamp(consultancyRevenue > 0 ? (consultancyRevenue / 200000) * consultMax : 0, 0, consultMax);
  const proposalsMarks   = _clamp(5 * sponsoredGrantsCount, 0, grantsProposalMax);
  const grantsAmountMarks = calcGrantAmountMarks(sponsoredGrantsAmount, grantsAmountMax);
  const sponsoredCombined = _clamp(proposalsMarks + grantsAmountMarks, 0, grantsCombinedMax);
  const researchVisitsMarks = _clamp(10 * researchVisits, 0, visitMax);
  const membershipsMarks    = _clamp(10 * membershipsCount, 0, 10);
  const fdpMarks            = _clamp(1 * fdpDaysPhys + 0.5 * fdpDaysOnline + 4 * mooc4w, 0, fdpMax);
  const mandatoryMarks      = _clamp(10 * mandatoryCourses, 0, 10);
  const researchTotal = _clamp(
    pubsMarks + citationsMarks + consultancyMarks + sponsoredCombined +
    researchVisitsMarks + membershipsMarks + fdpMarks + mandatoryMarks, 0, MAXS.research);

  // C: Admin — [FIX 3] combined cap for 14+15
  const convenerRaw = 3*convenerDays + 2*convenerOnlineDays + 2*guestHours + 1*committeeEvents;
  const eventsRaw   = 3*eventsA + 2*eventsB + 1*eventsC;
  const convenerEventsMarks = _clamp(convenerRaw + eventsRaw, 0, convenerEventsMax);
  const respMarks   = _clamp(10 * headCount + 5 * memberCount, 0, respMax);
  const adminTotal  = _clamp(convenerEventsMarks + respMarks, 0, MAXS.admin);

  // D: Outreach
  const communityMarks   = _clamp(10 * outreachActivities, 0, communityMax);
  const resourceMarks    = _clamp(3 * resourceOutsideHours + 2 * resourceInsideHours, 0, 20);
  const trainingMarks    = _clamp((trainingDays / 14) * trainingMax, 0, trainingMax);
  const awardsMarks      = _clamp(5 * awardsCount, 0, 20);
  const recognitionMarks = _clamp(4 * editorialCount + 1 * reviewsCount, 0, 20);
  const awardsTotal      = _clamp(awardsMarks + recognitionMarks, 0, 20);
  const outreachTotal    = _clamp(communityMarks + resourceMarks + trainingMarks + awardsTotal, 0, MAXS.outreach);

  const grandTotal = Math.round(academicTotal + researchTotal + adminTotal + outreachTotal);

  return {
    perRow: {
      academic: { passMarks, fbMarks, videosMarks, sdgMarks, vacMarks },
      research: { pubsMarks, citationsMarks, consultancyMarks, proposalsMarks, grantsAmountMarks, sponsoredCombined, researchVisitsMarks, membershipsMarks, fdpMarks, mandatoryMarks },
      admin:    { convenerEventsMarks, respMarks },
      outreach: { communityMarks, resourceMarks, trainingMarks, awardsTotal },
    },
    totals: {
      academic: Math.round(academicTotal),
      research: Math.round(researchTotal),
      admin:    Math.round(adminTotal),
      outreach: Math.round(outreachTotal),
      total:    grandTotal,
    },
    MAXS,
  };
}

/* ══════════════════════════════════════════════════════════════
   READ-ONLY TABLE
══════════════════════════════════════════════════════════════ */
function ROTable({ columns, rows, emptyLabel = "No entries recorded." }) {
  if (!rows || rows.length === 0) return <div className="sd-empty">{emptyLabel}</div>;
  return (
    <div className="sd-table-wrap">
      <table className="sd-table">
        <thead><tr>{columns.map((c) => (
          <th key={c.key} style={{ width: c.width, textAlign: c.align || "left" }}>{c.label}</th>
        ))}</tr></thead>
        <tbody>{rows.map((row, i) => (
          <tr key={i}>{columns.map((c) => (
            <td key={c.key} style={{ textAlign: c.align || "left" }}>
              {c.compute ? c.compute(row) : (row[c.key] ?? "—")}
            </td>
          ))}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   KPI SECTION
══════════════════════════════════════════════════════════════ */
function SDSection({ number, title, rubric, max, score, note, children }) {
  const [open, setOpen] = useState(true);
  const hasScore = score > 0;
  return (
    <div className="kpi-section">
      <div className="kpi-section-header" onClick={() => setOpen((v) => !v)}>
        <div className="kpi-section-left">
          <span className="kpi-num">{number}</span>
          <div>
            <div className="kpi-title">{title}</div>
            {rubric && <div className="kpi-rubric">{rubric}</div>}
          </div>
        </div>
        <div className="kpi-section-right">
          <div className="sd-max-lbl">Max <strong>{max}</strong></div>
          {max > 0 && (
            <div className="kpi-badge" style={{
              background: hasScore ? "#e8f5ee" : "#f0f4f8",
              color:      hasScore ? "#1a7f4f" : "#a0aec0",
              border:     hasScore ? "1px solid #b2dfcc" : "1px solid #e2e8f0",
            }}>{score}</div>
          )}
          <span className="sd-chev">{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <div className="kpi-section-body">
          {note && <div className="sd-note">{note}</div>}
          {children}
        </div>
      )}
    </div>
  );
}

/* Section total bar */
function SecTotal({ label, max, value, isGrand }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`section-total${isGrand ? " grand" : ""}`}>
      <div className="st-left">{label}</div>
      <div className="st-right">
        <div className="st-bar-wrap">
          <div className="st-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="st-score">
          <span className="st-val">{value}</span>
          <span className="st-max"> / {max}</span>
        </div>
      </div>
    </div>
  );
}

function SBH({ text }) {
  return <div className="section-block-header">{text}</div>;
}

/* Score strip */
function ScoreStrip({ computed, MAXS }) {
  const gt = computed.totals.total;
  const bandColor = gt >= 400 ? "#1a7f4f" : gt >= 300 ? "#1976d2" : gt >= 200 ? "#e65100" : gt >= 100 ? "#880e4f" : "#b71c1c";
  const bandBg    = gt >= 400 ? "#e8f5ee" : gt >= 300 ? "#e3f2fd" : gt >= 200 ? "#fff8e1" : gt >= 100 ? "#fce4ec" : "#ffebee";
  const bandLabel = gt >= 400 ? "Good Performance" : gt >= 300 ? "Has Potential & Need to Work Smart" : gt >= 200 ? "Needs to Improve the Focus" : gt >= 100 ? "Needs Significant Improvement" : "Lacks Commitment";
  const chips = [
    { label: "Academic",  val: computed.totals.academic,  max: MAXS.academic  },
    { label: "Research",  val: computed.totals.research,  max: MAXS.research  },
    { label: "Admin",     val: computed.totals.admin,     max: MAXS.admin     },
    { label: "Outreach",  val: computed.totals.outreach,  max: MAXS.outreach  },
  ];
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="sd-strip">
        {chips.map((c) => (
          <div key={c.label} className="sd-chip">
            <div className="sc-label">{c.label}</div>
            <div className="sc-val">{c.val}<span className="sc-max">/{c.max}</span></div>
            <div className="sc-bar-bg"><div className="sc-bar-fill" style={{ width: `${Math.min(100,(c.val/c.max)*100)}%` }} /></div>
          </div>
        ))}
        <div className="sd-chip grand">
          <div className="sc-label">Grand Total</div>
          <div className="sc-val" style={{ color: bandColor }}>{gt}<span className="sc-max">/500</span></div>
          <div className="sc-bar-bg"><div className="sc-bar-fill" style={{ width: `${Math.min(100,(gt/500)*100)}%`, background: bandColor }} /></div>
        </div>
      </div>
      {gt > 0 && (
        <div className="perf-band" style={{ background: bandBg, borderColor: bandColor }}>
          <span className="perf-label">Performance Band:</span>
          <span className="perf-value" style={{ color: bandColor }}>{bandLabel}</span>
          <span className="perf-score">{gt} pts</span>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function SubmissionDetail({ apiBase = "http://127.0.0.1:8000", id, onClose, onUpdated }) {
  const [submission,    setSubmission]    = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [userRole,      setUserRole]      = useState("faculty");
  const [currentUserId, setCurrentUserId] = useState(null);
  const [showEdit,      setShowEdit]      = useState(false);
  const token = localStorage.getItem("token");
  const HIGHER_ROLES = new Set(["hod","director","registrar","office_head","admin"]);

  useEffect(() => {
    if (!token) return;
    fetch(`${apiBase.replace(/\/$/,"")}/api/users/me`, { headers: { Authorization: "Bearer " + token } })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!d) return; if (d.role) setUserRole(String(d.role).toLowerCase()); setCurrentUserId(d._id ?? d.id ?? d.email ?? null); })
      .catch(() => {});
  }, [token, apiBase]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`${apiBase.replace(/\/$/,"")}/api/submissions/${encodeURIComponent(id)}`, { headers: token ? { Authorization: "Bearer " + token } : {} })
      .then(async (r) => {
        if (!r.ok) { const txt = await r.text(); let b = {}; try { b = JSON.parse(txt); } catch (_) { b = { detail: txt }; } throw new Error(b.detail || `HTTP ${r.status}`); }
        return r.json();
      })
      .then(setSubmission)
      .catch((e) => setSubmission({ error: e.message }))
      .finally(() => setLoading(false));
  }, [id, token, apiBase]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase.replace(/\/$/,"")}/api/submissions/${encodeURIComponent(id)}`, { headers: token ? { Authorization: "Bearer " + token } : {} });
      if (r.ok) setSubmission(await r.json());
    } catch (_) {}
    setLoading(false);
  }

  async function verify(action) {
    if (!HIGHER_ROLES.has(userRole)) { alert("Not authorized."); return; }
    if (!window.confirm(`Confirm ${action}?`)) return;
    const comments = window.prompt("Optional comments", "") || "";
    const fd = new FormData(); fd.append("action", action); if (comments) fd.append("comments", comments);
    try {
      const r = await fetch(`${apiBase.replace(/\/$/,"")}/api/submissions/${encodeURIComponent(id)}/verify`, { method: "PATCH", headers: token ? { Authorization: "Bearer " + token } : {}, body: fd });
      const body = await r.json();
      if (!r.ok) throw new Error(body.detail || JSON.stringify(body));
      await refresh(); if (onUpdated) onUpdated();
    } catch (e) { alert("Error: " + e.message); }
  }

  async function downloadPDF() {
    try {
      const r = await fetch(`${apiBase.replace(/\/$/,"")}/api/submissions/${encodeURIComponent(id)}/kpi-pdf`, { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) throw new Error("PDF download failed");
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "kpi-report.pdf";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
  }

  function isOwner() {
    if (!submission || !currentUserId) return false;
    return [submission.faculty_user_id, submission.faculty_id, submission.faculty_user?._id, submission.faculty_user?.id, submission.user_id, submission.user?._id]
      .some((c) => c && String(c) === String(currentUserId));
  }
  function canEdit() {
    if (!submission) return false;
    if (["rejected","finalized"].includes(String(submission.status).toLowerCase())) return false;
    return isOwner() || HIGHER_ROLES.has(userRole);
  }

  const s = submission || {};
  const eseCourses      = s.ese_courses          || [];
  const feedbackCourses = s.feedback_courses      || [];
  const videoRows       = s.video_rows            || [];
  const sdgRows         = s.sdg_rows              || [];
  const vacRows         = s.vac_rows              || [];
  const achievementRows = s.achievement_rows      || [];
  const pubRows         = s.pub_rows              || [];
  const citationRows    = s.citation_rows         || [];
  const kprietCitRows   = s.kpriet_citation_rows  || [];
  const consultancyRows = s.consultancy_rows      || [];
  const grantRows       = s.grant_rows            || [];
  const visitRows       = s.visit_rows            || [];
  const membershipRows  = s.membership_rows       || [];
  const fdpRows         = s.fdp_rows              || [];
  const mandatoryRows   = s.mandatory_rows        || [];
  const eventRows       = s.event_rows            || [];
  const respRows        = s.resp_rows             || [];
  const communityRows   = s.community_rows        || [];
  const resourceRows    = s.resource_rows         || [];
  const trainingRows    = s.training_rows         || [];
  const awardRows       = s.award_rows            || [];
  const recognitionRows = s.recognition_rows      || [];

  const rankType = useMemo(() => getRankType(s.faculty_rank || ""), [s.faculty_rank]);
  const isAPIII  = rankType === "AP3";

  const passPercent = useMemo(() => {
    const v = eseCourses.filter((r) => r.appeared !== "" && r.passed !== "");
    if (!v.length) return _toFloat(s.academic?.pass_percent || 0);
    return Math.round((v.reduce((acc, r) => { const a = _toFloat(r.appeared), p = _toFloat(r.passed); return acc + (a > 0 ? (p/a)*100 : 0); }, 0) / v.length) * 10) / 10;
  }, [eseCourses, s.academic]);

  const studentFeedback = useMemo(() => {
    const v = feedbackCourses.filter((r) => r.feedback !== "");
    if (!v.length) return _toFloat(s.academic?.student_feedback || 0);
    return Math.round((v.reduce((acc, r) => acc + _toFloat(r.feedback), 0) / v.length) * 10) / 10;
  }, [feedbackCourses, s.academic]);

  const onlineVideos     = useMemo(() => videoRows.filter((r) => r.title || r.link).length || _toInt(s.academic?.online_videos), [videoRows, s.academic]);
  const sdgActivities    = useMemo(() => sdgRows.filter((r) => r.topic || r.method).length || _toInt(s.academic?.sdg_activities), [sdgRows, s.academic]);
  const vacHours         = useMemo(() => vacRows.reduce((a, r) => a + _toFloat(r.hours), 0) || _toInt(s.academic?.vac_hours), [vacRows, s.academic]);
  const citations        = useMemo(() => citationRows.reduce((a, r) => a + _toInt(r.citations), 0) || _toInt(s.research?.citations), [citationRows, s.research]);
  const kprietCitations  = useMemo(() => kprietCitRows.reduce((a, r) => a + _toInt(r.cited), 0) || _toInt(s.research?.kpriet_citations), [kprietCitRows, s.research]);
  const consultancyRevenue    = useMemo(() => consultancyRows.reduce((a, r) => a + _toFloat(r.amount), 0) || _toFloat(s.research?.consultancy_revenue), [consultancyRows, s.research]);
  const sponsoredGrantsCount  = useMemo(() => grantRows.filter((r) => r.title).length || _toInt(s.research?.sponsored_grants_count), [grantRows, s.research]);
  const sponsoredGrantsAmount = useMemo(() => grantRows.reduce((a, r) => a + _toFloat(r.amount), 0) || _toFloat(s.research?.sponsored_grants_amount), [grantRows, s.research]);
  const researchVisits        = useMemo(() => visitRows.filter((r) => r.lab).length || _toInt(s.research?.research_visits), [visitRows, s.research]);
  const membershipsCount      = useMemo(() => membershipRows.filter((r) => r.society).length || _toInt(s.research?.memberships_count), [membershipRows, s.research]);
  const fdpDaysPhys           = useMemo(() => fdpRows.length ? fdpDaysFromRows(fdpRows, "Physical") : _toFloat(s.research?.fdp_days_phys), [fdpRows, s.research]);
  const fdpDaysOnline         = useMemo(() => fdpRows.length ? fdpDaysFromRows(fdpRows, "Online")   : _toFloat(s.research?.fdp_days_online), [fdpRows, s.research]);
  const mooc4w                = useMemo(() => fdpRows.length ? fdpRows.filter((r) => r.mode === "MOOC (4 weeks)").length : _toInt(s.research?.mooc_4w), [fdpRows, s.research]);
  const mandatoryCourses      = useMemo(() => mandatoryRows.filter((r) => r.programme).length || _toInt(s.research?.mandatory_courses), [mandatoryRows, s.research]);
  const convenerDays       = useMemo(() => eventRows.length ? eventRows.filter((r) => r.role === "Convener/Coordinator" && r.mode !== "Online").length : _toInt(s.administration?.convener_days), [eventRows, s.administration]);
  const convenerOnlineDays = useMemo(() => eventRows.length ? eventRows.filter((r) => r.role === "Convener/Coordinator" && r.mode === "Online").length  : _toInt(s.administration?.convener_online_days), [eventRows, s.administration]);
  const guestHours         = useMemo(() => eventRows.length ? eventRows.filter((r) => r.role === "Guest Lecture/Webinar").length : _toInt(s.administration?.guest_hours), [eventRows, s.administration]);
  const committeeEvents    = useMemo(() => eventRows.length ? eventRows.filter((r) => r.role === "Committee Member").length      : _toInt(s.administration?.committee_events), [eventRows, s.administration]);
  const eventsA = useMemo(() => eventRows.length ? eventRows.filter((r) => r.level === "National/International" && (r.role === "Convener/Coordinator" || r.role === "Organiser")).length : _toInt(s.administration?.events_a), [eventRows, s.administration]);
  const eventsB = useMemo(() => eventRows.length ? eventRows.filter((r) => r.level === "Institute" && (r.role === "Convener/Coordinator" || r.role === "Organiser")).length              : _toInt(s.administration?.events_b), [eventRows, s.administration]);
  const eventsC = useMemo(() => eventRows.length ? eventRows.filter((r) => r.role === "Committee Member").length : _toInt(s.administration?.events_c), [eventRows, s.administration]);
  const headCount   = useMemo(() => respRows.length ? respRows.filter((r) => r.designation === "Head").length : _toInt(s.administration?.head_count), [respRows, s.administration]);
  const memberCount = useMemo(() => respRows.length ? respRows.filter((r) => r.designation === "Member" || r.designation === "Coordinator").length : _toInt(s.administration?.member_count), [respRows, s.administration]);
  const outreachActivities   = useMemo(() => communityRows.filter((r) => r.activity).length || _toInt(s.outreach?.outreach_activities), [communityRows, s.outreach]);
  const resourceOutsideHours = useMemo(() => resourceRows.filter((r) => r.type === "Outside" && r.programme).length || _toInt(s.outreach?.resource_outside_hours), [resourceRows, s.outreach]);
  const resourceInsideHours  = useMemo(() => resourceRows.filter((r) => r.type === "Inside"  && r.programme).length || _toInt(s.outreach?.resource_inside_hours), [resourceRows, s.outreach]);
  const trainingDays         = useMemo(() => trainingRows.reduce((a, r) => a + _toFloat(r.days), 0) || _toFloat(s.outreach?.training_days), [trainingRows, s.outreach]);
  const awardsCount    = useMemo(() => awardRows.filter((r) => r.title).length || _toInt(s.outreach?.awards_count), [awardRows, s.outreach]);
  const editorialCount = useMemo(() => recognitionRows.filter((r) => r.role === "Editorial Board").length || _toInt(s.outreach?.editorial_count), [recognitionRows, s.outreach]);
  const reviewsCount   = useMemo(() => recognitionRows.filter((r) => r.role === "Reviewer").length        || _toInt(s.outreach?.reviews_count), [recognitionRows, s.outreach]);

  const computed = useMemo(() => calcScore(rankType, {
    passPercent, studentFeedback, onlineVideos, sdgActivities, vacHours,
    pubRows, citations, kprietCitations, consultancyRevenue,
    sponsoredGrantsCount, sponsoredGrantsAmount,
    researchVisits, membershipsCount, fdpDaysPhys, fdpDaysOnline, mooc4w, mandatoryCourses,
    convenerDays, convenerOnlineDays, guestHours, committeeEvents, eventsA, eventsB, eventsC,
    headCount, memberCount, outreachActivities, resourceOutsideHours, resourceInsideHours,
    trainingDays, awardsCount, editorialCount, reviewsCount,
  }), [rankType, passPercent, studentFeedback, onlineVideos, sdgActivities, vacHours,
    pubRows, citations, kprietCitations, consultancyRevenue, sponsoredGrantsCount, sponsoredGrantsAmount,
    researchVisits, membershipsCount, fdpDaysPhys, fdpDaysOnline, mooc4w, mandatoryCourses,
    convenerDays, convenerOnlineDays, guestHours, committeeEvents, eventsA, eventsB, eventsC,
    headCount, memberCount, outreachActivities, resourceOutsideHours, resourceInsideHours,
    trainingDays, awardsCount, editorialCount, reviewsCount]);

  const MAXS = computed.MAXS;

  function proofUrl(p = {}) {
    const dl = p.download_url ?? p.url ?? p.file_url;
    if (dl) return dl.startsWith("http") ? dl : apiBase.replace(/\/$/, "") + dl;
    if (p.stored_filename) return apiBase.replace(/\/$/, "") + "/uploads/" + encodeURIComponent(p.stored_filename);
    return null;
  }
  function globalProofs() {
    if (!submission) return [];
    const arr = [];
    if (submission.file_meta) arr.push(Array.isArray(submission.file_meta) ? submission.file_meta : [submission.file_meta]);
    for (const k of ["proofs","files","attachments","proof_files"]) { if (Array.isArray(submission[k])) arr.push(submission[k]); }
    return arr.flat().filter(Boolean).map((p) => typeof p === "string" ? { name: p, url: null } : p);
  }
  function activityProofs() {
    if (!submission) return {};
    const out = {};
    for (let i = 1; i <= 23; i++) {
      const key = `proof_row_${i}`;
      if (Array.isArray(submission[key]) && submission[key].length) out[i] = submission[key].map((p) => typeof p === "string" ? { name: p, url: null } : p);
    }
    if (submission.activity_proofs && typeof submission.activity_proofs === "object")
      Object.entries(submission.activity_proofs).forEach(([r, arr]) => { if (Array.isArray(arr)) out[r] = (out[r] || []).concat(arr.map((p) => typeof p === "string" ? { name: p, url: null } : p)); });
    return out;
  }
  const gProofs = globalProofs();
  const aProofs = activityProofs();
  const statusColor = { submitted:"#1976d2", verified:"#1a7f4f", approved:"#1a7f4f", rejected:"#c62828", finalized:"#6a11cb" }[String(s.status||"").toLowerCase()] || "#1976d2";

  if (!id) return null;

  return (
    <div className="sd-overlay">
      <div className="sd-panel">

        <div className="sd-topbar">
          <div>
            <h3 className="sd-heading">KPI Submission Detail</h3>
            <p className="sd-subhead">
              {s.faculty_rank  && <span className="sd-badge-rank">{s.faculty_rank}</span>}
              {s.academic_year && <span className="sd-badge-year">{s.academic_year}</span>}
              {s.department    && <span className="sd-dept">{s.department}</span>}
            </p>
          </div>
          <div className="sd-topbar-btns">
            <button onClick={downloadPDF} className="btn-pdf">⬇ KPI PDF</button>
            {submission && canEdit() && <button onClick={() => setShowEdit(true)} className="btn-edit">✏ Edit</button>}
            {submission && HIGHER_ROLES.has(userRole) && !["rejected","finalized"].includes(String(s.status||"").toLowerCase()) && (<>
              <button onClick={() => verify("approve")} className="btn-approve">✓ Approve</button>
              <button onClick={() => verify("reject")}  className="btn-reject">✕ Reject</button>
            </>)}
            <button onClick={onClose} className="btn-close">✕ Close</button>
          </div>
        </div>

        {loading && <div className="sd-loading">Loading…</div>}
        {!loading && s.error && <div className="sd-err">⚠ Error: {s.error}</div>}

        {!loading && submission && !s.error && !showEdit && (
          <div className="sd-body">
            <div className="sd-status-bar" style={{ borderLeftColor: statusColor }}>
              <span>Status: <strong style={{ color: statusColor }}>{s.status || "—"}</strong></span>
              {s.verified_by && <span style={{ marginLeft: 16, color: "#718096", fontSize: 12 }}>
                Verified by <strong>{s.verified_by.name}</strong> ({s.verified_by.role})
                {s.verification_comments && <> — "{s.verification_comments}"</>}
              </span>}
              {s.ai_feedback && <div style={{ marginTop: 6, fontSize: 12, color: "#718096", fontStyle: "italic" }}>💬 {s.ai_feedback}</div>}
            </div>

            <ScoreStrip computed={computed} MAXS={MAXS} />

            <div className="sd-main-cols">
              <div className="sd-left-col">

                {/* A: Academic */}
                <div className="section-block">
                  <SBH text={`A. Academic Outcomes — ${MAXS.academic} Points`} />
                  <SDSection number="1" title="% Pass in ESE (Average of all theory courses)"
                    rubric={`81%–95% → 0–${isAPIII?20:30} pts (step: 0.5% = 1 mark)`}
                    max={isAPIII?20:30} score={Math.round(computed.perRow.academic.passMarks)}
                    note={`Derived average pass %: ${passPercent}%`}>
                    <ROTable rows={eseCourses} emptyLabel="No ESE course data recorded." columns={[
                      { key:"course", label:"Course Name" },{ key:"semester", label:"Semester", width:80 },
                      { key:"className", label:"Class", width:70 },{ key:"appeared", label:"Appeared", width:90, align:"center" },
                      { key:"passed", label:"Passed", width:80, align:"center" },
                      { key:"pct", label:"Pass %", width:80, align:"center", compute:(r)=>{ const a=_toFloat(r.appeared),p=_toFloat(r.passed); return a>0?((p/a)*100).toFixed(1)+"%":"—"; }},
                    ]}/>
                  </SDSection>
                  <SDSection number="2" title="Students Feedback (Average of all theory courses)"
                    rubric={`3.1–4.5 → 0–${isAPIII?20:30} pts (step: 0.1 = 2 marks)`}
                    max={isAPIII?20:30} score={Math.round(computed.perRow.academic.fbMarks)}
                    note={`Derived average feedback: ${studentFeedback} / 5`}>
                    <ROTable rows={feedbackCourses} emptyLabel="No feedback data recorded." columns={[
                      { key:"course", label:"Course Name" },{ key:"semester", label:"Semester", width:80 },
                      { key:"className", label:"Class", width:70 },{ key:"feedback", label:"Feedback (0–5)", width:130, align:"center" },
                    ]}/>
                  </SDSection>
                  <SDSection number="3" title="Developing Online Course / Video Lecture (YouTube / Swayam)"
                    rubric="10 pts / video — cap 30" max={30} score={computed.perRow.academic.videosMarks}
                    note={`Videos: ${onlineVideos}`}>
                    <ROTable rows={videoRows} emptyLabel="No videos recorded." columns={[
                      { key:"course", label:"Course Name" },{ key:"title", label:"Video Title" },
                      { key:"link", label:"Link", compute:(r)=>r.link?<a href={r.link} target="_blank" rel="noreferrer" style={{color:"#1a7f4f"}}>{r.link}</a>:"—" },
                    ]}/>
                  </SDSection>
                  <SDSection number="4" title="Innovative Teaching Methodologies addressing SDGs"
                    rubric="4 pts / activity — cap 30" max={30} score={computed.perRow.academic.sdgMarks}
                    note={`Activities: ${sdgActivities}`}>
                    <ROTable rows={sdgRows} emptyLabel="No SDG activities recorded." columns={[
                      { key:"course", label:"Course" },{ key:"classSem", label:"Class/Sem", width:80 },
                      { key:"topic", label:"Topic" },{ key:"method", label:"Methodology" },{ key:"sdg", label:"SDG No.", width:70, align:"center" },
                    ]}/>
                  </SDSection>
                  <SDSection number="5a" title="Conduct of VAC / Capsule Courses" rubric="1 pt / hour"
                    max={isAPIII?25:30} score={Math.round(computed.perRow.academic.vacMarks)}
                    note={`Total VAC hours: ${vacHours}`}>
                    <ROTable rows={vacRows} emptyLabel="No VAC courses recorded." columns={[
                      { key:"course", label:"Course Name" },{ key:"classSem", label:"Class/Sem", width:80 },
                      { key:"students", label:"Students", width:90, align:"center" },{ key:"hours", label:"Hours", width:70, align:"center" },{ key:"date", label:"Date", width:100 },
                    ]}/>
                  </SDSection>
                  <SDSection number="5b" title="Training Students to Win Prizes / Awards / Publications" rubric="Documentation" max={0} score={0}>
                    <ROTable rows={achievementRows} emptyLabel="No student achievements recorded." columns={[
                      { key:"student", label:"Student Name" },{ key:"competition", label:"Competition / Conference" },
                      { key:"institute", label:"Institute" },{ key:"date", label:"Date", width:100 },{ key:"award", label:"Award", width:130 },
                    ]}/>
                  </SDSection>
                  <SecTotal label="Academic Total" max={MAXS.academic} value={computed.totals.academic} />
                </div>

                {/* B: Research */}
                <div className="section-block">
                  <SBH text={`B. Research & Professional Development — ${MAXS.research} Points`} />
                  <SDSection number="6" title="Article Publications / Patents (SCI / WoS / Scopus / Books / Patents)"
                    rubric={`Tiered pts by indexing — Patents: Published=10, Granted=30 — cap ${isAPIII?80:75}`}
                    max={isAPIII?80:75} score={Math.round(computed.perRow.research.pubsMarks)}
                    note={`Total pts (raw): ${calcPubPoints(pubRows)} | Publications: ${pubRows.filter(r=>r.title).length}`}>
                    <ROTable rows={pubRows} emptyLabel="No publications/patents recorded." columns={[
                      { key:"title", label:"Title of Paper / Patent" },
                      { key:"authors", label:"Authors", width:130 },
                      { key:"journal", label:"Journal", width:150 },
                      { key:"monthYear", label:"Month/Year", width:90, align:"center" },
                      { key:"indexing", label:"Indexing", width:100, align:"center" },
                      { key:"impactFactor", label:"IF", width:50, align:"center" },
                      { key:"_pts", label:"Pts", width:50, align:"center", compute:(r)=>pubRowPtsLabel(r) },
                    ]}/>
                  </SDSection>
                  <SDSection number="7a" title="Article Citation in WoS / Scopus"
                    rubric={`${isAPIII?"0.5":"1"} pt / citation — shared ${isAPIII?20:15}-pt cap with 7b`}
                    max={isAPIII?20:15} score={Math.round(computed.perRow.research.citationsMarks)}
                    note={`Citations: ${citations}${kprietCitations>0?` | KPRIET cited: ${kprietCitations}`:""}`}>
                    <ROTable rows={citationRows} emptyLabel="No citation data recorded." columns={[
                      { key:"title", label:"Paper Title" },{ key:"citations", label:"Citations (2024-25)", width:160, align:"center" },
                    ]}/>
                  </SDSection>
                  <SDSection number="7b" title="KPRIET Affiliation Articles Cited"
                    rubric="0.5 pt per article cited (shares cap with 7a)" max={0} score={0}>
                    <ROTable rows={kprietCitRows} emptyLabel="No KPRIET citation entries." columns={[
                      { key:"title", label:"Paper Title" },{ key:"cited", label:"KPRIET Articles Cited", width:180, align:"center" },
                    ]}/>
                  </SDSection>
                  <SDSection number="8" title="Consultancy Revenue Generation"
                    rubric={`Scaled to ${isAPIII?25:20} pts (₹0–2L)`} max={isAPIII?25:20}
                    score={Math.round(computed.perRow.research.consultancyMarks)}
                    note={`Total revenue: ₹${consultancyRevenue.toLocaleString()}`}>
                    <ROTable rows={consultancyRows} emptyLabel="No consultancy entries." columns={[
                      { key:"title", label:"Work / Testing Title" },{ key:"org", label:"Organisation", width:150 },
                      { key:"date", label:"Date", width:100, align:"center" },
                      { key:"amount", label:"Amount (₹)", width:110, align:"right", compute:(r)=>r.amount?`₹${_toFloat(r.amount).toLocaleString()}`:"—" },
                    ]}/>
                  </SDSection>
                  <SDSection number="9" title="Sponsored Grants Received / Submitted"
                    rubric={isAPIII?"5 pts/proposal (cap 40) + step amount (cap 10) → combined cap 50":"5 pts/proposal (cap 15) + step amount ₹10K=2M (cap 40) → combined cap 40"}
                    max={isAPIII?50:40} score={Math.round(computed.perRow.research.sponsoredCombined)}
                    note={`Proposals: ${sponsoredGrantsCount} (${computed.perRow.research.proposalsMarks} pts) | ₹${sponsoredGrantsAmount.toLocaleString()} (${computed.perRow.research.grantsAmountMarks} pts)`}>
                    <ROTable rows={grantRows} emptyLabel="No grant entries." columns={[
                      { key:"pi", label:"PI", width:110 },{ key:"title", label:"Project Title" },
                      { key:"agency", label:"Agency", width:120 },{ key:"date", label:"Date", width:110, align:"center" },
                      { key:"amount", label:"Amount (₹)", width:110, align:"right", compute:(r)=>r.amount?`₹${_toFloat(r.amount).toLocaleString()}`:"—" },
                      { key:"status", label:"Status", width:100, align:"center" },
                    ]}/>
                  </SDSection>
                  <SDSection number="10" title="Research Scholars / Visits to Research Laboratories"
                    rubric={isAPIII?"PhD/FT/PT pts — cap 15":"10 pts / visit — cap 10"}
                    max={isAPIII?15:10} score={Math.round(computed.perRow.research.researchVisitsMarks)}
                    note={`Visits / scholars: ${researchVisits}`}>
                    <ROTable rows={visitRows} emptyLabel="No visit entries." columns={[
                      { key:"lab", label:"Research Lab / Scholar" },{ key:"date", label:"Date", width:110, align:"center" },
                      { key:"outcome", label:"Outcome / Collaboration" },
                    ]}/>
                  </SDSection>
                  <SDSection number="11" title="Membership in Professional Bodies"
                    rubric="10 pts / membership — cap 10" max={10}
                    score={Math.round(computed.perRow.research.membershipsMarks)} note={`Memberships: ${membershipsCount}`}>
                    <ROTable rows={membershipRows} emptyLabel="No memberships recorded." columns={[
                      { key:"society", label:"Society / Chapter" },{ key:"level", label:"Level", width:110, align:"center" },
                      { key:"memberId", label:"Member ID", width:110, align:"center" },{ key:"type", label:"Type", width:80, align:"center" },{ key:"date", label:"Date", width:100, align:"center" },
                    ]}/>
                  </SDSection>
                  <SDSection number="12" title="Completion of FDP / STTP / MOOC Courses"
                    rubric="1 pt/day Physical | 0.5 pt/day Online | 4 pts for 4-week MOOC"
                    max={isAPIII?15:20} score={Math.round(computed.perRow.research.fdpMarks)}
                    note={`Physical: ${fdpDaysPhys}d | Online: ${fdpDaysOnline}d | MOOC 4w: ${mooc4w}`}>
                    <ROTable rows={fdpRows} emptyLabel="No FDP/MOOC entries." columns={[
                      { key:"course", label:"Course Name" },{ key:"organiser", label:"Organised By", width:130 },
                      { key:"from", label:"From", width:110, align:"center" },{ key:"to", label:"To", width:110, align:"center" },
                      { key:"mode", label:"Mode", width:120, align:"center" },{ key:"accolades", label:"Accolades", width:120 },
                    ]}/>
                  </SDSection>
                  <SDSection number="13" title="Mandatory Training Programmes" rubric="10 pts / course — cap 10"
                    max={10} score={Math.round(computed.perRow.research.mandatoryMarks)} note={`Programmes: ${mandatoryCourses}`}>
                    <ROTable rows={mandatoryRows} emptyLabel="No mandatory training recorded." columns={[
                      { key:"programme", label:"Training Programme" },{ key:"organiser", label:"Organised By", width:140 },
                      { key:"from", label:"From", width:100, align:"center" },{ key:"to", label:"To", width:100, align:"center" },{ key:"accolades", label:"Accolades", width:120 },
                    ]}/>
                  </SDSection>
                  <SecTotal label="Research Total" max={MAXS.research} value={computed.totals.research} />
                </div>

                {/* C: Administration */}
                <div className="section-block">
                  <SBH text={`C. Administration — ${MAXS.admin} Points`} />
                  <SDSection number="14 & 15" title="Convener / Coordinator / Guest Lectures / Committee for Events"
                    rubric={`Physical 3 pts | Online 2 pts | Guest 2 pts | Committee 1 pt — combined cap ${isAPIII?25:20}`}
                    max={isAPIII?25:20} score={Math.round(computed.perRow.admin.convenerEventsMarks)}
                    note={`Convener (Phys): ${convenerDays} | Online: ${convenerOnlineDays} | Guest: ${guestHours} | Committee: ${committeeEvents} | Events Natl/Intl: ${eventsA} | Institute: ${eventsB}`}>
                    <ROTable rows={eventRows} emptyLabel="No events recorded." columns={[
                      { key:"event", label:"Event Name" },{ key:"date", label:"Date", width:100, align:"center" },
                      { key:"mode", label:"Mode", width:90, align:"center" },{ key:"level", label:"Level", width:160, align:"center" },
                      { key:"role", label:"Role", width:180, align:"center" },{ key:"participants", label:"Participants", width:100, align:"center" },
                    ]}/>
                  </SDSection>
                  <SDSection number="16" title="Institute & Dept. Level Responsibility"
                    rubric="Head: 10 pts | Member/Coordinator: 5 pts"
                    max={isAPIII?35:30} score={Math.round(computed.perRow.admin.respMarks)}
                    note={`Heads: ${headCount} | Members/Coordinators: ${memberCount}`}>
                    <ROTable rows={respRows} emptyLabel="No responsibilities recorded." columns={[
                      { key:"responsibility", label:"NSC / Club / Responsibility" },{ key:"designation", label:"Designation", width:140, align:"center" },
                    ]}/>
                  </SDSection>
                  <SecTotal label="Admin Total" max={MAXS.admin} value={computed.totals.admin} />
                </div>

                {/* D: Outreach */}
                <div className="section-block">
                  <SBH text={`D. Outreach Activities — ${MAXS.outreach} Points`} />
                  <SDSection number="17" title="Community Services / ISR"
                    rubric={`10 pts / activity — cap ${isAPIII?15:30}`} max={isAPIII?15:30}
                    score={Math.round(computed.perRow.outreach.communityMarks)} note={`Activities: ${outreachActivities}`}>
                    <ROTable rows={communityRows} emptyLabel="No community activities recorded." columns={[
                      { key:"activity", label:"Name of Activity" },{ key:"date", label:"Date", width:100, align:"center" },{ key:"significance", label:"Significance" },
                    ]}/>
                  </SDSection>
                  <SDSection number="18" title="Being a Resource Person"
                    rubric="Outside: 3 pts/entry | Inside: 2 pts/entry — cap 20" max={20}
                    score={Math.round(computed.perRow.outreach.resourceMarks)}
                    note={`Outside: ${resourceOutsideHours} | Inside: ${resourceInsideHours}`}>
                    <ROTable rows={resourceRows} emptyLabel="No resource person entries." columns={[
                      { key:"programme", label:"Programme Name" },{ key:"org", label:"Organisation", width:140 },
                      { key:"topic", label:"Topic", width:140 },{ key:"date", label:"Date", width:100, align:"center" },{ key:"type", label:"Inside/Outside", width:110, align:"center" },
                    ]}/>
                  </SDSection>
                  <SDSection number="19" title="Training in Industry / Research Institutes"
                    rubric={`Two weeks = ${isAPIII?20:30} pts (linear)`} max={isAPIII?20:30}
                    score={Math.round(computed.perRow.outreach.trainingMarks)} note={`Total training days: ${trainingDays}`}>
                    <ROTable rows={trainingRows} emptyLabel="No training entries." columns={[
                      { key:"institute", label:"Industry / Research Institute" },
                      { key:"days", label:"No. of Days", width:110, align:"center" },{ key:"period", label:"Period", width:140, align:"center" },
                    ]}/>
                  </SDSection>
                  <SDSection number="20a" title="Awards" rubric="5 pts / award — cap 20" max={20}
                    score={Math.round(_clamp(awardsCount*5,0,20))} note={`Awards: ${awardsCount}`}>
                    <ROTable rows={awardRows} emptyLabel="No awards recorded." columns={[
                      { key:"title", label:"Title of Award" },{ key:"agency", label:"Issuing Agency", width:190 },{ key:"date", label:"Date", width:100, align:"center" },
                    ]}/>
                  </SDSection>
                  <SDSection number="20b" title="Recognition — Editorial Board / Journal Paper Review"
                    rubric="Editorial Board: 4 pts | Reviewer: 1 pt/paper — cap 20" max={20}
                    score={Math.round(_clamp(4*editorialCount+reviewsCount,0,20))}
                    note={`Editorial Board: ${editorialCount} | Reviewers: ${reviewsCount}`}>
                    <ROTable rows={recognitionRows} emptyLabel="No recognition entries." columns={[
                      { key:"journal", label:"Journal Name" },{ key:"role", label:"Role", width:150, align:"center" },{ key:"indexing", label:"Indexing", width:100, align:"center" },
                    ]}/>
                  </SDSection>
                  <SecTotal label="Outreach Total" max={MAXS.outreach} value={computed.totals.outreach} />
                </div>

                <SecTotal label="GRAND TOTAL" max={500} value={computed.totals.total} isGrand />
              </div>

              {/* Right sidebar */}
              <div className="sd-right-col">
                <div className="sd-card">
                  <div className="sd-card-title">📋 Submission Info</div>
                  {[["Faculty ID",s.faculty_user_id||"—"],["Rank",s.faculty_rank||"—"],["Rank Type",rankType],
                    ["Year",s.academic_year||"—"],["Department",s.department||"—"],
                    ["Submitted",s.created_at?new Date(s.created_at).toLocaleDateString():"—"]
                  ].map(([k,v])=>(
                    <div key={k} className="sd-kv"><span className="sd-k">{k}</span><span className="sd-v">{v}</span></div>
                  ))}
                </div>
                <div className="sd-card" style={{marginTop:10}}>
                  <div className="sd-card-title">🏆 Score Summary</div>
                  {[["Academic",computed.totals.academic,MAXS.academic],["Research",computed.totals.research,MAXS.research],
                    ["Admin",computed.totals.admin,MAXS.admin],["Outreach",computed.totals.outreach,MAXS.outreach],["TOTAL",computed.totals.total,500]
                  ].map(([k,v,m])=>(
                    <div key={k} className="sd-score-row" style={k==="TOTAL"?{marginTop:6,borderTop:"2px solid #e2e8f0",paddingTop:6}:{}}>
                      <span className="sd-k">{k}</span>
                      <span className="sd-score-val" style={k==="TOTAL"?{color:"#1a7f4f",fontSize:18}:{}}>
                        {v}<span style={{color:"#a0aec0",fontSize:11}}> / {m}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="sd-card" style={{marginTop:10}}>
                  <div className="sd-card-title">📎 Global Proofs</div>
                  {gProofs.length===0?<div className="sd-empty-sm">No global proofs attached.</div>
                    :gProofs.map((p,i)=>{const url=proofUrl(p);const name=p.original_filename??p.name??p.filename??"Proof";
                      return <div key={i} className="file-chip existing" style={{marginBottom:4}}>{url?<a href={url} target="_blank" rel="noreferrer">{name}</a>:<span>{name}</span>}</div>;
                    })}
                </div>
                <div className="sd-card" style={{marginTop:10}}>
                  <div className="sd-card-title">📎 Per-Activity Proofs</div>
                  {Object.keys(aProofs).length===0?<div className="sd-empty-sm">No per-activity proofs.</div>
                    :Object.entries(aProofs).map(([row,arr])=>(
                      <div key={row} style={{marginBottom:8}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#718096",marginBottom:3,textTransform:"uppercase",letterSpacing:".3px"}}>KPI Row {row}</div>
                        {arr.map((p,i)=>{const url=proofUrl(p);const name=p.original_filename??p.name??p.filename??"File";
                          return <div key={i} className="file-chip existing" style={{marginBottom:3}}>{url?<a href={url} target="_blank" rel="noreferrer">{name}</a>:<span>{name}</span>}</div>;
                        })}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {showEdit && submission && (
          <SubmissionForm apiBase={apiBase} submission={submission} editable={true}
            onCancel={() => setShowEdit(false)}
            onSubmitted={async (updated) => { setShowEdit(false); await refresh(); if (onUpdated) onUpdated(updated); }}
          />
        )}
      </div>

      <style>{`
        .sd-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;z-index:2900;padding:16px;}
        .sd-panel{width:98%;max-width:1300px;max-height:94vh;overflow:auto;background:#f7f9fc;border-radius:14px;padding:22px;color:#1a2332;box-shadow:0 12px 48px rgba(0,0,0,0.22);font-family:'Segoe UI',system-ui,sans-serif;scrollbar-width:thin;scrollbar-color:rgba(26,127,79,0.2) transparent;}
        .sd-panel::-webkit-scrollbar{width:5px;}.sd-panel::-webkit-scrollbar-thumb{background:rgba(26,127,79,0.2);border-radius:3px;}
        .sd-topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;flex-wrap:wrap;}
        .sd-heading{margin:0 0 4px;font-size:19px;font-weight:800;color:#1a2332;}
        .sd-subhead{margin:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
        .sd-badge-rank{padding:2px 9px;border-radius:20px;background:#e8f5ee;border:1px solid #b2dfcc;font-size:12px;color:#1a7f4f;font-weight:700;}
        .sd-badge-year{padding:2px 9px;border-radius:20px;background:#e3f2fd;border:1px solid #90caf9;font-size:12px;color:#1565c0;font-weight:700;}
        .sd-dept{font-size:12px;color:#718096;}
        .sd-topbar-btns{display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;}
        .btn-pdf{padding:8px 13px;border-radius:8px;background:#7b5cff;color:#fff;border:none;cursor:pointer;font-weight:700;font-size:13px;transition:all .2s;}
        .btn-pdf:hover{background:#6a4ee0;transform:translateY(-1px);box-shadow:0 4px 12px rgba(123,92,255,0.35);}
        .btn-edit{padding:8px 13px;border-radius:8px;background:#1976d2;color:#fff;border:none;cursor:pointer;font-weight:700;font-size:13px;transition:all .2s;}
        .btn-edit:hover{background:#1565c0;transform:translateY(-1px);}
        .btn-approve{padding:8px 13px;border-radius:8px;background:#1a7f4f;color:#fff;border:none;cursor:pointer;font-weight:700;font-size:13px;transition:all .2s;}
        .btn-approve:hover{background:#155f3a;transform:translateY(-1px);}
        .btn-reject{padding:8px 13px;border-radius:8px;background:#c62828;color:#fff;border:none;cursor:pointer;font-weight:700;font-size:13px;transition:all .2s;}
        .btn-reject:hover{background:#b71c1c;transform:translateY(-1px);}
        .btn-close{padding:8px 13px;border-radius:8px;background:#fff;color:#4a5568;border:1px solid #d1d9e0;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s;}
        .btn-close:hover{background:#f0f4f8;border-color:#b0bec5;}
        .sd-loading{padding:28px;text-align:center;color:#718096;font-size:14px;}
        .sd-err{padding:12px 16px;background:#fff0f0;border:1px solid #fbb6b6;color:#c53030;border-radius:8px;margin-top:10px;font-size:13px;font-weight:600;}
        .sd-status-bar{padding:10px 14px;border-radius:8px;background:#fff;border:1px solid #e2e8f0;border-left:4px solid;margin-bottom:14px;font-size:13px;font-weight:600;}
        .sd-strip{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;}
        .sd-chip{flex:1;min-width:110px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
        .sd-chip.grand{flex:1.4;border-color:#b2dfcc;background:#f0faf5;}
        .sc-label{font-size:10px;color:#718096;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;}
        .sc-val{font-size:22px;font-weight:800;color:#1a2332;margin-bottom:6px;line-height:1;}
        .sc-max{font-size:12px;font-weight:400;color:#a0aec0;margin-left:2px;}
        .sc-bar-bg{height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden;}
        .sc-bar-fill{height:100%;background:#1a7f4f;border-radius:2px;transition:width .4s;}
        .perf-band{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:8px;border:2px solid;margin-bottom:14px;flex-wrap:wrap;}
        .perf-label{font-size:11px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.4px;}
        .perf-value{font-size:13px;font-weight:800;flex:1;}
        .perf-score{font-size:15px;font-weight:800;color:#1a2332;margin-left:auto;}
        .sd-body{display:flex;flex-direction:column;gap:0;}
        .sd-main-cols{display:flex;gap:16px;align-items:flex-start;}
        .sd-left-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;}
        .sd-right-col{width:270px;flex-shrink:0;display:flex;flex-direction:column;gap:0;position:sticky;top:0;}
        .section-block{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.05);}
        .section-block-header{background:linear-gradient(90deg,#1b2d4f,#1a7f4f);padding:9px 16px;font-size:12px;font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:.5px;}
        .kpi-section{border-bottom:1px solid #edf2f7;}
        .kpi-section:last-child{border-bottom:none;}
        .kpi-section-header{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;gap:12px;cursor:pointer;transition:background .15s;}
        .kpi-section-header:hover{background:#f7fbf9;}
        .kpi-section-left{display:flex;align-items:flex-start;gap:10px;flex:1;min-width:0;}
        .kpi-section-right{display:flex;align-items:center;gap:10px;flex-shrink:0;}
        .kpi-num{min-width:36px;height:36px;border-radius:8px;flex-shrink:0;background:#e8f5ee;border:1px solid #b2dfcc;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#1a7f4f;}
        .kpi-title{font-size:13px;font-weight:700;color:#2d3748;line-height:1.3;}
        .kpi-rubric{font-size:11px;color:#718096;margin-top:2px;}
        .sd-max-lbl{font-size:11px;color:#718096;white-space:nowrap;}.sd-max-lbl strong{color:#2d3748;}
        .kpi-badge{min-width:44px;text-align:center;padding:4px 10px;border-radius:8px;font-size:14px;font-weight:800;}
        .sd-chev{font-size:10px;color:#a0aec0;}
        .kpi-section-body{padding:8px 16px 14px;background:#fafcff;}
        .sd-note{font-size:12px;color:#2d6a4f;background:#e8f5ee;border-left:3px solid #1a7f4f;padding:5px 10px;border-radius:0 6px 6px 0;margin-bottom:8px;font-weight:600;}
        .section-total{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#f0f4f8;border-top:1px solid #e2e8f0;font-size:13px;font-weight:800;color:#2d3748;}
        .section-total.grand{background:linear-gradient(90deg,#1b2d4f,#1a7f4f);border:none;border-radius:8px;margin-top:12px;font-size:15px;color:#fff;box-shadow:0 3px 10px rgba(26,127,79,0.25);}
        .section-total.grand .st-val,.section-total.grand .st-max{color:#fff;}
        .section-total.grand .st-max{opacity:.7;}
        .st-left{flex:1;}.st-right{display:flex;align-items:center;gap:14px;}
        .st-bar-wrap{width:110px;height:5px;background:rgba(0,0,0,0.08);border-radius:3px;overflow:hidden;}
        .section-total.grand .st-bar-wrap{background:rgba(255,255,255,0.2);}
        .st-bar{height:100%;border-radius:3px;background:#1a7f4f;transition:width .35s;}
        .section-total.grand .st-bar{background:#fff;}
        .st-score{display:flex;align-items:baseline;gap:1px;min-width:68px;justify-content:flex-end;}
        .st-val{font-size:18px;font-weight:800;color:#1a2332;}.st-max{font-size:12px;color:#718096;}
        .sd-table-wrap{overflow-x:auto;border-radius:8px;border:1px solid #e2e8f0;}
        .sd-table{width:100%;border-collapse:collapse;font-size:12px;}
        .sd-table thead tr{background:#f0f4f8;}
        .sd-table th{padding:7px 8px;text-align:left;font-weight:700;color:#4a5568;font-size:11px;border-bottom:1px solid #e2e8f0;white-space:nowrap;}
        .sd-table td{padding:7px 8px;border-bottom:1px solid #f0f4f8;color:#2d3748;vertical-align:middle;}
        .sd-table tr:nth-child(even){background:#f7f9fc;}
        .sd-table tr:last-child td{border-bottom:none;}
        .sd-empty{padding:12px;text-align:center;font-size:12px;color:#a0aec0;font-style:italic;}
        .sd-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
        .sd-card-title{font-size:11px;font-weight:800;color:#1a7f4f;text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px;}
        .sd-kv,.sd-score-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #edf2f7;}
        .sd-kv:last-child,.sd-score-row:last-child{border-bottom:none;}
        .sd-k{font-size:11px;color:#718096;font-weight:600;}
        .sd-v{font-size:12px;color:#2d3748;font-weight:600;text-align:right;max-width:160px;}
        .sd-score-val{font-size:14px;font-weight:800;color:#1a2332;}
        .sd-empty-sm{font-size:12px;color:#a0aec0;font-style:italic;}
        .file-chip{display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;font-size:11px;}
        .file-chip.existing{background:#fff8e1;color:#b7791f;border:1px solid #f6cc72;}
        .file-chip.existing a{color:#b7791f;text-decoration:none;font-weight:600;}
        .file-chip.existing a:hover{text-decoration:underline;}
      `}</style>
    </div>
  );
}
