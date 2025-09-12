// src/SubmissionForm.jsx
import React, { useEffect, useMemo, useState } from "react";

/*
  SubmissionForm
  - Shows full 20 activities in a table-like layout
  - computeMarks() returns perRow and totals
  - on submit, POST to `${apiBase}/api/submissions/` with section_totals_json and file (proof)
*/

export default function SubmissionForm({
  apiBase = "http://127.0.0.1:8000",
  onSubmitted = () => {},
  onCancel = () => {},
}) {
  // meta
  const [facultyRank, setFacultyRank] = useState("AP I");
  const [academicYear, setAcademicYear] = useState("2024-2025");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  // --- Academic inputs
  const [passPercent, setPassPercent] = useState(85);
  const [studentFeedback, setStudentFeedback] = useState(4.0);
  const [onlineVideos, setOnlineVideos] = useState(0);
  const [sdgActivities, setSdgActivities] = useState(0);
  const [vacHours, setVacHours] = useState(0);

  // --- Research
  const [publications, setPublications] = useState(0);
  const [citations, setCitations] = useState(0);
  const [consultancyRevenue, setConsultancyRevenue] = useState(0);
  const [sponsoredGrantsCount, setSponsoredGrantsCount] = useState(0);
  const [sponsoredGrantsAmount, setSponsoredGrantsAmount] = useState(0);
  const [researchVisits, setResearchVisits] = useState(0);
  const [membershipsCount, setMembershipsCount] = useState(0);
  const [fdpDaysPhys, setFdpDaysPhys] = useState(0);
  const [fdpDaysOnline, setFdpDaysOnline] = useState(0);
  const [mooc4w, setMooc4w] = useState(0);
  const [mandatoryCourses, setMandatoryCourses] = useState(0);

  // --- Admin / Responsibilities
  const [convenerDays, setConvenerDays] = useState(0);
  const [convenerOnlineDays, setConvenerOnlineDays] = useState(0);
  const [guestHours, setGuestHours] = useState(0);
  const [committeeEvents, setCommitteeEvents] = useState(0);
  const [eventsA, setEventsA] = useState(0);
  const [eventsB, setEventsB] = useState(0);
  const [eventsC, setEventsC] = useState(0);
  const [headCount, setHeadCount] = useState(0);
  const [memberCount, setMemberCount] = useState(0);

  // --- Outreach
  const [outreachActivities, setOutreachActivities] = useState(0);
  const [resourceOutsideHours, setResourceOutsideHours] = useState(0);
  const [resourceInsideHours, setResourceInsideHours] = useState(0);
  const [trainingDays, setTrainingDays] = useState(0);
  const [awardsCount, setAwardsCount] = useState(0);
  const [editorialCount, setEditorialCount] = useState(0);
  const [reviewsCount, setReviewsCount] = useState(0);

  // file upload
  const [proofFile, setProofFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const token = localStorage.getItem("token");

  // helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const toInt = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && !Number.isNaN(n) ? Math.floor(n) : 0;
  };
  const toFloat = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && !Number.isNaN(n) ? n : 0;
  };

  // compute marks - same algorithm as prior code
  function computeMarks() {
    const passPct = toFloat(passPercent);
    let passMarks = passPct > 81 ? ((passPct - 81) / (95 - 81)) * 30 : 0;
    passMarks = clamp(passMarks, 0, 30);

    const studFb = toFloat(studentFeedback);
    let fbMarks = studFb > 3.1 ? ((studFb - 3.1) / (4.5 - 3.1)) * 30 : 0;
    fbMarks = clamp(fbMarks, 0, 30);

    const videosMarks = clamp(10 * toInt(onlineVideos), 0, 30);
    const sdgMarks = clamp(4 * toInt(sdgActivities), 0, 30);
    const vacMarks = clamp(1 * toInt(vacHours), 0, 9999);

    const academicTotal = clamp(passMarks + fbMarks + videosMarks + sdgMarks + vacMarks, 0, 150);

    const pubsMarks = clamp(25 * toInt(publications), 0, 75);
    const citationsMarks = clamp(1 * toInt(citations), 0, 15);
    const consultancyMarks = clamp(toFloat(consultancyRevenue) > 0 ? (toFloat(consultancyRevenue) / 200000) * 20 : 0, 0, 20);

    const proposalsMarks = clamp(5 * toInt(sponsoredGrantsCount), 0, 15);
    const grantsAmountMarks = clamp(
      toFloat(sponsoredGrantsAmount) > 10000 ? ((toFloat(sponsoredGrantsAmount) - 10000) / (200000 - 10000)) * 25 : 0,
      0,
      25
    );
    const sponsoredCombined = clamp(proposalsMarks + grantsAmountMarks, 0, 40);

    const researchVisitsMarks = clamp(10 * toInt(researchVisits), 0, 10);
    const membershipsMarks = clamp(10 * toInt(membershipsCount), 0, 10);
    const fdpMarks = clamp(1 * toFloat(fdpDaysPhys) + 0.5 * toFloat(fdpDaysOnline) + 4 * toInt(mooc4w), 0, 20);
    const mandatoryMarks = clamp(10 * toInt(mandatoryCourses), 0, 10);

    const researchTotal = clamp(
      pubsMarks +
        citationsMarks +
        consultancyMarks +
        sponsoredCombined +
        researchVisitsMarks +
        membershipsMarks +
        fdpMarks +
        mandatoryMarks,
      0,
      200
    );

    const convenerMarks = clamp(3 * toInt(convenerDays) + 2 * toInt(convenerOnlineDays) + 2 * toInt(guestHours) + 1 * toInt(committeeEvents), 0, 20);
    const eventsMarks = 3 * toInt(eventsA) + 2 * toInt(eventsB) + 1 * toInt(eventsC);
    const respMarks = clamp(10 * toInt(headCount) + 5 * toInt(memberCount), 0, 30);
    const adminTotal = clamp(convenerMarks + eventsMarks + respMarks, 0, 50);

    const communityMarks = clamp(10 * toInt(outreachActivities), 0, 30);
    const resourceMarks = clamp(3 * toInt(resourceOutsideHours) + 2 * toInt(resourceInsideHours), 0, 20);
    const trainingMarks = clamp((toFloat(trainingDays) / 14) * 30, 0, 30);
    const awardsMarks = clamp(5 * toInt(awardsCount), 0, 20);
    const recognitionMarks = clamp(4 * toInt(editorialCount) + 1 * toInt(reviewsCount), 0, 20);
    const awardsTotal = clamp(awardsMarks + recognitionMarks, 0, 20);
    const outreachTotal = clamp(communityMarks + resourceMarks + trainingMarks + awardsTotal, 0, 100);

    const grandTotal = Math.round(academicTotal + researchTotal + adminTotal + outreachTotal);

    return {
      perRow: {
        academic: { passMarks, fbMarks, videosMarks, sdgMarks, vacMarks },
        research: {
          pubsMarks,
          citationsMarks,
          consultancyMarks,
          proposalsMarks,
          grantsAmountMarks,
          sponsoredCombined,
          researchVisitsMarks,
          membershipsMarks,
          fdpMarks,
          mandatoryMarks,
        },
        admin: { convenerMarks, eventsMarks, respMarks },
        outreach: { communityMarks, resourceMarks, trainingMarks, awardsTotal },
      },
      totals: { academic: Math.round(academicTotal), research: Math.round(researchTotal), admin: Math.round(adminTotal), outreach: Math.round(outreachTotal), total: grandTotal },
    };
  }

  // compute live
  const computed = useMemo(() => computeMarks(), [
    passPercent,
    studentFeedback,
    onlineVideos,
    sdgActivities,
    vacHours,
    publications,
    citations,
    consultancyRevenue,
    sponsoredGrantsCount,
    sponsoredGrantsAmount,
    researchVisits,
    membershipsCount,
    fdpDaysPhys,
    fdpDaysOnline,
    mooc4w,
    mandatoryCourses,
    convenerDays,
    convenerOnlineDays,
    guestHours,
    committeeEvents,
    eventsA,
    eventsB,
    eventsC,
    headCount,
    memberCount,
    outreachActivities,
    resourceOutsideHours,
    resourceInsideHours,
    trainingDays,
    awardsCount,
    editorialCount,
    reviewsCount,
  ]);

  // drag & drop
  function onDropFile(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) setProofFile(f);
  }

  async function handleSubmit(e) {
    e && e.preventDefault();
    setStatus("");
    setSubmitting(true);

    if (!token) {
      setStatus("You must be logged in to submit.");
      setSubmitting(false);
      return;
    }

    try {
      const fd = new FormData();
      fd.append("faculty_rank", facultyRank);
      fd.append("academic_year", academicYear);

      // academic
      fd.append("pass_percent", toFloat(passPercent));
      fd.append("student_feedback", toFloat(studentFeedback));
      fd.append("online_videos", toInt(onlineVideos));
      fd.append("sdg_activities", toInt(sdgActivities));
      fd.append("vac_hours", toInt(vacHours));

      // research
      fd.append("publications", toInt(publications));
      fd.append("citations", toInt(citations));
      fd.append("consultancy_revenue", toFloat(consultancyRevenue));
      fd.append("sponsored_grants_count", toInt(sponsoredGrantsCount));
      fd.append("sponsored_grants_amount", toFloat(sponsoredGrantsAmount));
      fd.append("research_visits", toInt(researchVisits));
      fd.append("memberships_count", toInt(membershipsCount));
      fd.append("fdp_days_phys", toFloat(fdpDaysPhys));
      fd.append("fdp_days_online", toFloat(fdpDaysOnline));
      fd.append("mooc_4w", toInt(mooc4w));
      fd.append("mandatory_courses", toInt(mandatoryCourses));

      // admin
      fd.append("convener_days", toInt(convenerDays));
      fd.append("convener_online_days", toInt(convenerOnlineDays));
      fd.append("guest_hours", toInt(guestHours));
      fd.append("committee_events", toInt(committeeEvents));
      fd.append("events_a", toInt(eventsA));
      fd.append("events_b", toInt(eventsB));
      fd.append("events_c", toInt(eventsC));
      fd.append("head_count", toInt(headCount));
      fd.append("member_count", toInt(memberCount));

      // outreach
      fd.append("outreach_activities", toInt(outreachActivities));
      fd.append("resource_outside_hours", toInt(resourceOutsideHours));
      fd.append("resource_inside_hours", toInt(resourceInsideHours));
      fd.append("training_days", toFloat(trainingDays));
      fd.append("awards_count", toInt(awardsCount));
      fd.append("editorial_count", toInt(editorialCount));
      fd.append("reviews_count", toInt(reviewsCount));

      // computed totals
      fd.append("section_totals_json", JSON.stringify(computed));

      if (proofFile) fd.append("proof", proofFile);

      const res = await fetch(`${apiBase.replace(/\/$/,"")}/api/submissions/`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || JSON.stringify(body) || `HTTP ${res.status}`);
      setStatus("Submission saved.");
      setProofFile(null);
      // optionally reset some fields — leaving defaults
      onSubmitted();
    } catch (err) {
      setStatus("Error: " + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // small row renderer helper to make code shorter
  function NumericInput({ value, onChange, placeholder = "Enter", min = 0, step = "1" }) {
    return (
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 110,
          padding: "6px 8px",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
          color: "#eaf2ff",
        }}
        placeholder={placeholder}
      />
    );
  }

  // layout: we'll produce a large vertically scrollable modal-ish card
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(3,6,23,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 18
    }}>
      <form onSubmit={handleSubmit} style={{
        width: "92%", maxWidth: 1100, maxHeight: "92vh", overflow: "auto",
        background: "#0d1b2a", padding: 20, borderRadius: 12, color: "#eaf2ff",
        boxShadow: "0 8px 40px rgba(2,6,18,0.6)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
          <div>
            <h2 style={{ margin: "0 0 6px 0" }}>Submit KPI Sheet</h2>
            <div style={{ color: "rgba(200,220,255,0.6)" }}>Fill the KPI entries below. Points will be computed automatically.</div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onCancel} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)", background: "transparent", color: "#eaf2ff", cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={submitting} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "linear-gradient(90deg,#6a11cb,#2575fc)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              {submitting ? "Submitting..." : "Submit KPI Sheet"}
            </button>
          </div>
        </div>

        {/* meta row */}
        <div style={{ display: "flex", gap: 12, marginTop: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <label style={{ display: "block", color: "rgba(200,220,255,0.7)", marginBottom: 6 }}>🎓 Faculty Rank</label>
            <select value={facultyRank} onChange={(e) => setFacultyRank(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: "#0b1720", color: "#eaf2ff", border: "1px solid rgba(255,255,255,0.04)" }}>
              <option>AP I</option>
              <option>AP II</option>
              <option>AP III</option>
              <option>AsP/Prof</option>
              <option>CFRD</option>
            </select>
          </div>

          <div style={{ flex: "1 1 160px" }}>
            <label style={{ display: "block", color: "rgba(200,220,255,0.7)", marginBottom: 6 }}>📅 Academic Year</label>
            <input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: "#0b1720", color: "#eaf2ff", border: "1px solid rgba(255,255,255,0.04)" }} />
          </div>
        </div>

        {/* table / card */}
        <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.03)", marginTop: 6, background: "linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.008))" }}>
          <div style={{ padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,0.02)", background: "rgba(255,255,255,0.01)", display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 48, color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>#</div>
            <div style={{ flex: 1, color: "rgba(200,220,255,0.9)", fontWeight: 700 }}>Activity</div>
            <div style={{ width: 300, color: "rgba(200,220,255,0.9)", fontWeight: 700 }}>Rubric <span style={{ fontSize: 12, color: "rgba(200,220,255,0.6)" }}>(ℹ️)</span></div>
            <div style={{ width: 80, color: "rgba(200,220,255,0.9)", fontWeight: 700, textAlign: "right" }}>Max</div>
            <div style={{ width: 160, color: "rgba(200,220,255,0.9)", fontWeight: 700, textAlign: "right" }}>Points Scored</div>
          </div>

          <div style={{ padding: 12 }}>
            {/* We'll render each row manually to ensure full 20 rows */}
            {/* 1: Pass % */}
            <Row number={1} activity="% Pass in ESE (Average of all theory courses)" rubric="81% - 95% → 0–30" max={30}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={passPercent} onChange={(v) => setPassPercent(v)} min={0} step="0.1" />
                <Badge>{Math.round(computed.perRow.academic.passMarks)}</Badge>
              </div>
            </Row>

            {/* 2: Student feedback */}
            <Row number={2} activity="Student Feedback (Average of all theory courses)" rubric="3.1 - 4.5 (out of 5) → 0–30" max={30}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={studentFeedback} onChange={(v) => setStudentFeedback(v)} min={0} step="0.1" />
                <Badge>{Math.round(computed.perRow.academic.fbMarks)}</Badge>
              </div>
            </Row>

            {/* 3: Online videos */}
            <Row number={3} activity="Developing Online Course / Video Lecture and uploaded" rubric="10 pts / video (cap 30)" max={30}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={onlineVideos} onChange={(v) => setOnlineVideos(v)} min={0} step="1" />
                <Badge>{Math.round(computed.perRow.academic.videosMarks)}</Badge>
              </div>
            </Row>

            {/* 4: SDG activities */}
            <Row number={4} activity="Implementation of Innovative teaching methodologies addressing SDGs" rubric="4 pts / activity (cap 30)" max={30}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={sdgActivities} onChange={(v) => setSdgActivities(v)} min={0} />
                <Badge>{Math.round(computed.perRow.academic.sdgMarks)}</Badge>
              </div>
            </Row>

            {/* 5: VAC hours */}
            <Row number={5} activity="Conduct of VAC / Capsule courses / Achievements / Publications" rubric="1 pt/hr VAC; 4 pts achievement; 2 pts/publication" max={30}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={vacHours} onChange={(v) => setVacHours(v)} min={0} />
                <Badge>{Math.round(computed.perRow.academic.vacMarks)}</Badge>
              </div>
            </Row>

            {/* Academic subtotal */}
            <SectionTotal label="Academic Total" max={150} value={computed.totals.academic} />

            {/* Research section header */}
            <SectionHeader text="Research & Professional Development" />

            {/* 6: Publications */}
            <Row number={6} activity="Publications" rubric="25 pts / publication (up to 75)" max={75}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={publications} onChange={(v) => setPublications(v)} min={0} />
                <Badge>{Math.round(computed.perRow.research.pubsMarks)}</Badge>
              </div>
            </Row>

            {/* 7: Citations */}
            <Row number={7} activity="Citations" rubric="1 pt / citation (cap 15)" max={15}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={citations} onChange={(v) => setCitations(v)} min={0} />
                <Badge>{Math.round(computed.perRow.research.citationsMarks)}</Badge>
              </div>
            </Row>

            {/* 8: Consultancy */}
            <Row number={8} activity="Consultancy Revenue (₹ / year)" rubric="Scaled 0..200k → 0..20" max={20}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={consultancyRevenue} onChange={(v) => setConsultancyRevenue(v)} min={0} />
                <Badge>{Math.round(computed.perRow.research.consultancyMarks)}</Badge>
              </div>
            </Row>

            {/* 9: Sponsored grants */}
            <Row number={9} activity="Sponsored grants / proposals" rubric="Combined scaled score (cap 40)" max={40}>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <input className="mini" type="number" min="0" placeholder="#proposals" value={sponsoredGrantsCount} onChange={(e) => setSponsoredGrantsCount(e.target.value)} style={{ width: 90, padding: "6px 8px", borderRadius:6 }} />
                <input className="mini" type="number" min="0" placeholder="Total ₹" value={sponsoredGrantsAmount} onChange={(e) => setSponsoredGrantsAmount(e.target.value)} style={{ width: 110, padding: "6px 8px", borderRadius:6 }} />
                <Badge>{Math.round(computed.perRow.research.sponsoredCombined)}</Badge>
              </div>
            </Row>

            {/* 10: Research visits */}
            <Row number={10} activity="Research visits" rubric="10 pts / visit" max={10}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={researchVisits} onChange={(v) => setResearchVisits(v)} min={0} />
                <Badge>{Math.round(computed.perRow.research.researchVisitsMarks)}</Badge>
              </div>
            </Row>

            {/* 11: Memberships */}
            <Row number={11} activity="Professional memberships" rubric="10 pts / membership" max={10}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={membershipsCount} onChange={(v) => setMembershipsCount(v)} min={0} />
                <Badge>{Math.round(computed.perRow.research.membershipsMarks)}</Badge>
              </div>
            </Row>

            {/* 12: FDP / MOOC / STTP */}
            <Row number={12} activity="FDP / MOOC / STTP" rubric="1 pt/day physical; 0.5 pt/day online; 4 pts/4w MOOC" max={20}>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput value={fdpDaysPhys} onChange={(v) => setFdpDaysPhys(v)} min={0} placeholder="phys days" />
                <NumericInput value={fdpDaysOnline} onChange={(v) => setFdpDaysOnline(v)} min={0} placeholder="online days" />
                <NumericInput value={mooc4w} onChange={(v) => setMooc4w(v)} min={0} placeholder="4w MOOC" />
                <Badge>{Math.round(computed.perRow.research.fdpMarks)}</Badge>
              </div>
            </Row>

            {/* 13: Mandatory training */}
            <Row number={13} activity="Mandatory training courses" rubric="10 pts / course" max={10}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput value={mandatoryCourses} onChange={(v) => setMandatoryCourses(v)} min={0} />
                <Badge>{Math.round(computed.perRow.research.mandatoryMarks)}</Badge>
              </div>
            </Row>

            {/* Research subtotal */}
            <SectionTotal label="Research Total" max={200} value={computed.totals.research} />

            {/* Administration header */}
            <SectionHeader text="Administration" />

            {/* 14: Convener / Guest / committee */}
            <Row number={14} activity="Convener / Coordinator / Guest lectures / Committees" rubric="Physical 3 pts/day; Online 2 pts/day; Guest 2 pts/hr; Committee 1 pt" max={20}>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput value={convenerDays} onChange={(v) => setConvenerDays(v)} min={0} placeholder="phys" />
                <NumericInput value={convenerOnlineDays} onChange={(v) => setConvenerOnlineDays(v)} min={0} placeholder="online" />
                <NumericInput value={guestHours} onChange={(v) => setGuestHours(v)} min={0} placeholder="guest hrs" />
                <Badge>{Math.round(computed.perRow.admin.convenerMarks)}</Badge>
              </div>
            </Row>

            {/* 15: Events A/B/C */}
            <Row number={15} activity="Institution events (a/b/c)" rubric="a:3 pts b:2 pts c:1 pt" max={0}>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput value={eventsA} onChange={(v) => setEventsA(v)} min={0} placeholder="a" />
                <NumericInput value={eventsB} onChange={(v) => setEventsB(v)} min={0} placeholder="b" />
                <NumericInput value={eventsC} onChange={(v) => setEventsC(v)} min={0} placeholder="c" />
                <Badge>{Math.round(computed.perRow.admin.eventsMarks)}</Badge>
              </div>
            </Row>

            {/* 16: Responsibilities */}
            <Row number={16} activity="Institute / Dept responsibilities" rubric="Head 10 pts, Member 5 pts" max={30}>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput value={headCount} onChange={(v) => setHeadCount(v)} min={0} placeholder="heads" />
                <NumericInput value={memberCount} onChange={(v) => setMemberCount(v)} min={0} placeholder="members" />
                <Badge>{Math.round(computed.perRow.admin.respMarks)}</Badge>
              </div>
            </Row>

            <SectionTotal label="Admin Total" max={50} value={computed.totals.admin} />

            {/* Outreach header */}
            <SectionHeader text="Outreach Activities" />

            {/* 17: Community service */}
            <Row number={17} activity="Community Services / ISR" rubric="10 pts / activity" max={30}>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput value={outreachActivities} onChange={(v) => setOutreachActivities(v)} min={0} />
                <Badge>{Math.round(computed.perRow.outreach.communityMarks)}</Badge>
              </div>
            </Row>

            {/* 18: Resource person */}
            <Row number={18} activity="Being a Resource person" rubric="Outside 3 pt/hr; Inside 2 pt/hr" max={20}>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput value={resourceOutsideHours} onChange={(v) => setResourceOutsideHours(v)} min={0} placeholder="outside hrs" />
                <NumericInput value={resourceInsideHours} onChange={(v) => setResourceInsideHours(v)} min={0} placeholder="inside hrs" />
                <Badge>{Math.round(computed.perRow.outreach.resourceMarks)}</Badge>
              </div>
            </Row>

            {/* 19: Training */}
            <Row number={19} activity="Training in Industry / Research (Days/Year)" rubric="Two weeks = full 30 pts (linear)" max={30}>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput value={trainingDays} onChange={(v) => setTrainingDays(v)} min={0} />
                <Badge>{Math.round(computed.perRow.outreach.trainingMarks)}</Badge>
              </div>
            </Row>

            {/* 20: Awards & Recognition */}
            <Row number={20} activity="Awards & Recognition" rubric="Awards 5 pts each; Editorial 4 pts; Review 1 pt" max={20}>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput value={awardsCount} onChange={(v) => setAwardsCount(v)} min={0} placeholder="awards" />
                <NumericInput value={editorialCount} onChange={(v) => setEditorialCount(v)} min={0} placeholder="editorial" />
                <NumericInput value={reviewsCount} onChange={(v) => setReviewsCount(v)} min={0} placeholder="reviews" />
                <Badge>{Math.round(computed.perRow.outreach.awardsTotal)}</Badge>
              </div>
            </Row>

            <SectionTotal label="Outreach Total" max={100} value={computed.totals.outreach} />
            <SectionTotal label="Grand Total" max={500} value={computed.totals.total} />
          </div>
        </div>

        {/* file upload */}
        <div style={{ marginTop: 14 }}>
          <label style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>Attach proof (optional)</label>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDropFile}
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 10,
              border: "2px dashed rgba(100,150,255,0.06)",
              background: dragOver ? "rgba(60,80,160,0.06)" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12
            }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ fontSize: 24 }}>📂</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>
                Drag & drop file here, or <label style={{ color: "#a7c8ff", textDecoration: "underline", cursor: "pointer" }}>
                  <input type="file" accept=".pdf,.docx,.png,.jpg" style={{ display: "none" }} onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} /> click to choose
                </label>
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              {proofFile ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ color: "#eaf2ff" }}>{proofFile.name}</div>
                  <button type="button" onClick={() => setProofFile(null)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.04)", color: "#fff", padding: "6px 8px", borderRadius: 8 }}>Remove</button>
                </div>
              ) : (
                <div style={{ color: "rgba(200,220,255,0.6)" }}>No file chosen</div>
              )}
            </div>
          </div>
        </div>

        {status && <div style={{ marginTop: 12, color: status.startsWith("Error") ? "tomato" : "#9fe7ff" }}>{status}</div>}
      </form>
    </div>
  );
}

/* ---------------- small subcomponents used in the form ---------------- */

function Row({ number, activity, rubric, max, children }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 6px", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
      <div style={{ width: 48, color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>{number}</div>
      <div style={{ flex: 1 }}>{activity}</div>
      <div style={{ width: 300, color: "rgba(200,220,255,0.7)" }}>{rubric}</div>
      <div style={{ width: 80, textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{max}</div>
      <div style={{ width: 160, textAlign: "right" }}>{children}</div>
    </div>
  );
}

function SectionHeader({ text }) {
  return (
    <div style={{ padding: "14px 8px", background: "rgba(255,255,255,0.01)", color: "rgba(200,220,255,0.8)", fontWeight: 800 }}> {text} </div>
  );
}
function SectionTotal({ label, max, value }) {
  return (
    <div style={{ padding: "12px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: 800, background: "rgba(255,255,255,0.01)" }}>
      <div>{label}</div>
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <div style={{ color: "rgba(200,220,255,0.7)" }}>{max}</div>
        <div style={{ background: "rgba(0,0,0,0.4)", padding: "6px 10px", borderRadius: 8, minWidth: 56, textAlign: "center", fontWeight: 800 }}>{value}</div>
      </div>
    </div>
  );
}

function NumericInput({ value, onChange, min = 0, step = "1", placeholder = "Enter" }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: 110,
        padding: "6px 8px",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
        color: "#eaf2ff",
      }}
      min={min}
      step={step}
      placeholder={placeholder}
    />
  );
}

function Badge({ children }) {
  return (
    <div style={{ background: "rgba(0,0,0,0.45)", padding: "6px 10px", borderRadius: 8, color: "#eaf2ff", minWidth: 36, textAlign: "center", fontWeight: 800 }}>
      {children}
    </div>
  );
}
