// src/SubmissionForm.jsx
// Faculty KPI Appraisal Form — All Faculty Levels
// Supports: AP I, AP II, AP III, ASP/Prof, HOD, CFRD, Physical Education,
//           Non-Teaching (PO/JA), Non-Teaching (Lab)
// AUTO-SCORING: All scores update live as you type.
//
// ═══════════════════════════════════════════════════════════════════
// SCORING AUDIT & FIXES (vs AP I & II official doc + rubric images)
// ═══════════════════════════════════════════════════════════════════
// [FIX 1]  Sec 6b Patents  — Doc has NO separate max for patents; they
//          are part of Section 6 (Publications, max 75).  Removed the
//          fake "Max 50" patent section; patent points now feed into
//          pubsMarks and share the 75-pt cap.
//
// [FIX 2]  Sec 9 Grants    — Doc: 10K=2M, 15K=3M, … >=2L=40M → linear
//          ₹5K step = 1 mark, so formula = (amount-10000)/5000 + 2,
//          capped at 40.  Old code capped at 25 — wrong.
//
// [FIX 3]  Sec 14+15 combined max is 20 per doc (not 30).  Events 15a
//          (3pts), 15b (2pts), 15c (1pt) all share this pool.
//
// [FIX 4]  Sec 1 Pass %   — Doc: 81%=2M, 81.5%=3M, 82%=4M … >=95=30M
//          i.e. every 0.5 % above 81 = 1 mark → marks = (pass-81)/0.5 +1
//          capped at 30.
//
// [FIX 5]  Sec 2 Feedback — Doc: 3.1=2M, 3.2=4M … >=4.5=30M
//          i.e. every 0.1 above 3.1 = 2 marks → marks = ((fb-3.1)/0.1)*2
//          capped at 30.
//
// [FIX 6]  Sec 7a citations AP12 cap confirmed 15 (shared with 7b).
//          7b formula: 0.5 * kprietCitations, remaining share of 15 cap.
// ═══════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   PURE HELPERS
═══════════════════════════════════════════════════════════════════════════ */
const _clamp   = (v, a, b) => Math.max(a, Math.min(b, v));
const _toInt   = (v) => { const n = parseInt(v, 10);  return Number.isFinite(n) ? n : 0; };
const _toFloat = (v) => { const n = parseFloat(v);    return Number.isFinite(n) ? n : 0; };

/* ═══════════════════════════════════════════════════════════════════════════
   RANK HELPERS
═══════════════════════════════════════════════════════════════════════════ */
function getRankType(rank) {
  const r = (rank || "").toUpperCase();
  if (r.includes("HOD") || r.includes("PG COORDINATOR")) return "HOD";
  if (r.includes("CFRD")) return "CFRD";
  if (r.includes("PHYSICAL")) return "PE";
  if (r.includes("NON-TEACHING") && r.includes("LAB")) return "NTL";
  if (r.includes("NON-TEACHING")) return "NTP";
  if (r.includes("AP III") || r.includes("AP (III)")) return "AP3";
  if (r.includes("ASP") || r.includes("PROF")) return "ASP";
  return "AP12"; // AP I / AP II default
}

/* ═══════════════════════════════════════════════════════════════════════════
   PASS % SCORING  (per actual doc rubric)
   81% → 2M, 81.5% → 3M, 82% → 4M, … >=95% → 30M
   Pattern: 2 + (pass - 81) / 0.5  at 81; each 0.5% adds 1M.
   Simplified: marks = (pass - 81) / 0.5 + 2  (starts at 2 when pass=81)
   Cap = passMax (30 for AP12, 20 for AP3/ASP/HOD-self etc.)
═══════════════════════════════════════════════════════════════════════════ */
function calcPassMarks(passPercent, passMax) {
  if (passPercent < 81) return 0;
  const raw = Math.round((passPercent - 81) / 0.5) + 2; // +2 because 81%=2M
  return _clamp(raw, 0, passMax);
}

/* ═══════════════════════════════════════════════════════════════════════════
   FEEDBACK SCORING  (per actual doc rubric)
   3.1 → 2M, 3.2 → 4M, … >=4.5 → 30M
   Pattern: every 0.1 above 3.1 adds 2 marks.
   marks = ((fb - 3.1) / 0.1) * 2 rounded
   Cap = fbMax (30 for AP12, 20 for AP3/ASP etc.)
═══════════════════════════════════════════════════════════════════════════ */
function calcFbMarks(fb, fbMax) {
  if (fb < 3.1) return 0;
  const raw = Math.round(((fb - 3.1) / 0.1)) * 2 + 2; // 3.1=2M
  return _clamp(raw, 0, fbMax);
}

/* ═══════════════════════════════════════════════════════════════════════════
   GRANT SCORING  (per actual doc rubric)
   10K=2M, 15K=3M, 20K=4M, … >=2L=40M
   Pattern: starts at 2M at 10K, each ₹5K = +1M → max 40 at ₹2L
   Formula: 2 + (amount - 10000) / 5000  → cap 40
═══════════════════════════════════════════════════════════════════════════ */
function calcGrantAmountMarks(amount, max) {
  if (amount < 10000) return 0;
  const raw = 2 + (amount - 10000) / 5000;
  return _clamp(Math.round(raw), 0, max);
}

/* ═══════════════════════════════════════════════════════════════════════════
   TIERED PUBLICATION SCORING
   Patents are now folded IN here (no separate section).
   pubRows = array of row objects with .indexing, .impactFactor, .grantDate fields.
   For patent rows: Published = 10pts, Granted (grantDate filled) = 30pts.
═══════════════════════════════════════════════════════════════════════════ */
function calcPubPoints(pubRows) {
  return (pubRows || []).reduce((total, r) => {
    if (!r.title && !r.journal) return total;
    const idx = (r.indexing || "").toUpperCase();
    const IF  = _toFloat(r.impactFactor);
    let pts = 0;
    if (idx.includes("SCI")) {
      pts = idx.includes("Q3") || idx.includes("Q4") ? 20 : 25;
    } else if (idx.includes("WOS") || idx.includes("WOB") || idx.includes("WEB OF")) {
      pts = 15;
    } else if (idx.includes("SCOPUS")) {
      pts = 15;
    } else if (idx.includes("CONFERENCE")) {
      pts = 10;
    } else if (idx.includes("BOOK-INT") || idx === "BOOK-INTERNATIONAL") {
      pts = 50;
    } else if (idx.includes("BOOK-NAT") || idx === "BOOK-NATIONAL") {
      pts = 30;
    } else if (idx.includes("EDITED")) {
      pts = 20;
    } else if (idx.includes("BOOK CHAPTER") || idx.includes("CHAPTER")) {
      pts = 15;
    } else if (idx.includes("PATENT") && idx.includes("GRANT")) {
      // Granted patent: 30 pts
      pts = 30;
    } else if (idx.includes("PATENT")) {
      // Published (not yet granted): 10 pts
      pts = 10;
    } else if (idx.includes("UGC")) {
      pts = 10;
    } else {
      pts = (r.title || r.journal) ? 15 : 0;
    }
    if (IF > 5) pts += 5;
    return total + pts;
  }, 0);
}

/* Per-row computed pts label (for display in table) */
function pubRowPts(r) {
  if (!r.title && !r.journal) return "—";
  const idx = (r.indexing || "").toUpperCase();
  const IF = _toFloat(r.impactFactor);
  let p = 0;
  if (idx.includes("SCI") && (idx.includes("Q3") || idx.includes("Q4"))) p = 20;
  else if (idx.includes("SCI")) p = 25;
  else if (idx.includes("WOS")) p = 15;
  else if (idx.includes("SCOPUS")) p = 15;
  else if (idx.includes("CONFERENCE")) p = 10;
  else if (idx.includes("BOOK-INT") || idx === "BOOK-INTERNATIONAL") p = 50;
  else if (idx.includes("BOOK-NAT") || idx === "BOOK-NATIONAL") p = 30;
  else if (idx.includes("EDITED")) p = 20;
  else if (idx.includes("CHAPTER")) p = 15;
  else if (idx.includes("PATENT") && idx.includes("GRANT")) p = 30;
  else if (idx.includes("PATENT")) p = 10;
  else if (idx.includes("UGC")) p = 10;
  else p = (r.title || r.journal) ? 15 : 0;
  if (IF > 5) p += 5;
  return <strong style={{ color: "#1a7f4f" }}>{p}</strong>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORING — AP I / AP II / AP III / ASP / Prof
═══════════════════════════════════════════════════════════════════════════ */
function calcScoreAPFamily({
  rankType,
  passPercent, studentFeedback, onlineVideos, sdgActivities, vacHours,
  sympPubs,
  pubRows,
  citations, kprietCitations,
  consultancyRevenue,
  sponsoredGrantsCount, sponsoredGrantsAmount,
  researchVisits, membershipsCount,
  fdpDaysPhys, fdpDaysOnline, mooc4w, mandatoryCourses,
  convenerDays, convenerOnlineDays, guestHours, committeeEvents,
  eventsA, eventsB, eventsC,
  headCount, memberCount,
  outreachActivities, resourceOutsideHours, resourceInsideHours,
  trainingDays, awardsCount, editorialCount, reviewsCount,
  phdCount, phdPursuing,
  achievementPoints,
}) {
  const isAP3 = rankType === "AP3";
  const isASP = rankType === "ASP";

  // Section maximums per rank
  let MAXS;
  if (isAP3)      MAXS = { academic: 125, research: 225, admin: 75,  outreach: 75,  grand: 500 };
  else if (isASP) MAXS = { academic: 100, research: 250, admin: 100, outreach: 50,  grand: 500 };
  else            MAXS = { academic: 150, research: 200, admin: 50,  outreach: 100, grand: 500 };

  /* ── ACADEMIC ──────────────────────────────────────────────────────── */
  const passMax = (isAP3 || isASP) ? 20 : 30;
  const fbMax   = (isAP3 || isASP) ? 20 : 30;

  // [FIX 4] Pass: 81%=2M, each +0.5%=+1M, cap passMax
  const passMarks = calcPassMarks(passPercent, passMax);
  // [FIX 5] Feedback: 3.1=2M, each +0.1=+2M, cap fbMax
  const fbMarks   = calcFbMarks(studentFeedback, fbMax);

  const videosCap  = isASP ? 20 : 30;
  const sdgCap     = isASP ? 20 : 30;
  const videosMarks = _clamp(10 * onlineVideos, 0, videosCap);
  const sdgMarks    = _clamp(4 * sdgActivities, 0, sdgCap);

  // Section 5: VAC + Achievement + Symposium pubs (combined pool)
  const sec5Cap    = isASP ? 20 : (isAP3 ? 25 : 30);
  const vacRaw     = _toFloat(vacHours);
  const achRaw     = _toInt(achievementPoints);
  const sec5PubRaw = 2 * _toInt(sympPubs);
  const sec5Marks  = _clamp(vacRaw + achRaw + sec5PubRaw, 0, sec5Cap);
  const vacMarks   = _clamp(vacRaw, 0, sec5Cap);
  const achieveMarks = _clamp(achRaw, 0, sec5Cap);

  const academicTotal = _clamp(passMarks + fbMarks + videosMarks + sdgMarks + sec5Marks, 0, MAXS.academic);

  /* ── RESEARCH ─────────────────────────────────────────────────────── */
  // [FIX 1] Patents folded into publications section — pubRows now includes
  //         patent rows (indexing = "Patent Published" or "Patent Granted").
  //         No separate patent section or separate max.
  const rawPubPoints = calcPubPoints(pubRows);

  let pubMax, citMax, conMax, grantMax, visitMax, memMax, fdpMax, mandMax;
  let pubsMarks, citationsMarks, kprietCitMarks, consultancyMarks;
  let proposalsMarks, grantsAmountMarks, sponsoredCombined;
  let researchVisitsMarks, membershipsMarks, fdpMarks, mandatoryMarks;

  if (isAP3) {
    pubMax = 80; citMax = 20; conMax = 25; grantMax = 50; visitMax = 10; memMax = 10; fdpMax = 15; mandMax = 10;
    pubsMarks         = _clamp(rawPubPoints, 0, pubMax);
    citationsMarks    = _clamp(0.5 * citations, 0, citMax);
    kprietCitMarks    = _clamp(0.5 * kprietCitations, 0, Math.max(0, citMax - citationsMarks));
    consultancyMarks  = _clamp(consultancyRevenue > 0 ? (consultancyRevenue / 200000) * 25 : 0, 0, conMax);
    proposalsMarks    = _clamp(5 * sponsoredGrantsCount, 0, 15);
    // [FIX 2] Grant amount: 10K=2M, 15K=3M, …, 2L=40M — but AP3 cap is lower (grantMax-proposalsMax=35)
    grantsAmountMarks = calcGrantAmountMarks(sponsoredGrantsAmount, 35);
    sponsoredCombined = _clamp(proposalsMarks + grantsAmountMarks, 0, grantMax);
    researchVisitsMarks = _clamp(10 * researchVisits, 0, visitMax);
    membershipsMarks    = _clamp(10 * membershipsCount, 0, memMax);
    fdpMarks            = _clamp(1 * fdpDaysPhys + 0.5 * fdpDaysOnline + 4 * mooc4w, 0, fdpMax);
    mandatoryMarks      = _clamp(10 * mandatoryCourses, 0, mandMax);

  } else if (isASP) {
    pubMax = 90; citMax = 30; conMax = 25; grantMax = 50; visitMax = 10; memMax = 5; fdpMax = 10; mandMax = 10;
    pubsMarks         = _clamp(rawPubPoints, 0, pubMax);
    citationsMarks    = _clamp(0.5 * citations, 0, citMax);
    kprietCitMarks    = _clamp(0.5 * kprietCitations, 0, Math.max(0, citMax - citationsMarks));
    consultancyMarks  = _clamp(consultancyRevenue > 0 ? (consultancyRevenue / 200000) * 25 : 0, 0, conMax);
    proposalsMarks    = _clamp(5 * sponsoredGrantsCount, 0, 15);
    grantsAmountMarks = calcGrantAmountMarks(sponsoredGrantsAmount, 35);
    sponsoredCombined = _clamp(proposalsMarks + grantsAmountMarks, 0, grantMax);
    researchVisitsMarks = _clamp(10 * researchVisits, 0, visitMax);
    membershipsMarks    = _clamp(5 * membershipsCount, 0, memMax);
    fdpMarks            = _clamp(1 * fdpDaysPhys + 0.5 * fdpDaysOnline + 4 * mooc4w, 0, fdpMax);
    mandatoryMarks      = _clamp(10 * mandatoryCourses, 0, mandMax);

  } else {
    // AP I / AP II
    // [FIX 1] Publications max 75; patents now included inside this cap
    pubMax = 75; citMax = 15; conMax = 20; grantMax = 40; visitMax = 10; memMax = 10; fdpMax = 20; mandMax = 10;
    pubsMarks         = _clamp(rawPubPoints, 0, pubMax);
    // [FIX 6] 7a: 1 pt/citation; 7b: 0.5 pt/KPRIET citation; combined share cap=15
    citationsMarks    = _clamp(1 * citations, 0, citMax);
    kprietCitMarks    = _clamp(0.5 * kprietCitations, 0, Math.max(0, citMax - citationsMarks));
    consultancyMarks  = _clamp(consultancyRevenue > 0 ? (consultancyRevenue / 200000) * 20 : 0, 0, conMax);
    proposalsMarks    = _clamp(5 * sponsoredGrantsCount, 0, 15);
    // [FIX 2] Grant amount doc rubric: 10K=2M, 15K=3M … >=2L=40M
    grantsAmountMarks = calcGrantAmountMarks(sponsoredGrantsAmount, 40);
    sponsoredCombined = _clamp(proposalsMarks + grantsAmountMarks, 0, grantMax);
    researchVisitsMarks = _clamp(10 * researchVisits, 0, visitMax);
    membershipsMarks    = _clamp(10 * membershipsCount, 0, memMax);
    fdpMarks            = _clamp(1 * fdpDaysPhys + 0.5 * fdpDaysOnline + 4 * mooc4w, 0, fdpMax);
    mandatoryMarks      = _clamp(10 * mandatoryCourses, 0, mandMax);
  }

  const researchTotal = _clamp(
    pubsMarks + citationsMarks + kprietCitMarks + consultancyMarks +
    sponsoredCombined + researchVisitsMarks + membershipsMarks + fdpMarks + mandatoryMarks,
    0, MAXS.research
  );

  /* ── ADMINISTRATION ────────────────────────────────────────────────── */
  // [FIX 3] Sections 14+15 share max 20 for AP12 (doc confirmed).
  //         Sec 14: Physical 3pts/day, Online 2pts/day, Guest 2pts/entry, Committee 1pt
  //         Sec 15: a)3pts b)2pts c)1pt — these are distinct event scoring
  //         Both sections combined are capped at 20 for AP12.
  const adminConvenerEventsMax = isASP ? 30 : (isAP3 ? 25 : 20);
  const convenerRaw   = 3 * convenerDays + 2 * convenerOnlineDays + 2 * guestHours + 1 * committeeEvents;
  const eventsRaw     = 3 * eventsA + 2 * eventsB + 1 * eventsC;
  const convenerEventsMarks = _clamp(convenerRaw + eventsRaw, 0, adminConvenerEventsMax);

  const respMax   = isASP ? 35 : (isAP3 ? 30 : 30);
  const respMarks = _clamp(10 * headCount + 5 * memberCount, 0, respMax);

  const adminTotal = _clamp(convenerEventsMarks + respMarks, 0, MAXS.admin);

  /* ── OUTREACH ──────────────────────────────────────────────────────── */
  const commCap  = isASP ? 10 : (isAP3 ? 15 : 30);
  const trainCap = isASP ? 20 : (isAP3 ? 20 : 30);
  const communityMarks = _clamp(10 * outreachActivities, 0, commCap);
  // Resource person: Outside 3pt/entry, Inside 2pt/entry (doc says 3pt/hr, 2pt/hr)
  const resourceMarks  = _clamp(3 * resourceOutsideHours + 2 * resourceInsideHours, 0, 20);
  const trainingMarks  = _clamp((trainingDays / 14) * trainCap, 0, trainCap);
  const awardsMarks    = _clamp(5 * awardsCount, 0, 20);
  const recognitionMarks = _clamp(4 * editorialCount + 1 * reviewsCount, 0, 20);
  const awardsTotal    = _clamp(awardsMarks + recognitionMarks, 0, 20);
  const outreachTotal  = _clamp(communityMarks + resourceMarks + trainingMarks + awardsTotal, 0, MAXS.outreach);

  const grandTotal = Math.round(academicTotal + researchTotal + adminTotal + outreachTotal);

  return {
    perRow: {
      academic: { passMarks, fbMarks, videosMarks, sdgMarks, vacMarks, achieveMarks, sec5Marks, sec5Cap },
      research: {
        pubsMarks, citationsMarks, kprietCitMarks, consultancyMarks,
        proposalsMarks, grantsAmountMarks, sponsoredCombined,
        researchVisitsMarks, membershipsMarks, fdpMarks, mandatoryMarks,
      },
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

/* ═══════════════════════════════════════════════════════════════════════════
   SCORING — HOD / PG Coordinator
═══════════════════════════════════════════════════════════════════════════ */
function calcScoreHOD({
  deptPassPercent, industryLabs, newTracks, placementPct, medianSalary,
  gatePct, higherStudiesPct, moocStudentPct, studentAchievements,
  avgPublications, consultancyRevenue2L, studentProjectConv,
  grantsReceived10L, mouCount, studyVisitsCount,
  visitingFacultyCount, facultyRetentionPct, enrolmentPct,
  profMembershipsEvents, localBodyInteractions, trainingRevenue, uniqueAwards,
  passPercent, studentFeedback, publications, citations, consultancySelf,
  grantsCountSelf, grantsAmtSelf, phdCompleted, phdPursuing,
  membershipsCount, fdpDaysPhys, fdpDaysOnline, mooc4w, mandatoryCourses,
  resourceOutsideHours, resourceInsideHours,
}) {
  // Sec 1–8: Academic (150)
  const s1  = _clamp(calcPassMarks(deptPassPercent, 20), 0, 20);
  const s2  = _clamp((_toInt(industryLabs) >= 1) ? 20 : 0, 0, 20);
  const s3  = _clamp((_toInt(newTracks) >= 1) ? 20 : 0, 0, 20);
  const s4a = _clamp((_toFloat(placementPct) / 100) * 20, 0, 20);
  const s4b = _clamp((_toFloat(medianSalary) > 0) ? 10 : 0, 0, 10);
  const s5  = _clamp(2 * _toFloat(gatePct) + 0.5 * _toFloat(gatePct), 0, 10);
  const s6  = _clamp((_toFloat(higherStudiesPct) >= 75) ? 10 : 0, 0, 10);
  const s7  = _clamp((_toFloat(moocStudentPct) >= 61) ? _toFloat(moocStudentPct) / 5 : 0, 0, 20);
  const s8  = _clamp(2 * (_toFloat(studentAchievements) / 100) * 20, 0, 20);
  const academicTotal = _clamp(s1 + s2 + s3 + s4a + s4b + s5 + s6 + s7 + s8, 0, 150);

  // Sec 9–14: R&D (150)
  const r9  = _clamp((_toFloat(avgPublications) / 3) * 30, 0, 30);
  const r10 = _clamp((_toFloat(consultancyRevenue2L) / 200000) * 30, 0, 30);
  const r11 = _clamp((_toFloat(studentProjectConv) / 100) * 30, 0, 30);
  const r12 = _clamp((_toFloat(grantsReceived10L) / 1000000) * 30, 0, 30);
  const r13 = _clamp((_toInt(mouCount) / 2) * 10, 0, 10);
  const r14 = _clamp(_toInt(studyVisitsCount) * 10, 0, 20);
  const researchTotal = _clamp(r9 + r10 + r11 + r12 + r13 + r14, 0, 150);

  // Sec 15–17: Admin (50)
  const a15 = _clamp((_toInt(visitingFacultyCount) >= 1) ? 10 : 0, 0, 10);
  const a16 = _clamp((_toFloat(facultyRetentionPct) >= 90) ? 10 : 0, 0, 10);
  const a17 = _clamp((_toFloat(enrolmentPct) / 100) * 30, 0, 30);
  const adminTotal = _clamp(a15 + a16 + a17, 0, 50);

  // Sec 18–21: Outreach (50)
  const o18 = _clamp((_toInt(profMembershipsEvents) >= 4) ? 10 : 0, 0, 10);
  const o19 = _clamp(_toInt(localBodyInteractions) * 5, 0, 10);
  const o20 = _clamp((_toFloat(trainingRevenue) / 50000) * 20, 0, 20);
  const o21 = _clamp(_toInt(uniqueAwards) * 10, 0, 10);
  const outreachTotal = _clamp(o18 + o19 + o20 + o21, 0, 50);

  // Self section 22–25 (100)
  const selfPassMarks = _clamp(calcPassMarks(passPercent, 10), 0, 10);
  const selfFbMarks   = _clamp(calcFbMarks(studentFeedback, 10), 0, 10);
  const selfPubMarks  = _clamp(25 * publications, 0, 60);
  const selfCitMarks  = _clamp(0.5 * citations, 0, 10);
  const selfConMarks  = _clamp(consultancySelf > 0 ? (consultancySelf / 200000) * 10 : 0, 0, 10);
  const selfGrantMarks = _clamp(5 * grantsCountSelf, 0, 10);
  const selfPhdMarks  = _clamp(10 * _toInt(phdCompleted) + 4 * _toInt(phdPursuing), 0, 20);
  const selfMemMarks  = _clamp(5 * membershipsCount, 0, 20);
  const selfFdpMarks  = _clamp(1 * fdpDaysPhys + 0.5 * fdpDaysOnline + 4 * mooc4w, 0, 10);
  const selfMandMarks = _clamp(10 * mandatoryCourses, 0, 10);
  const selfResMarks  = _clamp(3 * resourceOutsideHours + 2 * resourceInsideHours, 0, 10);
  const selfTotal = _clamp(
    selfPassMarks + selfFbMarks + selfPubMarks + selfCitMarks + selfConMarks +
    selfGrantMarks + selfPhdMarks + selfMemMarks + selfFdpMarks + selfMandMarks + selfResMarks,
    0, 100
  );

  const grandTotal = Math.round(academicTotal + researchTotal + adminTotal + outreachTotal + selfTotal);
  return {
    totals: {
      academic: Math.round(academicTotal), research: Math.round(researchTotal),
      admin: Math.round(adminTotal), outreach: Math.round(outreachTotal),
      self: Math.round(selfTotal), total: grandTotal,
    },
    MAXS: { academic: 150, research: 150, admin: 50, outreach: 50, self: 100, grand: 500 },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORING — CFRD
═══════════════════════════════════════════════════════════════════════════ */
function calcScoreCFRD({ passPercent, studentFeedback, researchTraining, publications, grantsRevenue, phdCompleted, phdPursuing, resourceHours }) {
  const s1 = _clamp(calcPassMarks(passPercent, 20), 0, 20);
  const s2 = _clamp(calcFbMarks(studentFeedback, 20), 0, 20);
  const s3 = _clamp(_toFloat(researchTraining) * 2, 0, 10);
  const academicTotal = _clamp(s1 + s2 + s3, 0, 50);
  const pubMarks  = _clamp(25 * publications, 0, 225);
  const grantMark = _clamp((_toFloat(grantsRevenue) / 100000) * 10, 0, 195);
  const phdMarks  = _clamp(10 * _toInt(phdCompleted) + 4 * _toInt(phdPursuing), 0, 15);
  const resMarks  = _clamp(_toFloat(resourceHours) * 2, 0, 15);
  const researchTotal = _clamp(pubMarks + grantMark + phdMarks + resMarks, 0, 450);
  const grandTotal = Math.round(academicTotal + researchTotal);
  return {
    totals: { academic: Math.round(academicTotal), research: Math.round(researchTotal), total: grandTotal },
    MAXS: { academic: 50, research: 450, grand: 500 },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORING — Physical Education
═══════════════════════════════════════════════════════════════════════════ */
function calcScorePE({ sportsQuota, practising, stateEvents, nationalEvents, promotionalEvents, venuePartner, revenue, feedback, studentAchievements }) {
  const s1 = _clamp(_toFloat(sportsQuota) >= 100 ? 10 : (_toFloat(sportsQuota) / 100) * 10, 0, 10);
  const s2 = _clamp(_toFloat(practising) * 2, 0, 10);
  const s3 = _clamp(_toFloat(stateEvents), 0, 100);
  const s4 = _clamp(_toInt(nationalEvents) * 10, 0, 50);
  const s5 = _clamp(_toInt(promotionalEvents) * 5, 0, 50);
  const s6 = _clamp(_toInt(venuePartner) * 2, 0, 10);
  const s7 = _clamp((_toFloat(revenue) / 10000) * 1, 0, 10);
  const s8 = _clamp((_toFloat(feedback) / 5) * 10, 0, 10);
  const s9 = _clamp(_toFloat(studentAchievements), 0, 250);
  const total = Math.round(_clamp(s1 + s2 + s3 + s4 + s5 + s6 + s7 + s8 + s9, 0, 500));
  return { totals: { total }, MAXS: { grand: 500 } };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORING — Non-Teaching PO/JA
═══════════════════════════════════════════════════════════════════════════ */
function calcScoreNTP({ fiveS, training, feedback, beyondHours, branding, headAssessment }) {
  const s1 = _clamp(_toInt(fiveS) * 2, 0, 10);
  const s2 = _clamp(_toInt(training) * 3, 0, 10);
  const s3 = _clamp(_toFloat(feedback) >= 70 ? (_toFloat(feedback) - 70) / (90 - 70) * 20 : 0, 0, 20);
  const s4 = _clamp(_toFloat(beyondHours), 0, 20);
  const s5 = _clamp(_toInt(branding) * 5, 0, 10);
  const s6 = _clamp(_toFloat(headAssessment), 0, 20);
  const total = Math.round(_clamp(s1 + s2 + s3 + s4 + s5 + s6, 0, 100));
  return { totals: { total }, MAXS: { grand: 100 } };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORING — Non-Teaching Lab
═══════════════════════════════════════════════════════════════════════════ */
function calcScoreNTL({ fiveS, safety, equipment, beyondHours, training, projects, consultancy, events, branding, hodFeedback }) {
  const s1  = _clamp(_toInt(fiveS) * 2, 0, 10);
  const s2  = _clamp(_toFloat(safety) >= 1 ? 10 : 0, 0, 10);
  const s3  = _clamp(_toFloat(equipment) >= 100 ? 10 : 0, 0, 10);
  const s4  = _clamp(_toInt(beyondHours) * 3, 0, 10);
  const s5  = _clamp(_toInt(training) * 3, 0, 10);
  const s6  = _clamp(2 * _toInt(projects), 0, 10);
  const s7  = _clamp(_toInt(consultancy) * 2, 0, 10);
  const s8  = _clamp(_toInt(events) * 1, 0, 10);
  const s9  = _clamp(_toInt(branding) * 5, 0, 10);
  const s10 = _clamp(_toFloat(hodFeedback), 0, 10);
  const total = Math.round(_clamp(s1 + s2 + s3 + s4 + s5 + s6 + s7 + s8 + s9 + s10, 0, 100));
  return { totals: { total }, MAXS: { grand: 100 } };
}

/* ═══════════════════════════════════════════════════════════════════════════
   REUSABLE KPI TABLE
═══════════════════════════════════════════════════════════════════════════ */
function KPITable({ columns, rows, onAddRow, onRemoveRow, onUpdateRow, editable, minRows = 0, emptyLabel = "No entries yet. Click ＋ to add." }) {
  return (
    <div className="kpi-table-wrap">
      <table className="kpi-table">
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={{ width: col.width || "auto", textAlign: col.align || "left" }}>{col.label}</th>
            ))}
            {editable && <th style={{ width: 56, textAlign: "center" }}>Act.</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length + (editable ? 1 : 0)} style={{ textAlign: "center", color: "rgba(100,120,160,0.5)", padding: "14px 8px", fontSize: 12, fontStyle: "italic" }}>{emptyLabel}</td></tr>
          )}
          {rows.map((row, idx) => (
            <tr key={idx} className="kpi-table-row">
              {columns.map(col => (
                <td key={col.key} style={{ textAlign: col.align || "left" }}>
                  {col.type === "number" ? (
                    <input type="number" className="course-input" placeholder={col.placeholder || "0"} value={row[col.key] ?? ""} min={col.min ?? 0} max={col.max} step={col.step || "1"} onChange={e => onUpdateRow(idx, col.key, e.target.value)} disabled={!editable} />
                  ) : col.type === "select" ? (
                    <select className="course-input" value={row[col.key] ?? ""} onChange={e => onUpdateRow(idx, col.key, e.target.value)} disabled={!editable}>
                      <option value="">Select…</option>
                      {(col.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : col.type === "computed" ? (
                    <span className="computed-cell">{col.compute(row)}</span>
                  ) : (
                    <input type="text" className="course-input" placeholder={col.placeholder || ""} value={row[col.key] ?? ""} onChange={e => onUpdateRow(idx, col.key, e.target.value)} disabled={!editable} />
                  )}
                </td>
              ))}
              {editable && (
                <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  <button type="button" className="act-btn add" title="Add row below" onClick={() => onAddRow(idx)}>＋</button>
                  {rows.length > minRows && <button type="button" className="act-btn rem" title="Remove row" onClick={() => onRemoveRow(idx)}>✕</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && rows.length === 0 && (
        <div style={{ padding: "4px 0 2px" }}>
          <button type="button" className="btn-add-first" onClick={() => onAddRow(-1)}>＋ Add first entry</button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION
═══════════════════════════════════════════════════════════════════════════ */
function Section({ number, title, rubric, max, score, proofComponent, children }) {
  const [open, setOpen] = useState(true);
  const hasScore = score > 0;
  return (
    <div className="kpi-section">
      <div className="kpi-section-header" onClick={() => setOpen(v => !v)}>
        <div className="kpi-section-left">
          <span className="kpi-num">{number}</span>
          <div style={{ minWidth: 0 }}>
            <div className="kpi-title">{title}</div>
            {rubric && <div className="kpi-rubric">{rubric}</div>}
          </div>
        </div>
        <div className="kpi-section-right">
          {proofComponent && <div onClick={e => e.stopPropagation()}>{proofComponent}</div>}
          {max > 0 && <div className="kpi-max">Max <strong>{max}</strong></div>}
          {max > 0 && <div className="kpi-badge" style={{ background: hasScore ? "#e8f5ee" : "#f0f4f8", color: hasScore ? "#1a7f4f" : "#a0aec0", border: hasScore ? "1px solid #b2dfcc" : "1px solid #e2e8f0" }}>{score}</div>}
          <span className="kpi-chevron">{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && children && <div className="kpi-section-body">{children}</div>}
    </div>
  );
}

/* Section Total Bar */
function SectionTotal({ label, max, value, isGrand = false }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`section-total${isGrand ? " grand" : ""}`}>
      <div className="st-left">{label}</div>
      <div className="st-right">
        <div className="st-bar-wrap"><div className="st-bar" style={{ width: `${pct}%`, background: isGrand ? "linear-gradient(90deg,#6a11cb,#2575fc)" : "rgba(37,117,252,0.5)" }} /></div>
        <div className="st-score"><span className="st-val">{value}</span><span className="st-max"> / {max}</span></div>
      </div>
    </div>
  );
}

function SBH({ text }) { return <div className="section-block-header">{text}</div>; }

/* ═══════════════════════════════════════════════════════════════════════════
   SIMPLE METRIC INPUT
═══════════════════════════════════════════════════════════════════════════ */
function MetricInput({ label, value, onChange, type = "number", step = "1", min = 0, max, editable = true, note }) {
  return (
    <div className="metric-input-row">
      <label className="metric-label">{label}</label>
      <div className="metric-right">
        {type === "select"
          ? <select className="course-input metric-field" value={value} onChange={e => onChange(e.target.value)} disabled={!editable}>
            {(max || []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          : <input type={type} className="course-input metric-field" value={value} step={step} min={min} onChange={e => onChange(e.target.value)} disabled={!editable} />
        }
        {note && <span className="metric-note">{note}</span>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FILE ATTACH
═══════════════════════════════════════════════════════════════════════════ */
function FileAttach({ row, activityFiles, existingActivityProofs, onAdd, onRemove, editable }) {
  const newFiles = activityFiles[row] || [];
  const existing = existingActivityProofs[row] || [];
  return (
    <div className="file-attach-wrap">
      {editable && (
        <>
          <input id={`far-${row}`} type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" multiple style={{ display: "none" }} onChange={e => { onAdd(row, Array.from(e.target.files || [])); e.target.value = ""; }} />
          <label htmlFor={`far-${row}`} className="btn-attach">📎 Attach</label>
        </>
      )}
      {existing.map((p, i) => (
        <div key={`ex${i}`} className="file-chip existing">{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.name}</a> : p.name}</div>
      ))}
      {newFiles.map((f, i) => (
        <div key={`nw${i}`} className="file-chip new"><span title={f.name}>{f.name}</span>{editable && <button type="button" className="chip-x" onClick={() => onRemove(row, i)}>✕</button>}</div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TABLE ROW HOOKS FACTORY
═══════════════════════════════════════════════════════════════════════════ */
function makeHooks(setter) {
  return {
    add: (afterIdx) => setter(prev => {
      const tpl = prev[0] ? Object.fromEntries(Object.keys(prev[0]).map(k => [k, ""])) : {};
      const next = [...prev]; next.splice(Math.max(0, afterIdx + 1), 0, { ...tpl }); return next;
    }),
    remove: (idx) => setter(prev => prev.filter((_, i) => i !== idx)),
    update: (idx, field, value) => setter(prev => { const next = [...prev]; next[idx] = { ...next[idx], [field]: value }; return next; }),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORE STRIP
═══════════════════════════════════════════════════════════════════════════ */
function ScoreStrip({ strips, grandTotal, grandMax }) {
  return (
    <div className="score-strip">
      {strips.map(s => (
        <div key={s.label} className="score-chip">
          <div className="sc-label">{s.label}</div>
          <div className="sc-val">{s.val}<span className="sc-max">/{s.max}</span></div>
          <div className="sc-bar-bg"><div className="sc-bar-fill" style={{ width: `${Math.min(100, (s.val / s.max) * 100)}%` }} /></div>
        </div>
      ))}
      <div className="score-chip grand">
        <div className="sc-label">Grand Total</div>
        <div className="sc-val">{grandTotal}<span className="sc-max">/{grandMax}</span></div>
        <div className="sc-bar-bg"><div className="sc-bar-fill grand" style={{ width: `${Math.min(100, (grandTotal / grandMax) * 100)}%` }} /></div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function SubmissionForm({
  apiBase = "http://127.0.0.1:8000",
  submission = null,
  editable = true,
  onSubmitted = () => { },
  onCancel = () => { },
}) {
  /* ── Meta ── */
  const [facultyRank, setFacultyRank]   = useState("AP I");
  const [academicYear, setAcademicYear] = useState("2024-2025");
  const [submitting, setSubmitting]     = useState(false);
  const [statusMsg, setStatusMsg]       = useState("");

  const rankType   = useMemo(() => getRankType(facultyRank), [facultyRank]);
  const isAPFamily = ["AP12", "AP3", "ASP"].includes(rankType);
  const isAP3comp  = rankType === "AP3";
  const isASPcomp  = rankType === "ASP";
  const isHOD      = rankType === "HOD";
  const isCFRD     = rankType === "CFRD";
  const isPE       = rankType === "PE";
  const isNTP      = rankType === "NTP";
  const isNTL      = rankType === "NTL";

  /* ── Table state ── */
  const [eseCourses,      setEseCourses]      = useState([{ course: "", semester: "", className: "", appeared: "", passed: "" }]);
  const [feedbackCourses, setFeedbackCourses] = useState([{ course: "", semester: "", className: "", feedback: "" }]);
  const [videoRows,       setVideoRows]       = useState([]);
  const [sdgRows,         setSdgRows]         = useState([]);
  const [vacRows,         setVacRows]         = useState([]);
  const [achievementRows, setAchievementRows] = useState([]);
  const [sympPubRows,     setSympPubRows]     = useState([]);
  // [FIX 1] Combined publications + patents table (indexing field includes "Patent Published" / "Patent Granted")
  const [pubRows,         setPubRows]         = useState([]);
  const [citationRows,    setCitationRows]    = useState([]);
  const [kprietCitRows,   setKprietCitRows]   = useState([]);
  const [consultancyRows, setConsultancyRows] = useState([]);
  const [grantRows,       setGrantRows]       = useState([]);
  const [visitRows,       setVisitRows]       = useState([]);
  const [phdRows,         setPhdRows]         = useState([]);
  const [membershipRows,  setMembershipRows]  = useState([]);
  const [fdpRows,         setFdpRows]         = useState([]);
  const [mandatoryRows,   setMandatoryRows]   = useState([]);
  const [eventRows,       setEventRows]       = useState([]);
  const [respRows,        setRespRows]        = useState([]);
  const [internshipRows,  setInternshipRows]  = useState([]);
  const [mouRows,         setMouRows]         = useState([]);
  const [communityRows,   setCommunityRows]   = useState([]);
  const [resourceRows,    setResourceRows]    = useState([]);
  const [trainingRows,    setTrainingRows]    = useState([]);
  const [awardRows,       setAwardRows]       = useState([]);
  const [recognitionRows, setRecognitionRows] = useState([]);

  /* ── HOD scalars ── */
  const [hodDeptPass,        setHodDeptPass]        = useState("");
  const [hodIndustryLabs,    setHodIndustryLabs]    = useState("");
  const [hodNewTracks,       setHodNewTracks]       = useState("");
  const [hodPlacement,       setHodPlacement]       = useState("");
  const [hodMedianSalary,    setHodMedianSalary]    = useState("");
  const [hodGatePct,         setHodGatePct]         = useState("");
  const [hodHigherStudies,   setHodHigherStudies]   = useState("");
  const [hodMoocStudents,    setHodMoocStudents]    = useState("");
  const [hodStudentAch,      setHodStudentAch]      = useState("");
  const [hodAvgPub,          setHodAvgPub]          = useState("");
  const [hodConsultancy2L,   setHodConsultancy2L]   = useState("");
  const [hodProjectConv,     setHodProjectConv]     = useState("");
  const [hodGrants10L,       setHodGrants10L]       = useState("");
  const [hodMouCount,        setHodMouCount]        = useState("");
  const [hodStudyVisits,     setHodStudyVisits]     = useState("");
  const [hodVisitingFaculty, setHodVisitingFaculty] = useState("");
  const [hodFacultyRetention,setHodFacultyRetention]= useState("");
  const [hodEnrolment,       setHodEnrolment]       = useState("");
  const [hodProfEvents,      setHodProfEvents]      = useState("");
  const [hodLocalBodies,     setHodLocalBodies]     = useState("");
  const [hodTrainingRev,     setHodTrainingRev]     = useState("");
  const [hodUniqueAwards,    setHodUniqueAwards]    = useState("");

  /* ── CFRD scalars ── */
  const [cfrdResearchTraining, setCfrdResearchTraining] = useState("");
  const [cfrdGrantsRevenue,    setCfrdGrantsRevenue]    = useState("");
  const [cfrdPhdCompleted,     setCfrdPhdCompleted]     = useState("");
  const [cfrdPhdPursuing,      setCfrdPhdPursuing]      = useState("");
  const [cfrdResourceHours,    setCfrdResourceHours]    = useState("");

  /* ── PE scalars ── */
  const [peSportsQuota,    setPeSportsQuota]    = useState("");
  const [pePractising,     setPePractising]     = useState("");
  const [peStateEvents,    setPeStateEvents]    = useState("");
  const [peNationalEvents, setPeNationalEvents] = useState("");
  const [pePromoEvents,    setPePromoEvents]    = useState("");
  const [peVenuePartner,   setPeVenuePartner]   = useState("");
  const [peRevenue,        setPeRevenue]        = useState("");
  const [peFeedback,       setPeFeedback]       = useState("");
  const [peStudentAch,     setPeStudentAch]     = useState("");

  /* ── NTP scalars ── */
  const [ntpFiveS,     setNtpFiveS]     = useState("");
  const [ntpTraining,  setNtpTraining]  = useState("");
  const [ntpFeedback,  setNtpFeedback]  = useState("");
  const [ntpBeyond,    setNtpBeyond]    = useState("");
  const [ntpBranding,  setNtpBranding]  = useState("");
  const [ntpHeadScore, setNtpHeadScore] = useState("");

  /* ── NTL scalars ── */
  const [ntlFiveS,       setNtlFiveS]       = useState("");
  const [ntlSafety,      setNtlSafety]      = useState("");
  const [ntlEquipment,   setNtlEquipment]   = useState("");
  const [ntlBeyond,      setNtlBeyond]      = useState("");
  const [ntlTraining,    setNtlTraining]    = useState("");
  const [ntlProjects,    setNtlProjects]    = useState("");
  const [ntlConsultancy, setNtlConsultancy] = useState("");
  const [ntlEvents,      setNtlEvents]      = useState("");
  const [ntlBranding,    setNtlBranding]    = useState("");
  const [ntlHodFeedback, setNtlHodFeedback] = useState("");

  /* ── Hooks ── */
  const ese   = useMemo(() => makeHooks(setEseCourses), []);
  const fb    = useMemo(() => makeHooks(setFeedbackCourses), []);
  const vid   = useMemo(() => makeHooks(setVideoRows), []);
  const sdg   = useMemo(() => makeHooks(setSdgRows), []);
  const vac   = useMemo(() => makeHooks(setVacRows), []);
  const ach   = useMemo(() => makeHooks(setAchievementRows), []);
  const symp  = useMemo(() => makeHooks(setSympPubRows), []);
  const pub   = useMemo(() => makeHooks(setPubRows), []);
  const cit   = useMemo(() => makeHooks(setCitationRows), []);
  const kpc   = useMemo(() => makeHooks(setKprietCitRows), []);
  const con   = useMemo(() => makeHooks(setConsultancyRows), []);
  const grt   = useMemo(() => makeHooks(setGrantRows), []);
  const vis   = useMemo(() => makeHooks(setVisitRows), []);
  const phd   = useMemo(() => makeHooks(setPhdRows), []);
  const mem   = useMemo(() => makeHooks(setMembershipRows), []);
  const fdp   = useMemo(() => makeHooks(setFdpRows), []);
  const mand  = useMemo(() => makeHooks(setMandatoryRows), []);
  const evt   = useMemo(() => makeHooks(setEventRows), []);
  const resp  = useMemo(() => makeHooks(setRespRows), []);
  const intern = useMemo(() => makeHooks(setInternshipRows), []);
  const mou   = useMemo(() => makeHooks(setMouRows), []);
  const comm  = useMemo(() => makeHooks(setCommunityRows), []);
  const res   = useMemo(() => makeHooks(setResourceRows), []);
  const train = useMemo(() => makeHooks(setTrainingRows), []);
  const awd   = useMemo(() => makeHooks(setAwardRows), []);
  const recog = useMemo(() => makeHooks(setRecognitionRows), []);

  /* ── Derived scoring values ── */
  const passPercent = useMemo(() => {
    const v = eseCourses.filter(r => r.appeared !== "" && r.passed !== "");
    if (!v.length) return 0;
    const sum = v.reduce((s, r) => { const a = _toFloat(r.appeared), p = _toFloat(r.passed); return s + (a > 0 ? (p / a) * 100 : 0); }, 0);
    return Math.round((sum / v.length) * 10) / 10;
  }, [eseCourses]);

  const studentFeedback = useMemo(() => {
    const v = feedbackCourses.filter(r => r.feedback !== "");
    if (!v.length) return 0;
    return Math.round((v.reduce((s, r) => s + _toFloat(r.feedback), 0) / v.length) * 10) / 10;
  }, [feedbackCourses]);

  const onlineVideos    = useMemo(() => videoRows.filter(r => r.title || r.link).length, [videoRows]);
  const sdgActivities   = useMemo(() => sdgRows.filter(r => r.topic || r.method).length, [sdgRows]);
  const vacHours        = useMemo(() => vacRows.reduce((s, r) => s + _toFloat(r.hours), 0), [vacRows]);
  const achievementPoints = useMemo(() => achievementRows.filter(r => r.student || r.competition).length * 4, [achievementRows]);
  const kprietCitations = useMemo(() => kprietCitRows.reduce((s, r) => s + _toInt(r.cited), 0), [kprietCitRows]);
  const sympPubs        = useMemo(() => sympPubRows.filter(r => r.title || r.conference).length, [sympPubRows]);
  const publications    = useMemo(() => pubRows.filter(r => r.title).length, [pubRows]);
  const citations       = useMemo(() => citationRows.reduce((s, r) => s + _toInt(r.citations), 0), [citationRows]);
  const consultancyRevenue    = useMemo(() => consultancyRows.reduce((s, r) => s + _toFloat(r.amount), 0), [consultancyRows]);
  const sponsoredGrantsCount  = useMemo(() => grantRows.filter(r => r.title).length, [grantRows]);
  const sponsoredGrantsAmount = useMemo(() => grantRows.reduce((s, r) => s + _toFloat(r.amount), 0), [grantRows]);
  const researchVisits        = useMemo(() => visitRows.filter(r => r.lab).length, [visitRows]);
  const phdCompleted          = useMemo(() => phdRows.filter(r => r.status === "Completed").length, [phdRows]);
  const phdPursuing           = useMemo(() => phdRows.filter(r => r.status !== "Completed" && r.scholar).length, [phdRows]);
  const membershipsCount      = useMemo(() => membershipRows.filter(r => r.society).length, [membershipRows]);
  const fdpDaysPhys  = useMemo(() => fdpRows.filter(r => r.mode === "Physical" || r.mode === "F2F").reduce((s, r) => { const f = r.from ? new Date(r.from) : null, t = r.to ? new Date(r.to) : null; return s + (f && t && !isNaN(f) && !isNaN(t) && t >= f ? Math.round((t - f) / 86400000) + 1 : 1); }, 0), [fdpRows]);
  const fdpDaysOnline = useMemo(() => fdpRows.filter(r => r.mode === "Online").reduce((s, r) => { const f = r.from ? new Date(r.from) : null, t = r.to ? new Date(r.to) : null; return s + (f && t && !isNaN(f) && !isNaN(t) && t >= f ? Math.round((t - f) / 86400000) + 1 : 1); }, 0), [fdpRows]);
  const mooc4w         = useMemo(() => fdpRows.filter(r => r.mode === "MOOC (4 weeks)").length, [fdpRows]);
  const mandatoryCourses = useMemo(() => mandatoryRows.filter(r => r.programme).length, [mandatoryRows]);

  // [FIX 3] Events — convener + Sec 15 events all feed into combined pool
  const convenerDays       = useMemo(() => eventRows.filter(r => r.role === "Convener/Coordinator" && r.mode !== "Online").length, [eventRows]);
  const convenerOnlineDays = useMemo(() => eventRows.filter(r => r.role === "Convener/Coordinator" && r.mode === "Online").length, [eventRows]);
  const guestHours         = useMemo(() => eventRows.filter(r => r.role === "Guest Lecture/Webinar").length, [eventRows]);
  const committeeEvents    = useMemo(() => eventRows.filter(r => r.role === "Committee Member").length, [eventRows]);
  const eventsA = useMemo(() => eventRows.filter(r => r.level === "National/International" && (r.role === "Convener/Coordinator" || r.role === "Organiser")).length, [eventRows]);
  const eventsB = useMemo(() => eventRows.filter(r => r.level === "Institute" && (r.role === "Convener/Coordinator" || r.role === "Organiser")).length, [eventRows]);
  const eventsC = useMemo(() => eventRows.filter(r => r.role === "Committee Member").length, [eventRows]);

  const headCount   = useMemo(() => respRows.filter(r => r.designation === "Head").length, [respRows]);
  const memberCount = useMemo(() => respRows.filter(r => r.designation === "Member" || r.designation === "Coordinator").length, [respRows]);
  const outreachActivities   = useMemo(() => communityRows.filter(r => r.activity).length, [communityRows]);
  const resourceOutsideHours = useMemo(() => resourceRows.filter(r => r.type === "Outside" && r.programme).length, [resourceRows]);
  const resourceInsideHours  = useMemo(() => resourceRows.filter(r => r.type === "Inside" && r.programme).length, [resourceRows]);
  const trainingDays         = useMemo(() => trainingRows.reduce((s, r) => s + _toFloat(r.days), 0), [trainingRows]);
  const awardsCount          = useMemo(() => awardRows.filter(r => r.title).length, [awardRows]);
  const editorialCount       = useMemo(() => recognitionRows.filter(r => r.role === "Editorial Board").length, [recognitionRows]);
  const reviewsCount         = useMemo(() => recognitionRows.filter(r => r.role === "Reviewer").length, [recognitionRows]);
  const conferencesOrganized = useMemo(() => eventRows.filter(r => r.level === "National/International").length, [eventRows]);
  const deptResponsibilities = useMemo(() => respRows.filter(r => r.responsibility).length, [respRows]);

  /* ── Compute scores ── */
  const apScore = useMemo(() => {
    if (!isAPFamily) return null;
    return calcScoreAPFamily({
      rankType, passPercent, studentFeedback, onlineVideos, sdgActivities, vacHours,
      sympPubs, pubRows,
      achievementPoints,
      citations, kprietCitations,
      consultancyRevenue, sponsoredGrantsCount, sponsoredGrantsAmount,
      researchVisits, membershipsCount, fdpDaysPhys, fdpDaysOnline, mooc4w, mandatoryCourses,
      convenerDays, convenerOnlineDays, guestHours, committeeEvents, eventsA, eventsB, eventsC,
      headCount, memberCount, outreachActivities, resourceOutsideHours, resourceInsideHours,
      trainingDays, awardsCount, editorialCount, reviewsCount,
      phdCount: phdCompleted, phdPursuing,
    });
  }, [isAPFamily, rankType, passPercent, studentFeedback, onlineVideos, sdgActivities, vacHours, sympPubs, pubRows, achievementPoints, citations, kprietCitations, consultancyRevenue, sponsoredGrantsCount, sponsoredGrantsAmount, researchVisits, membershipsCount, fdpDaysPhys, fdpDaysOnline, mooc4w, mandatoryCourses, convenerDays, convenerOnlineDays, guestHours, committeeEvents, eventsA, eventsB, eventsC, headCount, memberCount, outreachActivities, resourceOutsideHours, resourceInsideHours, trainingDays, awardsCount, editorialCount, reviewsCount, phdCompleted, phdPursuing]);

  const hodScore = useMemo(() => {
    if (!isHOD) return null;
    return calcScoreHOD({
      deptPassPercent: _toFloat(hodDeptPass), industryLabs: hodIndustryLabs, newTracks: hodNewTracks,
      placementPct: _toFloat(hodPlacement), medianSalary: _toFloat(hodMedianSalary),
      gatePct: _toFloat(hodGatePct), higherStudiesPct: _toFloat(hodHigherStudies),
      moocStudentPct: _toFloat(hodMoocStudents), studentAchievements: _toFloat(hodStudentAch),
      avgPublications: _toFloat(hodAvgPub), consultancyRevenue2L: _toFloat(hodConsultancy2L),
      studentProjectConv: _toFloat(hodProjectConv), grantsReceived10L: _toFloat(hodGrants10L),
      mouCount: hodMouCount, studyVisitsCount: hodStudyVisits,
      visitingFacultyCount: hodVisitingFaculty, facultyRetentionPct: _toFloat(hodFacultyRetention),
      enrolmentPct: _toFloat(hodEnrolment), profMembershipsEvents: hodProfEvents,
      localBodyInteractions: hodLocalBodies, trainingRevenue: _toFloat(hodTrainingRev),
      uniqueAwards: hodUniqueAwards,
      passPercent, studentFeedback, publications, citations,
      consultancySelf: consultancyRevenue, grantsCountSelf: sponsoredGrantsCount, grantsAmtSelf: sponsoredGrantsAmount,
      phdCompleted, phdPursuing, membershipsCount, fdpDaysPhys, fdpDaysOnline, mooc4w, mandatoryCourses,
      resourceOutsideHours, resourceInsideHours,
    });
  }, [isHOD, hodDeptPass, hodIndustryLabs, hodNewTracks, hodPlacement, hodMedianSalary, hodGatePct, hodHigherStudies, hodMoocStudents, hodStudentAch, hodAvgPub, hodConsultancy2L, hodProjectConv, hodGrants10L, hodMouCount, hodStudyVisits, hodVisitingFaculty, hodFacultyRetention, hodEnrolment, hodProfEvents, hodLocalBodies, hodTrainingRev, hodUniqueAwards, passPercent, studentFeedback, publications, citations, consultancyRevenue, sponsoredGrantsCount, sponsoredGrantsAmount, phdCompleted, phdPursuing, membershipsCount, fdpDaysPhys, fdpDaysOnline, mooc4w, mandatoryCourses, resourceOutsideHours, resourceInsideHours]);

  const cfrdScore = useMemo(() => {
    if (!isCFRD) return null;
    return calcScoreCFRD({ passPercent, studentFeedback, researchTraining: cfrdResearchTraining, publications, grantsRevenue: cfrdGrantsRevenue, phdCompleted: cfrdPhdCompleted, phdPursuing: cfrdPhdPursuing, resourceHours: cfrdResourceHours });
  }, [isCFRD, passPercent, studentFeedback, cfrdResearchTraining, publications, cfrdGrantsRevenue, cfrdPhdCompleted, cfrdPhdPursuing, cfrdResourceHours]);

  const peScore  = useMemo(() => { if (!isPE) return null; return calcScorePE({ sportsQuota: peSportsQuota, practising: pePractising, stateEvents: peStateEvents, nationalEvents: peNationalEvents, promotionalEvents: pePromoEvents, venuePartner: peVenuePartner, revenue: peRevenue, feedback: peFeedback, studentAchievements: peStudentAch }); }, [isPE, peSportsQuota, pePractising, peStateEvents, peNationalEvents, pePromoEvents, peVenuePartner, peRevenue, peFeedback, peStudentAch]);
  const ntpScore = useMemo(() => { if (!isNTP) return null; return calcScoreNTP({ fiveS: ntpFiveS, training: ntpTraining, feedback: ntpFeedback, beyondHours: ntpBeyond, branding: ntpBranding, headAssessment: ntpHeadScore }); }, [isNTP, ntpFiveS, ntpTraining, ntpFeedback, ntpBeyond, ntpBranding, ntpHeadScore]);
  const ntlScore = useMemo(() => { if (!isNTL) return null; return calcScoreNTL({ fiveS: ntlFiveS, safety: ntlSafety, equipment: ntlEquipment, beyondHours: ntlBeyond, training: ntlTraining, projects: ntlProjects, consultancy: ntlConsultancy, events: ntlEvents, branding: ntlBranding, hodFeedback: ntlHodFeedback }); }, [isNTL, ntlFiveS, ntlSafety, ntlEquipment, ntlBeyond, ntlTraining, ntlProjects, ntlConsultancy, ntlEvents, ntlBranding, ntlHodFeedback]);

  /* ── File state ── */
  const [proofFiles,             setProofFiles]             = useState([]);
  const [dragOver,               setDragOver]               = useState(false);
  const [activityFiles,          setActivityFiles]          = useState({});
  const [existingProofs,         setExistingProofs]         = useState([]);
  const [existingActivityProofs, setExistingActivityProofs] = useState({});
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;

  const onDropFile           = useCallback(e => { e.preventDefault(); setDragOver(false); const f = Array.from(e.dataTransfer?.files || []); if (f.length) setProofFiles(p => [...p, ...f]); }, []);
  const removeProofFile      = useCallback(idx => setProofFiles(p => p.filter((_, i) => i !== idx)), []);
  const handleActivityAdd    = useCallback((row, files) => setActivityFiles(p => ({ ...p, [row]: [...(p[row] || []), ...files] })), []);
  const handleActivityRemove = useCallback((row, idx) => setActivityFiles(p => { const n = { ...p }; n[row] = (n[row] || []).filter((_, i) => i !== idx); if (!n[row].length) delete n[row]; return n; }), []);
  const FAP = (row) => ({ row, activityFiles, existingActivityProofs, onAdd: handleActivityAdd, onRemove: handleActivityRemove, editable });

  /* ── Load submission ── */
  useEffect(() => {
    if (!submission) return;
    if (submission.faculty_rank)  setFacultyRank(submission.faculty_rank);
    if (submission.academic_year) setAcademicYear(submission.academic_year);
    const tryLoad = (key, setter) => { if (Array.isArray(submission[key]) && submission[key].length) setter(submission[key]); };
    tryLoad("ese_courses", setEseCourses); tryLoad("feedback_courses", setFeedbackCourses);
    tryLoad("video_rows", setVideoRows); tryLoad("sdg_rows", setSdgRows);
    tryLoad("vac_rows", setVacRows); tryLoad("achievement_rows", setAchievementRows); tryLoad("symp_pub_rows", setSympPubRows);
    tryLoad("pub_rows", setPubRows);
    tryLoad("citation_rows", setCitationRows); tryLoad("kpriet_citation_rows", setKprietCitRows);
    tryLoad("consultancy_rows", setConsultancyRows); tryLoad("grant_rows", setGrantRows);
    tryLoad("visit_rows", setVisitRows); tryLoad("phd_rows", setPhdRows);
    tryLoad("membership_rows", setMembershipRows); tryLoad("fdp_rows", setFdpRows);
    tryLoad("mandatory_rows", setMandatoryRows); tryLoad("event_rows", setEventRows);
    tryLoad("resp_rows", setRespRows); tryLoad("internship_rows", setInternshipRows);
    tryLoad("mou_rows", setMouRows); tryLoad("community_rows", setCommunityRows);
    tryLoad("resource_rows", setResourceRows); tryLoad("training_rows", setTrainingRows);
    tryLoad("award_rows", setAwardRows); tryLoad("recognition_rows", setRecognitionRows);
    const h = submission.hod_scalars || {};
    if (h.dept_pass) setHodDeptPass(h.dept_pass); if (h.industry_labs) setHodIndustryLabs(h.industry_labs);
    if (h.new_tracks) setHodNewTracks(h.new_tracks); if (h.placement) setHodPlacement(h.placement);
    if (h.median_salary) setHodMedianSalary(h.median_salary); if (h.gate_pct) setHodGatePct(h.gate_pct);
    if (h.higher_studies) setHodHigherStudies(h.higher_studies); if (h.mooc_students) setHodMoocStudents(h.mooc_students);
    if (h.student_ach) setHodStudentAch(h.student_ach); if (h.avg_pub) setHodAvgPub(h.avg_pub);
    if (h.consultancy_2l) setHodConsultancy2L(h.consultancy_2l); if (h.project_conv) setHodProjectConv(h.project_conv);
    if (h.grants_10l) setHodGrants10L(h.grants_10l); if (h.mou_count) setHodMouCount(h.mou_count);
    if (h.study_visits) setHodStudyVisits(h.study_visits); if (h.visiting_faculty) setHodVisitingFaculty(h.visiting_faculty);
    if (h.faculty_retention) setHodFacultyRetention(h.faculty_retention); if (h.enrolment) setHodEnrolment(h.enrolment);
    if (h.prof_events) setHodProfEvents(h.prof_events); if (h.local_bodies) setHodLocalBodies(h.local_bodies);
    if (h.training_rev) setHodTrainingRev(h.training_rev); if (h.unique_awards) setHodUniqueAwards(h.unique_awards);
    const gp = submission.proofs ?? submission.files ?? submission.attachments ?? [];
    if (Array.isArray(gp)) setExistingProofs(gp.map(p => typeof p === "string" ? { name: p, url: null } : p));
  }, [submission]);

  /* ── Submit ── */
  async function handleSubmit(e) {
    e && e.preventDefault();
    if (!editable) { setStatusMsg("Form is not editable."); return; }
    setStatusMsg(""); setSubmitting(true);
    if (!token) { setStatusMsg("You must be logged in to submit."); setSubmitting(false); return; }
    try {
      const fd = new FormData();
      fd.append("faculty_rank", facultyRank); fd.append("academic_year", academicYear); fd.append("rank_type", rankType);
      fd.append("pass_percent", passPercent); fd.append("student_feedback", studentFeedback);
      fd.append("online_videos", onlineVideos); fd.append("sdg_activities", sdgActivities);
      fd.append("vac_hours", vacHours); fd.append("publications", publications);
      fd.append("citations", citations); fd.append("consultancy_revenue", consultancyRevenue);
      fd.append("sponsored_grants_count", sponsoredGrantsCount); fd.append("sponsored_grants_amount", sponsoredGrantsAmount);
      fd.append("research_visits", researchVisits); fd.append("memberships_count", membershipsCount);
      fd.append("fdp_days_phys", fdpDaysPhys); fd.append("fdp_days_online", fdpDaysOnline);
      fd.append("mooc_4w", mooc4w); fd.append("mandatory_courses", mandatoryCourses);
      fd.append("convener_days", convenerDays); fd.append("convener_online_days", convenerOnlineDays);
      fd.append("guest_hours", guestHours); fd.append("committee_events", committeeEvents);
      fd.append("conferences_organized", conferencesOrganized);
      fd.append("events_a", eventsA); fd.append("events_b", eventsB); fd.append("events_c", eventsC);
      fd.append("head_count", headCount); fd.append("member_count", memberCount);
      fd.append("dept_responsibilities", deptResponsibilities);
      fd.append("outreach_activities", outreachActivities);
      fd.append("resource_outside_hours", resourceOutsideHours); fd.append("resource_inside_hours", resourceInsideHours);
      fd.append("training_days", trainingDays); fd.append("awards_count", awardsCount);
      fd.append("editorial_count", editorialCount); fd.append("reviews_count", reviewsCount);
      fd.append("phd_completed", phdCompleted); fd.append("phd_pursuing", phdPursuing);
      fd.append("hod_scalars_json", JSON.stringify({ dept_pass: hodDeptPass, industry_labs: hodIndustryLabs, new_tracks: hodNewTracks, placement: hodPlacement, median_salary: hodMedianSalary, gate_pct: hodGatePct, higher_studies: hodHigherStudies, mooc_students: hodMoocStudents, student_ach: hodStudentAch, avg_pub: hodAvgPub, consultancy_2l: hodConsultancy2L, project_conv: hodProjectConv, grants_10l: hodGrants10L, mou_count: hodMouCount, study_visits: hodStudyVisits, visiting_faculty: hodVisitingFaculty, faculty_retention: hodFacultyRetention, enrolment: hodEnrolment, prof_events: hodProfEvents, local_bodies: hodLocalBodies, training_rev: hodTrainingRev, unique_awards: hodUniqueAwards }));
      fd.append("cfrd_scalars_json", JSON.stringify({ research_training: cfrdResearchTraining, grants_revenue: cfrdGrantsRevenue, phd_completed: cfrdPhdCompleted, phd_pursuing: cfrdPhdPursuing, resource_hours: cfrdResourceHours }));
      fd.append("pe_scalars_json", JSON.stringify({ sports_quota: peSportsQuota, practising: pePractising, state_events: peStateEvents, national_events: peNationalEvents, promo_events: pePromoEvents, venue_partner: peVenuePartner, revenue: peRevenue, feedback: peFeedback, student_ach: peStudentAch }));
      fd.append("ntp_scalars_json", JSON.stringify({ five_s: ntpFiveS, training: ntpTraining, feedback: ntpFeedback, beyond: ntpBeyond, branding: ntpBranding, head_score: ntpHeadScore }));
      fd.append("ntl_scalars_json", JSON.stringify({ five_s: ntlFiveS, safety: ntlSafety, equipment: ntlEquipment, beyond: ntlBeyond, training: ntlTraining, projects: ntlProjects, consultancy: ntlConsultancy, events: ntlEvents, branding: ntlBranding, hod_feedback: ntlHodFeedback }));
      const tableKeys = { ese_courses: eseCourses, feedback_courses: feedbackCourses, video_rows: videoRows, sdg_rows: sdgRows, vac_rows: vacRows, achievement_rows: achievementRows, symp_pub_rows: sympPubRows, pub_rows: pubRows, citation_rows: citationRows, kpriet_citation_rows: kprietCitRows, consultancy_rows: consultancyRows, grant_rows: grantRows, visit_rows: visitRows, phd_rows: phdRows, membership_rows: membershipRows, fdp_rows: fdpRows, mandatory_rows: mandatoryRows, event_rows: eventRows, resp_rows: respRows, internship_rows: internshipRows, mou_rows: mouRows, community_rows: communityRows, resource_rows: resourceRows, training_rows: trainingRows, award_rows: awardRows, recognition_rows: recognitionRows };
      Object.entries(tableKeys).forEach(([k, v]) => fd.append(k, JSON.stringify(v)));
      const scores = { ap: apScore?.totals, hod: hodScore?.totals, cfrd: cfrdScore?.totals, pe: peScore?.totals, ntp: ntpScore?.totals, ntl: ntlScore?.totals };
      fd.append("section_totals_json", JSON.stringify(scores));
      proofFiles.forEach(f => fd.append("proof", f));
      Object.entries(activityFiles).forEach(([row, files]) => { if (Array.isArray(files)) files.forEach(file => fd.append(`proof_row_${row}`, file)); });
      const isUpdate = !!(submission && (submission._id || submission.id));
      const base = apiBase.replace(/\/$/, "");
      const url = isUpdate ? `${base}/api/submissions/${encodeURIComponent(submission._id || submission.id)}` : `${base}/api/submissions/`;
      const r = await fetch(url, { method: isUpdate ? "PATCH" : "POST", headers: { Authorization: `Bearer ${token}` }, body: fd, credentials: "include" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || body.message || JSON.stringify(body) || `HTTP ${r.status}`);
      setStatusMsg(isUpdate ? "Submission updated." : "Submission created.");
      setProofFiles([]); setActivityFiles({});
      onSubmitted(body);
    } catch (err) { setStatusMsg("Error: " + (err?.message || String(err))); }
    finally { setSubmitting(false); }
  }

  /* ── Render helpers ── */
  const gt = apScore?.totals.total ?? hodScore?.totals.total ?? cfrdScore?.totals.total ?? peScore?.totals.total ?? ntpScore?.totals.total ?? ntlScore?.totals.total ?? 0;
  const apStrips = apScore ? [
    { label: "Academic", val: apScore.totals.academic, max: apScore.MAXS.academic },
    { label: "Research", val: apScore.totals.research, max: apScore.MAXS.research },
    { label: "Admin",    val: apScore.totals.admin,    max: apScore.MAXS.admin },
    { label: "Outreach", val: apScore.totals.outreach, max: apScore.MAXS.outreach },
  ] : [];
  const hodStrips = hodScore ? [
    { label: "Academic", val: hodScore.totals.academic, max: 150 },
    { label: "R & D",    val: hodScore.totals.research, max: 150 },
    { label: "Admin",    val: hodScore.totals.admin,    max: 50 },
    { label: "Outreach", val: hodScore.totals.outreach, max: 50 },
    { label: "Self Dev", val: hodScore.totals.self,     max: 100 },
  ] : [];

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="sf-overlay">
      <form className="sf-form" onSubmit={handleSubmit}>

        {/* ── Top bar ── */}
        <div className="sf-topbar">
          <div>
            <h2 className="sf-title">{submission ? (editable ? "Edit KPI Sheet" : "View KPI Sheet") : "Submit KPI Sheet"}</h2>
            <p className="sf-subtitle">Fill the KPI entries below. Points update automatically as you type.</p>
            <span className="sf-rubric-badge">Rubric: <strong>{facultyRank} variant</strong></span>
          </div>
          <div className="sf-topbar-actions">
            <button type="button" onClick={onCancel} className="btn-cancel">Close</button>
            {editable && <button type="submit" disabled={submitting} className="btn-primary">{submitting ? (submission ? "Saving…" : "Submitting…") : (submission ? "Save Changes" : "Submit KPI Sheet")}</button>}
          </div>
        </div>

        <div className="sf-form-body">

          {/* ── Meta ── */}
          <div className="sf-meta">
            <div className="sf-field">
              <label>🎓 Faculty Rank</label>
              <select value={facultyRank} onChange={e => setFacultyRank(e.target.value)} disabled={!editable}>
                {["AP I", "AP II", "AP III", "ASP/Prof", "HOD", "PG Coordinator", "CFRD", "Physical Education", "Non-Teaching (PO/JA)", "Non-Teaching (Lab)"].map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="sf-field">
              <label>📅 Academic Year</label>
              <input value={academicYear} onChange={e => setAcademicYear(e.target.value)} disabled={!editable} />
            </div>
          </div>

          {/* ── Score Strip ── */}
          {isAPFamily && <ScoreStrip strips={apStrips} grandTotal={gt} grandMax={500} />}
          {isHOD      && <ScoreStrip strips={hodStrips} grandTotal={gt} grandMax={500} />}
          {isCFRD     && <ScoreStrip strips={[{ label: "Academic", val: cfrdScore?.totals.academic || 0, max: 50 }, { label: "Research", val: cfrdScore?.totals.research || 0, max: 450 }]} grandTotal={gt} grandMax={500} />}
          {(isPE || isNTP || isNTL) && <ScoreStrip strips={[]} grandTotal={gt} grandMax={isPE ? 500 : 100} />}

          {/* ════════════════════════════════════════════════════════════
              AP I / AP II / AP III / ASP / Prof FORM
          ════════════════════════════════════════════════════════════ */}
          {isAPFamily && (<>

            {/* ════ A: ACADEMIC ════ */}
            <div className="section-block">
              <SBH text={`A. Academic Outcomes — ${apScore?.MAXS.academic || 150} Points`} />

              <Section number="1" title="% Pass in ESE (Average of all theory courses)"
                rubric="81%=2M, 81.5%=3M, 82%=4M … ≥95%=30M  (every +0.5% = +1 mark)"
                max={rankType === "AP12" ? 30 : 20}
                score={Math.round(apScore?.perRow.academic.passMarks || 0)}
                proofComponent={<FileAttach {...FAP(1)} />}>
                <div className="derived-note">
                  Derived avg pass %: <strong className="live">{passPercent}%</strong>
                  &nbsp;→ Score: <strong className="live">{Math.round(apScore?.perRow.academic.passMarks || 0)}</strong> pts
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#777" }}>(formula: 2 + (pass−81)÷0.5, cap {rankType === "AP12" ? 30 : 20})</span>
                </div>
                <KPITable columns={[
                  { key: "course", label: "Course Name", placeholder: "e.g. Power Electronics" },
                  { key: "semester", label: "Semester", placeholder: "V", width: 80 },
                  { key: "className", label: "Class", placeholder: "EE", width: 70 },
                  { key: "appeared", label: "Appeared", type: "number", width: 100 },
                  { key: "passed", label: "Passed", type: "number", width: 100 },
                  { key: "pct", label: "Pass %", type: "computed", width: 80, align: "center", compute: r => { const a = _toFloat(r.appeared), p = _toFloat(r.passed); return a > 0 ? ((p / a) * 100).toFixed(1) + "%" : "—"; } },
                ]} rows={eseCourses} editable={editable} minRows={1} onAddRow={ese.add} onRemoveRow={ese.remove} onUpdateRow={ese.update} />
              </Section>

              <Section number="2" title="Students Feedback (Average of all theory courses)"
                rubric="3.1=2M, 3.2=4M … ≥4.5=30M  (every +0.1 = +2 marks)"
                max={rankType === "AP12" ? 30 : 20}
                score={Math.round(apScore?.perRow.academic.fbMarks || 0)}
                proofComponent={<FileAttach {...FAP(2)} />}>
                <div className="derived-note">
                  Derived avg feedback: <strong className="live">{studentFeedback} / 5</strong>
                  &nbsp;→ Score: <strong className="live">{Math.round(apScore?.perRow.academic.fbMarks || 0)}</strong> pts
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#777" }}>(formula: 2 + (fb−3.1)÷0.1 × 2, cap {rankType === "AP12" ? 30 : 20})</span>
                </div>
                <KPITable columns={[
                  { key: "course", label: "Course Name", placeholder: "e.g. Power Electronics" },
                  { key: "semester", label: "Semester", placeholder: "V", width: 80 },
                  { key: "className", label: "Class", placeholder: "EE", width: 70 },
                  { key: "feedback", label: "Feedback (0–5)", type: "number", step: "0.1", min: 0, max: 5, width: 120, placeholder: "4.2" },
                ]} rows={feedbackCourses} editable={editable} minRows={1} onAddRow={fb.add} onRemoveRow={fb.remove} onUpdateRow={fb.update} />
              </Section>

              <Section number="3" title="Developing Online Course / Video Lecture (YouTube / Swayam)"
                rubric="10 pts / video — cap 30" max={30} score={apScore?.perRow.academic.videosMarks || 0}
                proofComponent={<FileAttach {...FAP(3)} />}>
                <div className="derived-note">Videos counted: <strong className="live">{onlineVideos}</strong></div>
                <KPITable columns={[
                  { key: "course", label: "Course Name", placeholder: "e.g. Control Systems" },
                  { key: "title", label: "Video / Animation Title", placeholder: "Topic title" },
                  { key: "link", label: "YouTube / Swayam Link", placeholder: "https://…" },
                ]} rows={videoRows} editable={editable} emptyLabel="No videos added." onAddRow={vid.add} onRemoveRow={vid.remove} onUpdateRow={vid.update} />
              </Section>

              <Section number="4" title="Implementation of Innovative Teaching Methodologies addressing SDGs"
                rubric="4 pts / activity — cap 30  (Min 4 SDGs)" max={30} score={apScore?.perRow.academic.sdgMarks || 0}
                proofComponent={<FileAttach {...FAP(4)} />}>
                <div className="derived-note">Activities counted: <strong className="live">{sdgActivities}</strong></div>
                <KPITable columns={[
                  { key: "course", label: "Course", placeholder: "Course name" },
                  { key: "classSem", label: "Class/Sem", placeholder: "III EE", width: 80 },
                  { key: "topic", label: "Topic", placeholder: "Topic covered" },
                  { key: "method", label: "Methodology", placeholder: "Flipped / PBL…" },
                  { key: "sdg", label: "SDG No.", placeholder: "4", width: 70 },
                ]} rows={sdgRows} editable={editable} emptyLabel="No SDG activities added." onAddRow={sdg.add} onRemoveRow={sdg.remove} onUpdateRow={sdg.update} />
              </Section>

              <Section number="5" title="VAC / Student Achievements / Symposium Publications (combined pool)"
                rubric={`1pt/hr VAC + 4pts/achievement + 2pts/symp.pub — cap ${rankType === "AP3" ? 25 : rankType === "ASP" ? 20 : 30}`}
                max={rankType === "AP3" ? 25 : rankType === "ASP" ? 20 : 30}
                score={Math.round(apScore?.perRow.academic.sec5Marks || 0)}
                proofComponent={<FileAttach {...FAP(5)} />}>
                <div className="derived-note" style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
                  <span>VAC: <strong className="live">{Math.round(vacHours)}</strong> hrs = <strong className="live">{Math.round(vacHours)}</strong> pts</span>
                  <span>Achievements: <strong className="live">{achievementRows.filter(r => r.student || r.competition).length}</strong> × 4 = <strong className="live">{achievementPoints}</strong> pts</span>
                  <span>Symp. pubs: <strong className="live">{sympPubs}</strong> × 2 = <strong className="live">{2 * sympPubs}</strong> pts</span>
                  <span style={{ fontWeight: 700, color: "#1a7f4f", borderLeft: "2px solid #b2dfcc", paddingLeft: 12 }}>
                    Total (cap {rankType === "AP3" ? 25 : rankType === "ASP" ? 20 : 30}): <strong className="live" style={{ fontSize: 16 }}>{Math.round(apScore?.perRow.academic.sec5Marks || 0)}</strong>
                  </span>
                </div>

                <SBH text="5A — Conduct of VAC / Capsule Courses  (1 pt / hour)" />
                <KPITable columns={[
                  { key: "course", label: "Course Name", placeholder: "VAC / Capsule course name" },
                  { key: "classSem", label: "Class/Sem", placeholder: "III EE", width: 85 },
                  { key: "students", label: "No. of Students", type: "number", width: 110 },
                  { key: "hours", label: "Hours", type: "number", step: "0.5", width: 80, placeholder: "2" },
                  { key: "date", label: "Date", width: 100, placeholder: "dd/mm/yyyy" },
                ]} rows={vacRows} editable={editable} emptyLabel="No VAC courses added." onAddRow={vac.add} onRemoveRow={vac.remove} onUpdateRow={vac.update} />

                <SBH text="5B — Training Students to Win Prizes / Awards  (4 pts / achievement)" />
                <KPITable columns={[
                  { key: "student", label: "Student Name", placeholder: "Full name" },
                  { key: "competition", label: "Competition / Conference", placeholder: "Event name" },
                  { key: "institute", label: "Institute & Address", placeholder: "Venue / location" },
                  { key: "date", label: "Date", width: 100 },
                  { key: "award", label: "Award / Participation", placeholder: "1st Prize / 2nd / Gold…", width: 180 },
                ]} rows={achievementRows} editable={editable} emptyLabel="No student achievements added." onAddRow={ach.add} onRemoveRow={ach.remove} onUpdateRow={ach.update} />

                <SBH text="5C — Papers at Symposium / Conference at Tier-1 Institutions  (2 pts / paper)" />
                <div style={{ fontSize: 12, color: "#888", padding: "2px 8px 8px", fontStyle: "italic" }}>Tier-1 institutions only. Indexed journal publications → Section 6.</div>
                <KPITable columns={[
                  { key: "title", label: "Paper Title", placeholder: "Paper title" },
                  { key: "conference", label: "Symposium / Conference", placeholder: "Event name" },
                  { key: "institution", label: "Institution", placeholder: "IIT Madras / NIT Trichy…", width: 160 },
                  { key: "date", label: "Date", placeholder: "mm/yyyy", width: 90 },
                ]} rows={sympPubRows} editable={editable} emptyLabel="No symposium papers added." onAddRow={symp.add} onRemoveRow={symp.remove} onUpdateRow={symp.update} />
              </Section>

              <SectionTotal label="Academic Total" max={apScore?.MAXS.academic || 150} value={apScore?.totals.academic || 0} />
            </div>

            {/* ════ B: RESEARCH ════ */}
            <div className="section-block">
              <SBH text={`B. Research & Professional Development — ${apScore?.MAXS.research || 200} Points`} />

              {/* [FIX 1] Section 6: Publications + Patents combined under one 75-pt cap */}
              <Section number="6" title="Article Publications / Patents (SCI / WoS / Scopus / Books / Patents)"
                rubric={
                  rankType === "AP3"
                    ? "SCI Q1/Q2=25 | SCI Q3/Q4=20 | WoS/Scopus=15 | Conf=10 | Patent Published=10 | Patent Granted=30 | IF>5 +5 bonus — cap 80"
                    : rankType === "ASP"
                      ? "SCI Q1/Q2=25 | SCI Q3/Q4=20 | WoS/Scopus=15 | Conf=10 | Patent Published=10 | Patent Granted=30 | IF>5 +5 bonus — cap 90"
                      : "SCI Q1/Q2=25 | SCI Q3/Q4=20 | WoS/Scopus=15 | Conf=10 | Patent Published=10 | Patent Granted=30 | IF>5 +5 bonus — cap 75"
                }
                max={rankType === "AP3" ? 80 : rankType === "ASP" ? 90 : 75}
                score={Math.round(apScore?.perRow.research.pubsMarks || 0)}
                proofComponent={<FileAttach {...FAP(7)} />}>
                <div className="derived-note alert-box">
                  ⚠️ <strong>Patents are included here</strong> (Published=10 pts, Granted=30 pts). Select "Patent Published" or "Patent Granted" in Indexing column.
                </div>
                <div className="derived-note">
                  Publications/Patents entered: <strong className="live">{publications}</strong> — Points scored: <strong className="live">{Math.round(apScore?.perRow.research.pubsMarks || 0)}</strong>
                </div>
                <KPITable columns={[
                  { key: "title", label: "Title of Paper / Patent", placeholder: "Title" },
                  { key: "authors", label: "Authors", placeholder: "As in publication", width: 130 },
                  { key: "journal", label: "Journal / Conference / Patent No.", placeholder: "Journal / patent no.", width: 160 },
                  { key: "vol", label: "Vol/Issue", placeholder: "12(3)", width: 70 },
                  { key: "monthYear", label: "Month & Year", placeholder: "Jan 2024", width: 90 },
                  {
                    key: "indexing", label: "Indexing / Type", type: "select", width: 145,
                    options: ["SCI (Q1/Q2)", "SCI (Q3/Q4)", "WoS", "Scopus", "Conference", "Book-International", "Book-National", "Edited Book", "Book Chapter", "Patent Published", "Patent Granted", "UGC"]
                  },
                  { key: "impactFactor", label: "IF", type: "number", step: "0.01", width: 60 },
                  {
                    key: "pts", label: "Pts", type: "computed", width: 55, align: "center",
                    compute: r => pubRowPts(r)
                  },
                ]} rows={pubRows} editable={editable} emptyLabel="No publications/patents added." onAddRow={pub.add} onRemoveRow={pub.remove} onUpdateRow={pub.update} />
              </Section>

              {/* [FIX 6] Section 7a+7b: Citations — combined cap 15 for AP12 */}
              <Section number="7a" title="Article Citation in WoS / Scopus Journals & Conferences"
                rubric={rankType === "AP12" ? "1 pt / citation — 7a+7b share cap 15" : "0.5 pt / citation — cap 20"}
                max={rankType === "AP12" ? 15 : 20}
                score={Math.round(apScore?.perRow.research.citationsMarks || 0)}
                proofComponent={<FileAttach {...FAP(9)} />}>
                <div className="derived-note">Total citations: <strong className="live">{citations}</strong> → <strong className="live">{Math.round(apScore?.perRow.research.citationsMarks || 0)}</strong> pts</div>
                <KPITable columns={[
                  { key: "title", label: "Title of the Paper", placeholder: "Paper title" },
                  { key: "citations", label: "No. of Citations (2024-25)", type: "number", width: 190 },
                ]} rows={citationRows} editable={editable} emptyLabel="No citations added." onAddRow={cit.add} onRemoveRow={cit.remove} onUpdateRow={cit.update} />
              </Section>

              <Section number="7b" title="KPRIET Affiliation Articles Cited"
                rubric="0.5 pt per article cited — shares 15-pt pool with 7a (AP I/II)" max={10}
                score={Math.round(apScore?.perRow.research.kprietCitMarks || 0)}
                proofComponent={<FileAttach {...FAP(10)} />}>
                <div className="derived-note">KPRIET articles cited: <strong className="live">{kprietCitations}</strong> → <strong className="live">{Math.round(apScore?.perRow.research.kprietCitMarks || 0)}</strong> pts (remaining share of pool)</div>
                <KPITable columns={[
                  { key: "title", label: "Title of the Paper", placeholder: "KPRIET paper title" },
                  { key: "cited", label: "No. of KPRIET Articles Cited", type: "number", width: 210 },
                ]} rows={kprietCitRows} editable={editable} emptyLabel="No KPRIET citation entries." onAddRow={kpc.add} onRemoveRow={kpc.remove} onUpdateRow={kpc.update} />
              </Section>

              <Section number="8" title="Consultancy Revenue Generation"
                rubric={rankType === "AP12" ? "₹10K–₹2L → 0–20 pts" : "₹10K–₹2L → 0–25 pts"}
                max={rankType === "AP12" ? 20 : 25}
                score={Math.round(apScore?.perRow.research.consultancyMarks || 0)}
                proofComponent={<FileAttach {...FAP(11)} />}>
                <div className="derived-note">Total revenue: ₹<strong className="live">{consultancyRevenue.toLocaleString()}</strong></div>
                <KPITable columns={[
                  { key: "title", label: "Consultancy Work / Testing Title", placeholder: "Work description" },
                  { key: "org", label: "Organisation", placeholder: "Client name", width: 150 },
                  { key: "date", label: "Date", width: 100 },
                  { key: "amount", label: "Amount (₹)", type: "number", width: 120 },
                ]} rows={consultancyRows} editable={editable} emptyLabel="No consultancy entries." onAddRow={con.add} onRemoveRow={con.remove} onUpdateRow={con.update} />
              </Section>

              {/* [FIX 2] Section 9: Correct grant formula */}
              <Section number="9" title="Sponsored Grants Received / Submitted"
                rubric={
                  rankType === "AP12"
                    ? "a) Amount: ₹10K=2M, ₹15K=3M, … ≥₹2L=40M  |  b) Proposal: 5 pts each — combined max 40"
                    : rankType === "AP3"
                      ? "a) Amount: ₹10K=2M, ₹15K=3M, … ≥₹2L=35M  |  b) Proposal: 5 pts each — combined max 50"
                      : "a) Amount: ₹10K=2M, ₹15K=3M, … ≥₹2L=35M  |  b) Proposal: 5 pts each — combined max 50"
                }
                max={rankType === "AP12" ? 40 : 50}
                score={Math.round(apScore?.perRow.research.sponsoredCombined || 0)}
                proofComponent={<FileAttach {...FAP(12)} />}>
                <div className="derived-note">
                  Proposals: <strong className="live">{sponsoredGrantsCount}</strong> → <strong className="live">{Math.round(apScore?.perRow.research.proposalsMarks || 0)}</strong> pts &nbsp;|&nbsp;
                  Amount: ₹<strong className="live">{sponsoredGrantsAmount.toLocaleString()}</strong> → <strong className="live">{Math.round(apScore?.perRow.research.grantsAmountMarks || 0)}</strong> pts
                </div>
                <KPITable columns={[
                  { key: "pi", label: "PI / Coordinator", placeholder: "Name", width: 110 },
                  { key: "copi", label: "CO-PI (if any)", placeholder: "Name", width: 110 },
                  { key: "title", label: "Project Title", placeholder: "Title" },
                  { key: "agency", label: "Funding Agency", placeholder: "DST…", width: 120 },
                  { key: "date", label: "Submit / Grant Date", width: 120 },
                  { key: "amount", label: "Amount (₹)", type: "number", width: 110 },
                  { key: "status", label: "Status", type: "select", width: 110, options: ["Submitted", "Granted", "Sanctioned", "Rejected"] },
                ]} rows={grantRows} editable={editable} emptyLabel="No grant entries." onAddRow={grt.add} onRemoveRow={grt.remove} onUpdateRow={grt.update} />
              </Section>

              {/* PhD — for AP3 and ASP only */}
              {(rankType === "AP3" || rankType === "ASP") && (
                <Section number="10a" title="Research Scholars Supervision (PhD)"
                  rubric="Completion: 10 pts | Full-time: 4 pts | Part-time: 3 pts"
                  max={rankType === "AP3" ? 15 : 20}
                  score={Math.round(_clamp(10 * phdCompleted + 4 * phdPursuing, 0, rankType === "AP3" ? 15 : 20))}
                  proofComponent={<FileAttach {...FAP(13)} />}>
                  <div className="derived-note">Completed: <strong className="live">{phdCompleted}</strong> | Pursuing: <strong className="live">{phdPursuing}</strong></div>
                  <KPITable columns={[
                    { key: "scholar", label: "Scholar Name", placeholder: "Full name" },
                    { key: "title", label: "Thesis Title", placeholder: "Research title" },
                    { key: "status", label: "Status", type: "select", width: 130, options: ["Full-time", "Part-time", "Completed"] },
                    { key: "year", label: "Year of Completion / Enrollment", placeholder: "2024", width: 180 },
                  ]} rows={phdRows} editable={editable} emptyLabel="No PhD scholars added." onAddRow={phd.add} onRemoveRow={phd.remove} onUpdateRow={phd.update} />
                </Section>
              )}

              <Section number={rankType === "AP3" || rankType === "ASP" ? "10b" : "10"} title="Visit to Research Laboratories for Collaboration"
                rubric="10 pts / visit — cap 10" max={10}
                score={Math.round(apScore?.perRow.research.researchVisitsMarks || 0)}
                proofComponent={<FileAttach {...FAP(14)} />}>
                <div className="derived-note">Visits counted: <strong className="live">{researchVisits}</strong></div>
                <KPITable columns={[
                  { key: "lab", label: "Research Lab / Scholar", placeholder: "DRDO / CSIR / ISRO…" },
                  { key: "date", label: "Date", width: 110 },
                  { key: "outcome", label: "Outcome / Collaboration", placeholder: "MoU / joint paper…" },
                ]} rows={visitRows} editable={editable} emptyLabel="No visits added." onAddRow={vis.add} onRemoveRow={vis.remove} onUpdateRow={vis.update} />
              </Section>

              <Section number="11" title="Membership in Professional Bodies of High Repute"
                rubric={rankType === "ASP" ? "5 pts / membership — cap 5" : "10 pts / membership — cap 10"}
                max={rankType === "ASP" ? 5 : 10}
                score={Math.round(apScore?.perRow.research.membershipsMarks || 0)}
                proofComponent={<FileAttach {...FAP(15)} />}>
                <div className="derived-note">Memberships counted: <strong className="live">{membershipsCount}</strong></div>
                <KPITable columns={[
                  { key: "society", label: "Society / Chapter", placeholder: "IEEE / ISTE…" },
                  { key: "level", label: "Level", type: "select", width: 110, options: ["International", "National", "Regional"] },
                  { key: "memberId", label: "Member ID", width: 110 },
                  { key: "type", label: "Type", type: "select", width: 100, options: ["Annual", "Life"] },
                  { key: "date", label: "Date", width: 100 },
                ]} rows={membershipRows} editable={editable} emptyLabel="No memberships added." onAddRow={mem.add} onRemoveRow={mem.remove} onUpdateRow={mem.update} />
              </Section>

              <Section number="12" title="Completion of FDP / STTP / MOOC Courses with Proctored Exam"
                rubric="1 pt/day Physical | 0.5 pt/day Online | 4 pts for 4-week MOOC (min 15 hrs)"
                max={rankType === "AP12" ? 20 : rankType === "AP3" ? 15 : 10}
                score={Math.round(apScore?.perRow.research.fdpMarks || 0)}
                proofComponent={<FileAttach {...FAP(16)} />}>
                <div className="derived-note">Physical: <strong className="live">{fdpDaysPhys}d</strong> | Online: <strong className="live">{fdpDaysOnline}d</strong> | MOOC 4w: <strong className="live">{mooc4w}</strong></div>
                <KPITable columns={[
                  { key: "course", label: "Course Name", placeholder: "FDP / MOOC title" },
                  { key: "organiser", label: "Organised By", placeholder: "IIT / Coursera…", width: 130 },
                  { key: "from", label: "From (yyyy-mm-dd)", placeholder: "2024-06-01", width: 120 },
                  { key: "to", label: "To (yyyy-mm-dd)", placeholder: "2024-06-05", width: 120 },
                  { key: "mode", label: "Mode", type: "select", width: 140, options: ["Physical", "Online", "MOOC (4 weeks)", "F2F"] },
                  { key: "accolades", label: "Accolades", placeholder: "Cert / Score", width: 120 },
                ]} rows={fdpRows} editable={editable} emptyLabel="No FDP/MOOC entries." onAddRow={fdp.add} onRemoveRow={fdp.remove} onUpdateRow={fdp.update} />
              </Section>

              <Section number="13" title="Number of Mandatory Training Programmes Completed"
                rubric="10 pts per Course — cap 10" max={10}
                score={Math.round(apScore?.perRow.research.mandatoryMarks || 0)}
                proofComponent={<FileAttach {...FAP(17)} />}>
                <div className="derived-note">Programmes counted: <strong className="live">{mandatoryCourses}</strong></div>
                <KPITable columns={[
                  { key: "programme", label: "Training Programme", placeholder: "NEP / AI Basics…" },
                  { key: "organiser", label: "Organised By", placeholder: "AICTE / NPTEL", width: 140 },
                  { key: "from", label: "From", placeholder: "dd/mm/yyyy", width: 100 },
                  { key: "to", label: "To", placeholder: "dd/mm/yyyy", width: 100 },
                  { key: "accolades", label: "Accolades", placeholder: "Cert / Score", width: 120 },
                ]} rows={mandatoryRows} editable={editable} emptyLabel="No mandatory training entries." onAddRow={mand.add} onRemoveRow={mand.remove} onUpdateRow={mand.update} />
              </Section>

              <SectionTotal label="Research Total" max={apScore?.MAXS.research || 200} value={apScore?.totals.research || 0} />
            </div>

            {/* ════ C: ADMINISTRATION ════ */}
            <div className="section-block">
              {/* [FIX 3] Sections 14+15 now combined under one 20-pt cap for AP12 */}
              <SBH text={`C. Administration — ${apScore?.MAXS.admin || 50} Points`} />

              <Section number="14 & 15"
                title="Convener / Coordinator / Guest Lectures / Events / Committee Roles"
                rubric={
                  "Sec 14: Physical 3pts/day | Online 2pts/day | Guest 2pts/entry | Committee 1pt  —  " +
                  "Sec 15: a) Nat/Intl Convener 3pts | b) Institute Convener 2pts | c) Committee 1pt  —  " +
                  `Combined cap ${rankType === "ASP" ? 30 : rankType === "AP3" ? 25 : 20} pts`
                }
                max={rankType === "ASP" ? 30 : rankType === "AP3" ? 25 : 20}
                score={Math.round(apScore?.perRow.admin.convenerEventsMarks || 0)}
                proofComponent={<FileAttach {...FAP(18)} />}>
                <div className="derived-note">
                  Convener(Phys): <strong className="live">{convenerDays}</strong> (+{3 * convenerDays}pts) |
                  Online: <strong className="live">{convenerOnlineDays}</strong> (+{2 * convenerOnlineDays}pts) |
                  Guest: <strong className="live">{guestHours}</strong> (+{2 * guestHours}pts) |
                  Committee: <strong className="live">{committeeEvents}</strong> (+{committeeEvents}pts) |
                  Nat/Intl(15a): <strong className="live">{eventsA}</strong> (+{3 * eventsA}pts) |
                  Inst(15b): <strong className="live">{eventsB}</strong> (+{2 * eventsB}pts)
                  &nbsp;→ Raw {3 * convenerDays + 2 * convenerOnlineDays + 2 * guestHours + committeeEvents + 3 * eventsA + 2 * eventsB + eventsC} pts,
                  capped at <strong>{rankType === "ASP" ? 30 : rankType === "AP3" ? 25 : 20}</strong>
                </div>
                <KPITable columns={[
                  { key: "event", label: "Event Name", placeholder: "Workshop / FDP / Seminar" },
                  { key: "date", label: "Date", width: 100 },
                  { key: "mode", label: "Mode", type: "select", width: 100, options: ["Physical", "Online", "Hybrid"] },
                  { key: "level", label: "Level", type: "select", width: 160, options: ["National/International", "Institute", "Department"] },
                  { key: "role", label: "Role", type: "select", width: 185, options: ["Convener/Coordinator", "Guest Lecture/Webinar", "Committee Member", "Organiser"] },
                  { key: "participants", label: "Participants", type: "number", width: 100 },
                ]} rows={eventRows} editable={editable} emptyLabel="No events added." onAddRow={evt.add} onRemoveRow={evt.remove} onUpdateRow={evt.update} />
              </Section>

              <Section number="16" title="Institute & Dept. level responsibility"
                rubric="Head: 10 pts | Member/Coordinator: 5 pts — cap 30"
                max={30}
                score={Math.round(apScore?.perRow.admin.respMarks || 0)}
                proofComponent={<FileAttach {...FAP(19)} />}>
                <div className="derived-note">Heads: <strong className="live">{headCount}</strong> | Members/Coordinators: <strong className="live">{memberCount}</strong></div>
                <KPITable columns={[
                  { key: "responsibility", label: "NSC / Club / Dept. Responsibility", placeholder: "e.g. NSS Coordinator" },
                  { key: "designation", label: "Designation", type: "select", width: 140, options: ["Head", "Member", "Coordinator", "Advisor"] },
                ]} rows={respRows} editable={editable} emptyLabel="No responsibilities added." onAddRow={resp.add} onRemoveRow={resp.remove} onUpdateRow={resp.update} />
              </Section>

              {/* ASP extra: internships + MoUs */}
              {rankType === "ASP" && (<>
                <Section number="17" title="Arranging Student Internships / Placements / Projects in Industries"
                  rubric="2 pts / student — cap 20" max={20}
                  score={Math.round(_clamp(internshipRows.filter(r => r.student).length * 2, 0, 20))}
                  proofComponent={<FileAttach {...FAP(20)} />}>
                  <KPITable columns={[
                    { key: "student", label: "Student Name", placeholder: "Full name" },
                    { key: "company", label: "Company / Institute", placeholder: "Organisation", width: 160 },
                    { key: "duration", label: "Duration", placeholder: "2 months", width: 100 },
                    { key: "date", label: "Date", width: 100 },
                  ]} rows={internshipRows} editable={editable} emptyLabel="No internship entries." onAddRow={intern.add} onRemoveRow={intern.remove} onUpdateRow={intern.update} />
                </Section>
                <Section number="18" title="Signing MoU and Tangible Outcomes"
                  rubric="10 pts / MoU — cap 20" max={20}
                  score={Math.round(_clamp(mouRows.filter(r => r.institute).length * 10, 0, 20))}
                  proofComponent={<FileAttach {...FAP(21)} />}>
                  <KPITable columns={[
                    { key: "institute", label: "Institution / Industry", placeholder: "Partner org." },
                    { key: "date", label: "Date Signed", width: 110 },
                    { key: "outcome", label: "Tangible Outcome", placeholder: "Joint research / project…" },
                  ]} rows={mouRows} editable={editable} emptyLabel="No MoU entries." onAddRow={mou.add} onRemoveRow={mou.remove} onUpdateRow={mou.update} />
                </Section>
              </>)}

              {/* AP3 extra: internships + MoUs */}
              {rankType === "AP3" && (<>
                <Section number="17" title="Arranging Students Internship / Placement in Industries"
                  rubric="2 pts / student — cap 10" max={10}
                  score={Math.round(_clamp(internshipRows.filter(r => r.student).length * 2, 0, 10))}
                  proofComponent={<FileAttach {...FAP(22)} />}>
                  <KPITable columns={[
                    { key: "student", label: "Student Name", placeholder: "Full name" },
                    { key: "company", label: "Company / Institute", placeholder: "Organisation", width: 160 },
                    { key: "duration", label: "Duration", placeholder: "2 months", width: 100 },
                    { key: "date", label: "Date", width: 100 },
                  ]} rows={internshipRows} editable={editable} emptyLabel="No internship entries." onAddRow={intern.add} onRemoveRow={intern.remove} onUpdateRow={intern.update} />
                </Section>
                <Section number="18" title="Signing MoU and Tangible Outcomes"
                  rubric="10 pts / MoU — cap 10" max={10}
                  score={Math.round(_clamp(mouRows.filter(r => r.institute).length * 10, 0, 10))}
                  proofComponent={<FileAttach {...FAP(23)} />}>
                  <KPITable columns={[
                    { key: "institute", label: "Institution / Industry", placeholder: "Partner org." },
                    { key: "date", label: "Date Signed", width: 110 },
                    { key: "outcome", label: "Tangible Outcome", placeholder: "Joint research / project…" },
                  ]} rows={mouRows} editable={editable} emptyLabel="No MoU entries." onAddRow={mou.add} onRemoveRow={mou.remove} onUpdateRow={mou.update} />
                </Section>
              </>)}

              <SectionTotal label="Admin Total" max={apScore?.MAXS.admin || 50} value={apScore?.totals.admin || 0} />
            </div>

            {/* ════ D: OUTREACH ════ */}
            <div className="section-block">
              <SBH text={`D. Outreach Activities — ${apScore?.MAXS.outreach || 100} Points`} />

              <Section number="19" title="Community Services / Addressing Rural Issues / ISR"
                rubric={rankType === "AP3" ? "10 pts / activity — cap 15" : rankType === "ASP" ? "10 pts / activity — cap 10" : "10 pts / activity — cap 30"}
                max={rankType === "AP3" ? 15 : rankType === "ASP" ? 10 : 30}
                score={Math.round(apScore?.perRow.outreach.communityMarks || 0)}
                proofComponent={<FileAttach {...FAP(24)} />}>
                <div className="derived-note">Activities counted: <strong className="live">{outreachActivities}</strong></div>
                <KPITable columns={[
                  { key: "activity", label: "Name of Activity", placeholder: "Rural camp / ISR drive…" },
                  { key: "date", label: "Date", width: 100 },
                  { key: "significance", label: "Significance", placeholder: "Impact description" },
                ]} rows={communityRows} editable={editable} emptyLabel="No community activities added." onAddRow={comm.add} onRemoveRow={comm.remove} onUpdateRow={comm.update} />
              </Section>

              <Section number="20" title="Being a Resource Person"
                rubric="Outside: 3 pts/entry | Inside: 2 pts/entry — cap 20" max={20}
                score={Math.round(apScore?.perRow.outreach.resourceMarks || 0)}
                proofComponent={<FileAttach {...FAP(25)} />}>
                <div className="derived-note">Outside: <strong className="live">{resourceOutsideHours}</strong> entries (+{3 * resourceOutsideHours}pts) | Inside: <strong className="live">{resourceInsideHours}</strong> entries (+{2 * resourceInsideHours}pts)</div>
                <KPITable columns={[
                  { key: "programme", label: "Programme Name", placeholder: "Workshop / FDP…" },
                  { key: "org", label: "Organisation", placeholder: "Institution name", width: 150 },
                  { key: "topic", label: "Topic", placeholder: "Talk topic", width: 150 },
                  { key: "date", label: "Date", width: 100 },
                  { key: "type", label: "Inside / Outside", type: "select", width: 120, options: ["Outside", "Inside"] },
                ]} rows={resourceRows} editable={editable} emptyLabel="No resource person entries." onAddRow={res.add} onRemoveRow={res.remove} onUpdateRow={res.update} />
              </Section>

              <Section number="21" title="Training in Industry / Research Institutes (Physical)"
                rubric="Two weeks (14 days) = max pts (linear)" max={rankType === "AP3" ? 20 : rankType === "ASP" ? 20 : 30}
                score={Math.round(apScore?.perRow.outreach.trainingMarks || 0)}
                proofComponent={<FileAttach {...FAP(26)} />}>
                <div className="derived-note">Total training days: <strong className="live">{trainingDays}</strong></div>
                <KPITable columns={[
                  { key: "institute", label: "Industry / Research Institute", placeholder: "Company / Lab name" },
                  { key: "days", label: "No. of Days", type: "number", width: 110 },
                  { key: "period", label: "Period", placeholder: "Jun–Jul 2024", width: 140 },
                ]} rows={trainingRows} editable={editable} emptyLabel="No training entries." onAddRow={train.add} onRemoveRow={train.remove} onUpdateRow={train.update} />
              </Section>

              <Section number="22a" title="Awards"
                rubric="5 pts / award — cap 20" max={20}
                score={Math.round(_clamp(awardsCount * 5, 0, 20))}
                proofComponent={<FileAttach {...FAP(27)} />}>
                <div className="derived-note">Awards counted: <strong className="live">{awardsCount}</strong></div>
                <KPITable columns={[
                  { key: "title", label: "Title of Award", placeholder: "Best Teacher Award…" },
                  { key: "agency", label: "Issuing Agency / Organisation", placeholder: "Institution name", width: 200 },
                  { key: "date", label: "Date", width: 100 },
                ]} rows={awardRows} editable={editable} emptyLabel="No awards added." onAddRow={awd.add} onRemoveRow={awd.remove} onUpdateRow={awd.update} />
              </Section>

              <Section number="22b" title="Recognition — Editorial Board / Journal Paper Review"
                rubric="Editorial Board: 4 pts | Reviewer: 1 pt/paper — cap 20 (no fund remittance)" max={20}
                score={Math.round(_clamp(4 * editorialCount + reviewsCount, 0, 20))}
                proofComponent={<FileAttach {...FAP(28)} />}>
                <div className="derived-note">Editorial Board: <strong className="live">{editorialCount}</strong> | Reviewers: <strong className="live">{reviewsCount}</strong></div>
                <KPITable columns={[
                  { key: "journal", label: "Name of Journal", placeholder: "IEEE Transactions…" },
                  { key: "role", label: "Role", type: "select", width: 150, options: ["Editorial Board", "Reviewer"] },
                  { key: "indexing", label: "Indexing", type: "select", width: 120, options: ["SCI", "WoS", "Scopus", "UGC", "Other"] },
                ]} rows={recognitionRows} editable={editable} emptyLabel="No recognition entries." onAddRow={recog.add} onRemoveRow={recog.remove} onUpdateRow={recog.update} />
              </Section>

              <SectionTotal label="Outreach Total" max={apScore?.MAXS.outreach || 100} value={apScore?.totals.outreach || 0} />
            </div>

            <SectionTotal label="GRAND TOTAL" max={500} value={apScore?.totals.total || 0} isGrand />
          </>)}

          {/* ════════════════════════════════════════════════════════════
              HOD / PG COORDINATOR FORM
          ════════════════════════════════════════════════════════════ */}
          {isHOD && (<>
            <div className="section-block">
              <SBH text="A. Academic Activities — 150 Points" />
              <Section number="1" title="Department Pass Percentage" rubric="81%→2M, 81.5%→3M … ≥95%→20M" max={20} score={Math.round(_clamp(calcPassMarks(_toFloat(hodDeptPass), 20), 0, 20))}>
                <MetricInput label="Department Pass %" value={hodDeptPass} onChange={setHodDeptPass} min={0} max={100} step="0.1" editable={editable} note="Enter overall dept pass %" />
              </Section>
              <Section number="2" title="Establishing Industry Sponsored Labs / CoE" rubric="At least 1 CoE → 20 pts" max={20} score={_toInt(hodIndustryLabs) >= 1 ? 20 : 0}>
                <MetricInput label="No. of Industry Labs / CoE established" value={hodIndustryLabs} onChange={setHodIndustryLabs} editable={editable} />
              </Section>
              <Section number="3" title="New Minor / Honours / Micro / Nano Tracks Introduced" rubric="Min 1 track → 20 pts" max={20} score={_toInt(hodNewTracks) >= 1 ? 20 : 0}>
                <MetricInput label="No. of New Tracks Introduced" value={hodNewTracks} onChange={setHodNewTracks} editable={editable} />
              </Section>
              <Section number="4" title="Student Career Development" rubric="Placement % → 20 pts | Median Salary → 10 pts" max={30} score={0}>
                <MetricInput label="Placement % of current batch" value={hodPlacement} onChange={setHodPlacement} min={0} max={100} step="0.1" editable={editable} />
                <MetricInput label="Median Salary (₹/year)" value={hodMedianSalary} onChange={setHodMedianSalary} min={0} editable={editable} note="As per NIRF target" />
              </Section>
              <Section number="5" title="Valid GATE / CAT / GRE / TANCET / TOEFL Scores" rubric="2 pts/student — cap 10" max={10} score={0}>
                <MetricInput label="No. of students with valid scores" value={hodGatePct} onChange={setHodGatePct} editable={editable} />
              </Section>
              <Section number="6" title="Higher Studies & Entrepreneurship" rubric="75–100% → 10 pts" max={10} score={_toFloat(hodHigherStudies) >= 75 ? 10 : 0}>
                <MetricInput label="Higher Studies / Entrepreneurship %" value={hodHigherStudies} onChange={setHodHigherStudies} min={0} max={100} step="0.1" editable={editable} />
              </Section>
              <Section number="7" title="Proctored MOOC Courses by Students" rubric="61–100% of I, II and III year → 1–20 pts" max={20} score={0}>
                <MetricInput label="% of students (I/II/III year) completing MOOC" value={hodMoocStudents} onChange={setHodMoocStudents} min={0} max={100} step="0.1" editable={editable} />
              </Section>
              <Section number="8" title="Students Achievements in Extra & Co-curricular" rubric="2 pts / 1% of total students (top institutes only)" max={20} score={0}>
                <MetricInput label="No. of student achievements" value={hodStudentAch} onChange={setHodStudentAch} editable={editable} />
              </Section>
              <SectionTotal label="Academic Total" max={150} value={hodScore?.totals.academic || 0} />
            </div>

            <div className="section-block">
              <SBH text="B. Research & Development — 150 Points" />
              <Section number="9" title="Average Publications (Indexed) per Faculty" rubric="3 publications = 30 pts" max={30} score={Math.round(hodScore?.totals.research || 0)}>
                <MetricInput label="Average No. of Indexed Publications" value={hodAvgPub} onChange={setHodAvgPub} step="0.1" editable={editable} />
              </Section>
              <Section number="10" title="Revenue via Consultancy / Training" rubric="₹2L per division = 30 pts" max={30} score={0}>
                <MetricInput label="Consultancy / Training Revenue (₹)" value={hodConsultancy2L} onChange={setHodConsultancy2L} min={0} editable={editable} />
              </Section>
              <Section number="11" title="IV Year Projects → Publications / Patents / Products" rubric="71–100% → 30 pts" max={30} score={0}>
                <MetricInput label="Conversion % of IV year projects" value={hodProjectConv} onChange={setHodProjectConv} min={0} max={100} step="0.1" editable={editable} />
              </Section>
              <Section number="12" title="Grants Received (per Assessment Year / Division)" rubric="₹10 Lakhs = 30 pts" max={30} score={0}>
                <MetricInput label="Total Grants Received (₹)" value={hodGrants10L} onChange={setHodGrants10L} min={0} editable={editable} />
              </Section>
              <Section number="13" title="Signing New MoUs" rubric="2 MoUs = 10 pts" max={10} score={0}>
                <MetricInput label="No. of New MoUs Signed" value={hodMouCount} onChange={setHodMouCount} editable={editable} />
              </Section>
              <Section number="14" title="International / National Research / Study Visits for Students" rubric="National 10 pts | International 20 pts" max={20} score={0}>
                <MetricInput label="No. of Study Visits Organised" value={hodStudyVisits} onChange={setHodStudyVisits} editable={editable} />
              </Section>
              <SectionTotal label="R & D Total" max={150} value={hodScore?.totals.research || 0} />
            </div>

            <div className="section-block">
              <SBH text="C. Administration & Development — 50 Points" />
              <Section number="15" title="Visiting Faculty / PoP Appointed" rubric="Min 1 → 10 pts" max={10} score={_toInt(hodVisitingFaculty) >= 1 ? 10 : 0}>
                <MetricInput label="No. of Visiting Faculty / PoP Appointed" value={hodVisitingFaculty} onChange={setHodVisitingFaculty} editable={editable} />
              </Section>
              <Section number="16" title="Faculty Retention %" rubric="≥90% → 10 pts" max={10} score={_toFloat(hodFacultyRetention) >= 90 ? 10 : 0}>
                <MetricInput label="Faculty Retention %" value={hodFacultyRetention} onChange={setHodFacultyRetention} min={0} max={100} step="0.1" editable={editable} />
              </Section>
              <Section number="17" title="% of Enrolment in UG and PG" rubric="100% → 30 pts" max={30} score={0}>
                <MetricInput label="Enrolment % (UG + PG)" value={hodEnrolment} onChange={setHodEnrolment} min={0} max={100} step="0.1" editable={editable} />
              </Section>
              <SectionTotal label="Admin Total" max={50} value={hodScore?.totals.admin || 0} />
            </div>

            <div className="section-block">
              <SBH text="D. Outreach Activities — 50 Points" />
              <Section number="18" title="Faculty & Student Memberships + Programmes Organised" rubric="Min 4 programmes → 10 pts" max={10} score={0}>
                <MetricInput label="No. of Programmes Organised" value={hodProfEvents} onChange={setHodProfEvents} editable={editable} note="Min 4 for full credit" />
              </Section>
              <Section number="19" title="Interaction with Local Bodies" rubric="Min 2 interactions → 10 pts" max={10} score={0}>
                <MetricInput label="No. of Local Body Interactions" value={hodLocalBodies} onChange={setHodLocalBodies} editable={editable} />
              </Section>
              <Section number="20" title="Training Revenue to Industries" rubric="₹50,000 = 20 pts" max={20} score={0}>
                <MetricInput label="Training Revenue Generated (₹)" value={hodTrainingRev} onChange={setHodTrainingRev} min={0} editable={editable} />
              </Section>
              <Section number="21" title="Unique Awards & Recognitions" rubric="1 award = 10 pts" max={10} score={0}>
                <MetricInput label="No. of Unique Awards / Recognitions" value={hodUniqueAwards} onChange={setHodUniqueAwards} editable={editable} />
              </Section>
              <SectionTotal label="Outreach Total" max={50} value={hodScore?.totals.outreach || 0} />
            </div>

            <div className="section-block">
              <SBH text="E. Academic / Research / Professional Development (Self) — 100 Points" />
              <Section number="22" title="% Pass in ESE (Self)" rubric="81%→2M, 81.5%→3M … ≥95%→10M" max={10} score={Math.round(_clamp(calcPassMarks(passPercent, 10), 0, 10))}>
                <div className="derived-note">Average pass %: <strong className="live">{passPercent}%</strong></div>
                <KPITable columns={[
                  { key: "course", label: "Course Name", placeholder: "e.g. Power Electronics" },
                  { key: "semester", label: "Semester", placeholder: "V", width: 80 },
                  { key: "className", label: "Class", placeholder: "EE", width: 70 },
                  { key: "appeared", label: "Appeared", type: "number", width: 100 },
                  { key: "passed", label: "Passed", type: "number", width: 100 },
                  { key: "pct", label: "Pass %", type: "computed", width: 80, align: "center", compute: r => { const a = _toFloat(r.appeared), p = _toFloat(r.passed); return a > 0 ? ((p / a) * 100).toFixed(1) + "%" : "—"; } },
                ]} rows={eseCourses} editable={editable} minRows={1} onAddRow={ese.add} onRemoveRow={ese.remove} onUpdateRow={ese.update} />
              </Section>
              <Section number="23" title="Student Feedback (Self)" rubric="3.1→2M, 3.2→4M … ≥4.5→10M" max={10} score={Math.round(_clamp(calcFbMarks(studentFeedback, 10), 0, 10))}>
                <div className="derived-note">Average feedback: <strong className="live">{studentFeedback} / 5</strong></div>
                <KPITable columns={[
                  { key: "course", label: "Course Name", placeholder: "Course" },
                  { key: "semester", label: "Semester", width: 80 },
                  { key: "className", label: "Class", width: 70 },
                  { key: "feedback", label: "Feedback (0–5)", type: "number", step: "0.1", min: 0, max: 5, width: 120 },
                ]} rows={feedbackCourses} editable={editable} minRows={1} onAddRow={fb.add} onRemoveRow={fb.remove} onUpdateRow={fb.update} />
              </Section>
              <Section number="24a" title="Publications (Self)" rubric="25 pts/pub — cap 60" max={60} score={Math.round(_clamp(25 * publications, 0, 60))}>
                <div className="derived-note">Publications: <strong className="live">{publications}</strong></div>
                <KPITable columns={[
                  { key: "title", label: "Title of Paper", placeholder: "Paper title" },
                  { key: "authors", label: "Authors", width: 130 },
                  { key: "journal", label: "Journal", width: 150 },
                  { key: "monthYear", label: "Month & Year", width: 90 },
                  { key: "indexing", label: "Indexing", type: "select", width: 100, options: ["SCI", "WoS", "Scopus", "Conference"] },
                  { key: "impactFactor", label: "IF", type: "number", step: "0.01", width: 60 },
                ]} rows={pubRows} editable={editable} emptyLabel="No publications added." onAddRow={pub.add} onRemoveRow={pub.remove} onUpdateRow={pub.update} />
              </Section>
              <Section number="24b" title="PhD Scholars Supervision (Self)" rubric="Completion: 10 pts | Full-time: 4 pts | Part-time: 3 pts — cap 20" max={20} score={Math.round(_clamp(10 * phdCompleted + 4 * phdPursuing, 0, 20))}>
                <div className="derived-note">Completed: <strong className="live">{phdCompleted}</strong> | Pursuing: <strong className="live">{phdPursuing}</strong></div>
                <KPITable columns={[
                  { key: "scholar", label: "Scholar Name" },
                  { key: "title", label: "Thesis Title" },
                  { key: "status", label: "Status", type: "select", width: 130, options: ["Full-time", "Part-time", "Completed"] },
                  { key: "year", label: "Year", width: 80 },
                ]} rows={phdRows} editable={editable} emptyLabel="No PhD scholars added." onAddRow={phd.add} onRemoveRow={phd.remove} onUpdateRow={phd.update} />
              </Section>
              <Section number="25" title="Membership in Professional Bodies (Self)" rubric="5 pts / membership — cap 20" max={20} score={Math.round(_clamp(5 * membershipsCount, 0, 20))}>
                <div className="derived-note">Memberships: <strong className="live">{membershipsCount}</strong></div>
                <KPITable columns={[
                  { key: "society", label: "Society / Chapter", placeholder: "IEEE / ISTE…" },
                  { key: "level", label: "Level", type: "select", width: 110, options: ["International", "National", "Regional"] },
                  { key: "memberId", label: "Member ID", width: 110 },
                  { key: "date", label: "Date", width: 100 },
                ]} rows={membershipRows} editable={editable} emptyLabel="No memberships added." onAddRow={mem.add} onRemoveRow={mem.remove} onUpdateRow={mem.update} />
              </Section>
              <SectionTotal label="Self Dev Total" max={100} value={hodScore?.totals.self || 0} />
            </div>
            <SectionTotal label="GRAND TOTAL" max={500} value={hodScore?.totals.total || 0} isGrand />
          </>)}

          {/* ════════════════════════════════════════════════════════════
              CFRD FORM
          ════════════════════════════════════════════════════════════ */}
          {isCFRD && (<>
            <div className="section-block">
              <SBH text="A. Academic Activities — 50 Points" />
              <Section number="1" title="% Pass in ESE" rubric="81%→2M, 81.5%→3M … ≥95%→20M" max={20} score={Math.round(cfrdScore?.totals.academic || 0)}>
                <div className="derived-note">Average pass %: <strong className="live">{passPercent}%</strong></div>
                <KPITable columns={[
                  { key: "course", label: "Course Name" }, { key: "semester", label: "Semester", width: 80 },
                  { key: "className", label: "Class", width: 70 }, { key: "appeared", label: "Appeared", type: "number", width: 100 },
                  { key: "passed", label: "Passed", type: "number", width: 100 },
                  { key: "pct", label: "Pass %", type: "computed", width: 80, align: "center", compute: r => { const a = _toFloat(r.appeared), p = _toFloat(r.passed); return a > 0 ? ((p / a) * 100).toFixed(1) + "%" : "—"; } },
                ]} rows={eseCourses} editable={editable} minRows={1} onAddRow={ese.add} onRemoveRow={ese.remove} onUpdateRow={ese.update} />
              </Section>
              <Section number="2" title="Student Feedback" rubric="3.1→2M, 3.2→4M … ≥4.5→20M" max={20} score={Math.round(_clamp(calcFbMarks(studentFeedback, 20), 0, 20))}>
                <div className="derived-note">Average feedback: <strong className="live">{studentFeedback} / 5</strong></div>
                <KPITable columns={[
                  { key: "course", label: "Course Name" }, { key: "semester", label: "Semester", width: 80 },
                  { key: "className", label: "Class", width: 70 }, { key: "feedback", label: "Feedback (0–5)", type: "number", step: "0.1", min: 0, max: 5, width: 120 },
                ]} rows={feedbackCourses} editable={editable} minRows={1} onAddRow={fb.add} onRemoveRow={fb.remove} onUpdateRow={fb.update} />
              </Section>
              <Section number="3" title="Research Training Activities to Students" rubric="2 pts / hour — cap 10" max={10} score={Math.round(_clamp(_toFloat(cfrdResearchTraining) * 2, 0, 10))}>
                <MetricInput label="Research Training Hours" value={cfrdResearchTraining} onChange={setCfrdResearchTraining} step="0.5" editable={editable} />
              </Section>
              <SectionTotal label="Academic Total" max={50} value={cfrdScore?.totals.academic || 0} />
            </div>
            <div className="section-block">
              <SBH text="B. Research & Professional Development — 450 Points" />
              <Section number="4" title="Publications (Journals / Books / Book Chapters / Patents)" rubric="SCI Q1/Q2=25 | SCI Q3/Q4=20 | WoS/Scopus=15 | Book-Intl=50 | Book-Natl=30 | Edited=20 | Chapter=15 | Patent Published=10 | Patent Granted=30" max={225} score={Math.round(_clamp(25 * publications, 0, 225))}>
                <div className="derived-note">Publications counted: <strong className="live">{publications}</strong></div>
                <KPITable columns={[
                  { key: "title", label: "Title", placeholder: "Paper / Book / Patent title" },
                  { key: "authors", label: "Authors", width: 130 },
                  { key: "venue", label: "Journal / Publisher / Patent No.", width: 200 },
                  { key: "type", label: "Type", type: "select", width: 140, options: ["SCI(Q1/Q2)", "SCI(Q3/Q4)", "WoS/Scopus", "Conference", "Book-International", "Book-National", "Edited Book", "Book Chapter", "Patent Published", "Patent Granted"] },
                  { key: "date", label: "Date", width: 100 },
                  { key: "impactFactor", label: "IF", type: "number", step: "0.01", width: 60 },
                ]} rows={pubRows} editable={editable} emptyLabel="No publications added." onAddRow={pub.add} onRemoveRow={pub.remove} onUpdateRow={pub.update} />
              </Section>
              <Section number="5" title="Grants / Consultancy / Revenue / Product Development" rubric="10 pts per ₹1L — cap 195" max={195} score={Math.round(_clamp((_toFloat(cfrdGrantsRevenue) / 100000) * 10, 0, 195))}>
                <MetricInput label="Total Grants + Consultancy Revenue (₹)" value={cfrdGrantsRevenue} onChange={setCfrdGrantsRevenue} min={0} editable={editable} />
              </Section>
              <Section number="6" title="Research Scholars Supervision" rubric="Completion: 10 pts | Full-time: 4 pts | Part-time: 3 pts — cap 15" max={15} score={Math.round(_clamp(10 * _toInt(cfrdPhdCompleted) + 4 * _toInt(cfrdPhdPursuing), 0, 15))}>
                <div className="sf-meta">
                  <div className="sf-field"><label>PhD Scholars Completed this AY</label><input type="number" className="course-input" value={cfrdPhdCompleted} onChange={e => setCfrdPhdCompleted(e.target.value)} min={0} disabled={!editable} /></div>
                  <div className="sf-field"><label>PhD Scholars Currently Pursuing</label><input type="number" className="course-input" value={cfrdPhdPursuing} onChange={e => setCfrdPhdPursuing(e.target.value)} min={0} disabled={!editable} /></div>
                </div>
              </Section>
              <Section number="7" title="Resource Person for Events / FDP / Guest Lectures" rubric="2 pts per hour — cap 15" max={15} score={Math.round(_clamp(_toFloat(cfrdResourceHours) * 2, 0, 15))}>
                <MetricInput label="Total Resource Person Hours" value={cfrdResourceHours} onChange={setCfrdResourceHours} step="0.5" editable={editable} />
              </Section>
              <SectionTotal label="Research Total" max={450} value={cfrdScore?.totals.research || 0} />
            </div>
            <SectionTotal label="GRAND TOTAL" max={500} value={cfrdScore?.totals.total || 0} isGrand />
          </>)}

          {/* ════════════════════════════════════════════════════════════
              PHYSICAL EDUCATION FORM
          ════════════════════════════════════════════════════════════ */}
          {isPE && (<>
            <div className="section-block">
              <SBH text="Performance Appraisal — Physical Education (Total: 500)" />
              <Section number="1" title="Identifying and Admitting Students under Sports Quota" rubric="100% (with Institutional Scholarship) → 10 pts" max={10} score={Math.round(_clamp((_toFloat(peSportsQuota) / 100) * 10, 0, 10))}>
                <MetricInput label="Sports Quota Admission %" value={peSportsQuota} onChange={setPeSportsQuota} min={0} max={100} step="0.1" editable={editable} />
              </Section>
              <Section number="2" title="Practising Sports / Games along with Students" rubric="Active participation → up to 10 pts" max={10} score={Math.round(_clamp(_toFloat(pePractising) * 2, 0, 10))}>
                <MetricInput label="No. of sessions / activities" value={pePractising} onChange={setPePractising} editable={editable} />
              </Section>
              <Section number="3" title="Organising State Level Events" rubric="KPR Mini Marathon 20 | KPR Trophy 15 | Annual Sports Day 10 | Women's Day 5 | AU Zonal 20 | Interzonal 20 | Staff 10" max={100} score={Math.round(_clamp(_toFloat(peStateEvents), 0, 100))}>
                <MetricInput label="Total points from state-level events" value={peStateEvents} onChange={setPeStateEvents} min={0} max={100} editable={editable} note="Sum up based on event rubric" />
              </Section>
              <Section number="4" title="Organising National Level Events" rubric="10 pts per event — cap 50" max={50} score={Math.round(_clamp(_toInt(peNationalEvents) * 10, 0, 50))}>
                <MetricInput label="No. of National Level Events Organised" value={peNationalEvents} onChange={setPeNationalEvents} editable={editable} />
              </Section>
              <Section number="5" title="Promotional Events (School / Polytechnic / Public)" rubric="5 pts per event — cap 50" max={50} score={Math.round(_clamp(_toInt(pePromoEvents) * 5, 0, 50))}>
                <MetricInput label="No. of Promotional Events" value={pePromoEvents} onChange={setPePromoEvents} editable={editable} />
              </Section>
              <Section number="6" title="Supporting Sports as Venue Partner" rubric="2 pts per event — cap 10" max={10} score={Math.round(_clamp(_toInt(peVenuePartner) * 2, 0, 10))}>
                <MetricInput label="No. of Events as Venue Partner" value={peVenuePartner} onChange={setPeVenuePartner} editable={editable} />
              </Section>
              <Section number="7" title="Revenue Generated through Facilities" rubric="1 pt per ₹10,000 — cap 10" max={10} score={Math.round(_clamp((_toFloat(peRevenue) / 10000) * 1, 0, 10))}>
                <MetricInput label="Revenue Generated (₹)" value={peRevenue} onChange={setPeRevenue} min={0} editable={editable} />
              </Section>
              <Section number="8" title="Feedback from Students" rubric="Based on feedback score (0–5) → cap 10" max={10} score={Math.round(_clamp((_toFloat(peFeedback) / 5) * 10, 0, 10))}>
                <MetricInput label="Student Feedback Score (0–5)" value={peFeedback} onChange={setPeFeedback} step="0.1" min={0} max={5} editable={editable} />
              </Section>
              <Section number="9" title="Points for Student Achievements" rubric="Gold/Silver/Bronze at Anna Univ, District, Interzonal, State, National, International" max={250} score={Math.round(_clamp(_toFloat(peStudentAch), 0, 250))}>
                <MetricInput label="Total Achievement Points" value={peStudentAch} onChange={setPeStudentAch} min={0} max={250} editable={editable} note="Sum from points table below" />
                <div className="pe-points-table">
                  <div className="pe-pt-title">Points Reference Table</div>
                  <table className="kpi-table" style={{ fontSize: 11 }}>
                    <thead><tr><th>Position</th><th>Anna Univ.</th><th>District</th><th>Interzonal/State</th><th>National</th><th>International</th></tr></thead>
                    <tbody>
                      {[["Gold", "3", "5", "8", "12", "20"], ["Silver", "2", "4", "6", "10", "15"], ["Bronze", "1", "3", "4", "8", "10"], ["Participation", "—", "—", "—", "3", "6"]].map(r => (
                        <tr key={r[0]}><td><strong>{r[0]}</strong></td>{r.slice(1).map((v, i) => <td key={i} style={{ textAlign: "center" }}>{v}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
              <SectionTotal label="GRAND TOTAL" max={500} value={peScore?.totals.total || 0} isGrand />
            </div>
          </>)}

          {/* ════════════════════════════════════════════════════════════
              NON-TEACHING (PO / JA) FORM
          ════════════════════════════════════════════════════════════ */}
          {isNTP && (<>
            <div className="section-block">
              <SBH text="Performance Appraisal — Non-Teaching Staff (PO & JA) — Total: 100 Points" />
              <Section number="1" title="Implementation of 5S" rubric="2 pts per 'S' implemented — cap 10" max={10} score={Math.round(_clamp(_toInt(ntpFiveS) * 2, 0, 10))}>
                <MetricInput label="No. of 5S elements implemented (0–5)" value={ntpFiveS} onChange={setNtpFiveS} min={0} max={5} editable={editable} note="Sort, Set in Order, Shine, Standardise, Sustain" />
              </Section>
              <Section number="2" title="Upskilling Training Attended" rubric="3 pts per training — cap 10" max={10} score={Math.round(_clamp(_toInt(ntpTraining) * 3, 0, 10))}>
                <MetricInput label="No. of Upskilling Trainings Attended" value={ntpTraining} onChange={setNtpTraining} editable={editable} />
              </Section>
              <Section number="3" title="Feedback by Stakeholders" rubric="70%→0M, 90%→20M (linear)" max={20} score={Math.round(_clamp(_toFloat(ntpFeedback) >= 70 ? (_toFloat(ntpFeedback) - 70) / (90 - 70) * 20 : 0, 0, 20))}>
                <MetricInput label="Stakeholder Feedback % (0–100)" value={ntpFeedback} onChange={setNtpFeedback} min={0} max={100} step="0.1" editable={editable} />
              </Section>
              <Section number="4" title="Work beyond Office Hours" rubric="Assessed by Head — 0–20 pts" max={20} score={Math.round(_clamp(_toFloat(ntpBeyond), 0, 20))}>
                <MetricInput label="Score awarded by Head (0–20)" value={ntpBeyond} onChange={setNtpBeyond} min={0} max={20} step="0.5" editable={editable} />
              </Section>
              <Section number="5" title="Contribution to Institutional Image / Branding" rubric="5 pts per event — cap 10" max={10} score={Math.round(_clamp(_toInt(ntpBranding) * 5, 0, 10))}>
                <MetricInput label="No. of Branding Events Contributed" value={ntpBranding} onChange={setNtpBranding} editable={editable} />
              </Section>
              <Section number="6" title="Assessment Score by Head" rubric="Punctuality 5 | Coordination 5 | Ethics 5 | Perfection 5 = Total 20" max={20} score={Math.round(_clamp(_toFloat(ntpHeadScore), 0, 20))}>
                <MetricInput label="Total Head Assessment Score (0–20)" value={ntpHeadScore} onChange={setNtpHeadScore} min={0} max={20} step="0.5" editable={editable} note="Punctuality(5)+Coordination(5)+Ethics(5)+Perfection(5)" />
              </Section>
              <SectionTotal label="GRAND TOTAL" max={100} value={ntpScore?.totals.total || 0} isGrand />
            </div>
          </>)}

          {/* ════════════════════════════════════════════════════════════
              NON-TEACHING (LABORATORY) FORM
          ════════════════════════════════════════════════════════════ */}
          {isNTL && (<>
            <div className="section-block">
              <SBH text="Performance Appraisal — Non-Teaching Staff (Laboratory) — Total: 100 Points" />
              <Section number="1" title="Maintaining Lab with 5S" rubric="2 pts per 'S' — cap 10" max={10} score={Math.round(_clamp(_toInt(ntlFiveS) * 2, 0, 10))}>
                <MetricInput label="No. of 5S elements implemented (0–5)" value={ntlFiveS} onChange={setNtlFiveS} min={0} max={5} editable={editable} />
              </Section>
              <Section number="2" title="Safety Measures Implemented" rubric="Full implementation → 10 pts" max={10} score={Math.round(_clamp(_toFloat(ntlSafety) >= 1 ? 10 : 0, 0, 10))}>
                <MetricInput label="Safety measures implemented? (1=Yes, 0=No)" value={ntlSafety} onChange={setNtlSafety} min={0} max={1} editable={editable} />
              </Section>
              <Section number="3" title="Maintaining Equipment in Working Condition" rubric="100% working → 10 pts" max={10} score={Math.round(_clamp(_toFloat(ntlEquipment) >= 100 ? 10 : 0, 0, 10))}>
                <MetricInput label="Equipment Working Condition %" value={ntlEquipment} onChange={setNtlEquipment} min={0} max={100} step="0.1" editable={editable} />
              </Section>
              <Section number="4" title="Assisting Students Beyond Official Hours" rubric="3 pts per student team — cap 10" max={10} score={Math.round(_clamp(_toInt(ntlBeyond) * 3, 0, 10))}>
                <MetricInput label="No. of Student Teams Assisted Beyond Hours" value={ntlBeyond} onChange={setNtlBeyond} editable={editable} />
              </Section>
              <Section number="5" title="Upskilling Training Attended" rubric="3 pts per training — cap 10" max={10} score={Math.round(_clamp(_toInt(ntlTraining) * 3, 0, 10))}>
                <MetricInput label="No. of Upskilling Trainings Attended" value={ntlTraining} onChange={setNtlTraining} editable={editable} />
              </Section>
              <Section number="6" title="Assisting Students for Projects (Micro / Mini / Capstone)" rubric="Capstone: 2 pts — cap 10" max={10} score={Math.round(_clamp(2 * _toInt(ntlProjects), 0, 10))}>
                <MetricInput label="No. of Capstone Projects Assisted" value={ntlProjects} onChange={setNtlProjects} editable={editable} />
              </Section>
              <Section number="7" title="Supporting Consultancy / Research Works / VAC" rubric="2 pts per assignment — cap 10" max={10} score={Math.round(_clamp(_toInt(ntlConsultancy) * 2, 0, 10))}>
                <MetricInput label="No. of Consultancy / Research Assignments" value={ntlConsultancy} onChange={setNtlConsultancy} editable={editable} />
              </Section>
              <Section number="8" title="Contributing to Department / Institution Events" rubric="1 pt per event — cap 10" max={10} score={Math.round(_clamp(_toInt(ntlEvents) * 1, 0, 10))}>
                <MetricInput label="No. of Events Contributed" value={ntlEvents} onChange={setNtlEvents} editable={editable} />
              </Section>
              <Section number="9" title="Contribution to Branding" rubric="5 pts per event — cap 10" max={10} score={Math.round(_clamp(_toInt(ntlBranding) * 5, 0, 10))}>
                <MetricInput label="No. of Branding Events" value={ntlBranding} onChange={setNtlBranding} editable={editable} />
              </Section>
              <Section number="10" title="HoD Feedback" rubric="Punctuality 5 + Work Ethics 5 = Total 10" max={10} score={Math.round(_clamp(_toFloat(ntlHodFeedback), 0, 10))}>
                <MetricInput label="HoD Feedback Score (0–10)" value={ntlHodFeedback} onChange={setNtlHodFeedback} min={0} max={10} step="0.5" editable={editable} />
              </Section>
              <SectionTotal label="GRAND TOTAL" max={100} value={ntlScore?.totals.total || 0} isGrand />
            </div>
          </>)}

          {/* ── Performance Band Display ── */}
          {gt > 0 && (
            <div className="perf-band" style={{ background: gt >= 400 ? "#e8f5ee" : gt >= 300 ? "#e3f2fd" : gt >= 200 ? "#fff8e1" : gt >= 100 ? "#fce4ec" : "#ffebee", borderColor: gt >= 400 ? "#1a7f4f" : gt >= 300 ? "#1976d2" : gt >= 200 ? "#f57c00" : gt >= 100 ? "#c2185b" : "#c62828" }}>
              <span className="perf-label">Performance Band:</span>
              <span className="perf-value" style={{ color: gt >= 400 ? "#1a7f4f" : gt >= 300 ? "#1976d2" : gt >= 200 ? "#e65100" : gt >= 100 ? "#880e4f" : "#b71c1c" }}>
                {gt >= 400 ? "Good Performance" : gt >= 300 ? "Has Potential & Need to Work Smart" : gt >= 200 ? "Needs to Improve the Focus" : gt >= 100 ? "Needs Significant Improvement" : "Lacks Commitment"}
              </span>
              <span className="perf-score">{gt} pts</span>
            </div>
          )}

          {/* ── Global proof zone ── */}
          <div className="global-proof-zone"
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDropFile}
            style={{ borderColor: dragOver ? "#1a7f4f" : undefined }}>
            <div className="gpz-left">
              <div style={{ fontSize: 22 }}>📂</div>
              <div>
                <div className="gpz-label">Global Proof Attachment (optional, multiple files)</div>
                <div className="gpz-sub">Drag & drop files here, or{" "}
                  <label className="gpz-choose"><input type="file" accept=".pdf,.docx,.png,.jpg" multiple style={{ display: "none" }} onChange={e => { if (!editable) return; const f = Array.from(e.target.files || []); if (f.length) setProofFiles(p => [...p, ...f]); e.target.value = ""; }} disabled={!editable} />click to choose</label>
                </div>
              </div>
            </div>
            <div className="gpz-right">
              {existingProofs.map((p, i) => (
                <div key={`ep${i}`} className="file-chip existing">{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.name}</a> : p.name}</div>
              ))}
              {proofFiles.map((f, i) => (
                <div key={`np${i}`} className="file-chip new"><span title={f.name}>{f.name}</span><button type="button" className="chip-x" onClick={() => removeProofFile(i)}>✕</button></div>
              ))}
              {!existingProofs.length && !proofFiles.length && <span className="gpz-empty">No files chosen</span>}
            </div>
          </div>

          {statusMsg && (
            <div className={`sf-status ${statusMsg.startsWith("Error") ? "error" : "success"}`}>{statusMsg}</div>
          )}
        </div>
      </form>

      {/* ═══════════════════ SCOPED CSS ═══════════════════ */}
      <style>{`
        .sf-overlay{position:fixed;inset:0;background:rgba(15,25,50,0.55);display:flex;align-items:center;justify-content:center;z-index:3000;padding:18px;}
        .sf-form{width:92%;max-width:1100px;max-height:92vh;overflow:auto;background:#f4f6f9;padding:0;border-radius:12px;color:#1a2332;box-shadow:0 10px 50px rgba(15,25,50,0.28);font-family:'Segoe UI',system-ui,sans-serif;scrollbar-width:thin;scrollbar-color:#c8d3de transparent;}
        .sf-form::-webkit-scrollbar{width:6px;}.sf-form::-webkit-scrollbar-thumb{background:#c8d3de;border-radius:4px;}
        .sf-form-body{padding:16px 20px;}
        .sf-topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;background:#1b2d4f;padding:16px 20px;border-radius:12px 12px 0 0;}
        .sf-title{margin:0 0 3px;font-size:17px;font-weight:800;color:#ffffff;}
        .sf-subtitle{margin:0 0 6px;font-size:12px;color:rgba(255,255,255,0.6);}
        .sf-rubric-badge{display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(34,160,107,0.25);border:1px solid rgba(34,160,107,0.45);font-size:11px;color:#7ddfb0;font-weight:600;}
        .sf-topbar-actions{display:flex;gap:8px;flex-shrink:0;align-items:flex-start;}
        .sf-meta{display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;}
        .sf-field{display:flex;flex-direction:column;gap:5px;flex:1;min-width:160px;}
        .sf-field label{font-size:11px;color:#4a5568;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}
        .sf-field select,.sf-field input{padding:8px 11px;border-radius:7px;background:#ffffff;border:1px solid #d1d9e0;color:#1a2332;font-size:13px;outline:none;transition:border .18s,box-shadow .18s;}
        .sf-field select:focus,.sf-field input:focus{border-color:#1a7f4f;box-shadow:0 0 0 3px rgba(26,127,79,0.1);}
        .score-strip{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;}
        .score-chip{flex:1;min-width:110px;background:#ffffff;border:1px solid #d1d9e0;border-radius:10px;padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
        .score-chip.grand{flex:1.4;border-color:#1a7f4f;background:#e8f5ee;}
        .sc-label{font-size:10px;color:#718096;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
        .sc-val{font-size:22px;font-weight:800;color:#1a2332;line-height:1;margin-bottom:6px;}
        .score-chip.grand .sc-val{color:#1a7f4f;}
        .sc-max{font-size:12px;font-weight:400;color:#a0aec0;margin-left:2px;}
        .sc-bar-bg{height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden;}
        .sc-bar-fill{height:100%;background:#22a06b;border-radius:2px;transition:width .35s;}
        .sc-bar-fill.grand{background:linear-gradient(90deg,#1a7f4f,#22a06b);}
        .section-block{border:1px solid #d1d9e0;border-radius:10px;margin-bottom:14px;overflow:hidden;background:#ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.05);}
        .section-block-header{background:#1b2d4f;padding:9px 16px;font-size:11px;font-weight:800;color:#ffffff;text-transform:uppercase;letter-spacing:.6px;}
        .kpi-section{border-bottom:1px solid #edf2f7;}
        .kpi-section:last-child{border-bottom:none;}
        .kpi-section-header{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;gap:12px;cursor:pointer;transition:background .16s;}
        .kpi-section-header:hover{background:#f7fafc;}
        .kpi-section-left{display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0;}
        .kpi-section-right{display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;}
        .kpi-num{min-width:34px;height:34px;border-radius:8px;flex-shrink:0;background:#e8f5ee;border:1px solid #b2dfcc;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#1a7f4f;}
        .kpi-title{font-size:13px;font-weight:700;color:#1a2332;line-height:1.3;}
        .kpi-rubric{font-size:11px;color:#718096;margin-top:2px;}
        .kpi-max{font-size:11px;color:#718096;white-space:nowrap;}.kpi-max strong{color:#4a5568;}
        .kpi-badge{min-width:44px;text-align:center;padding:4px 10px;border-radius:8px;font-size:14px;font-weight:800;transition:background .3s,color .3s;}
        .kpi-chevron{font-size:10px;color:#a0aec0;}
        .kpi-section-body{padding:8px 16px 14px;background:#fafcff;}
        .derived-note{font-size:12px;color:#2d6a4f;background:#e8f5ee;border-left:3px solid #1a7f4f;padding:5px 10px;border-radius:0 6px 6px 0;margin-bottom:8px;}
        .derived-note.alert-box{background:#fff3e0;border-left-color:#f57c00;color:#7c4700;}
        .derived-note .live{color:#1a7f4f;font-weight:700;}
        .kpi-table-wrap{overflow-x:auto;border-radius:7px;border:1px solid #e2e8f0;}
        .kpi-table{width:100%;border-collapse:collapse;font-size:12px;}
        .kpi-table thead tr{background:#f0f4f8;}
        .kpi-table th{padding:7px 8px;text-align:left;font-weight:700;color:#4a5568;font-size:11px;border-bottom:1px solid #e2e8f0;white-space:nowrap;text-transform:uppercase;letter-spacing:.3px;}
        .kpi-table-row{transition:background .12s;}
        .kpi-table-row:nth-child(even){background:#f9fafb;}
        .kpi-table-row:hover{background:#edf7f2;}
        .kpi-table td{padding:5px 6px;border-bottom:1px solid #edf2f7;vertical-align:middle;color:#2d3748;}
        .kpi-table tr:last-child td{border-bottom:none;}
        .course-input{width:100%;padding:5px 8px;border-radius:5px;border:1px solid #d1d9e0;background:#ffffff;color:#1a2332;font-size:12px;outline:none;transition:border .16s,box-shadow .16s;}
        .course-input:focus{border-color:#1a7f4f;box-shadow:0 0 0 2px rgba(26,127,79,0.12);}
        .course-input:disabled{background:#f7fafc;color:#a0aec0;cursor:not-allowed;}
        .computed-cell{font-weight:700;color:#1a7f4f;padding:0 6px;font-size:12px;}
        .act-btn{width:24px;height:24px;border-radius:5px;border:none;cursor:pointer;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;transition:background .16s,transform .1s;}
        .act-btn.add{background:#e8f5ee;color:#1a7f4f;border:1px solid #b2dfcc;margin-right:2px;}
        .act-btn.add:hover{background:#1a7f4f;color:#fff;transform:scale(1.08);}
        .act-btn.rem{background:#fff0f0;color:#e53e3e;border:1px solid #fbb6b6;}
        .act-btn.rem:hover{background:#e53e3e;color:#fff;transform:scale(1.08);}
        .btn-add-first{margin:5px 0;padding:5px 12px;border-radius:6px;background:#f0faf5;border:1px dashed #1a7f4f;color:#1a7f4f;font-size:12px;cursor:pointer;font-weight:600;transition:background .16s;}
        .btn-add-first:hover{background:#e8f5ee;}
        .section-total{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#f0f4f8;border-top:1px solid #e2e8f0;font-size:13px;font-weight:800;color:#2d3748;}
        .section-total.grand{background:linear-gradient(90deg,#1b2d4f,#1a7f4f);border:none;border-radius:8px;margin-top:10px;font-size:15px;color:#ffffff;}
        .section-total.grand .st-val,.section-total.grand .st-max{color:#ffffff;}
        .section-total.grand .st-max{opacity:.7;}
        .st-left{flex:1;}.st-right{display:flex;align-items:center;gap:14px;}
        .st-bar-wrap{width:110px;height:5px;background:rgba(0,0,0,0.08);border-radius:3px;overflow:hidden;}
        .section-total.grand .st-bar-wrap{background:rgba(255,255,255,0.2);}
        .st-bar{height:100%;border-radius:3px;background:#1a7f4f;transition:width .35s;}
        .section-total.grand .st-bar{background:#ffffff;}
        .st-score{display:flex;align-items:baseline;gap:1px;min-width:68px;justify-content:flex-end;}
        .st-val{font-size:18px;font-weight:800;color:#1a2332;}.st-max{font-size:12px;color:#718096;}
        .metric-input-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #edf2f7;gap:12px;}
        .metric-input-row:last-child{border-bottom:none;}
        .metric-label{font-size:13px;color:#2d3748;font-weight:600;flex:1;}
        .metric-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}
        .metric-field{width:140px;}
        .metric-note{font-size:11px;color:#718096;max-width:160px;}
        .file-attach-wrap{display:flex;flex-direction:column;align-items:flex-end;gap:4px;}
        .btn-attach{padding:4px 9px;border-radius:5px;cursor:pointer;background:#f0faf5;border:1px solid #b2dfcc;color:#1a7f4f;font-size:12px;font-weight:600;transition:background .16s;white-space:nowrap;}
        .btn-attach:hover{background:#e8f5ee;}
        .file-chip{display:flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:11px;}
        .file-chip.existing{background:#fff8e1;color:#b7791f;border:1px solid #f6cc72;}
        .file-chip.existing a{color:#b7791f;text-decoration:none;}
        .file-chip.new{background:#e8f5ee;color:#1a7f4f;border:1px solid #b2dfcc;}
        .file-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100px;}
        .chip-x{background:none;border:none;cursor:pointer;color:inherit;padding:0;font-size:10px;opacity:.55;line-height:1;}.chip-x:hover{opacity:1;}
        .global-proof-zone{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 16px;border-radius:8px;margin-top:14px;border:2px dashed #b2dfcc;background:#f0faf5;transition:border-color .2s;flex-wrap:wrap;}
        .global-proof-zone:hover{border-color:#1a7f4f;}
        .gpz-left{display:flex;align-items:center;gap:12px;}
        .gpz-label{font-size:13px;font-weight:700;color:#2d6a4f;}
        .gpz-sub{font-size:12px;color:#718096;margin-top:2px;}
        .gpz-choose{color:#1a7f4f;text-decoration:underline;cursor:pointer;font-weight:600;}
        .gpz-right{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end;min-width:260px;}
        .gpz-empty{color:#a0aec0;font-size:12px;}
        .sf-status{margin-top:12px;padding:9px 14px;border-radius:8px;font-size:13px;font-weight:600;}
        .sf-status.success{background:#e8f5ee;border:1px solid #b2dfcc;color:#1a7f4f;}
        .sf-status.error{background:#fff0f0;border:1px solid #fbb6b6;color:#c53030;}
        .btn-primary{padding:9px 18px;border-radius:8px;border:none;background:#1a7f4f;color:#fff;font-weight:700;font-size:13px;cursor:pointer;transition:all .2s;white-space:nowrap;}
        .btn-primary:hover:not(:disabled){background:#155f3a;box-shadow:0 4px 12px rgba(26,127,79,0.35);transform:translateY(-1px);}
        .btn-primary:disabled{opacity:.55;cursor:not-allowed;}
        .btn-cancel{padding:9px 14px;border-radius:8px;border:1px solid #d1d9e0;background:#ffffff;color:#4a5568;font-size:13px;cursor:pointer;transition:all .2s;font-weight:600;}
        .btn-cancel:hover{background:#f0f4f8;border-color:#b0bec5;}
        .perf-band{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:8px;border:2px solid;margin-top:12px;flex-wrap:wrap;}
        .perf-label{font-size:12px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.4px;}
        .perf-value{font-size:14px;font-weight:800;flex:1;}
        .perf-score{font-size:16px;font-weight:800;color:#1a2332;margin-left:auto;}
        .pe-points-table{margin-top:12px;padding:10px;background:#f8faff;border-radius:8px;border:1px solid #e2e8f0;}
        .pe-pt-title{font-size:11px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px;}
      `}</style>
    </div>
  );
}
