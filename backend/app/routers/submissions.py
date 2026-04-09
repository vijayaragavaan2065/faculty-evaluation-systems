# backend/app/routers/submissions.py
# ============================================================
#  Faculty KPI Evaluation System — Submissions Router
#  PDF export mirrors the official PADS Summary Sheet format
# ============================================================

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status, Path
from fastapi.responses import StreamingResponse
from app.routers.auth import get_current_user
from app.db.client import db
from bson import ObjectId
from io import BytesIO
import os
import json
import traceback
from datetime import datetime, date
from typing import Optional, Any, Dict, List

from app.services import ai_service

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_DEPARTMENTS = [
    "Artificial Intelligence & Data Science",
    "Biomedical Engineering",
    "Chemical Engineering",
    "Civil Engineering",
    "Computer Science and Engineering (AIML)",
    "Computer Science and Engineering (Cyber Security)",
    "Computer Science and Engineering (Business Systems)",
    "Electrical and Electronics Engineering",
    "Electronics and Communication Engineering",
    "Information Technology",
    "Mechanical Engineering",
]

# ──────────────────────────────────────────────
# Helper utilities
# ──────────────────────────────────────────────

def is_higher_role(user: dict) -> bool:
    role = (user.get("role") or "").lower()
    return role in ("director", "registrar", "office_head", "admin")


def sanitize_value(v: Any) -> Any:
    from bson import ObjectId as _OID
    if isinstance(v, _OID):
        return str(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, dict):
        return sanitize_doc(v)
    if isinstance(v, list):
        return [sanitize_value(x) for x in v]
    return v


def sanitize_doc(doc: dict) -> dict:
    out: dict = {}
    for k, v in doc.items():
        if k == "_id":
            out["id"] = sanitize_value(v)
        else:
            out[k] = sanitize_value(v)
    return out


def _safe_parse_date(val: Any) -> datetime:
    if not val:
        return datetime.utcnow()
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(val, fmt)
            except ValueError:
                continue
    return datetime.utcnow()


def _extract_score(doc: dict) -> float:
    if isinstance(doc.get("ai_score"), (int, float)):
        return float(doc["ai_score"])
    sc = doc.get("score")
    if isinstance(sc, dict) and isinstance(sc.get("total"), (int, float)):
        return float(sc["total"])
    if isinstance(sc, (int, float)):
        return float(sc)
    totals = doc.get("section_totals") or {}
    if isinstance(totals, str):
        try:
            totals = json.loads(totals)
        except Exception:
            totals = {}
    if isinstance(totals, dict):
        vals = [float(v) for v in totals.values() if isinstance(v, (int, float))]
        if vals:
            return float(min(100, sum(vals)))
    return 0.0


ALL_TABLE_ROW_KEYS: List[str] = [
    "ese_courses", "feedback_courses",
    "video_rows", "sdg_rows", "vac_rows", "achievement_rows",
    "pub_rows", "patent_rows", "citation_rows", "kpriet_citation_rows",
    "consultancy_rows", "grant_rows", "visit_rows", "membership_rows",
    "fdp_rows", "mandatory_rows", "event_rows", "resp_rows",
    "community_rows", "resource_rows", "training_rows",
    "award_rows", "recognition_rows",
]


# ══════════════════════════════════════════════════════════════════════════════
#  RANK DETECTION
# ══════════════════════════════════════════════════════════════════════════════

def _get_rank_type(rank: str) -> str:
    r = (rank or "").upper()
    if "HOD" in r or "PG COORDINATOR" in r:
        return "HOD"
    if "CFRD" in r:
        return "CFRD"
    if "PHYSICAL" in r:
        return "PE"
    if "NON-TEACHING" in r and "LAB" in r:
        return "NTL"
    if "NON-TEACHING" in r:
        return "NTP"
    if "AP III" in r or "AP (III)" in r:
        return "AP3"
    if "ASP" in r or "PROF" in r:
        return "ASP"
    return "AP12"


# ══════════════════════════════════════════════════════════════════════════════
#  SCORING HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _clamp(v, lo, hi):
    return max(lo, min(hi, v))

def _to_int(v):
    try:
        n = int(v)
        return n if n == n else 0
    except Exception:
        return 0

def _to_float(v):
    try:
        n = float(v)
        return n if n == n else 0.0
    except Exception:
        return 0.0

def _calc_pass_marks(pass_pct: float, cap: int) -> int:
    if pass_pct < 81:
        return 0
    return int(_clamp(round((pass_pct - 81) / 0.5) + 2, 0, cap))

def _calc_fb_marks(fb: float, cap: int) -> int:
    if fb < 3.1:
        return 0
    return int(_clamp(round(((fb - 3.1) / 0.1)) * 2 + 2, 0, cap))

def _calc_grant_amount_marks(amount: float, cap: int) -> int:
    if amount < 10000:
        return 0
    return int(_clamp(round(2 + (amount - 10000) / 5000), 0, cap))

def _calc_pub_points(pub_rows: list) -> float:
    total = 0
    for r in (pub_rows or []):
        if not r.get("title") and not r.get("journal"):
            continue
        idx = (r.get("indexing") or "").upper()
        IF = _to_float(r.get("impactFactor", 0))
        if "SCI" in idx and ("Q3" in idx or "Q4" in idx):
            pts = 20
        elif "SCI" in idx:
            pts = 25
        elif "WOS" in idx or "WEB OF" in idx:
            pts = 15
        elif "SCOPUS" in idx:
            pts = 15
        elif "CONFERENCE" in idx:
            pts = 10
        elif "BOOK-INT" in idx or idx == "BOOK-INTERNATIONAL":
            pts = 50
        elif "BOOK-NAT" in idx or idx == "BOOK-NATIONAL":
            pts = 30
        elif "EDITED" in idx:
            pts = 20
        elif "CHAPTER" in idx:
            pts = 15
        elif "PATENT" in idx and "GRANT" in idx:
            pts = 30
        elif "PATENT" in idx:
            pts = 10
        elif "UGC" in idx:
            pts = 10
        else:
            pts = 15 if (r.get("title") or r.get("journal")) else 0
        if IF > 5:
            pts += 5
        total += pts
    return total

def _pub_row_pts_label(r: dict) -> str:
    if not r.get("title") and not r.get("journal"):
        return "—"
    idx = (r.get("indexing") or "").upper()
    IF = _to_float(r.get("impactFactor", 0))
    if "SCI" in idx and ("Q3" in idx or "Q4" in idx):
        p = 20
    elif "SCI" in idx:
        p = 25
    elif "WOS" in idx or "WEB OF" in idx:
        p = 15
    elif "SCOPUS" in idx:
        p = 15
    elif "CONFERENCE" in idx:
        p = 10
    elif "BOOK-INT" in idx or idx == "BOOK-INTERNATIONAL":
        p = 50
    elif "BOOK-NAT" in idx or idx == "BOOK-NATIONAL":
        p = 30
    elif "EDITED" in idx:
        p = 20
    elif "CHAPTER" in idx:
        p = 15
    elif "PATENT" in idx and "GRANT" in idx:
        p = 30
    elif "PATENT" in idx:
        p = 10
    elif "UGC" in idx:
        p = 10
    else:
        p = 15 if (r.get("title") or r.get("journal")) else 0
    if IF > 5:
        p += 5
    return str(p)

def _fdp_days(fdp_rows: list, mode: str) -> int:
    total = 0
    for r in (fdp_rows or []):
        if r.get("mode") == mode or (mode == "Physical" and r.get("mode") == "F2F"):
            f = r.get("from")
            t = r.get("to")
            try:
                fd = datetime.strptime(str(f), "%Y-%m-%d")
                td = datetime.strptime(str(t), "%Y-%m-%d")
                days = max(1, (td - fd).days + 1)
            except Exception:
                days = 1
            total += days
    return total

def _compute_scores(rank_type: str, doc: dict) -> dict:
    pub_rows    = doc.get("pub_rows") or []
    ese_courses = doc.get("ese_courses") or []
    fb_courses  = doc.get("feedback_courses") or []
    video_rows  = doc.get("video_rows") or []
    sdg_rows    = doc.get("sdg_rows") or []
    vac_rows    = doc.get("vac_rows") or []
    ach_rows    = doc.get("achievement_rows") or []
    symp_rows   = doc.get("symp_pub_rows") or []
    cit_rows    = doc.get("citation_rows") or []
    kpc_rows    = doc.get("kpriet_citation_rows") or []
    con_rows    = doc.get("consultancy_rows") or []
    grt_rows    = doc.get("grant_rows") or []
    vis_rows    = doc.get("visit_rows") or []
    mem_rows    = doc.get("membership_rows") or []
    fdp_rows    = doc.get("fdp_rows") or []
    mand_rows   = doc.get("mandatory_rows") or []
    evt_rows    = doc.get("event_rows") or []
    resp_rows   = doc.get("resp_rows") or []
    comm_rows   = doc.get("community_rows") or []
    res_rows    = doc.get("resource_rows") or []
    train_rows  = doc.get("training_rows") or []
    awd_rows    = doc.get("award_rows") or []
    recog_rows  = doc.get("recognition_rows") or []

    def avg_pass():
        v = [r for r in ese_courses if r.get("appeared") not in ("", None) and r.get("passed") not in ("", None)]
        if not v:
            return _to_float(doc.get("academic", {}).get("pass_percent", 0))
        s = sum((_to_float(r["passed"]) / _to_float(r["appeared"]) * 100)
                if _to_float(r["appeared"]) > 0 else 0 for r in v)
        return round(s / len(v), 1)

    def avg_fb():
        v = [r for r in fb_courses if r.get("feedback") not in ("", None)]
        if not v:
            return _to_float(doc.get("academic", {}).get("student_feedback", 0))
        return round(sum(_to_float(r["feedback"]) for r in v) / len(v), 1)

    pass_pct      = avg_pass()
    fb_score      = avg_fb()
    online_videos = len([r for r in video_rows if r.get("title") or r.get("link")])
    sdg_act       = len([r for r in sdg_rows if r.get("topic") or r.get("method")])
    vac_hrs       = sum(_to_float(r.get("hours", 0)) for r in vac_rows)
    ach_pts       = len([r for r in ach_rows if r.get("student") or r.get("competition")]) * 4
    symp_pubs     = len([r for r in symp_rows if r.get("title") or r.get("conference")])
    citations     = sum(_to_int(r.get("citations", 0)) for r in cit_rows)
    kpriet_cit    = sum(_to_int(r.get("cited", 0)) for r in kpc_rows)
    con_rev       = sum(_to_float(r.get("amount", 0)) for r in con_rows)
    grt_count     = len([r for r in grt_rows if r.get("title")])
    grt_amt       = sum(_to_float(r.get("amount", 0)) for r in grt_rows)
    vis_count     = len([r for r in vis_rows if r.get("lab")])
    mem_count     = len([r for r in mem_rows if r.get("society")])
    fdp_phys      = _fdp_days(fdp_rows, "Physical")
    fdp_online    = _fdp_days(fdp_rows, "Online")
    mooc4w        = len([r for r in fdp_rows if r.get("mode") == "MOOC (4 weeks)"])
    mand          = len([r for r in mand_rows if r.get("programme")])
    conv_phys     = len([r for r in evt_rows if r.get("role") == "Convener/Coordinator" and r.get("mode") != "Online"])
    conv_online   = len([r for r in evt_rows if r.get("role") == "Convener/Coordinator" and r.get("mode") == "Online"])
    guest_hrs     = len([r for r in evt_rows if r.get("role") == "Guest Lecture/Webinar"])
    comm_evts     = len([r for r in evt_rows if r.get("role") == "Committee Member"])
    evts_a        = len([r for r in evt_rows if r.get("level") == "National/International" and r.get("role") in ("Convener/Coordinator", "Organiser")])
    evts_b        = len([r for r in evt_rows if r.get("level") == "Institute" and r.get("role") in ("Convener/Coordinator", "Organiser")])
    evts_c        = comm_evts
    head_c        = len([r for r in resp_rows if r.get("designation") == "Head"])
    mem_c         = len([r for r in resp_rows if r.get("designation") in ("Member", "Coordinator")])
    outreach_act  = len([r for r in comm_rows if r.get("activity")])
    res_out       = len([r for r in res_rows if r.get("type") == "Outside" and r.get("programme")])
    res_in        = len([r for r in res_rows if r.get("type") == "Inside" and r.get("programme")])
    train_days    = sum(_to_float(r.get("days", 0)) for r in train_rows)
    awd_count     = len([r for r in awd_rows if r.get("title")])
    edit_count    = len([r for r in recog_rows if r.get("role") == "Editorial Board"])
    rev_count     = len([r for r in recog_rows if r.get("role") == "Reviewer"])

    is_ap3 = rank_type == "AP3"
    is_asp = rank_type == "ASP"

    if is_ap3:
        MAXS = {"academic": 125, "research": 225, "admin": 75, "outreach": 75}
    elif is_asp:
        MAXS = {"academic": 100, "research": 250, "admin": 100, "outreach": 50}
    else:
        MAXS = {"academic": 150, "research": 200, "admin": 50, "outreach": 100}

    pass_max   = 20 if (is_ap3 or is_asp) else 30
    fb_max     = 20 if (is_ap3 or is_asp) else 30
    pass_marks = _calc_pass_marks(pass_pct, pass_max)
    fb_marks   = _calc_fb_marks(fb_score, fb_max)
    vid_cap    = 20 if is_asp else 30
    sdg_cap    = 20 if is_asp else 30
    vid_marks  = _clamp(10 * online_videos, 0, vid_cap)
    sdg_marks  = _clamp(4 * sdg_act, 0, sdg_cap)
    sec5_cap   = 20 if is_asp else (25 if is_ap3 else 30)
    sec5_marks = _clamp(vac_hrs + ach_pts + 2 * symp_pubs, 0, sec5_cap)
    acad_total = _clamp(pass_marks + fb_marks + vid_marks + sdg_marks + sec5_marks, 0, MAXS["academic"])

    raw_pub = _calc_pub_points(pub_rows)
    if is_ap3:
        pub_max, cit_max, con_max, grt_max = 80, 20, 25, 50
        pub_marks = _clamp(raw_pub, 0, pub_max)
        cit_marks = _clamp(0.5 * citations, 0, cit_max)
        kpc_marks = _clamp(0.5 * kpriet_cit, 0, max(0, cit_max - cit_marks))
        con_marks = _clamp((con_rev / 200000) * 25 if con_rev > 0 else 0, 0, con_max)
        prop_marks = _clamp(5 * grt_count, 0, 15)
        grt_amt_marks = _calc_grant_amount_marks(grt_amt, 35)
        grt_combined = _clamp(prop_marks + grt_amt_marks, 0, grt_max)
    elif is_asp:
        pub_max, cit_max, con_max, grt_max = 90, 30, 25, 50
        pub_marks = _clamp(raw_pub, 0, pub_max)
        cit_marks = _clamp(0.5 * citations, 0, cit_max)
        kpc_marks = _clamp(0.5 * kpriet_cit, 0, max(0, cit_max - cit_marks))
        con_marks = _clamp((con_rev / 200000) * 25 if con_rev > 0 else 0, 0, con_max)
        prop_marks = _clamp(5 * grt_count, 0, 15)
        grt_amt_marks = _calc_grant_amount_marks(grt_amt, 35)
        grt_combined = _clamp(prop_marks + grt_amt_marks, 0, grt_max)
    else:
        pub_max, cit_max, con_max, grt_max = 75, 15, 20, 40
        pub_marks = _clamp(raw_pub, 0, pub_max)
        cit_marks = _clamp(1 * citations, 0, cit_max)
        kpc_marks = _clamp(0.5 * kpriet_cit, 0, max(0, cit_max - cit_marks))
        con_marks = _clamp((con_rev / 200000) * 20 if con_rev > 0 else 0, 0, con_max)
        prop_marks = _clamp(5 * grt_count, 0, 15)
        grt_amt_marks = _calc_grant_amount_marks(grt_amt, 40)
        grt_combined = _clamp(prop_marks + grt_amt_marks, 0, grt_max)

    fdp_max_map = {"AP12": 20, "AP3": 15, "ASP": 10}
    fdp_max = fdp_max_map.get(rank_type, 20)
    fdp_marks = _clamp(1 * fdp_phys + 0.5 * fdp_online + 4 * mooc4w, 0, fdp_max)
    vis_marks = _clamp(10 * vis_count, 0, 10)
    mem_marks = _clamp((5 if is_asp else 10) * mem_count, 0, (5 if is_asp else 10))
    mand_marks = _clamp(10 * mand, 0, 10)
    res_total = _clamp(
        pub_marks + cit_marks + kpc_marks + con_marks + grt_combined +
        vis_marks + mem_marks + fdp_marks + mand_marks,
        0, MAXS["research"]
    )

    admin_conv_max = 30 if is_asp else (25 if is_ap3 else 20)
    conv_raw = 3 * conv_phys + 2 * conv_online + 2 * guest_hrs + 1 * comm_evts
    evts_raw = 3 * evts_a + 2 * evts_b + 1 * evts_c
    conv_marks = _clamp(conv_raw + evts_raw, 0, admin_conv_max)
    resp_max_map = {"ASP": 35, "AP3": 30}
    resp_max = resp_max_map.get(rank_type, 30)
    resp_marks = _clamp(10 * head_c + 5 * mem_c, 0, resp_max)
    adm_total = _clamp(conv_marks + resp_marks, 0, MAXS["admin"])

    comm_cap_map = {"ASP": 10, "AP3": 15}
    comm_cap = comm_cap_map.get(rank_type, 30)
    train_cap_map = {"ASP": 20, "AP3": 20}
    train_cap = train_cap_map.get(rank_type, 30)
    comm_marks  = _clamp(10 * outreach_act, 0, comm_cap)
    res_marks   = _clamp(3 * res_out + 2 * res_in, 0, 20)
    train_marks = _clamp((train_days / 14) * train_cap, 0, train_cap)
    awd_marks   = _clamp(5 * awd_count, 0, 20)
    recog_marks = _clamp(4 * edit_count + 1 * rev_count, 0, 20)
    awd_total   = _clamp(awd_marks + recog_marks, 0, 20)
    out_total   = _clamp(comm_marks + res_marks + train_marks + awd_total, 0, MAXS["outreach"])

    grand = round(acad_total + res_total + adm_total + out_total)
    return {
        "pass_pct": pass_pct, "fb_score": fb_score,
        "pass_marks": pass_marks, "fb_marks": fb_marks,
        "vid_marks": vid_marks, "sdg_marks": sdg_marks, "sec5_marks": sec5_marks,
        "academic": round(acad_total),
        "pub_marks": pub_marks, "cit_marks": cit_marks, "kpc_marks": kpc_marks,
        "con_marks": con_marks, "prop_marks": prop_marks,
        "grt_amt_marks": grt_amt_marks, "grt_combined": grt_combined,
        "vis_marks": vis_marks, "mem_marks": mem_marks, "fdp_marks": fdp_marks, "mand_marks": mand_marks,
        "research": round(res_total),
        "conv_marks": conv_marks, "resp_marks": resp_marks,
        "admin": round(adm_total),
        "comm_marks": comm_marks, "res_marks": res_marks, "train_marks": train_marks, "awd_total": awd_total,
        "outreach": round(out_total),
        "total": grand,
        "MAXS": MAXS,
        "online_videos": online_videos, "sdg_act": sdg_act, "vac_hrs": vac_hrs,
        "ach_pts": ach_pts, "symp_pubs": symp_pubs,
        "citations": citations, "kpriet_cit": kpriet_cit,
        "con_rev": con_rev, "grt_count": grt_count, "grt_amt": grt_amt,
        "vis_count": vis_count, "mem_count": mem_count,
        "fdp_phys": fdp_phys, "fdp_online": fdp_online, "mooc4w": mooc4w, "mand": mand,
        "conv_phys": conv_phys, "conv_online": conv_online, "guest_hrs": guest_hrs,
        "comm_evts": comm_evts, "evts_a": evts_a, "evts_b": evts_b,
        "head_c": head_c, "mem_c": mem_c,
        "outreach_act": outreach_act, "res_out": res_out, "res_in": res_in,
        "train_days": train_days, "awd_count": awd_count, "edit_count": edit_count, "rev_count": rev_count,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  PDF GENERATOR  —  mirrors PADS official Summary Sheet layout exactly
# ══════════════════════════════════════════════════════════════════════════════

def _generate_kpi_pdf(doc: dict, faculty_name: str) -> bytes:
    """
    Generates a PDF that replicates the PADS Summary Sheet format:
    5-column table: Sl.No | KPI Description | Scoring Rubric | Max | Points Scored
    Filled with actual data from the submission.
    """
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.units import mm
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table,
            TableStyle, HRFlowable, KeepTogether,
        )
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
    except ImportError:
        raise RuntimeError("reportlab is required: pip install reportlab")

    buf = BytesIO()
    doc_pdf = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=12 * mm, leftMargin=12 * mm,
        topMargin=14 * mm, bottomMargin=16 * mm,
    )
    PW = A4[0] - 24 * mm  # ~166mm usable

    # ── Colours (matching the Word doc palette) ────────────────────────────
    C_NAVY      = colors.HexColor("#1B2D4F")
    C_DARK_BLUE = colors.HexColor("#1F3864")
    C_SEC_HEAD  = colors.HexColor("#2E5496")   # section header bg
    C_SEC_TXT   = colors.white
    C_HDR_BG    = colors.HexColor("#D6E4F7")   # column header bg
    C_HDR_TXT   = colors.HexColor("#1F3864")
    C_ROW_ALT   = colors.HexColor("#EEF4FB")
    C_WHITE     = colors.white
    C_SCORE     = colors.HexColor("#C00000")   # red score column (like the doc)
    C_TOTAL_BG  = colors.HexColor("#FFF2CC")   # yellow total row
    C_TOTAL_TXT = colors.HexColor("#7F3F00")
    C_GRID      = colors.HexColor("#BDD7EE")
    C_BLACK     = colors.black

    # ── Styles ─────────────────────────────────────────────────────────────
    def _ps(name, **kw):
        return ParagraphStyle(name, **kw)

    S_MAIN_TITLE = _ps("MT", fontName="Helvetica-Bold", fontSize=13,
                        textColor=C_DARK_BLUE, alignment=TA_CENTER, leading=16)
    S_SUB_TITLE  = _ps("ST", fontName="Helvetica-Bold", fontSize=9,
                        textColor=C_DARK_BLUE, alignment=TA_CENTER, leading=12)
    S_INFO_LINE  = _ps("IL", fontName="Helvetica", fontSize=8.5,
                        textColor=C_BLACK, leading=11)
    S_INFO_BOLD  = _ps("IB", fontName="Helvetica-Bold", fontSize=8.5,
                        textColor=C_BLACK, leading=11)
    S_SEC_HDR    = _ps("SH", fontName="Helvetica-Bold", fontSize=9,
                        textColor=C_SEC_TXT, leading=12)
    S_COL_HDR    = _ps("CH", fontName="Helvetica-Bold", fontSize=8,
                        textColor=C_HDR_TXT, alignment=TA_CENTER, leading=10)
    S_NUM        = _ps("NUM", fontName="Helvetica-Bold", fontSize=8.5,
                        textColor=C_BLACK, alignment=TA_CENTER, leading=11)
    S_KPI        = _ps("KPI", fontName="Helvetica", fontSize=8,
                        textColor=C_BLACK, leading=10)
    S_KPI_B      = _ps("KPIB", fontName="Helvetica-Bold", fontSize=8,
                        textColor=C_BLACK, leading=10)
    S_RUBRIC     = _ps("RUB", fontName="Helvetica-Oblique", fontSize=7.5,
                        textColor=colors.HexColor("#444444"), leading=9.5)
    S_MAX        = _ps("MAX", fontName="Helvetica-Bold", fontSize=8.5,
                        textColor=C_BLACK, alignment=TA_CENTER, leading=11)
    S_SCORE_VAL  = _ps("SV", fontName="Helvetica-Bold", fontSize=9,
                        textColor=C_SCORE, alignment=TA_CENTER, leading=12)
    S_TOTAL      = _ps("TOT", fontName="Helvetica-Bold", fontSize=9,
                        textColor=C_TOTAL_TXT, leading=11)
    S_TOTAL_VAL  = _ps("TV", fontName="Helvetica-Bold", fontSize=10,
                        textColor=C_SCORE, alignment=TA_CENTER, leading=12)
    S_FOOTER     = _ps("FTR", fontName="Helvetica-Oblique", fontSize=7,
                        textColor=colors.HexColor("#888888"), alignment=TA_CENTER)
    S_AI_FB      = _ps("AIB", fontName="Helvetica-Oblique", fontSize=8,
                        textColor=colors.HexColor("#333333"), leading=11)

    # Column widths (sum = PW ≈ 166mm)
    # Sl | KPI Description | Scoring Rubric | Max | Points Scored
    COL_W = [8*mm, 72*mm, 52*mm, 18*mm, 16*mm]

    def _sp(h=3):
        return Spacer(1, h * mm)

    def _v(val, default="—"):
        if val is None or val == "":
            return default
        return str(val)

    def _n(val):
        """Format numeric score — blank if 0, else show int."""
        try:
            f = float(val)
            return str(int(round(f))) if f != 0 else ""
        except Exception:
            return ""

    # ── Build border style ─────────────────────────────────────────────────
    BDR = {"style": "SINGLE", "size": 0.5, "color": C_GRID}

    def _tbl_style(n_rows, alt=True, header_rows=1):
        ts = [
            # Header
            ("BACKGROUND",    (0, 0), (-1, header_rows - 1), C_HDR_BG),
            ("TEXTCOLOR",     (0, 0), (-1, header_rows - 1), C_HDR_TXT),
            ("FONTNAME",      (0, 0), (-1, header_rows - 1), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, header_rows - 1), 8),
            ("ALIGN",         (0, 0), (-1, header_rows - 1), "CENTER"),
            # Grid
            ("GRID",          (0, 0), (-1, -1), 0.4, C_GRID),
            ("BOX",           (0, 0), (-1, -1), 0.8, C_DARK_BLUE),
            # Padding
            ("TOPPADDING",    (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING",   (0, 0), (-1, -1), 4),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]
        if alt:
            for i in range(header_rows, n_rows):
                bg = C_ROW_ALT if i % 2 == 0 else C_WHITE
                ts.append(("BACKGROUND", (0, i), (-1, i), bg))
        return TableStyle(ts)

    def section_header_row(text, max_pts):
        """Full-width dark blue section header like the Word doc."""
        row = [[
            Paragraph(text, S_SEC_HDR),
            Paragraph(""), Paragraph(""),
            Paragraph(f"Max ({max_pts})", _ps("MX", fontName="Helvetica-Bold",
                      fontSize=8, textColor=C_SEC_TXT, alignment=TA_RIGHT, leading=11)),
            Paragraph("Points\nScored", _ps("PS", fontName="Helvetica-Bold",
                      fontSize=7.5, textColor=C_SEC_TXT, alignment=TA_CENTER, leading=10)),
        ]]
        t = Table(row, colWidths=COL_W)
        t.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C_SEC_HEAD),
            ("SPAN",          (0, 0), (2, 0)),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 6),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_GRID),
            ("BOX",           (0, 0), (-1, -1), 0.8, C_DARK_BLUE),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        return t

    def kpi_row(num, kpi_text, rubric_text, max_pts, score_val, alt=False):
        """Single KPI data row."""
        row = [[
            Paragraph(str(num), S_NUM),
            Paragraph(kpi_text, S_KPI),
            Paragraph(rubric_text, S_RUBRIC),
            Paragraph(_v(max_pts), S_MAX),
            Paragraph(_n(score_val), S_SCORE_VAL),
        ]]
        t = Table(row, colWidths=COL_W)
        bg = C_ROW_ALT if alt else C_WHITE
        t.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), bg),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_GRID),
            ("BOX",           (0, 0), (-1, -1), 0.8, C_DARK_BLUE),
            ("TOPPADDING",    (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING",   (0, 0), (-1, -1), 4),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ]))
        return t

    def total_row(label, pts, max_pts=500, is_grand=False):
        row = [[
            Paragraph(""), Paragraph(""),
            Paragraph(label, _ps("TL", fontName="Helvetica-Bold", fontSize=9,
                      textColor=C_TOTAL_TXT if not is_grand else C_DARK_BLUE,
                      alignment=TA_RIGHT, leading=11)),
            Paragraph(_v(max_pts), _ps("TM", fontName="Helvetica-Bold", fontSize=9,
                      textColor=C_BLACK, alignment=TA_CENTER, leading=11)),
            Paragraph(_n(pts), S_TOTAL_VAL),
        ]]
        t = Table(row, colWidths=COL_W)
        bg = colors.HexColor("#FFF2CC") if not is_grand else colors.HexColor("#D6E4F7")
        t.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), bg),
            ("SPAN",          (0, 0), (1, 0)),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_GRID),
            ("BOX",           (0, 0), (-1, -1), 1.2, C_DARK_BLUE),
            ("TOPPADDING",    (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING",   (0, 0), (-1, -1), 4),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        return t

    def detail_sub_table(headers, rows, col_widths=None):
        """Small embedded detail table (courses, pubs, etc.)."""
        if not rows:
            return None
        n = len(headers)
        cw = col_widths or [(COL_W[1] + COL_W[2]) / n] * n
        data = [[Paragraph(h, _ps(f"dh{i}", fontName="Helvetica-Bold", fontSize=7,
                  textColor=C_WHITE, alignment=TA_CENTER, leading=9))
                 for i, h in enumerate(headers)]]
        for r in rows:
            data.append([Paragraph(_v(c), _ps("db", fontName="Helvetica", fontSize=7,
                          textColor=C_BLACK, leading=9)) for c in r])
        t = Table(data, colWidths=cw, repeatRows=1)
        ts = [
            ("BACKGROUND",    (0, 0), (-1, 0), C_NAVY),
            ("TEXTCOLOR",     (0, 0), (-1, 0), C_WHITE),
            ("GRID",          (0, 0), (-1, -1), 0.3, C_GRID),
            ("TOPPADDING",    (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("LEFTPADDING",   (0, 0), (-1, -1), 3),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 3),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]
        for i in range(1, len(data)):
            ts.append(("BACKGROUND", (0, i), (-1, i),
                       C_ROW_ALT if i % 2 == 1 else C_WHITE))
        t.setStyle(TableStyle(ts))
        return t

    def kpi_row_with_detail(num, kpi_text, rubric_text, max_pts, score_val,
                             det_headers, det_rows, det_col_w=None, alt=False):
        """KPI row that includes an embedded detail sub-table in the description cell."""
        detail = detail_sub_table(det_headers, det_rows, det_col_w)
        kpi_cell_content = [Paragraph(kpi_text, S_KPI)]
        if detail:
            kpi_cell_content.append(_sp(1))
            kpi_cell_content.append(detail)

        from reportlab.platypus import KeepTogether as KT
        row = [[
            Paragraph(str(num), S_NUM),
            kpi_cell_content,
            Paragraph(rubric_text, S_RUBRIC),
            Paragraph(_v(max_pts), S_MAX),
            Paragraph(_n(score_val), S_SCORE_VAL),
        ]]
        t = Table(row, colWidths=COL_W)
        bg = C_ROW_ALT if alt else C_WHITE
        t.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), bg),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_GRID),
            ("BOX",           (0, 0), (-1, -1), 0.8, C_DARK_BLUE),
            ("TOPPADDING",    (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING",   (0, 0), (-1, -1), 4),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ]))
        return t

    def page_number(canvas, doc_obj):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#888888"))
        canvas.drawRightString(A4[0] - 12 * mm, 8 * mm, f"Page {doc_obj.page}")
        canvas.restoreState()

    # ── Pull submission data ───────────────────────────────────────────────
    rank        = doc.get("faculty_rank", "AP I")
    rank_type   = _get_rank_type(rank)
    acad_year   = doc.get("academic_year", "")
    department  = doc.get("department", "")
    sub_id      = str(doc.get("_id") or doc.get("id") or "—")
    created_at  = _safe_parse_date(doc.get("created_at")).strftime("%d %b %Y, %H:%M UTC")
    status_str  = (doc.get("status") or "submitted").upper()

    ese_courses = doc.get("ese_courses") or []
    fb_courses  = doc.get("feedback_courses") or []
    video_rows  = doc.get("video_rows") or []
    sdg_rows    = doc.get("sdg_rows") or []
    vac_rows    = doc.get("vac_rows") or []
    ach_rows    = doc.get("achievement_rows") or []
    symp_rows   = doc.get("symp_pub_rows") or []
    pub_rows    = doc.get("pub_rows") or []
    cit_rows    = doc.get("citation_rows") or []
    kpc_rows    = doc.get("kpriet_citation_rows") or []
    con_rows    = doc.get("consultancy_rows") or []
    grt_rows    = doc.get("grant_rows") or []
    vis_rows    = doc.get("visit_rows") or []
    phd_rows    = doc.get("phd_rows") or []
    mem_rows    = doc.get("membership_rows") or []
    fdp_rows    = doc.get("fdp_rows") or []
    mand_rows   = doc.get("mandatory_rows") or []
    evt_rows    = doc.get("event_rows") or []
    resp_rows   = doc.get("resp_rows") or []
    intern_rows = doc.get("internship_rows") or []
    mou_rows    = doc.get("mou_rows") or []
    comm_rows   = doc.get("community_rows") or []
    res_rows    = doc.get("resource_rows") or []
    train_rows  = doc.get("training_rows") or []
    awd_rows    = doc.get("award_rows") or []
    recog_rows  = doc.get("recognition_rows") or []

    story = []

    # ══════════════════════════════════════════════════════════════════════════
    #  HEADER BLOCK
    # ══════════════════════════════════════════════════════════════════════════
    def make_header(rank_label: str):
        header_rows = [
            [Paragraph(f"KPIs for {rank_label}", S_MAIN_TITLE)],
            [Paragraph("K.P.R. Institute of Engineering and Technology", S_SUB_TITLE)],
            [Paragraph("Performance Appraisal & Development System (PADS)", S_SUB_TITLE)],
        ]
        t = Table(header_rows, colWidths=[PW])
        t.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C_DARK_BLUE),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("BOX",           (0, 0), (-1, -1), 1, C_DARK_BLUE),
        ]))
        return t

    def make_info_bar():
        left_text = (
            f"Faculty Name: {faculty_name}     "
            f"Faculty ID: {sub_id[-8:]}     "
            f"Dept: {department}"
        )
        right_text = f"Academic Year: {acad_year}     Status: {status_str}     Submitted: {created_at}"
        info_data = [[
            Paragraph(left_text, S_INFO_LINE),
            Paragraph(right_text, _ps("IR", fontName="Helvetica", fontSize=8,
                       textColor=C_BLACK, alignment=TA_RIGHT, leading=11)),
        ]]
        t = Table(info_data, colWidths=[PW * 0.55, PW * 0.45])
        t.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor("#EEF4FB")),
            ("BOX",           (0, 0), (-1, -1), 0.5, C_GRID),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ]))
        return t

    # ══════════════════════════════════════════════════════════════════════════
    #  AP I / AP II  (AP12)
    # ══════════════════════════════════════════════════════════════════════════
    if rank_type == "AP12":
        sc = _compute_scores("AP12", doc)
        story.append(make_header("AP (I) & AP (II)"))
        story.append(_sp(2))
        story.append(make_info_bar())
        story.append(_sp(3))

        # ── ACADEMIC ──────────────────────────────────────────────────────
        story.append(KeepTogether([
            section_header_row("Academic Activities", 150),
            kpi_row_with_detail(
                1,
                "% Pass in ESE (Average of all theory courses)",
                "81% – 95%  →  1–30 M\n(81%=2M, every +0.5%=+1M)",
                30, sc["pass_marks"], alt=False,
                det_headers=["Course Name", "Semester", "Class", "Appeared", "Passed", "Pass %"],
                det_rows=[
                    [r.get("course",""), r.get("semester",""), r.get("className",""),
                     _v(r.get("appeared","")), _v(r.get("passed","")),
                     f"{(_to_float(r.get('passed',0))/_to_float(r.get('appeared',1))*100):.1f}%"
                     if _to_float(r.get("appeared",0)) > 0 else "—"]
                    for r in ese_courses
                ],
                det_col_w=[38*mm, 12*mm, 11*mm, 14*mm, 14*mm, 11*mm]
            ),
        ]))

        story.append(kpi_row_with_detail(
            2, "Student Feedback (Average of all theory courses)",
            "3.1–4.5 (Out of 5)  →  1–30 M\n(3.1=2M, every +0.1=+2M)",
            30, sc["fb_marks"], alt=True,
            det_headers=["Course Name", "Semester", "Class", "Feedback (0-5)"],
            det_rows=[[r.get("course",""), r.get("semester",""),
                       r.get("className",""), _v(r.get("feedback",""))]
                      for r in fb_courses],
            det_col_w=[55*mm, 15*mm, 12*mm, 18*mm]
        ))

        story.append(kpi_row_with_detail(
            3, "Developing Online Course / Video Lecture and uploaded",
            "10 pts. / video  —  cap 30",
            30, sc["vid_marks"], alt=False,
            det_headers=["Course Name", "Video / Animation Title", "YouTube / Swayam Link"],
            det_rows=[[r.get("course",""), r.get("title",""), r.get("link","")]
                      for r in video_rows],
            det_col_w=[30*mm, 35*mm, 35*mm]
        ))

        story.append(kpi_row_with_detail(
            4, "Implementation of Innovative teaching methodologies addressing SDGs",
            "4 pts. / activity  —  Min 4 SDG  —  cap 30",
            30, sc["sdg_marks"], alt=True,
            det_headers=["Course", "Class/Sem", "Topic", "Methodology", "SDG No."],
            det_rows=[[r.get("course",""), r.get("classSem",""), r.get("topic",""),
                       r.get("method",""), _v(r.get("sdg",""))]
                      for r in sdg_rows],
            det_col_w=[24*mm, 16*mm, 24*mm, 24*mm, 12*mm]
        ))

        # KPI 5 — composite
        vac_data  = [[r.get("course",""), r.get("classSem",""), _v(r.get("students","")),
                      _v(r.get("hours","")), _v(r.get("date",""))] for r in vac_rows]
        ach_data  = [[r.get("student",""), r.get("competition",""),
                      r.get("institute",""), _v(r.get("date",""))] for r in ach_rows]
        symp_data = [[r.get("title",""), r.get("conference",""),
                      r.get("institution",""), _v(r.get("date",""))] for r in symp_rows]

        vac_tbl  = detail_sub_table(["Course Name","Class/Sem","Students","Hours","Date"],
                                     vac_data, [28*mm,16*mm,14*mm,10*mm,12*mm])
        ach_tbl  = detail_sub_table(["Student Name","Competition","Institute","Date"],
                                     ach_data, [28*mm,25*mm,22*mm,12*mm])
        symp_tbl = detail_sub_table(["Paper Title","Symposium/Conference","Institution","Date"],
                                     symp_data, [28*mm,25*mm,22*mm,12*mm])

        kpi5_content = [Paragraph(
            "Conduct of VAC/Capsule courses / Training the students to win prizes / "
            "awards in project / papers presented in symposium & Conference / "
            "technical contest at Tier-1 institutions", S_KPI)]
        note5 = (f"VAC: {sc['vac_hrs']:.0f} hrs = {sc['vac_hrs']:.0f} pts  |  "
                 f"Achievements: {sc['ach_pts']//4} × 4 = {sc['ach_pts']} pts  |  "
                 f"Symp. pubs: {sc['symp_pubs']} × 2 = {sc['symp_pubs']*2} pts  |  "
                 f"Total (cap 30): {sc['sec5_marks']}")
        kpi5_content.append(Paragraph(note5, _ps("n5", fontName="Helvetica-Oblique",
                             fontSize=7, textColor=colors.HexColor("#1a7f4f"), leading=9)))
        if vac_tbl:
            kpi5_content.append(Paragraph("5A — VAC / Capsule Courses (1 pt/hr):",
                                           _ps("sub5", fontName="Helvetica-Bold", fontSize=7,
                                               textColor=C_DARK_BLUE, leading=9)))
            kpi5_content.append(vac_tbl)
        if ach_tbl:
            kpi5_content.append(Paragraph("5B — Student Achievements (4 pts each):",
                                           _ps("sub5b", fontName="Helvetica-Bold", fontSize=7,
                                               textColor=C_DARK_BLUE, leading=9)))
            kpi5_content.append(ach_tbl)
        if symp_tbl:
            kpi5_content.append(Paragraph("5C — Symposium Publications (2 pts each):",
                                           _ps("sub5c", fontName="Helvetica-Bold", fontSize=7,
                                               textColor=C_DARK_BLUE, leading=9)))
            kpi5_content.append(symp_tbl)

        kpi5_row = [[
            Paragraph("5", S_NUM),
            kpi5_content,
            Paragraph("1 pt./hour of VAC\n4 pts. Achievement\n2 Pts. /Publication\ncap 30", S_RUBRIC),
            Paragraph("30", S_MAX),
            Paragraph(_n(sc["sec5_marks"]), S_SCORE_VAL),
        ]]
        kpi5_tbl = Table(kpi5_row, colWidths=COL_W)
        kpi5_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C_ROW_ALT),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_GRID),
            ("BOX",           (0, 0), (-1, -1), 0.8, C_DARK_BLUE),
            ("TOPPADDING",    (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING",   (0, 0), (-1, -1), 4),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(kpi5_tbl)
        story.append(total_row("Academic Total:", sc["academic"], 150))

        # ── RESEARCH ──────────────────────────────────────────────────────
        story.append(_sp(3))
        story.append(section_header_row("Research and Professional Development", 200))

        # Publications
        pub_data = [[r.get("title","")[:35], r.get("authors","")[:20],
                     r.get("journal","")[:25], _v(r.get("monthYear","")),
                     _v(r.get("indexing","")), _v(r.get("impactFactor","")),
                     _pub_row_pts_label(r)] for r in pub_rows]
        story.append(kpi_row_with_detail(
            6, "Publications (Min 1 SCI)",
            "SCI Q1/Q2=25 | SCI Q3/Q4=20\nWoS/Scopus=15 | Conf=10\nPatent Pub=10 | Granted=30\nIF>5: +5 bonus  —  cap 75",
            75, sc["pub_marks"], alt=False,
            det_headers=["Title", "Authors", "Journal", "Month/Year", "Indexing", "IF", "Pts"],
            det_rows=pub_data,
            det_col_w=[30*mm, 20*mm, 24*mm, 12*mm, 14*mm, 8*mm, 8*mm]
        ))

        cit_data = [[r.get("title","")[:60], _v(r.get("citations",""))]
                    for r in cit_rows]
        kpc_data = [[r.get("title","")[:60], _v(r.get("cited",""))]
                    for r in kpc_rows]
        cit_all  = (cit_data or []) + ([["--- KPRIET affiliation ---", ""]] if kpc_data else []) + (kpc_data or [])
        story.append(kpi_row_with_detail(
            7, "Article Citation in WoS / Scopus Journals & Conferences",
            "1 pt. / citation (AP I/II)\n0.5 pt. / KPRIET affiliation article\ncap 15 (shared pool)",
            15, sc["cit_marks"] + sc["kpc_marks"], alt=True,
            det_headers=["Title of the Paper", "No. of Citations"],
            det_rows=cit_all,
            det_col_w=[78*mm, 22*mm]
        ))

        con_data = [[r.get("title",""), r.get("org",""),
                     _v(r.get("date","")), f"Rs.{_to_float(r.get('amount',0)):,.0f}"]
                    for r in con_rows]
        story.append(kpi_row_with_detail(
            8, "Consultancy Revenue Generation (Rs. per Year)",
            f"Scaled 0–20 pts\n(₹0→0, ₹2L→20)\nTotal: ₹{sc['con_rev']:,.0f}",
            20, sc["con_marks"], alt=False,
            det_headers=["Work Title", "Organisation", "Date", "Amount (Rs.)"],
            det_rows=con_data,
            det_col_w=[40*mm, 28*mm, 12*mm, 20*mm]
        ))

        grt_data = [[r.get("pi",""), r.get("title","")[:30], r.get("agency",""),
                     _v(r.get("date","")), f"Rs.{_to_float(r.get('amount',0)):,.0f}",
                     _v(r.get("status",""))]
                    for r in grt_rows]
        story.append(kpi_row_with_detail(
            9,
            "a) Sponsored Grants received during AY\nb) Research Proposal submitted above 10 Lakhs",
            "a) 10K–2L → 2–40 M\nb) 5 pts. / proposal\ncap 40",
            40, sc["grt_combined"], alt=True,
            det_headers=["PI", "Project Title", "Agency", "Date", "Amount", "Status"],
            det_rows=grt_data,
            det_col_w=[16*mm, 28*mm, 18*mm, 12*mm, 16*mm, 10*mm]
        ))

        vis_data = [[r.get("lab",""), _v(r.get("date","")), _v(r.get("outcome",""))]
                    for r in vis_rows]
        story.append(kpi_row_with_detail(
            10, "Visit to Research Laboratories for Collaboration",
            "10 pts. / visit  —  cap 10",
            10, sc["vis_marks"], alt=False,
            det_headers=["Research Lab / Scholar", "Date", "Outcome / Collaboration"],
            det_rows=vis_data,
            det_col_w=[40*mm, 15*mm, 45*mm]
        ))

        mem_data = [[r.get("society",""), _v(r.get("level","")),
                     _v(r.get("memberId","")), _v(r.get("type",""))]
                    for r in mem_rows]
        story.append(kpi_row_with_detail(
            11, "Membership in Professional bodies of high repute",
            "10 pts. / membership  —  cap 10",
            10, sc["mem_marks"], alt=True,
            det_headers=["Society / Chapter", "Level", "Member ID", "Type"],
            det_rows=mem_data,
            det_col_w=[38*mm, 18*mm, 18*mm, 14*mm]
        ))

        fdp_data = [[r.get("course",""), r.get("organiser",""),
                     _v(r.get("from","")), _v(r.get("to","")), _v(r.get("mode",""))]
                    for r in fdp_rows]
        story.append(kpi_row_with_detail(
            12, "Completion of FDP / STTP / MOOC courses with proctored exam",
            "1 pt./day Physical\n0.5 pt./day Online\n4 pts. for 4-week MOOC\ncap 20",
            20, sc["fdp_marks"], alt=False,
            det_headers=["Course Name", "Organised By", "From", "To", "Mode"],
            det_rows=fdp_data,
            det_col_w=[32*mm, 24*mm, 14*mm, 14*mm, 16*mm]
        ))

        mand_data = [[r.get("programme",""), r.get("organiser",""),
                      _v(r.get("from","")), _v(r.get("to",""))]
                     for r in mand_rows]
        story.append(kpi_row_with_detail(
            13, "Number of Mandatory Training Programmes Completed",
            "10 pts. / Course  —  cap 10",
            10, sc["mand_marks"], alt=True,
            det_headers=["Training Programme", "Organised By", "From", "To"],
            det_rows=mand_data,
            det_col_w=[40*mm, 28*mm, 12*mm, 12*mm]
        ))
        story.append(total_row("Research Total:", sc["research"], 200))

        # ── ADMINISTRATION ────────────────────────────────────────────────
        story.append(_sp(3))
        story.append(section_header_row("Administration", 50))

        evt_data = [[r.get("event",""), _v(r.get("date","")), _v(r.get("mode","")),
                     _v(r.get("level","")), _v(r.get("role",""))]
                    for r in evt_rows]
        story.append(kpi_row_with_detail(
            "14",
            "Convener or Coordinator for Workshop / Seminar / FDP / Short-term courses / Executive development program",
            "Physical – 3 pts/day\nOnline – 2 pts/day\nGuest lecture – 2 pts/day\nCommittee – 1 pt/program",
            20, sc["conv_marks"], alt=False,
            det_headers=["Event Name", "Date", "Mode", "Level", "Role"],
            det_rows=evt_data,
            det_col_w=[38*mm, 12*mm, 14*mm, 20*mm, 16*mm]
        ))

        # 15a+b+c share the same events table; just show rubric with note
        story.append(kpi_row(
            "15",
            "a) National / Intl. conference / Institute level signature events\n"
            "b) Committee head for Institute level event\n"
            "c) Committee member for institute level events",
            "a) 3 pts. / program\nb) 2 pts. / program\nc) 1 pt. / program\n"
            f"(Combined with KPI 14, cap 20)\nScored: Nat/Intl={sc['evts_a']}, Inst={sc['evts_b']}",
            "—", "", alt=True
        ))

        resp_data = [[r.get("responsibility",""), _v(r.get("designation",""))]
                     for r in resp_rows]
        story.append(kpi_row_with_detail(
            16, "Institute & Dept. level responsibility",
            "Head – 10 pts\nMember – 5 pts\ncap 30",
            30, sc["resp_marks"], alt=False,
            det_headers=["Responsibility / Committee", "Designation"],
            det_rows=resp_data,
            det_col_w=[72*mm, 28*mm]
        ))
        story.append(total_row("Administration Total:", sc["admin"], 50))

        # ── OUTREACH ──────────────────────────────────────────────────────
        story.append(_sp(3))
        story.append(section_header_row("Outreach Activities", 100))

        comm_data = [[r.get("activity",""), _v(r.get("date","")), _v(r.get("significance",""))]
                     for r in comm_rows]
        story.append(kpi_row_with_detail(
            17, "Community Services / Addressing Rural Issues / ISR",
            "10 pts. / activity  —  cap 30",
            30, sc["comm_marks"], alt=False,
            det_headers=["Activity", "Date", "Significance"],
            det_rows=comm_data,
            det_col_w=[40*mm, 14*mm, 46*mm]
        ))

        res_data = [[r.get("programme",""), r.get("org",""), _v(r.get("type","")),
                     _v(r.get("date",""))]
                    for r in res_rows]
        story.append(kpi_row_with_detail(
            18, "Being a Resource person",
            "Outside – 3 pt. / hour\nInside – 2 pt. / hour\ncap 20",
            20, sc["res_marks"], alt=True,
            det_headers=["Programme Name", "Organisation", "Inside/Outside", "Date"],
            det_rows=res_data,
            det_col_w=[38*mm, 28*mm, 18*mm, 16*mm]
        ))

        tr_data = [[r.get("institute",""), _v(r.get("days","")), _v(r.get("period",""))]
                   for r in train_rows]
        story.append(kpi_row_with_detail(
            19, "Training in Industry / Research institutes (Days / Year) – Physical",
            "Two weeks (14 days) = max pts\n(linear)\ncap 30",
            30, sc["train_marks"], alt=False,
            det_headers=["Industry / Research Institute", "No. of Days", "Period"],
            det_rows=tr_data,
            det_col_w=[55*mm, 16*mm, 29*mm]
        ))

        awd_data  = [[r.get("title",""), r.get("agency",""), _v(r.get("date",""))]
                     for r in awd_rows]
        rec_data  = [[r.get("journal",""), _v(r.get("role","")), _v(r.get("indexing",""))]
                     for r in recog_rows]
        awd_all   = awd_data + ([["--- Recognitions ---", "", ""]] if rec_data else []) + rec_data
        story.append(kpi_row_with_detail(
            "20",
            "Awards  &  Recognition\n(Top 2%, Editorial board – 4 pts., Journal paper review – 1 pt./paper)\nWithout fund remittance",
            "Awards: 5 pts. / award\nEditorial Board: 4 pts.\nReviewer: 1 pt./paper\ncap 20",
            20, sc["awd_total"], alt=True,
            det_headers=["Title / Journal", "Agency / Role", "Date / Indexing"],
            det_rows=awd_all,
            det_col_w=[50*mm, 28*mm, 22*mm]
        ))
        story.append(total_row("Outreach Total:", sc["outreach"], 100))
        story.append(_sp(2))
        story.append(total_row("GRAND TOTAL:", sc["total"], 500, is_grand=True))

    # ══════════════════════════════════════════════════════════════════════════
    #  AP III  (AP3)
    # ══════════════════════════════════════════════════════════════════════════
    elif rank_type == "AP3":
        sc = _compute_scores("AP3", doc)
        story.append(make_header("AP (III)"))
        story.append(_sp(2))
        story.append(make_info_bar())
        story.append(_sp(3))

        story.append(section_header_row("Academic Activities", 125))
        story.append(kpi_row(1, "% Pass in ESE (Average of all theory courses)",
                             "81% – 95%  →  1–20 M", 20, sc["pass_marks"], alt=False))
        story.append(kpi_row(2, "Student Feedback (Average of all theory courses)",
                             "3.1–4.5 (Out of 5)  →  1–20 M", 20, sc["fb_marks"], alt=True))
        story.append(kpi_row(3, "Developing Online Course / Video Lecture and uploaded",
                             "10 pts. / video  —  cap 30", 30, sc["vid_marks"], alt=False))
        story.append(kpi_row(4, "Implementation of Innovative teaching methodologies addressing SDGs",
                             "4 pts. / activity  —  Min 4 SDG  —  cap 30", 30, sc["sdg_marks"], alt=True))
        story.append(kpi_row(5, "Conduct of VAC/Capsule courses / Training the students",
                             "1 pt./hour of VAC\n4 pts. Achievement\n2 Pts. /Publication\ncap 25",
                             25, sc["sec5_marks"], alt=False))
        story.append(total_row("Academic Total:", sc["academic"], 125))

        story.append(_sp(3))
        story.append(section_header_row("Research and Professional Development", 225))

        pub_data = [[r.get("title","")[:40], r.get("authors","")[:18],
                     r.get("journal","")[:22], _v(r.get("indexing","")),
                     _pub_row_pts_label(r)] for r in pub_rows]
        story.append(kpi_row_with_detail(
            6, "Publications (Min 1 SCI)",
            "SCI Q1/Q2=25 | SCI Q3/Q4=20\nWoS/Scopus=15 | Conf=10\nPatent=10/30  cap 80",
            80, sc["pub_marks"], alt=False,
            det_headers=["Title", "Authors", "Journal", "Indexing", "Pts"],
            det_rows=pub_data,
            det_col_w=[35*mm, 20*mm, 24*mm, 16*mm, 10*mm]
        ))
        story.append(kpi_row(7, "Article Citation in WoS / Scopus Journals & Conferences",
                             "0.5 pt. per citation\n0.5 pt. for KPRIET affiliation\ncap 20", 20,
                             sc["cit_marks"] + sc["kpc_marks"], alt=True))
        story.append(kpi_row(8, "Consultancy Revenue Generation (Rs. per Year)",
                             f"0–2L → 0–25 pts\nTotal: ₹{sc['con_rev']:,.0f}", 25, sc["con_marks"], alt=False))
        story.append(kpi_row(9, "a) Sponsored Grants received\nb) Research Proposal submitted above 10 Lakhs",
                             "a) 10K–4L → pts\nb) 5 pts. / proposal upto\ncap 50", 50, sc["grt_combined"], alt=True))

        phd_comp = len([r for r in phd_rows if r.get("status") == "Completed"])
        phd_pur  = len([r for r in phd_rows if r.get("status") != "Completed" and r.get("scholar")])
        phd_sc   = int(_clamp(10 * phd_comp + 4 * phd_pur, 0, 15))
        phd_data = [[r.get("scholar",""), r.get("title",""), _v(r.get("status","")), _v(r.get("year",""))]
                    for r in phd_rows]
        story.append(kpi_row_with_detail(
            10, "Research Scholars Supervision",
            "a) 10 pts. for completion\nb) 4 pts. Full time\n3 pts. Part time\ncap 15",
            15, phd_sc, alt=False,
            det_headers=["Scholar Name", "Thesis Title", "Status", "Year"],
            det_rows=phd_data,
            det_col_w=[28*mm, 42*mm, 14*mm, 16*mm]
        ))
        story.append(kpi_row(11, "Visit to Research Laboratories for Collaboration",
                             "10 pts. / visit  —  cap 10", 10, sc["vis_marks"], alt=True))
        story.append(kpi_row(12, "Membership in Professional bodies of high repute",
                             "10 pts. / membership  —  Min 1  —  cap 10", 10, sc["mem_marks"], alt=False))
        story.append(kpi_row(13, "Completion of FDP / STTP / MOOC courses with proctored exam",
                             "1 pt./day Physical\n0.5 pt./day Online\n4 pts. for 4-week MOOC  cap 15",
                             15, sc["fdp_marks"], alt=True))
        story.append(kpi_row(14, "Number of Mandatory Training Programmes Completed",
                             "10 pts. per Course  —  cap 10", 10, sc["mand_marks"], alt=False))
        story.append(total_row("Research Total:", sc["research"], 225))

        story.append(_sp(3))
        story.append(section_header_row("Administration", 75))
        story.append(kpi_row(15, "Convener or Coordinator for Workshop / Seminar / FDP / Short-term courses",
                             "Physical – 3 pts/day\nOnline – 2 pts/day\nGuest – 2 pts/day\nCommittee – 1 pt",
                             25, sc["conv_marks"], alt=False))
        story.append(kpi_row(16, "a) Nat/Intl conference events\nb) Committee head\nc) Committee member",
                             "a) 3 pts. / program\nb) 2 pts.\nc) 1 pt.", "—", "", alt=True))
        story.append(kpi_row(17, "Institute & Dept. level responsibility",
                             "Head – 10 pts  Member – 5 pts  cap 30", 30, sc["resp_marks"], alt=False))

        intern_sc = int(_clamp(len([r for r in intern_rows if r.get("student")]) * 2, 0, 10))
        mou_sc    = int(_clamp(len([r for r in mou_rows if r.get("institute")]) * 10, 0, 10))
        story.append(kpi_row(18, "Arranging Students internship / placement / project in Industries",
                             "2 pts. / student  —  cap 10", 10, intern_sc, alt=True))
        story.append(kpi_row(19, "Signing MoU and tangible outcomes",
                             "10 pts. / MoU  —  cap 10", 10, mou_sc, alt=False))
        story.append(total_row("Administration Total:", sc["admin"], 75))

        story.append(_sp(3))
        story.append(section_header_row("Outreach Activities", 75))
        story.append(kpi_row(20, "Community Services / Addressing Rural Issues / ISR",
                             "10 pts. / activity  —  cap 15", 15, sc["comm_marks"], alt=False))
        story.append(kpi_row(21, "Being a Resource person",
                             "Outside – 3 pt. / hour\nInside – 2 pt. / hour  cap 20", 20, sc["res_marks"], alt=True))
        story.append(kpi_row(22, "Training in Industry / Research institutes (Days / Year) – Physical",
                             "Two weeks = max pts  cap 20", 20, sc["train_marks"], alt=False))
        story.append(kpi_row("23.", "Awards & Recognition (Editorial board – 4 pts.; Journal paper review – 1 pt./paper)",
                             "Awards: 5 pts.\nEditorial: 4 pts.\nReviewer: 1 pt.  cap 20", 20, sc["awd_total"], alt=True))
        story.append(total_row("Outreach Total:", sc["outreach"], 75))
        story.append(_sp(2))
        story.append(total_row("GRAND TOTAL:", sc["total"], 500, is_grand=True))

    # ══════════════════════════════════════════════════════════════════════════
    #  ASP / Prof
    # ══════════════════════════════════════════════════════════════════════════
    elif rank_type == "ASP":
        sc = _compute_scores("ASP", doc)
        story.append(make_header("AsP / Prof."))
        story.append(_sp(2))
        story.append(make_info_bar())
        story.append(_sp(3))

        story.append(section_header_row("Academic Activities", 100))
        story.append(kpi_row(1, "% Pass in ESE (Average of all theory courses)",
                             "81% – 95%  →  1–20 M", 20, sc["pass_marks"], alt=False))
        story.append(kpi_row(2, "Student Feedback (Average of all theory courses)",
                             "3.1–4.5 (Out of 5)  →  1–20 M", 20, sc["fb_marks"], alt=True))
        story.append(kpi_row(3, "Developing Online Course / Video Lecture",
                             "10 pts. / video  —  cap 20", 20, sc["vid_marks"], alt=False))
        story.append(kpi_row(4, "Implementation of Innovative teaching methodologies addressing SDGs",
                             "4 pts. / activity  —  cap 20", 20, sc["sdg_marks"], alt=True))
        story.append(kpi_row(5, "Conduct of VAC / Training the students",
                             "1 pt./hour VAC\n4 pts. Achievement\n2 Pts. /Publication  cap 20",
                             20, sc["sec5_marks"], alt=False))
        story.append(total_row("Academic Total:", sc["academic"], 100))

        story.append(_sp(3))
        story.append(section_header_row("Research and Professional Development", 250))

        pub_data = [[r.get("title","")[:40], r.get("authors","")[:18],
                     r.get("journal","")[:22], _v(r.get("indexing","")),
                     _pub_row_pts_label(r)] for r in pub_rows]
        story.append(kpi_row_with_detail(
            6, "Publications (Min 1 SCI)", "SCI Q1/Q2=25 | SCI Q3/Q4=20\nWoS/Scopus=15 | Conf=10\ncap 90",
            90, sc["pub_marks"], alt=False,
            det_headers=["Title", "Authors", "Journal", "Indexing", "Pts"],
            det_rows=pub_data,
            det_col_w=[35*mm, 20*mm, 24*mm, 16*mm, 10*mm]
        ))
        story.append(kpi_row(7, "Article Citation in WoS / Scopus Journals & Conferences",
                             "0.5 pt. per citation\n0.5 pt. KPRIET affiliation  cap 30",
                             30, sc["cit_marks"] + sc["kpc_marks"], alt=True))
        story.append(kpi_row(8, "Consultancy Revenue Generation",
                             f"0–2L → 0–25 pts\nTotal: ₹{sc['con_rev']:,.0f}", 25, sc["con_marks"], alt=False))
        story.append(kpi_row(9, "Sponsored Grants received / Research Proposals",
                             "a) 10K–4L\nb) 5 pts. / proposal  cap 50", 50, sc["grt_combined"], alt=True))

        phd_comp = len([r for r in phd_rows if r.get("status") == "Completed"])
        phd_pur  = len([r for r in phd_rows if r.get("status") != "Completed" and r.get("scholar")])
        phd_sc   = int(_clamp(10 * phd_comp + 4 * phd_pur, 0, 20))
        story.append(kpi_row(10, "Research Scholars Supervision",
                             "Completion: 10 pts\nFull-time: 4 pts\nPart-time: 3 pts  cap 20",
                             20, phd_sc, alt=False))
        story.append(kpi_row(11, "Visit to Research Laboratories for Collaboration",
                             "10 pts. / visit  —  cap 10", 10, sc["vis_marks"], alt=True))
        story.append(kpi_row(12, "Membership in Professional bodies",
                             "5 pts. / membership  —  cap 5", 5, sc["mem_marks"], alt=False))
        story.append(kpi_row(13, "Completion of FDP / STTP / MOOC courses",
                             "1 pt./day Physical\n0.5 pt./day Online\n4 pts. for 4-week MOOC  cap 10",
                             10, sc["fdp_marks"], alt=True))
        story.append(kpi_row(14, "Number of Mandatory Training Programmes",
                             "10 pts. per Course  —  cap 10", 10, sc["mand_marks"], alt=False))
        story.append(total_row("Research Total:", sc["research"], 250))

        story.append(_sp(3))
        story.append(section_header_row("Administration", 100))
        story.append(kpi_row(15, "Convener / Coordinator for Workshop / Seminar / FDP",
                             "Physical – 3 pts/day\nOnline – 2 pts/day\nGuest – 2 pts/day\nCommittee – 1 pt  cap 30",
                             30, sc["conv_marks"], alt=False))
        story.append(kpi_row(16, "a) Nat/Intl conference events\nb) Committee head\nc) Committee member",
                             "a) 3 pts. / program\nb) 2 pts.\nc) 1 pt.", "—", "", alt=True))
        story.append(kpi_row(17, "Institute & Dept. level responsibility",
                             "Head – 10 pts  Member – 5 pts  cap 30", 30, sc["resp_marks"], alt=False))
        intern_sc = int(_clamp(len([r for r in intern_rows if r.get("student")]) * 2, 0, 20))
        mou_sc    = int(_clamp(len([r for r in mou_rows if r.get("institute")]) * 10, 0, 20))
        story.append(kpi_row(18, "Arranging Students internship / placement / project in Industries",
                             "2 pts. / student  —  cap 20", 20, intern_sc, alt=True))
        story.append(kpi_row(19, "Signing MoU and tangible outcomes",
                             "10 pts. / MoU  —  cap 20", 20, mou_sc, alt=False))
        story.append(total_row("Administration Total:", sc["admin"], 100))

        story.append(_sp(3))
        story.append(section_header_row("Outreach Activities", 50))
        story.append(kpi_row(20, "Community Services / Addressing Rural Issues / ISR",
                             "10 pts. / activity  —  cap 10", 10, sc["comm_marks"], alt=False))
        story.append(kpi_row(21, "Being a Resource person",
                             "Outside – 3 pt. / hour\nInside – 2 pt. / hour  cap 20", 20, sc["res_marks"], alt=True))
        story.append(kpi_row("23.", "Awards & Recognition (Editorial board – 4 pts., Journal paper review – 1 pt./paper)",
                             "Awards: 5 pts.\nEditorial: 4 pts.\nReviewer: 1 pt.  cap 20", 20, sc["awd_total"], alt=False))
        story.append(total_row("Outreach Total:", sc["outreach"], 50))
        story.append(_sp(2))
        story.append(total_row("GRAND TOTAL:", sc["total"], 500, is_grand=True))

    # ══════════════════════════════════════════════════════════════════════════
    #  CFRD
    # ══════════════════════════════════════════════════════════════════════════
    elif rank_type == "CFRD":
        acad_s   = doc.get("academic") or {}
        cfrd_s   = doc.get("cfrd_scalars") or {}
        pass_pct = _to_float(acad_s.get("pass_percent", 0))
        fb_v     = _to_float(acad_s.get("student_feedback", 0))
        pubs_cnt = len([r for r in pub_rows if r.get("title")])
        s1 = _calc_pass_marks(pass_pct, 20)
        s2 = _calc_fb_marks(fb_v, 20)
        s3 = int(_clamp(_to_float(cfrd_s.get("research_training", 0)) * 2, 0, 10))
        acad_t   = _clamp(s1 + s2 + s3, 0, 50)
        pub_pts  = int(_clamp(25 * pubs_cnt, 0, 225))
        grt_rev  = _to_float(cfrd_s.get("grants_revenue", 0))
        grt_mark = int(_clamp((grt_rev / 100000) * 10, 0, 195))
        phd_c    = _to_int(cfrd_s.get("phd_completed", 0))
        phd_p    = _to_int(cfrd_s.get("phd_pursuing", 0))
        phd_mark = int(_clamp(10 * phd_c + 4 * phd_p, 0, 15))
        res_hrs  = _to_float(cfrd_s.get("resource_hours", 0))
        res_mark = int(_clamp(res_hrs * 2, 0, 15))
        res_t    = _clamp(pub_pts + grt_mark + phd_mark + res_mark, 0, 450)
        grand_t  = round(acad_t + res_t)

        story.append(make_header("CFRD"))
        story.append(_sp(2))
        story.append(make_info_bar())
        story.append(_sp(3))

        story.append(section_header_row("Academic Activities", 50))
        story.append(kpi_row(1, "% Pass in ESE (Average of all theory courses)",
                             "81–95  →  1–20 M", 20, s1, alt=False))
        story.append(kpi_row(2, "Student Feedback (Average of all theory courses)",
                             "3.1–4.5  →  1–20 M", 20, s2, alt=True))
        story.append(kpi_row(3, "Research training activities to students",
                             "4 pts. / Activity  —  cap 10", 10, s3, alt=False))
        story.append(total_row("Academic Total:", int(acad_t), 50))

        story.append(_sp(3))
        story.append(section_header_row("Research and Professional Development", 450))

        pub_data = [[r.get("title","")[:40], r.get("authors","")[:18],
                     _v(r.get("indexing","")), _pub_row_pts_label(r)]
                    for r in pub_rows]
        story.append(kpi_row_with_detail(
            4, "Publications (Min 4 SCI)",
            "SCI Q1/Q2=25, WoS/Scopus=15\nBook-Intl=50, Patent=10/30\ncap 225",
            225, pub_pts, alt=False,
            det_headers=["Title", "Authors", "Indexing", "Pts"],
            det_rows=pub_data,
            det_col_w=[50*mm, 25*mm, 18*mm, 12*mm]
        ))
        story.append(kpi_row(5, "Consultancy Revenue Generation (Rs per Year)",
                             f"10 pts. per ₹1L  —  cap 195\nTotal: ₹{grt_rev:,.0f}", 100, grt_mark, alt=True))
        story.append(kpi_row(6, "Sponsored Grants received during AY",
                             "10K–10 Lakhs  →  pts", 100, 0, alt=False))
        story.append(kpi_row(7, "Product Development", "—", 25, 0, alt=True))
        story.append(kpi_row(8, "Research Scholars Supervision",
                             "a) 10 pts. for PhD completion\nb) 4 pts. FT scholar\n3 pts. PT scholar  cap 15",
                             15, phd_mark, alt=False))
        story.append(kpi_row(9, "Resource person for Executive development / FDP / Guest lecture",
                             "Outside KPRIET – 2 pts. per hour\nInside KPRIET – 1 pt. per hour  cap 15",
                             15, res_mark, alt=True))
        story.append(kpi_row(10, "Convener / Coordinator for self-supporting program",
                             "10 pts. per day (Physical)\n5 pt. / program committee member",
                             20, 0, alt=False))
        story.append(total_row("Research Total:", int(res_t), 450))
        story.append(_sp(2))
        story.append(total_row("GRAND TOTAL:", grand_t, 500, is_grand=True))

    # ══════════════════════════════════════════════════════════════════════════
    #  HOD / PE / NTP / NTL — simplified summary table
    # ══════════════════════════════════════════════════════════════════════════
    else:
        section_totals = doc.get("section_totals") or {}
        if isinstance(section_totals, str):
            try:
                section_totals = json.loads(section_totals)
            except Exception:
                section_totals = {}

        def _sct(k):
            return int(_to_float(section_totals.get(k) or 0))

        if rank_type == "HOD":
            story.append(make_header("HOD / PG Coordinator"))
        elif rank_type == "PE":
            story.append(make_header("Physical Education"))
        elif rank_type == "NTP":
            story.append(make_header("Non-Teaching Staff (PO & JA)"))
        elif rank_type == "NTL":
            story.append(make_header("Non-Teaching Staff (Laboratory)"))
        else:
            story.append(make_header(rank))

        story.append(_sp(2))
        story.append(make_info_bar())
        story.append(_sp(3))

        grand_v = sum([_sct(k) for k in ("academic","research","admin","outreach","self")])
        for sec_lbl, sec_key, sec_max in [
            ("Academic / Section A", "academic", 150),
            ("Research / Section B", "research", 150),
            ("Administration / Section C", "admin", 50),
            ("Outreach / Section D", "outreach", 50),
            ("Self Development / Section E", "self", 100),
        ]:
            story.append(section_header_row(sec_lbl, sec_max))
            story.append(kpi_row("—", f"Total for {sec_lbl}",
                                 "Refer to detailed submission form", sec_max, _sct(sec_key)))
        story.append(total_row("GRAND TOTAL:", grand_v or _extract_score(doc), 500, is_grand=True))

    # ── Additional weightage / AI Feedback ────────────────────────────────
    story.append(_sp(3))
    add_wt_row = [[
        Paragraph("Additional weightage (if any) – evaluated by the Principal", S_KPI_B),
        Paragraph(""), Paragraph(""), Paragraph(""), Paragraph(""),
    ]]
    add_wt_tbl = Table(add_wt_row, colWidths=COL_W)
    add_wt_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor("#FFF9C4")),
        ("SPAN",          (0, 0), (-1, 0)),
        ("GRID",          (0, 0), (-1, -1), 0.4, C_GRID),
        ("BOX",           (0, 0), (-1, -1), 0.8, C_DARK_BLUE),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
    ]))
    story.append(add_wt_tbl)

    # AI Feedback
    ai_fb = doc.get("ai_feedback")
    if ai_fb:
        story.append(_sp(3))
        fb_hdr = Table([[Paragraph("AI-Generated Feedback", S_SEC_HDR)]], colWidths=[PW])
        fb_hdr.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), C_SEC_HEAD),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("BOX", (0, 0), (-1, -1), 0.8, C_DARK_BLUE),
        ]))
        story.append(fb_hdr)
        fb_body = Table([[Paragraph(str(ai_fb), S_AI_FB)]], colWidths=[PW])
        fb_body.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor("#FFF8E1")),
            ("BOX",           (0, 0), (-1, -1), 0.6, C_GRID),
            ("TOPPADDING",    (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ]))
        story.append(fb_body)

    # Footer
    story.append(_sp(4))
    story.append(HRFlowable(width="100%", thickness=0.5,
                             color=colors.HexColor("#BBBBBB")))
    story.append(_sp(1))
    story.append(Paragraph(
        "Faculty KPI Evaluation System — KPRIET — Performance Appraisal & Development System — Confidential",
        S_FOOTER))

    doc_pdf.build(story, onFirstPage=page_number, onLaterPages=page_number)
    buf.seek(0)
    return buf.read()


# ══════════════════════════════════════════════════════════════════════════════
#  ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/", status_code=201)
async def create_submission(
    faculty_rank: str = Form(...),
    academic_year: str = Form(...),
    pass_percent: float = Form(...),
    student_feedback: float = Form(...),
    online_videos: int = Form(...),
    sdg_activities: int = Form(...),
    vac_hours: int = Form(...),
    publications: int = Form(...),
    citations: int = Form(...),
    consultancy_revenue: float = Form(0.0),
    sponsored_grants_count: int = Form(0),
    sponsored_grants_amount: float = Form(0.0),
    research_visits: int = Form(0),
    memberships_count: int = Form(0),
    fdp_days_phys: float = Form(0.0),
    fdp_days_online: float = Form(0.0),
    mooc_4w: int = Form(0),
    mandatory_courses: int = Form(0),
    convener_days: int = Form(0),
    convener_online_days: int = Form(0),
    guest_hours: int = Form(0),
    committee_events: int = Form(0),
    conferences_organized: int = Form(0),
    events_a: int = Form(0),
    events_b: int = Form(0),
    events_c: int = Form(0),
    head_count: int = Form(0),
    member_count: int = Form(0),
    dept_responsibilities: int = Form(0),
    outreach_activities: int = Form(0),
    resource_person_hours: int = Form(0),
    resource_outside_hours: int = Form(0),
    resource_inside_hours: int = Form(0),
    training_days: int = Form(0),
    awards_count: int = Form(0),
    editorial_count: int = Form(0),
    reviews_count: int = Form(0),
    section_totals_json: str = Form(None),
    rubric_variant: Optional[str] = Form(None),
    ese_courses:          Optional[str] = Form(None),
    feedback_courses:     Optional[str] = Form(None),
    video_rows:           Optional[str] = Form(None),
    sdg_rows:             Optional[str] = Form(None),
    vac_rows:             Optional[str] = Form(None),
    achievement_rows:     Optional[str] = Form(None),
    symp_pub_rows:        Optional[str] = Form(None),
    pub_rows:             Optional[str] = Form(None),
    patent_rows:          Optional[str] = Form(None),
    citation_rows:        Optional[str] = Form(None),
    kpriet_citation_rows: Optional[str] = Form(None),
    consultancy_rows:     Optional[str] = Form(None),
    grant_rows:           Optional[str] = Form(None),
    visit_rows:           Optional[str] = Form(None),
    phd_rows:             Optional[str] = Form(None),
    internship_rows:      Optional[str] = Form(None),
    mou_rows:             Optional[str] = Form(None),
    membership_rows:      Optional[str] = Form(None),
    fdp_rows:             Optional[str] = Form(None),
    mandatory_rows:       Optional[str] = Form(None),
    event_rows:           Optional[str] = Form(None),
    resp_rows:            Optional[str] = Form(None),
    community_rows:       Optional[str] = Form(None),
    resource_rows:        Optional[str] = Form(None),
    training_rows:        Optional[str] = Form(None),
    award_rows:           Optional[str] = Form(None),
    recognition_rows:     Optional[str] = Form(None),
    hod_scalars_json:     Optional[str] = Form(None),
    cfrd_scalars_json:    Optional[str] = Form(None),
    pe_scalars_json:      Optional[str] = Form(None),
    ntp_scalars_json:     Optional[str] = Form(None),
    ntl_scalars_json:     Optional[str] = Form(None),
    proof: UploadFile = File(None),
    proof_row_1:  UploadFile = File(None),
    proof_row_2:  UploadFile = File(None),
    proof_row_3:  UploadFile = File(None),
    proof_row_4:  UploadFile = File(None),
    proof_row_5:  UploadFile = File(None),
    proof_row_6:  UploadFile = File(None),
    proof_row_7:  UploadFile = File(None),
    proof_row_8:  UploadFile = File(None),
    proof_row_9:  UploadFile = File(None),
    proof_row_10: UploadFile = File(None),
    proof_row_11: UploadFile = File(None),
    proof_row_12: UploadFile = File(None),
    proof_row_13: UploadFile = File(None),
    proof_row_14: UploadFile = File(None),
    proof_row_15: UploadFile = File(None),
    proof_row_16: UploadFile = File(None),
    proof_row_17: UploadFile = File(None),
    proof_row_18: UploadFile = File(None),
    proof_row_19: UploadFile = File(None),
    proof_row_20: UploadFile = File(None),
    proof_row_21: UploadFile = File(None),
    proof_row_22: UploadFile = File(None),
    proof_row_23: UploadFile = File(None),
    current_user: dict = Depends(get_current_user),
):
    def _parse_rows(raw: Optional[str]) -> list:
        try:
            return json.loads(raw) if raw else []
        except Exception:
            return []

    def _parse_scalars(raw: Optional[str]) -> dict:
        try:
            return json.loads(raw) if raw else {}
        except Exception:
            return {}

    file_meta = None
    if proof and proof.filename:
        ts = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
        sname = f"{ts}_{proof.filename}"
        out_path = os.path.join(UPLOAD_DIR, sname)
        with open(out_path, "wb") as fh:
            fh.write(await proof.read())
        file_meta = {
            "original_filename": proof.filename,
            "stored_path":       out_path,
            "stored_filename":   sname,
            "content_type":      proof.content_type,
            "uploaded_at":       datetime.utcnow(),
        }

    row_proofs: dict = {}
    for idx, file in enumerate([
        proof_row_1,  proof_row_2,  proof_row_3,  proof_row_4,  proof_row_5,
        proof_row_6,  proof_row_7,  proof_row_8,  proof_row_9,  proof_row_10,
        proof_row_11, proof_row_12, proof_row_13, proof_row_14, proof_row_15,
        proof_row_16, proof_row_17, proof_row_18, proof_row_19, proof_row_20,
        proof_row_21, proof_row_22, proof_row_23,
    ], start=1):
        if file and file.filename:
            ts = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
            sname = f"{ts}_{file.filename}"
            out_path = os.path.join(UPLOAD_DIR, sname)
            with open(out_path, "wb") as fh:
                fh.write(await file.read())
            row_proofs[f"proof_row_{idx}"] = [{
                "original_filename": file.filename,
                "stored_path":       out_path,
                "stored_filename":   sname,
                "content_type":      file.content_type,
                "uploaded_at":       datetime.utcnow(),
            }]

    department = current_user.get("department")

    submission: dict = {
        "faculty_user_id": current_user["id"],
        "faculty_rank":    faculty_rank,
        "academic_year":   academic_year,
        "department":      department,
        **row_proofs,
        "academic": {
            "pass_percent":      pass_percent,
            "student_feedback":  student_feedback,
            "online_videos":     online_videos,
            "sdg_activities":    sdg_activities,
            "vac_hours":         vac_hours,
        },
        "research": {
            "publications":            publications,
            "citations":               citations,
            "consultancy_revenue":     consultancy_revenue,
            "sponsored_grants_count":  sponsored_grants_count,
            "sponsored_grants_amount": sponsored_grants_amount,
            "research_visits":         research_visits,
            "memberships_count":       memberships_count,
            "fdp_days_phys":           fdp_days_phys,
            "fdp_days_online":         fdp_days_online,
            "mooc_4w":                 mooc_4w,
            "mandatory_courses":       mandatory_courses,
        },
        "administration": {
            "convener_days":         convener_days,
            "convener_online_days":  convener_online_days,
            "guest_hours":           guest_hours,
            "committee_events":      committee_events,
            "conferences_organized": conferences_organized,
            "events_a":              events_a,
            "events_b":              events_b,
            "events_c":              events_c,
            "head_count":            head_count,
            "member_count":          member_count,
            "dept_responsibilities": dept_responsibilities,
        },
        "outreach": {
            "outreach_activities":    outreach_activities,
            "resource_person_hours":  resource_person_hours,
            "resource_outside_hours": resource_outside_hours,
            "resource_inside_hours":  resource_inside_hours,
            "training_days":          training_days,
            "awards_count":           awards_count,
            "editorial_count":        editorial_count,
            "reviews_count":          reviews_count,
        },
        "ese_courses":          _parse_rows(ese_courses),
        "feedback_courses":     _parse_rows(feedback_courses),
        "video_rows":           _parse_rows(video_rows),
        "sdg_rows":             _parse_rows(sdg_rows),
        "vac_rows":             _parse_rows(vac_rows),
        "achievement_rows":     _parse_rows(achievement_rows),
        "symp_pub_rows":        _parse_rows(symp_pub_rows),
        "pub_rows":             _parse_rows(pub_rows),
        "patent_rows":          _parse_rows(patent_rows),
        "citation_rows":        _parse_rows(citation_rows),
        "kpriet_citation_rows": _parse_rows(kpriet_citation_rows),
        "consultancy_rows":     _parse_rows(consultancy_rows),
        "grant_rows":           _parse_rows(grant_rows),
        "visit_rows":           _parse_rows(visit_rows),
        "phd_rows":             _parse_rows(phd_rows),
        "internship_rows":      _parse_rows(internship_rows),
        "mou_rows":             _parse_rows(mou_rows),
        "membership_rows":      _parse_rows(membership_rows),
        "fdp_rows":             _parse_rows(fdp_rows),
        "mandatory_rows":       _parse_rows(mandatory_rows),
        "event_rows":           _parse_rows(event_rows),
        "resp_rows":            _parse_rows(resp_rows),
        "community_rows":       _parse_rows(community_rows),
        "resource_rows":        _parse_rows(resource_rows),
        "training_rows":        _parse_rows(training_rows),
        "award_rows":           _parse_rows(award_rows),
        "recognition_rows":     _parse_rows(recognition_rows),
        "hod_scalars":          _parse_scalars(hod_scalars_json),
        "cfrd_scalars":         _parse_scalars(cfrd_scalars_json),
        "pe_scalars":           _parse_scalars(pe_scalars_json),
        "ntp_scalars":          _parse_scalars(ntp_scalars_json),
        "ntl_scalars":          _parse_scalars(ntl_scalars_json),
        "file_meta":           file_meta,
        "section_totals_json": section_totals_json,
        "rubric_variant":      rubric_variant,
        "status":              "submitted",
        "created_at":          datetime.utcnow(),
    }

    try:
        scored = ai_service.score_submission(submission)
        submission["score"]          = scored.get("score")
        submission["section_totals"] = scored.get("section_totals")
        submission["ai_feedback"]    = scored.get("ai_feedback")
        submission["score_debug"]    = scored.get("debug")
        submission["scored_at"]      = scored.get("scored_at")
    except Exception as exc:
        print("ai_service scoring error:", exc)
        traceback.print_exc()

    res = await db.submissions.insert_one(submission)
    return {"submission_id": str(res.inserted_id)}


# ── /stats must come BEFORE /{submission_id} ──────────────────────────────────

@router.get("/stats", status_code=200)
async def submissions_stats(current_user: dict = Depends(get_current_user)):
    try:
        q: Dict[str, Any] = {}
        role = (current_user.get("role") or "").lower()
        if is_higher_role(current_user):
            q = {}
        elif role == "hod":
            dept = current_user.get("department")
            q = {"department": dept} if dept else {}
        else:
            q = {"faculty_user_id": current_user["id"]}

        total    = await db.submissions.count_documents(q)
        pending  = await db.submissions.count_documents({**q, "status": {"$in": ["submitted", "pending"]}})
        approved = await db.submissions.count_documents({**q, "status": {"$in": ["verified", "finalized", "approved"]}})

        avg_score = None
        try:
            pipeline = [
                {"$match": q},
                {"$project": {"numericScore": {
                    "$cond": [
                        {"$isNumber": "$score.total"}, "$score.total",
                        {"$cond": [{"$isNumber": "$score"}, "$score", None]},
                    ]
                }}},
                {"$match": {"numericScore": {"$ne": None}}},
                {"$group": {"_id": None, "avg": {"$avg": "$numericScore"}}},
            ]
            res = await db.submissions.aggregate(pipeline).to_list(length=1)
            if res:
                avg_score = round(float(res[0]["avg"]), 2)
        except Exception as agg_err:
            print("stats aggregation error:", agg_err)

        return {
            "total_submissions": int(total),
            "avg_score":         avg_score,
            "pending_reviews":   int(pending),
            "approved":          int(approved),
        }
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Unable to compute stats")


@router.get("/", status_code=200)
async def list_submissions(
    status: Optional[str] = None,
    faculty_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    q: dict = {}
    if status:
        q["status"] = status

    role = (current_user.get("role") or "").lower()
    if is_higher_role(current_user):
        if faculty_id:
            q["faculty_user_id"] = faculty_id
    elif role == "hod":
        dept = current_user.get("department")
        if dept:
            q["department"] = dept
        if faculty_id:
            q["faculty_user_id"] = faculty_id
    else:
        q["faculty_user_id"] = current_user["id"]

    cursor = db.submissions.find(q).sort("created_at", -1)
    items: list = []
    async for doc in cursor:
        safe = sanitize_doc(doc)
        if safe.get("file_meta") and safe["file_meta"].get("stored_filename"):
            safe["file_meta"]["download_url"] = f"/uploads/{safe['file_meta']['stored_filename']}"
        for i in range(1, 24):
            key = f"proof_row_{i}"
            if safe.get(key):
                for f in safe[key]:
                    if f.get("stored_filename"):
                        f["download_url"] = f"/uploads/{f['stored_filename']}"
        for key in ALL_TABLE_ROW_KEYS:
            safe.setdefault(key, [])
        items.append(safe)

    return {"count": len(items), "submissions": items}


# ── PDF download — must come BEFORE /{submission_id} ──────────────────────────

@router.get("/{submission_id}/kpi-pdf")
async def download_kpi_pdf(
    submission_id: str = Path(..., pattern=r"^[0-9a-fA-F]{24}$"),
    current_user: dict = Depends(get_current_user),
):
    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid submission ID")

    doc = await db.submissions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Submission not found")

    role        = (current_user.get("role") or "").lower()
    is_owner    = str(doc.get("faculty_user_id")) == str(current_user.get("id"))
    is_hod      = (role == "hod" and current_user.get("department") == doc.get("department"))
    is_elevated = is_higher_role(current_user)

    if not (is_owner or is_hod or is_elevated):
        raise HTTPException(status_code=403, detail="Not authorized")

    faculty_name = doc.get("faculty_name") or doc.get("name") or "Faculty"
    try:
        uid = doc.get("faculty_user_id")
        if uid:
            u = await db.users.find_one({"_id": ObjectId(str(uid))})
            if u:
                faculty_name = u.get("name") or u.get("full_name") or faculty_name
    except Exception:
        pass

    pdf_bytes = _generate_kpi_pdf(doc, faculty_name)

    fname = "PADS_KPI_{}_{}_{}.pdf".format(
        faculty_name.replace(" ", "_"),
        (doc.get("academic_year") or "").replace("/", "-"),
        submission_id[-6:],
    )
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.get("/{submission_id}", status_code=200)
async def get_submission(
    submission_id: str = Path(..., pattern=r"^[0-9a-fA-F]{24}$"),
    current_user: dict = Depends(get_current_user),
):
    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid submission ID: {submission_id}")

    doc = await db.submissions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Submission not found")

    safe = sanitize_doc(doc)

    if safe.get("file_meta") and safe["file_meta"].get("stored_filename"):
        safe["file_meta"]["download_url"] = f"/uploads/{safe['file_meta']['stored_filename']}"

    for i in range(1, 24):
        key = f"proof_row_{i}"
        if safe.get(key):
            for f in safe[key]:
                if f.get("stored_filename"):
                    f["download_url"] = f"/uploads/{f['stored_filename']}"

    for key in ALL_TABLE_ROW_KEYS:
        safe.setdefault(key, [])

    return safe


@router.patch("/{submission_id}", status_code=200)
async def update_submission(
    submission_id: str = Path(..., pattern=r"^[0-9a-fA-F]{24}$"),
    faculty_rank: str = Form(...),
    academic_year: str = Form(...),
    pass_percent: float = Form(...),
    student_feedback: float = Form(...),
    online_videos: int = Form(...),
    sdg_activities: int = Form(...),
    vac_hours: int = Form(...),
    publications: int = Form(...),
    citations: int = Form(...),
    consultancy_revenue: float = Form(0.0),
    sponsored_grants_count: int = Form(0),
    sponsored_grants_amount: float = Form(0.0),
    research_visits: int = Form(0),
    memberships_count: int = Form(0),
    fdp_days_phys: float = Form(0.0),
    fdp_days_online: float = Form(0.0),
    mooc_4w: int = Form(0),
    mandatory_courses: int = Form(0),
    convener_days: int = Form(0),
    convener_online_days: int = Form(0),
    guest_hours: int = Form(0),
    committee_events: int = Form(0),
    conferences_organized: int = Form(0),
    events_a: int = Form(0),
    events_b: int = Form(0),
    events_c: int = Form(0),
    head_count: int = Form(0),
    member_count: int = Form(0),
    dept_responsibilities: int = Form(0),
    outreach_activities: int = Form(0),
    resource_person_hours: int = Form(0),
    resource_outside_hours: int = Form(0),
    resource_inside_hours: int = Form(0),
    training_days: int = Form(0),
    awards_count: int = Form(0),
    editorial_count: int = Form(0),
    reviews_count: int = Form(0),
    section_totals_json: str = Form(None),
    rubric_variant: Optional[str] = Form(None),
    ese_courses:          Optional[str] = Form(None),
    feedback_courses:     Optional[str] = Form(None),
    video_rows:           Optional[str] = Form(None),
    sdg_rows:             Optional[str] = Form(None),
    vac_rows:             Optional[str] = Form(None),
    achievement_rows:     Optional[str] = Form(None),
    symp_pub_rows:        Optional[str] = Form(None),
    pub_rows:             Optional[str] = Form(None),
    patent_rows:          Optional[str] = Form(None),
    citation_rows:        Optional[str] = Form(None),
    kpriet_citation_rows: Optional[str] = Form(None),
    consultancy_rows:     Optional[str] = Form(None),
    grant_rows:           Optional[str] = Form(None),
    visit_rows:           Optional[str] = Form(None),
    phd_rows:             Optional[str] = Form(None),
    internship_rows:      Optional[str] = Form(None),
    mou_rows:             Optional[str] = Form(None),
    membership_rows:      Optional[str] = Form(None),
    fdp_rows:             Optional[str] = Form(None),
    mandatory_rows:       Optional[str] = Form(None),
    event_rows:           Optional[str] = Form(None),
    resp_rows:            Optional[str] = Form(None),
    community_rows:       Optional[str] = Form(None),
    resource_rows:        Optional[str] = Form(None),
    training_rows:        Optional[str] = Form(None),
    award_rows:           Optional[str] = Form(None),
    recognition_rows:     Optional[str] = Form(None),
    hod_scalars_json:     Optional[str] = Form(None),
    cfrd_scalars_json:    Optional[str] = Form(None),
    pe_scalars_json:      Optional[str] = Form(None),
    ntp_scalars_json:     Optional[str] = Form(None),
    ntl_scalars_json:     Optional[str] = Form(None),
    proof: UploadFile = File(None),
    proof_row_1:  UploadFile = File(None),
    proof_row_2:  UploadFile = File(None),
    proof_row_3:  UploadFile = File(None),
    proof_row_4:  UploadFile = File(None),
    proof_row_5:  UploadFile = File(None),
    proof_row_6:  UploadFile = File(None),
    proof_row_7:  UploadFile = File(None),
    proof_row_8:  UploadFile = File(None),
    proof_row_9:  UploadFile = File(None),
    proof_row_10: UploadFile = File(None),
    proof_row_11: UploadFile = File(None),
    proof_row_12: UploadFile = File(None),
    proof_row_13: UploadFile = File(None),
    proof_row_14: UploadFile = File(None),
    proof_row_15: UploadFile = File(None),
    proof_row_16: UploadFile = File(None),
    proof_row_17: UploadFile = File(None),
    proof_row_18: UploadFile = File(None),
    proof_row_19: UploadFile = File(None),
    proof_row_20: UploadFile = File(None),
    proof_row_21: UploadFile = File(None),
    proof_row_22: UploadFile = File(None),
    proof_row_23: UploadFile = File(None),
    current_user: dict = Depends(get_current_user),
):
    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid submission ID: {submission_id}")

    doc = await db.submissions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Submission not found")

    is_owner    = str(doc.get("faculty_user_id")) == str(current_user.get("id"))
    is_elevated = is_higher_role(current_user) or (current_user.get("role") or "").lower() == "hod"
    if not (is_owner or is_elevated):
        raise HTTPException(status_code=403, detail="Not authorized to update this submission")

    if str(doc.get("status", "")).lower() in ("rejected", "finalized"):
        raise HTTPException(status_code=400, detail="Cannot edit a rejected or finalized submission")

    def _parse_rows(raw: Optional[str]) -> list:
        try:
            return json.loads(raw) if raw else []
        except Exception:
            return []

    def _parse_scalars(raw: Optional[str]) -> dict:
        try:
            return json.loads(raw) if raw else {}
        except Exception:
            return {}

    file_meta = doc.get("file_meta")
    if proof and proof.filename:
        ts = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
        sname = f"{ts}_{proof.filename}"
        out_path = os.path.join(UPLOAD_DIR, sname)
        with open(out_path, "wb") as fh:
            fh.write(await proof.read())
        file_meta = {
            "original_filename": proof.filename,
            "stored_path":       out_path,
            "stored_filename":   sname,
            "content_type":      proof.content_type,
            "uploaded_at":       datetime.utcnow(),
        }

    row_proofs: dict = {}
    for idx, file in enumerate([
        proof_row_1,  proof_row_2,  proof_row_3,  proof_row_4,  proof_row_5,
        proof_row_6,  proof_row_7,  proof_row_8,  proof_row_9,  proof_row_10,
        proof_row_11, proof_row_12, proof_row_13, proof_row_14, proof_row_15,
        proof_row_16, proof_row_17, proof_row_18, proof_row_19, proof_row_20,
        proof_row_21, proof_row_22, proof_row_23,
    ], start=1):
        key = f"proof_row_{idx}"
        existing = doc.get(key, [])
        if file and file.filename:
            ts = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
            sname = f"{ts}_{file.filename}"
            out_path = os.path.join(UPLOAD_DIR, sname)
            with open(out_path, "wb") as fh:
                fh.write(await file.read())
            row_proofs[key] = (existing or []) + [{
                "original_filename": file.filename,
                "stored_path":       out_path,
                "stored_filename":   sname,
                "content_type":      file.content_type,
                "uploaded_at":       datetime.utcnow(),
            }]
        elif existing:
            row_proofs[key] = existing

    update_fields: dict = {
        "faculty_rank":  faculty_rank,
        "academic_year": academic_year,
        **row_proofs,
        "academic": {
            "pass_percent":     pass_percent,
            "student_feedback": student_feedback,
            "online_videos":    online_videos,
            "sdg_activities":   sdg_activities,
            "vac_hours":        vac_hours,
        },
        "research": {
            "publications":            publications,
            "citations":               citations,
            "consultancy_revenue":     consultancy_revenue,
            "sponsored_grants_count":  sponsored_grants_count,
            "sponsored_grants_amount": sponsored_grants_amount,
            "research_visits":         research_visits,
            "memberships_count":       memberships_count,
            "fdp_days_phys":           fdp_days_phys,
            "fdp_days_online":         fdp_days_online,
            "mooc_4w":                 mooc_4w,
            "mandatory_courses":       mandatory_courses,
        },
        "administration": {
            "convener_days":         convener_days,
            "convener_online_days":  convener_online_days,
            "guest_hours":           guest_hours,
            "committee_events":      committee_events,
            "conferences_organized": conferences_organized,
            "events_a":              events_a,
            "events_b":              events_b,
            "events_c":              events_c,
            "head_count":            head_count,
            "member_count":          member_count,
            "dept_responsibilities": dept_responsibilities,
        },
        "outreach": {
            "outreach_activities":    outreach_activities,
            "resource_person_hours":  resource_person_hours,
            "resource_outside_hours": resource_outside_hours,
            "resource_inside_hours":  resource_inside_hours,
            "training_days":          training_days,
            "awards_count":           awards_count,
            "editorial_count":        editorial_count,
            "reviews_count":          reviews_count,
        },
        "ese_courses":          _parse_rows(ese_courses),
        "feedback_courses":     _parse_rows(feedback_courses),
        "video_rows":           _parse_rows(video_rows),
        "sdg_rows":             _parse_rows(sdg_rows),
        "vac_rows":             _parse_rows(vac_rows),
        "achievement_rows":     _parse_rows(achievement_rows),
        "symp_pub_rows":        _parse_rows(symp_pub_rows),
        "pub_rows":             _parse_rows(pub_rows),
        "patent_rows":          _parse_rows(patent_rows),
        "citation_rows":        _parse_rows(citation_rows),
        "kpriet_citation_rows": _parse_rows(kpriet_citation_rows),
        "consultancy_rows":     _parse_rows(consultancy_rows),
        "grant_rows":           _parse_rows(grant_rows),
        "visit_rows":           _parse_rows(visit_rows),
        "phd_rows":             _parse_rows(phd_rows),
        "internship_rows":      _parse_rows(internship_rows),
        "mou_rows":             _parse_rows(mou_rows),
        "membership_rows":      _parse_rows(membership_rows),
        "fdp_rows":             _parse_rows(fdp_rows),
        "mandatory_rows":       _parse_rows(mandatory_rows),
        "event_rows":           _parse_rows(event_rows),
        "resp_rows":            _parse_rows(resp_rows),
        "community_rows":       _parse_rows(community_rows),
        "resource_rows":        _parse_rows(resource_rows),
        "training_rows":        _parse_rows(training_rows),
        "award_rows":           _parse_rows(award_rows),
        "recognition_rows":     _parse_rows(recognition_rows),
        "hod_scalars":          _parse_scalars(hod_scalars_json),
        "cfrd_scalars":         _parse_scalars(cfrd_scalars_json),
        "pe_scalars":           _parse_scalars(pe_scalars_json),
        "ntp_scalars":          _parse_scalars(ntp_scalars_json),
        "ntl_scalars":          _parse_scalars(ntl_scalars_json),
        "file_meta":            file_meta,
        "section_totals_json":  section_totals_json,
        "rubric_variant":       rubric_variant,
        "status":               "submitted",
        "updated_at":           datetime.utcnow(),
    }

    try:
        scored = ai_service.score_submission({**doc, **update_fields})
        update_fields["score"]          = scored.get("score")
        update_fields["section_totals"] = scored.get("section_totals")
        update_fields["ai_feedback"]    = scored.get("ai_feedback")
        update_fields["score_debug"]    = scored.get("debug")
        update_fields["scored_at"]      = scored.get("scored_at")
    except Exception as exc:
        print("ai_service scoring error on update:", exc)
        traceback.print_exc()

    await db.submissions.update_one({"_id": oid}, {"$set": update_fields})
    return {"submission_id": submission_id, "message": "updated"}


@router.delete("/{submission_id}", status_code=200)
async def delete_submission(
    submission_id: str = Path(..., pattern=r"^[0-9a-fA-F]{24}$"),
    current_user: dict = Depends(get_current_user),
):
    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid submission ID: {submission_id}")

    doc = await db.submissions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Submission not found")

    role        = (current_user.get("role") or "").lower()
    is_owner    = str(doc.get("faculty_user_id")) == str(current_user.get("id"))
    is_elevated = is_higher_role(current_user) or role == "hod"
    st          = (doc.get("status") or "").lower()

    if st == "finalized":
        raise HTTPException(status_code=400, detail="Cannot delete a finalized submission.")

    if not is_elevated:
        if not is_owner:
            raise HTTPException(status_code=403, detail="Not authorized to delete this submission.")
        if st not in ("submitted", "rejected", ""):
            raise HTTPException(
                status_code=400,
                detail="You can only delete submissions that are in 'submitted' or 'rejected' status.",
            )

    result = await db.submissions.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Submission not found or already deleted.")

    return {"message": "deleted", "submission_id": submission_id}


@router.patch("/{submission_id}/verify", status_code=200)
async def verify_submission(
    submission_id: str = Path(..., pattern=r"^[0-9a-fA-F]{24}$"),
    action: str = Form(...),
    comments: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    role = (current_user.get("role") or "").lower()
    if role not in ("hod", "director", "registrar", "office_head", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to verify")

    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid submission ID: {submission_id}")

    doc = await db.submissions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Submission not found")

    new_status = "verified" if action == "approve" else "rejected"
    update = {"$set": {
        "status": new_status,
        "verified_by": {
            "id":         current_user["id"],
            "name":       current_user.get("name"),
            "role":       current_user.get("role"),
            "department": current_user.get("department"),
        },
        "verified_at":           datetime.utcnow(),
        "verification_comments": comments,
    }}

    res = await db.submissions.update_one({"_id": oid}, update)
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Submission not found")

    return {"message": "ok", "submission_id": submission_id, "status": new_status}
