# backend/app/services/ai_service.py
"""
Rule-based scorer for faculty submissions.

Scoring scheme (AP I/II style):
- Academic: 150
- Research: 200
- Administration: 50
- Outreach: 100
- Grand total: 500

This updated version returns:
- raw grand total (out of 500)
- scaled score (out of 100) as score.total
- section_totals (raw)
- computed: totals (scaled to /100) and perRow breakdown matching frontend expectations
- ai_feedback, debug, scored_at
"""
from typing import Dict, Any
from datetime import datetime

def _clamp(x, a, b):
    return max(a, min(b, x))

def _round2(x):
    try:
        return round(float(x), 2)
    except Exception:
        return 0.0

def score_submission(submission: Dict[str, Any]) -> Dict[str, Any]:
    acad = submission.get("academic", {}) or {}
    research = submission.get("research", {}) or {}
    admin = submission.get("administration", {}) or {}
    outreach = submission.get("outreach", {}) or {}

    # --- ACADEMIC (Max 150) ---
    pass_percent = float(acad.get("pass_percent", 0.0) or 0.0)
    student_feedback = float(acad.get("student_feedback", 0.0) or 0.0)  # 1-5
    online_videos = int(acad.get("online_videos", 0) or 0)
    sdg_activities = int(acad.get("sdg_activities", 0) or 0)
    vac_hours = int(acad.get("vac_hours", 0) or 0)

    # 1) Pass %: linear 81 -> 95 maps 0 -> 30
    if pass_percent <= 81.0:
        pass_marks = 0.0
    else:
        pass_marks = ((pass_percent - 81.0) / (95.0 - 81.0)) * 30.0
    pass_marks = _clamp(pass_marks, 0.0, 30.0)

    # 2) Student feedback: 3.1 -> 4.5 maps 0 -> 30
    if student_feedback <= 3.1:
        fb_marks = 0.0
    else:
        fb_marks = ((student_feedback - 3.1) / (4.5 - 3.1)) * 30.0
    fb_marks = _clamp(fb_marks, 0.0, 30.0)

    # 3) Online videos: 10 pts / video, cap 30
    videos_marks = min(30.0, 10.0 * online_videos)

    # 4) SDG activities: 4 pts / activity, cap 30
    sdg_marks = min(30.0, 4.0 * sdg_activities)

    # 5) VAC / Achievements: 1 pt / hour for VAC
    vac_marks = float(vac_hours) * 1.0

    academic_raw = pass_marks + fb_marks + videos_marks + sdg_marks + vac_marks
    academic_total = _clamp(academic_raw, 0.0, 150.0)

    # --- RESEARCH (Max 200) ---
    publications = int(research.get("publications", 0) or 0)
    citations = int(research.get("citations", 0) or 0)
    consultancy_revenue = float(research.get("consultancy_revenue", 0.0) or 0.0)
    sponsored_grants_count = int(research.get("sponsored_grants_count", 0) or 0)
    sponsored_grants_amount = float(research.get("sponsored_grants_amount", 0.0) or 0.0)
    research_visits = int(research.get("research_visits", 0) or 0)
    memberships_count = int(research.get("memberships_count", 0) or 0)
    fdp_days_phys = float(research.get("fdp_days_phys", 0) or 0.0)
    fdp_days_online = float(research.get("fdp_days_online", 0) or 0.0)
    mooc_4w = int(research.get("mooc_4w", 0) or 0)
    mandatory_courses = int(research.get("mandatory_courses", 0) or 0)

    # Pubs: 25 pts each up to 75
    pubs_marks = min(75.0, 25.0 * publications)

    # Citations: 1 pt each up to 15
    citations_marks = min(15.0, 1.0 * citations)

    # Consultancy: scale 0..200000 -> 0..20
    if consultancy_revenue <= 0:
        consultancy_marks = 0.0
    else:
        consultancy_marks = (consultancy_revenue / 200000.0) * 20.0
    consultancy_marks = _clamp(consultancy_marks, 0.0, 20.0)

    # Sponsored grants + proposals combined up to 40:
    proposals_count = sponsored_grants_count
    proposals_marks = min(15.0, 5.0 * proposals_count)
    if sponsored_grants_amount <= 10000:
        grants_amount_points = 0.0
    else:
        grants_amount_points = ((sponsored_grants_amount - 10000.0) / (200000.0 - 10000.0)) * 25.0
    grants_amount_points = _clamp(grants_amount_points, 0.0, 25.0)
    sponsored_combined = _clamp(grants_amount_points + proposals_marks, 0.0, 40.0)

    research_visits_marks = min(10.0, 10.0 * research_visits)
    memberships_marks = min(10.0, 10.0 * memberships_count)

    fdp_marks = (1.0 * fdp_days_phys) + (0.5 * fdp_days_online) + (4.0 * mooc_4w)
    fdp_marks = min(20.0, fdp_marks)

    mandatory_marks = min(10.0, 10.0 * mandatory_courses)

    research_raw = (
        pubs_marks + citations_marks + consultancy_marks + sponsored_combined +
        research_visits_marks + memberships_marks + fdp_marks + mandatory_marks
    )
    research_total = _clamp(research_raw, 0.0, 200.0)

    # --- ADMINISTRATION (Max 50) ---
    convener_days = float(admin.get("convener_days", 0) or 0.0)
    convener_online_days = float(admin.get("convener_online_days", 0) or 0.0)
    guest_hours = float(admin.get("guest_hours", 0) or 0.0)
    committee_events = int(admin.get("committee_events", 0) or 0)
    events_a = int(admin.get("events_a", 0) or 0)
    events_b = int(admin.get("events_b", 0) or 0)
    events_c = int(admin.get("events_c", 0) or 0)
    head_count = int(admin.get("head_count", 0) or 0)
    member_count = int(admin.get("member_count", 0) or 0)

    convener_marks = (3.0 * convener_days) + (2.0 * convener_online_days) + (2.0 * guest_hours) + (1.0 * committee_events)
    convener_marks = min(20.0, convener_marks)

    events_marks = (3.0 * events_a) + (2.0 * events_b) + (1.0 * events_c)

    resp_marks = min(30.0, (10.0 * head_count) + (5.0 * member_count))

    administration_raw = convener_marks + events_marks + resp_marks
    administration_total = _clamp(administration_raw, 0.0, 50.0)

    # --- OUTREACH (Max 100) ---
    community_activities = int(outreach.get("outreach_activities", 0) or 0)
    resource_outside_hours = int(outreach.get("resource_outside_hours", outreach.get("resource_person_hours", 0)) or 0)
    resource_inside_hours = int(outreach.get("resource_inside_hours", 0) or 0)
    training_days_val = float(outreach.get("training_days", 0) or 0.0)
    awards_count = int(outreach.get("awards_count", 0) or 0)
    editorial_count = int(outreach.get("editorial_count", 0) or 0)
    reviews_count = int(outreach.get("reviews_count", 0) or 0)

    community_marks = min(30.0, 10.0 * community_activities)
    resource_marks = min(20.0, (3.0 * resource_outside_hours) + (2.0 * resource_inside_hours))
    training_marks = min(30.0, (training_days_val / 14.0) * 30.0)  # full at 14 days
    awards_marks = min(20.0, 5.0 * awards_count)
    recognition_marks = min(20.0, (4.0 * editorial_count) + (1.0 * reviews_count))
    awards_total_marks = min(20.0, awards_marks + recognition_marks)

    outreach_raw = community_marks + resource_marks + training_marks + awards_total_marks
    outreach_total = _clamp(outreach_raw, 0.0, 100.0)

    # Grand total (out of 500)
    grand_total_raw = academic_total + research_total + administration_total + outreach_total
    grand_total_500 = _clamp(grand_total_raw, 0.0, 500.0)

    # Scaled to 0..100 for frontend convenience
    grand_total_100 = _round2((grand_total_500 / 500.0) * 100.0)

    section_totals = {
        "academic": _round2(academic_total),
        "research": _round2(research_total),
        "administration": _round2(administration_total),
        "outreach": _round2(outreach_total),
    }

    # computed totals scaled to /100 to match frontend layout showing totals and grand total /100
    computed_totals = {
        "academic": _round2((academic_total / 500.0) * 100.0),   # note: for display consistency we scale each section relative to full 500, but you can adjust as needed
        "research": _round2((research_total / 500.0) * 100.0),
        "admin": _round2((administration_total / 500.0) * 100.0),
        "outreach": _round2((outreach_total / 500.0) * 100.0),
        "total": grand_total_100,
    }

    # perRow breakdown (these keys match names used in frontend computed.perRow.*)
    per_row = {
        "academic": {
            "passMarks": _round2(pass_marks),
            "fbMarks": _round2(fb_marks),
            "videosMarks": _round2(videos_marks),
            "sdgMarks": _round2(sdg_marks),
            "vacMarks": _round2(vac_marks),
            "academic_raw": _round2(academic_raw),
        },
        "research": {
            "pubsMarks": _round2(pubs_marks),
            "citationsMarks": _round2(citations_marks),
            "consultancyMarks": _round2(consultancy_marks),
            "sponsoredCombined": _round2(sponsored_combined),
            "researchVisitsMarks": _round2(research_visits_marks),
            "membershipsMarks": _round2(memberships_marks),
            "fdpMarks": _round2(fdp_marks),
            "mandatoryMarks": _round2(mandatory_marks),
            "research_raw": _round2(research_raw),
        },
        "admin": {
            "convenerMarks": _round2(convener_marks),
            "eventsMarks": _round2(events_marks),
            "respMarks": _round2(resp_marks),
            "administration_raw": _round2(administration_raw),
        },
        "outreach": {
            "communityMarks": _round2(community_marks),
            "resourceMarks": _round2(resource_marks),
            "trainingMarks": _round2(training_marks),
            "awardsTotal": _round2(awards_total_marks),
            "outreach_raw": _round2(outreach_raw),
        },
    }

    # Simple rule-based feedback
    feedback_lines = []
    if publications == 0:
        feedback_lines.append("No publications reported — increasing publications will help research score.")
    elif publications < 3:
        feedback_lines.append("Some publications — aim for more consistent output.")
    else:
        feedback_lines.append("Good publication record.")

    if pass_percent >= 85:
        feedback_lines.append("Strong pass percentage.")
    elif pass_percent >= 70:
        feedback_lines.append("Moderate pass percentage; review weaker cohorts.")
    else:
        feedback_lines.append("Pass percentage is low — improve teaching and remediation.")

    weakest_section = min(section_totals.items(), key=lambda t: t[1])[0]
    feedback_lines.append(f"Weakest section: {weakest_section}. Consider actions to improve it.")

    ai_feedback = " ".join(feedback_lines)

    result = {
        # main score object: scaled for UI plus raw 500 value
        "score": {
            "total": grand_total_100,        # convenient value for displays like "xx / 100"
            "raw_500": _round2(grand_total_500),
        },
        "section_totals": section_totals,   # raw per-section totals (out of their maxima)
        "computed": {
            "totals": computed_totals,
            "perRow": per_row,
        },
        "ai_feedback": ai_feedback,
        "debug": {
            "academic": {
                "pass_marks": _round2(pass_marks),
                "fb_marks": _round2(fb_marks),
                "videos_marks": _round2(videos_marks),
                "sdg_marks": _round2(sdg_marks),
                "vac_marks": _round2(vac_marks),
                "academic_raw": _round2(academic_raw),
            },
            "research": {
                "pubs_marks": _round2(pubs_marks),
                "citations_marks": _round2(citations_marks),
                "consultancy_marks": _round2(consultancy_marks),
                "sponsored_combined": _round2(sponsored_combined),
                "research_raw": _round2(research_raw),
            },
            "administration": {
                "convener_marks": _round2(convener_marks),
                "events_marks": _round2(events_marks),
                "resp_marks": _round2(resp_marks),
                "administration_raw": _round2(administration_raw),
            },
            "outreach": {
                "community_marks": _round2(community_marks),
                "resource_marks": _round2(resource_marks),
                "training_marks": _round2(training_marks),
                "awards_total_marks": _round2(awards_total_marks),
                "outreach_raw": _round2(outreach_raw),
            },
        },
        "scored_at": datetime.utcnow().isoformat(),
    }

    return result
