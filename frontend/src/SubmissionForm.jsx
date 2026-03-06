// src/SubmissionForm.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/*
  SubmissionForm (supports new/edit flows + multiple-file uploads)
  Props:
    - apiBase (string) default "http://127.0.0.1:8000"
    - submission (object|null) optional existing submission to edit
    - editable (bool) whether fields are editable (default true)
    - onSubmitted (fn) called after successful create/update
    - onCancel (fn) cancel/close form
*/

export default function SubmissionForm({
  apiBase = "http://127.0.0.1:8000",
  submission = null,
  editable = true,
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

  // global file upload: supports multiple files (new uploads)
  const [proofFiles, setProofFiles] = useState([]); // array of File
  const [dragOver, setDragOver] = useState(false);

  // per-activity files keyed by row number (1..20) -> array of File (new uploads)
  const [activityFiles, setActivityFiles] = useState({});

  // existing proofs from submission (read-only metadata; usually objects {name, url, id})
  const [existingProofs, setExistingProofs] = useState([]); // global
  const [existingActivityProofs, setExistingActivityProofs] = useState({}); // { row: [ {name,url,id}, ... ] }

  // auth token
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

  const NUM_INPUTS = 31;
  const inputRefs = useRef(Array.from({ length: NUM_INPUTS }, () => null));

  // Determine rubric variant: AP III or default
  const isAPIII = (facultyRank || "").toString().toUpperCase().includes("AP III") || facultyRank === "AP III";

  const MAXS = isAPIII
    ? { academic: 125, research: 225, admin: 75, outreach: 75, grand: 500 }
    : { academic: 150, research: 200, admin: 50, outreach: 100, grand: 500 };

  function computeMarks() {
    // Academic
    let passMarks = 0;
    if (isAPIII) {
      const pct = toFloat(passPercent);
      passMarks = pct > 81 ? ((pct - 81) / (95 - 81)) * 20 : 0;
      passMarks = clamp(passMarks, 0, 20);
    } else {
      const pct = toFloat(passPercent);
      passMarks = pct > 80 ? ((pct - 80) / (95 - 80)) * 30 : 0;
      passMarks = clamp(passMarks, 0, 30);
    }

    let fbMarks = 0;
    if (isAPIII) {
      const fb = toFloat(studentFeedback);
      fbMarks = fb > 3.1 ? ((fb - 3.1) / (4.5 - 3.1)) * 20 : 0;
      fbMarks = clamp(fbMarks, 0, 20);
    } else {
      const fb = toFloat(studentFeedback);
      fbMarks = fb > 3.0 ? ((fb - 3.0) / (4.5 - 3.0)) * 30 : 0;
      fbMarks = clamp(fbMarks, 0, 30);
    }

    const videosMarks = clamp(10 * toInt(onlineVideos), 0, 30);
    const sdgMarks = clamp(4 * toInt(sdgActivities), 0, 30);
    const vacMarks = clamp(1 * toInt(vacHours), 0, 9999);

    const academicRaw = passMarks + fbMarks + videosMarks + sdgMarks + vacMarks;
    const academicTotal = clamp(academicRaw, 0, MAXS.academic);

    // Research
    let pubsMarks = 0;
    let citationsMarks = 0;
    let consultancyMarks = 0;
    let proposalsMarks = 0;
    let grantsAmountMarks = 0;
    let sponsoredCombined = 0;
    let researchVisitsMarks = 0;
    let membershipsMarks = 0;
    let fdpMarks = 0;
    let mandatoryMarks = 0;

    if (isAPIII) {
      pubsMarks = clamp((80 / 3) * toInt(publications), 0, 80);
      citationsMarks = clamp(0.5 * toInt(citations), 0, 20);
      consultancyMarks = clamp(toFloat(consultancyRevenue) > 0 ? (toFloat(consultancyRevenue) / 200000) * 25 : 0, 0, 25);
      proposalsMarks = clamp(5 * toInt(sponsoredGrantsCount), 0, 40);
      grantsAmountMarks = clamp(
        toFloat(sponsoredGrantsAmount) > 10000 ? ((toFloat(sponsoredGrantsAmount) - 10000) / (400000 - 10000)) * 10 : 0,
        0,
        10
      );
      sponsoredCombined = clamp(proposalsMarks + grantsAmountMarks, 0, 50);
      researchVisitsMarks = clamp(10 * toInt(researchVisits), 0, 10);
      membershipsMarks = clamp(10 * toInt(membershipsCount), 0, 10);
      fdpMarks = clamp(1 * toFloat(fdpDaysPhys) + 0.5 * toFloat(fdpDaysOnline) + 4 * toInt(mooc4w), 0, 15);
      mandatoryMarks = clamp(10 * toInt(mandatoryCourses), 0, 10);
    } else {
      pubsMarks = clamp(25 * toInt(publications), 0, 75);
      citationsMarks = clamp(1 * toInt(citations), 0, 15);
      consultancyMarks = clamp(toFloat(consultancyRevenue) > 0 ? (toFloat(consultancyRevenue) / 200000) * 20 : 0, 0, 20);
      proposalsMarks = clamp(5 * toInt(sponsoredGrantsCount), 0, 15);
      grantsAmountMarks = clamp(
        toFloat(sponsoredGrantsAmount) > 10000 ? ((toFloat(sponsoredGrantsAmount) - 10000) / (200000 - 10000)) * 25 : 0,
        0,
        25
      );
      sponsoredCombined = clamp(proposalsMarks + grantsAmountMarks, 0, 40);
      researchVisitsMarks = clamp(10 * toInt(researchVisits), 0, 10);
      membershipsMarks = clamp(10 * toInt(membershipsCount), 0, 10);
      fdpMarks = clamp(1 * toFloat(fdpDaysPhys) + 0.5 * toFloat(fdpDaysOnline) + 4 * toInt(mooc4w), 0, 20);
      mandatoryMarks = clamp(10 * toInt(mandatoryCourses), 0, 10);
    }

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
      MAXS.research
    );

    // Administration
    const convenerMarks = clamp(
      3 * toInt(convenerDays) + 2 * toInt(convenerOnlineDays) + 2 * toInt(guestHours) + 1 * toInt(committeeEvents),
      0,
      isAPIII ? 40 : 20
    );
    const eventsMarks = 3 * toInt(eventsA) + 2 * toInt(eventsB) + 1 * toInt(eventsC);
    const respMarks = clamp(10 * toInt(headCount) + 5 * toInt(memberCount), 0, isAPIII ? 35 : 30);

    const adminRaw = convenerMarks + eventsMarks + respMarks;
    const adminTotal = clamp(adminRaw, 0, MAXS.admin);

    // Outreach
    const communityMarks = clamp(10 * toInt(outreachActivities), 0, isAPIII ? 15 : 30);
    const resourceMarks = clamp(3 * toInt(resourceOutsideHours) + 2 * toInt(resourceInsideHours), 0, 20);
    const trainingMarks = clamp((toFloat(trainingDays) / 14) * (isAPIII ? 20 : 30), 0, isAPIII ? 20 : 30);
    const awardsMarks = clamp(5 * toInt(awardsCount), 0, 20);
    const recognitionMarks = clamp(4 * toInt(editorialCount) + 1 * toInt(reviewsCount), 0, 20);
    const awardsTotal = clamp(awardsMarks + recognitionMarks, 0, 20);

    const outreachTotal = clamp(communityMarks + resourceMarks + trainingMarks + awardsTotal, 0, MAXS.outreach);

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
      totals: {
        academic: Math.round(academicTotal),
        research: Math.round(researchTotal),
        admin: Math.round(adminTotal),
        outreach: Math.round(outreachTotal),
        total: grandTotal,
      },
    };
  }

  const computed = useMemo(() => computeMarks(), [
    facultyRank,
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

  // Populate form if submission prop provided
  useEffect(() => {
    if (!submission) return;

    // Map common fields - adjust names to match your API if necessary
    if (submission.faculty_rank) setFacultyRank(submission.faculty_rank);
    if (submission.academic_year) setAcademicYear(submission.academic_year);

    setPassPercent(submission.pass_percent ?? submission.passPercent ?? passPercent);
    setStudentFeedback(submission.student_feedback ?? submission.studentFeedback ?? studentFeedback);
    setOnlineVideos(submission.online_videos ?? submission.onlineVideos ?? onlineVideos);
    setSdgActivities(submission.sdg_activities ?? submission.sdgActivities ?? sdgActivities);
    setVacHours(submission.vac_hours ?? submission.vacHours ?? vacHours);

    setPublications(submission.publications ?? submission.publication_count ?? publications);
    setCitations(submission.citations ?? submission.citation_count ?? citations);
    setConsultancyRevenue(submission.consultancy_revenue ?? consultancyRevenue);
    setSponsoredGrantsCount(submission.sponsored_grants_count ?? submission.grants_count ?? sponsoredGrantsCount);
    setSponsoredGrantsAmount(submission.sponsored_grants_amount ?? submission.grants_amount ?? sponsoredGrantsAmount);
    setResearchVisits(submission.research_visits ?? researchVisits);
    setMembershipsCount(submission.memberships_count ?? membershipsCount);
    setFdpDaysPhys(submission.fdp_days_phys ?? fdpDaysPhys);
    setFdpDaysOnline(submission.fdp_days_online ?? fdpDaysOnline);
    setMooc4w(submission.mooc_4w ?? mooc4w);
    setMandatoryCourses(submission.mandatory_courses ?? mandatoryCourses);

    setConvenerDays(submission.convener_days ?? convenerDays);
    setConvenerOnlineDays(submission.convener_online_days ?? convenerOnlineDays);
    setGuestHours(submission.guest_hours ?? guestHours);
    setCommitteeEvents(submission.committee_events ?? committeeEvents);
    setEventsA(submission.events_a ?? eventsA);
    setEventsB(submission.events_b ?? eventsB);
    setEventsC(submission.events_c ?? eventsC);
    setHeadCount(submission.head_count ?? headCount);
    setMemberCount(submission.member_count ?? memberCount);

    setOutreachActivities(submission.outreach_activities ?? outreachActivities);
    setResourceOutsideHours(submission.resource_outside_hours ?? resourceOutsideHours);
    setResourceInsideHours(submission.resource_inside_hours ?? resourceInsideHours);
    setTrainingDays(submission.training_days ?? trainingDays);
    setAwardsCount(submission.awards_count ?? awardsCount);
    setEditorialCount(submission.editorial_count ?? editorialCount);
    setReviewsCount(submission.reviews_count ?? reviewsCount);

    // existingProofs: common shapes: submission.proofs || submission.files || submission.attachments
    const globalProofs = submission.proofs ?? submission.files ?? submission.attachments ?? [];
    if (Array.isArray(globalProofs)) {
      setExistingProofs(globalProofs.map((p) => (typeof p === "string" ? { name: p, url: null } : p)));
    }

    // existingActivityProofs: backend might store per-row keys like proof_row_1 etc or structure {row: []}
    const perActivity = {};
    if (submission.activity_proofs && typeof submission.activity_proofs === "object") {
      // e.g. { "1": [{name,url}], "2": [...] }
      Object.entries(submission.activity_proofs).forEach(([row, arr]) => {
        if (Array.isArray(arr)) perActivity[row] = arr.map((p) => (typeof p === "string" ? { name: p, url: null } : p));
      });
    } else {
      // try to detect proof_row_{n} keys
      for (let i = 1; i <= 20; i++) {
        const k1 = `proof_row_${i}`;
        if (Array.isArray(submission[k1]) && submission[k1].length) {
          perActivity[i] = submission[k1].map((p) => (typeof p === "string" ? { name: p, url: null } : p));
        }
      }
    }
    setExistingActivityProofs(perActivity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission]);

  // drag & drop global file (multiple)
  function onDropFile(e) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) {
      setProofFiles((prev) => [...prev, ...files]);
    }
  }

  // per-activity file handlers (accept multiple)
  function handleActivityFileChange(row, e) {
    const files = Array.from(e.target.files || []);
    setActivityFiles((prev) => {
      const next = { ...(prev || {}) };
      next[row] = [...(next[row] || []), ...files];
      return next;
    });
    e.target.value = "";
  }

  // remove single file from per-activity list (new uploads)
  function removeActivityFile(row, idx) {
    setActivityFiles((prev) => {
      const next = { ...(prev || {}) };
      if (!Array.isArray(next[row])) return prev;
      next[row] = next[row].filter((_, i) => i !== idx);
      if (next[row].length === 0) delete next[row];
      return next;
    });
  }

  // remove a single global new file by index
  function removeProofFile(idx) {
    setProofFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // NOTE: we do not attempt to remove existingProofs server-side automatically since backend contract may vary.
  // If you want that behavior, backend must accept a remove list like remove_proofs[] or accept PATCH fields.

  async function handleSubmit(e) {
    e && e.preventDefault();
    if (!editable) {
      setStatus("Form is not editable.");
      return;
    }
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

      // computed totals + rubric variant
      fd.append("section_totals_json", JSON.stringify(computed));
      fd.append("rubric_variant", isAPIII ? "AP III" : "DEFAULT");

      // Append new global proof files (multiple allowed)
      proofFiles.forEach((f) => {
        fd.append("proof", f);
      });

      // Append new per-activity proof files (multiple per row allowed)
      Object.entries(activityFiles).forEach(([row, files]) => {
        if (!Array.isArray(files)) return;
        files.forEach((file) => {
          fd.append(`proof_row_${row}`, file);
        });
      });

      // If submission exists -> update (PATCH), else create (POST)
      const isUpdate = !!(submission && (submission._id || submission.id));
      const urlBase = apiBase.replace(/\/$/, "");
      const url = isUpdate
        ? `${urlBase}/api/submissions/${encodeURIComponent(submission._id || submission.id)}/`
        : `${urlBase}/api/submissions/`;

      const res = await fetch(url, {
        method: isUpdate ? "PATCH" : "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
        credentials: "include",
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || body.message || JSON.stringify(body) || `HTTP ${res.status}`);

      setStatus(isUpdate ? "Submission updated." : "Submission created.");
      // clear new-file buffers (do not clear existingProofs)
      setProofFiles([]);
      setActivityFiles({});
      onSubmitted(body);
    } catch (err) {
      setStatus("Error: " + (err?.message || String(err)));
    } finally {
      setSubmitting(false);
    }
  }

  // NumericInput helper (same as original)
  function NumericInput({ value, onChange, placeholder = "Enter", min = 0, step = "1", inputIndex = 0, style = {} }) {
    return (
      <input
        ref={(el) => (inputRefs.current[inputIndex] = el)}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          try {
            e.target.select();
          } catch (err) {}
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const next = inputIndex + 1;
            if (inputRefs.current[next]) {
              inputRefs.current[next].focus();
              try {
                inputRefs.current[next].select();
              } catch (err) {}
            }
          }
        }}
        className="numeric-input"
        placeholder={placeholder}
        min={min}
        step={step}
        style={style}
        disabled={!editable}
      />
    );
  }

  // FileAttach per-row showing both existing (read-only) and new uploaded files
  function FileAttach({ row }) {
    const newFiles = activityFiles[row] || [];
    const existing = existingActivityProofs[row] || [];
    return (
      <div className="file-attach-wrap" style={{ minWidth: 140 }}>
        <input
          id={`file-input-row-${row}`}
          type="file"
          accept=".pdf,.docx,.png,.jpg"
          style={{ display: "none" }}
          multiple
          onChange={(e) => handleActivityFileChange(row, e)}
          disabled={!editable}
        />
        <label htmlFor={`file-input-row-${row}`} className="btn-attach" style={{ opacity: editable ? 1 : 0.6, pointerEvents: editable ? "auto" : "none" }}>
          Attach
        </label>

        {/* show existing (server-side) proofs */}
        {existing.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {existing.map((p, i) => (
              <div key={"ex-" + i} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                <div className="file-name" title={p.name} style={{ maxWidth: 120 }}>
                  {p.url ? <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "#cfe7ff" }}>{p.name}</a> : p.name}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* show newly added (client) files */}
        {newFiles.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {newFiles.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                <div className="file-name" title={f.name} style={{ maxWidth: 120 }}>{f.name}</div>
                <button type="button" onClick={() => removeActivityFile(row, i)} className="btn-small">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // mapping row -> first input index (used by focusRowInput)
  function focusRowInput(rowNumber) {
    const rowToIndex = {
      1: 0,
      2: 1,
      3: 2,
      4: 3,
      5: 4,
      6: 5,
      7: 6,
      8: 7,
      9: 8, // proposals count input
      10: 10,
      11: 11,
      12: 12,
      13: 15,
      14: 16,
      15: 19,
      16: 22,
      17: 24,
      18: 25,
      19: 27,
      20: 28,
    };
    const idx = rowToIndex[rowNumber];
    if (typeof idx === "number" && inputRefs.current[idx]) {
      inputRefs.current[idx].focus();
      try {
        inputRefs.current[idx].select();
      } catch (err) {}
    }
  }

  // Styles (same as before)
  const styles = {
    overlay: { position: "fixed", inset: 0, background: "rgba(3,6,23,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 18 },
    form: { width: "92%", maxWidth: 1100, maxHeight: "92vh", overflow: "auto", background: "#0d1b2a", padding: 20, borderRadius: 12, color: "#eaf2ff", boxShadow: "0 8px 40px rgba(2,6,18,0.6)" },
    tableWrap: { borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.03)", marginTop: 6, background: "linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.008))" },
    headerRow: { padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,0.02)", background: "rgba(255,255,255,0.01)", display: "grid", gridTemplateColumns: "48px 1fr 300px 220px 80px 160px", gap: 12, alignItems: "center" },
    row: { display: "grid", gridTemplateColumns: "48px 1fr 300px 220px 80px 160px", gap: 12, alignItems: "center", padding: "12px 6px", borderBottom: "1px solid rgba(255,255,255,0.02)", cursor: "text" },
  };

  return (
    <div style={styles.overlay}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
          <div>
            <h2 style={{ margin: "0 0 6px 0" }}>{submission ? (editable ? "Edit KPI Sheet" : "View KPI Sheet") : "Submit KPI Sheet"}</h2>
            <div style={{ color: "rgba(200,220,255,0.6)" }}>
              Fill the KPI entries below. Points will be computed automatically.
              <div style={{ marginTop: 6, fontSize: 13, color: "#bcd7ff" }}>
                Rubric: <strong>{isAPIII ? "AP (III) variant" : "Default AP I / AP II variant"}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onCancel} className="btn-cancel">Close</button>
            {editable && (
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? (submission ? "Saving..." : "Submitting...") : (submission ? "Save Changes" : "Submit KPI Sheet")}
              </button>
            )}
          </div>
        </div>

        {/* meta row */}
        <div style={{ display: "flex", gap: 12, marginTop: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <label style={{ display: "block", color: "rgba(200,220,255,0.7)", marginBottom: 6 }}>🎓 Faculty Rank</label>
            <select value={facultyRank} onChange={(e) => setFacultyRank(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: "#0b1720", color: "#eaf2ff", border: "1px solid rgba(255,255,255,0.04)" }} disabled={!editable}>
              <option>AP I</option>
              <option>AP II</option>
              <option>AP III</option>
              <option>AsP/Prof</option>
              <option>CFRD</option>
            </select>
          </div>

          <div style={{ flex: "1 1 160px" }}>
            <label style={{ display: "block", color: "rgba(200,220,255,0.7)", marginBottom: 6 }}>📅 Academic Year</label>
            <input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: "#0b1720", color: "#eaf2ff", border: "1px solid rgba(255,255,255,0.04)" }} disabled={!editable}/>
          </div>
        </div>

        {/* table / card */}
        <div style={styles.tableWrap}>
          <div style={styles.headerRow}>
            <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>#</div>
            <div style={{ color: "rgba(200,220,255,0.9)", fontWeight: 700 }}>Activity</div>
            <div style={{ color: "rgba(200,220,255,0.9)", fontWeight: 700 }}>Rubric <span style={{ fontSize: 12, color: "rgba(200,220,255,0.6)" }}>(ℹ️)</span></div>
            <div style={{ color: "rgba(200,220,255,0.9)", fontWeight: 700, textAlign: "right" }}>Attach Proof</div>
            <div style={{ color: "rgba(200,220,255,0.9)", fontWeight: 700, textAlign: "right" }}>Max</div>
            <div style={{ color: "rgba(200,220,255,0.9)", fontWeight: 700, textAlign: "right" }}>Points Scored</div>
          </div>

          <div style={{ padding: 12, maxHeight: "60vh", overflowY: "auto" }}>
            {/* Row 1 */}
            <div className="row" style={styles.row} onClick={(e) => { const tag = e.target.tagName?.toLowerCase(); if (!["button","input","label","a"].includes(tag)) focusRowInput(1); }}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>1</div>
              <div>% Pass in ESE (Average of all theory courses)</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "81% - 95% → 0–20" : "80% - 95% → 0–30"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={1} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 20 : 30}</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={0} value={passPercent} onChange={(v) => setPassPercent(toFloat(v))} min={0} step="0.1" />
                <Badge>{Math.round(computed.perRow.academic.passMarks)}</Badge>
              </div>
            </div>

            {/* Row 2 */}
            <div className="row" style={styles.row} onClick={(e) => { const tag = e.target.tagName?.toLowerCase(); if (!["button","input","label","a"].includes(tag)) focusRowInput(2); }}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>2</div>
              <div>Student Feedback (Average of all theory courses)</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "3.1 - 4.5 (out of 5) → 0–20" : "3.0 - 4.5 (out of 5) → 0–30"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={2} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 20 : 30}</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={1} value={studentFeedback} onChange={(v) => setStudentFeedback(toFloat(v))} min={0} step="0.1" />
                <Badge>{Math.round(computed.perRow.academic.fbMarks)}</Badge>
              </div>
            </div>

            {/* Row 3 */}
            <div className="row" style={styles.row} onClick={(e) => { const tag = e.target.tagName?.toLowerCase(); if (!["button","input","label","a"].includes(tag)) focusRowInput(3); }}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>3</div>
              <div>Developing Online Course / Video Lecture and uploaded</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>10 pts / video (cap 30)</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={3} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>30</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={2} value={onlineVideos} onChange={(v) => setOnlineVideos(toInt(v))} min={0} step="1" />
                <Badge>{Math.round(computed.perRow.academic.videosMarks)}</Badge>
              </div>
            </div>

            {/* Row 4 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(4)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>4</div>
              <div>Implementation of Innovative teaching methodologies addressing SDGs</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>4 pts / activity (cap 30)</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={4} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>30</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={3} value={sdgActivities} onChange={(v) => setSdgActivities(toInt(v))} min={0} />
                <Badge>{Math.round(computed.perRow.academic.sdgMarks)}</Badge>
              </div>
            </div>

            {/* Row 5 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(5)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>5</div>
              <div>Conduct of VAC / Capsule courses / Training the students / Publications</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "1 pt/hr VAC; 4 pts achievement; 2 pts/publication — Academic aggregated" : "1 pt/hr VAC; 4 pts achievement; 2 pts/publication"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={5} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 25 : 30}</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={4} value={vacHours} onChange={(v) => setVacHours(toInt(v))} min={0} />
                <Badge>{Math.round(computed.perRow.academic.vacMarks)}</Badge>
              </div>
            </div>

            <SectionTotal label="Academic Total" max={MAXS.academic} value={computed.totals.academic} />

            <SectionHeader text="Research & Professional Development" />

            {/* Row 6 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(6)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>6</div>
              <div>Publications</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "Publications - target 3 (Min 1 SCI) — total up to 80 pts" : "25 pts / publication (up to 75)"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={6} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 80 : 75}</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={5} value={publications} onChange={(v) => setPublications(toInt(v))} min={0} />
                <Badge>{Math.round(computed.perRow.research.pubsMarks)}</Badge>
              </div>
            </div>

            {/* Row 7 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(7)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>7</div>
              <div>Article Citation in WoS / Scopus Journals & Conferences</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "0.5 pt / citation (including KPRIET affiliated) — cap 20" : "1 pt / citation (cap 15)"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={7} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 20 : 15}</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={6} value={citations} onChange={(v) => setCitations(toInt(v))} min={0} />
                <Badge>{Math.round(computed.perRow.research.citationsMarks)}</Badge>
              </div>
            </div>

            {/* Row 8 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(8)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>8</div>
              <div>Consultancy Revenue (₹ / year)</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "Scaled to 25 pts (0..200k -> 0..25)" : "Scaled 0..200k → 0..20"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={8} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 25 : 20}</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={7} value={consultancyRevenue} onChange={(v) => setConsultancyRevenue(toFloat(v))} min={0} />
                <Badge>{Math.round(computed.perRow.research.consultancyMarks)}</Badge>
              </div>
            </div>

            {/* Row 9 (two inputs: proposals count index=8, grants amount index=9) */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(9)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>9</div>
              <div>Sponsored grants / proposals</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "a) 10K-4L → up to 10 pts; b) 5 pts / proposal (cap 40) — combined cap 50" : "Combined scaled score (cap 40)"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={9} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 50 : 40}</div>
              <div style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <input
                  className="mini numeric-input"
                  type="number"
                  min="0"
                  placeholder="#proposals"
                  value={sponsoredGrantsCount}
                  onChange={(e) => setSponsoredGrantsCount(toInt(e.target.value))}
                  ref={(el) => (inputRefs.current[8] = el)}
                  style={{ width: 90, padding: "6px 8px", borderRadius: 6 }}
                  disabled={!editable}
                />
                <input
                  className="mini numeric-input"
                  type="number"
                  min="0"
                  placeholder="Total ₹"
                  value={sponsoredGrantsAmount}
                  onChange={(e) => setSponsoredGrantsAmount(toFloat(e.target.value))}
                  ref={(el) => (inputRefs.current[9] = el)}
                  style={{ width: 110, padding: "6px 8px", borderRadius: 6 }}
                  disabled={!editable}
                />
                <Badge>{Math.round(computed.perRow.research.sponsoredCombined)}</Badge>
              </div>
            </div>

            {/* Row 10 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(10)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>10</div>
              <div>Research Scholars Supervision</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "10 pts per PhD completion; 4 pts FT; 3 pts PT" : "Research visits / supervision mapping"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={10} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>15</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={10} value={researchVisits} onChange={(v) => setResearchVisits(toInt(v))} min={0} />
                <Badge>{Math.round(computed.perRow.research.researchVisitsMarks)}</Badge>
              </div>
            </div>

            {/* Row 11 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(11)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>11</div>
              <div>Visit to Research Laboratories for Collaboration</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>1 visit → 10 pts (cap 10)</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={11} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>10</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={11} value={membershipsCount} onChange={(v) => setMembershipsCount(toInt(v))} min={0} />
                <Badge>{Math.round(computed.perRow.research.membershipsMarks)}</Badge>
              </div>
            </div>

            {/* Row 12 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(12)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>12</div>
              <div>Completion of FDP / STTP / MOOC courses with proctored exam</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>1 pt/day physical; 0.5 pt/day online; 4 pts/4w MOOC</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={12} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 15 : 20}</div>
              <div style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput inputIndex={12} value={fdpDaysPhys} onChange={(v) => setFdpDaysPhys(toFloat(v))} min={0} placeholder="phys days" />
                <NumericInput inputIndex={13} value={fdpDaysOnline} onChange={(v) => setFdpDaysOnline(toFloat(v))} min={0} placeholder="online days" />
                <NumericInput inputIndex={14} value={mooc4w} onChange={(v) => setMooc4w(toInt(v))} min={0} placeholder="4w MOOC" />
                <Badge>{Math.round(computed.perRow.research.fdpMarks)}</Badge>
              </div>
            </div>

            {/* Row 13 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(13)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>13</div>
              <div>Number of Mandatory Training Programmes Completed</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>1 Course → 10 pts</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={13} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>10</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={15} value={mandatoryCourses} onChange={(v) => setMandatoryCourses(toInt(v))} min={0} />
                <Badge>{Math.round(computed.perRow.research.mandatoryMarks)}</Badge>
              </div>
            </div>

            <SectionTotal label="Research Total" max={MAXS.research} value={computed.totals.research} />

            <SectionHeader text="Administration" />

            {/* Row 14 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(14)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>14</div>
              <div>Convener / Coordinator / Guest lectures / Committees</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "Physical – 3 pts/day; Online – 2 pts/day; Guest/Webinars – 2 pts/day; Committee – 1 pt" : "Physical 3 pts/day; Online 2 pts/day; Guest 2 pts/hr; Committee 1 pt"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={14} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 25 : 20}</div>
              <div style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput inputIndex={16} value={convenerDays} onChange={(v) => setConvenerDays(toInt(v))} min={0} placeholder="phys" />
                <NumericInput inputIndex={17} value={convenerOnlineDays} onChange={(v) => setConvenerOnlineDays(toInt(v))} min={0} placeholder="online" />
                <NumericInput inputIndex={18} value={guestHours} onChange={(v) => setGuestHours(toInt(v))} min={0} placeholder="guest hrs" />
                <Badge>{Math.round(computed.perRow.admin.convenerMarks)}</Badge>
              </div>
            </div>

            {/* Row 15 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(15)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>15</div>
              <div>National / Intl / Institute level events organized (a/b/c)</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>a:3 pts / program, b:2 pts / program, c:1 pt / program</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={15} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>0</div>
              <div style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput inputIndex={19} value={eventsA} onChange={(v) => setEventsA(toInt(v))} min={0} placeholder="a" />
                <NumericInput inputIndex={20} value={eventsB} onChange={(v) => setEventsB(toInt(v))} min={0} placeholder="b" />
                <NumericInput inputIndex={21} value={eventsC} onChange={(v) => setEventsC(toInt(v))} min={0} placeholder="c" />
                <Badge>{Math.round(computed.perRow.admin.eventsMarks)}</Badge>
              </div>
            </div>

            {/* Row 16 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(16)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>16</div>
              <div>Institute & Dept. level responsibility</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>Head:10 pts, Member:5 pts</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={16} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>30</div>
              <div style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput inputIndex={22} value={headCount} onChange={(v) => setHeadCount(toInt(v))} min={0} placeholder="heads" />
                <NumericInput inputIndex={23} value={memberCount} onChange={(v) => setMemberCount(toInt(v))} min={0} placeholder="members" />
                <Badge>{Math.round(computed.perRow.admin.respMarks)}</Badge>
              </div>
            </div>

            <SectionTotal label="Admin Total" max={MAXS.admin} value={computed.totals.admin} />

            <SectionHeader text="Outreach Activities" />

            {/* Row 17 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(17)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>17</div>
              <div>Community Services / Addressing Rural Issues / ISR</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "10 pts / activity (cap 15)" : "10 pts / activity"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={17} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 15 : 30}</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={24} value={outreachActivities} onChange={(v) => setOutreachActivities(toInt(v))} min={0} />
                <Badge>{Math.round(computed.perRow.outreach.communityMarks)}</Badge>
              </div>
            </div>

            {/* Row 18 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(18)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>18</div>
              <div>Being a Resource person</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>Outside 3 pt/hr; Inside 2 pt/hr</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={18} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>20</div>
              <div style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput inputIndex={25} value={resourceOutsideHours} onChange={(v) => setResourceOutsideHours(toInt(v))} min={0} placeholder="outside hrs" />
                <NumericInput inputIndex={26} value={resourceInsideHours} onChange={(v) => setResourceInsideHours(toInt(v))} min={0} placeholder="inside hrs" />
                <Badge>{Math.round(computed.perRow.outreach.resourceMarks)}</Badge>
              </div>
            </div>

            {/* Row 19 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(19)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>19</div>
              <div>Training in Industry / Research institutes (Days / Year)</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>{isAPIII ? "Two weeks = full 20 pts (linear)" : "Two weeks = full 30 pts (linear)"}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={19} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{isAPIII ? 20 : 30}</div>
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <NumericInput inputIndex={27} value={trainingDays} onChange={(v) => setTrainingDays(toFloat(v))} min={0} />
                <Badge>{Math.round(computed.perRow.outreach.trainingMarks)}</Badge>
              </div>
            </div>

            {/* Row 20 */}
            <div className="row" style={styles.row} onClick={() => focusRowInput(20)}>
              <div style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>20</div>
              <div>Awards & Recognition</div>
              <div style={{ color: "rgba(200,220,255,0.7)" }}>Awards 5 pts each; Editorial 4 pts; Review 1 pt</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><FileAttach row={20} /></div>
              <div style={{ textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>20</div>
              <div style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <NumericInput inputIndex={28} value={awardsCount} onChange={(v) => setAwardsCount(toInt(v))} min={0} placeholder="awards" />
                <NumericInput inputIndex={29} value={editorialCount} onChange={(v) => setEditorialCount(toInt(v))} min={0} placeholder="editorial" />
                <NumericInput inputIndex={30} value={reviewsCount} onChange={(v) => setReviewsCount(toInt(v))} min={0} placeholder="reviews" />
                <Badge>{Math.round(computed.perRow.outreach.awardsTotal)}</Badge>
              </div>
            </div>

            <SectionTotal label="Outreach Total" max={MAXS.outreach} value={computed.totals.outreach} />
            <SectionTotal label="Grand Total" max={MAXS.grand} value={computed.totals.total} />
          </div>
        </div>

        {/* global file upload (multiple) */}
        <div style={{ marginTop: 14 }}>
          <label style={{ color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>Attach proof (optional) — global (multiple files allowed)</label>

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
                Drag & drop files here, or{" "}
                <label style={{ color: "#a7c8ff", textDecoration: "underline", cursor: editable ? "pointer" : "default", opacity: editable ? 1 : 0.6 }}>
                  <input
                    type="file"
                    accept=".pdf,.docx,.png,.jpg"
                    style={{ display: "none" }}
                    multiple
                    onChange={(e) => {
                      if (!editable) return;
                      const files = Array.from(e.target.files || []);
                      if (files.length) setProofFiles((prev) => [...prev, ...files]);
                      e.target.value = "";
                    }}
                    disabled={!editable}
                  />{" "}
                  click to choose
                </label>
              </div>
            </div>

            <div style={{ textAlign: "right", minWidth: 260 }}>
              {/* show existing server-side proofs first */}
              {existingProofs.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  {existingProofs.map((p, i) => (
                    <div key={"exg-" + i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ color: "#eaf2ff", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.url ? <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "#cfe7ff" }}>{p.name}</a> : p.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* newly added files */}
              {proofFiles.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  {proofFiles.map((f, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ color: "#eaf2ff", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                      <button type="button" onClick={() => removeProofFile(i)} className="btn-small">Remove</button>
                    </div>
                  ))}
                </div>
              ) : (
                existingProofs.length === 0 && <div style={{ color: "rgba(200,220,255,0.6)" }}>No files chosen</div>
              )}
            </div>
          </div>
        </div>

        {status && <div style={{ marginTop: 12, color: status.startsWith("Error") ? "tomato" : "#9fe7ff" }}>{status}</div>}
      </form>

      {/* Local styles (scoped via className) */}
      <style>{`
        .numeric-input { width: 110px; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); color: #eaf2ff; }
        .btn-attach { padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); background: transparent; color: #a7c8ff; cursor: pointer; font-size: 13px; }
        .btn-small { padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); background: transparent; color: #eaf2ff; cursor: pointer; }
        .file-attach-wrap { display: flex; justify-content: flex-end; align-items: center; gap: 8px; min-width: 140px; flex-direction: column; }
        .file-present { display: flex; gap: 8px; align-items: center; }
        .file-name { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cfe7ff; }
        .btn-primary { padding: 10px 16px; border-radius: 10px; border: none; background: linear-gradient(90deg,#6a11cb,#2575fc); color: #fff; font-weight: 700; cursor: pointer; }
        .btn-cancel { padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.04); background: transparent; color: #eaf2ff; cursor: pointer; }
        .mini { width: auto; }
      `}</style>
    </div>
  );
}

/* ---------------- small subcomponents used in the form ---------------- */

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

function Badge({ children }) {
  return (
    <div style={{ background: "rgba(0,0,0,0.45)", padding: "6px 10px", borderRadius: 8, color: "#eaf2ff", minWidth: 36, textAlign: "center", fontWeight: 800 }}>
      {children}
    </div>
  );
}
