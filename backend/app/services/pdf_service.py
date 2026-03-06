from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from io import BytesIO


def generate_kpi_pdf(submission: dict) -> BytesIO:
    """
    Generate a PDF for the KPI submission report.
    :param submission: The submission data to include in the PDF.
    :return: A BytesIO object containing the PDF data.
    """
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    pdf.setTitle("KPI Submission Report")
    
    width, height = letter
    y = height - 50
    
    # Helper function to add new page if needed
    def check_page(y_pos, space_needed=40):
        if y_pos < space_needed:
            pdf.showPage()
            return height - 50
        return y_pos
    
    # Helper to draw section header
    def draw_section_header(title, y_pos):
        y_pos = check_page(y_pos, 60)
        pdf.setFillColor(HexColor("#4A5568"))
        pdf.rect(40, y_pos - 5, width - 80, 25, fill=True, stroke=False)
        pdf.setFillColor(HexColor("#FFFFFF"))
        pdf.setFont("Helvetica-Bold", 14)
        pdf.drawString(50, y_pos + 5, title)
        pdf.setFillColor(HexColor("#000000"))
        return y_pos - 35
    
    # Helper to draw key-value pair
    def draw_field(label, value, y_pos, indent=50):
        y_pos = check_page(y_pos)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(indent, y_pos, f"{label}:")
        pdf.setFont("Helvetica", 10)
        pdf.drawString(indent + 150, y_pos, str(value))
        return y_pos - 15
    
    # Helper to draw table header
    def draw_table_header(headers, x_positions, y_pos):
        y_pos = check_page(y_pos, 50)
        pdf.setFillColor(HexColor("#E2E8F0"))
        pdf.rect(40, y_pos - 5, width - 80, 20, fill=True, stroke=True)
        pdf.setFillColor(HexColor("#000000"))
        pdf.setFont("Helvetica-Bold", 10)
        for header, x in zip(headers, x_positions):
            pdf.drawString(x, y_pos + 3, header)
        return y_pos - 25
    
    # Helper to draw table row
    def draw_table_row(values, x_positions, y_pos):
        y_pos = check_page(y_pos)
        pdf.setFont("Helvetica", 9)
        for value, x in zip(values, x_positions):
            pdf.drawString(x, y_pos, str(value))
        pdf.setStrokeColor(HexColor("#E2E8F0"))
        pdf.line(40, y_pos - 5, width - 40, y_pos - 5)
        pdf.setStrokeColor(HexColor("#000000"))
        return y_pos - 18
    
    # Title
    pdf.setFont("Helvetica-Bold", 20)
    pdf.setFillColor(HexColor("#2D3748"))
    pdf.drawString(50, y, "Faculty KPI Submission Report")
    y -= 40
    
    # Basic Information Section
    y = draw_section_header("Basic Information", y)
    y = draw_field("Faculty ID", submission.get('faculty_user_id', 'N/A'), y)
    y = draw_field("Faculty Name", submission.get('faculty_name', 'N/A'), y)
    y = draw_field("Rank", submission.get('faculty_rank', 'N/A'), y)
    y = draw_field("Academic Year", submission.get('academic_year', 'N/A'), y)
    y = draw_field("Department", submission.get('department', 'N/A'), y)
    y = draw_field("Status", submission.get('status', 'N/A'), y)
    y -= 20
    
    # Overall Score Section
    score = submission.get('score', {})
    section_totals = submission.get('section_totals', {})
    if isinstance(score, dict):
        y = draw_section_header("Overall KPI Score Summary", y)
        total = score.get('total', 0)
        raw_500 = score.get('raw_500', 0)
        
        pdf.setFont("Helvetica-Bold", 12)
        y = check_page(y)
        pdf.drawString(50, y, f"Total Score: {total}% (Raw: {raw_500}/500)")
        y -= 25
        
        # Category breakdown - read from section_totals
        y = draw_field("Academic Performance", f"{section_totals.get('academic', 0)}/150", y)
        y = draw_field("Research & Development", f"{section_totals.get('research', 0)}/200", y)
        y = draw_field("Administration", f"{section_totals.get('administration', 0)}/50", y)
        y = draw_field("Outreach & Extension", f"{section_totals.get('outreach', 0)}/100", y)
        y -= 20
    
    # Academic Activities Section
    academic = submission.get('academic', {})
    score_debug = submission.get('score_debug', {})
    if isinstance(academic, dict):
        y = draw_section_header("Academic Activities", y)
        
        # Table for academic activities
        x_pos = [50, 300, 450]
        y = draw_table_header(["Activity", "Value", "Score"], x_pos, y)
        
        academic_breakdown = score_debug.get('academic', {}) if isinstance(score_debug, dict) else {}
        activities = [
            ("Pass Percentage", f"{academic.get('pass_percent', 0)}%", 
             academic_breakdown.get('pass_marks', 0)),
            ("Student Feedback", f"{academic.get('student_feedback', 0)}/5", 
             academic_breakdown.get('fb_marks', 0)),
            ("Online Videos", academic.get('online_videos', 0), 
             academic_breakdown.get('videos_marks', 0)),
            ("SDG Activities", academic.get('sdg_activities', 0), 
             academic_breakdown.get('sdg_marks', 0)),
            ("VAC Hours", academic.get('vac_hours', 0), 
             academic_breakdown.get('vac_marks', 0)),
        ]
        
        for activity, value, points in activities:
            y = draw_table_row([activity, value, f"{points} pts"], x_pos, y)
        y -= 20
    
    # Research Activities Section
    research = submission.get('research', {})
    if isinstance(research, dict):
        y = draw_section_header("Research & Development Activities", y)
        
        x_pos = [50, 300, 450]
        y = draw_table_header(["Activity", "Value", "Score"], x_pos, y)
        
        research_breakdown = score_debug.get('research', {}) if isinstance(score_debug, dict) else {}
        activities = [
            ("Publications", research.get('publications', 0), research_breakdown.get('pubs_marks', 0)),
            ("Citations", research.get('citations', 0), research_breakdown.get('citations_marks', 0)),
            ("Consultancy Revenue", f"₹{research.get('consultancy_revenue', 0)}", 
             research_breakdown.get('consultancy_marks', 0)),
            ("Sponsored Grants", f"{research.get('sponsored_grants_count', 0)} grants", 
             research_breakdown.get('sponsoredCombined', 0)),
            ("Research Visits", research.get('research_visits', 0), 
             research_breakdown.get('researchVisitsMarks', 0)),
            ("Memberships", research.get('memberships_count', 0), 
             research_breakdown.get('membershipsMarks', 0)),
            ("FDP Days (Physical)", research.get('fdp_days_phys', 0), 
             research_breakdown.get('fdpMarks', 0)),
            ("FDP Days (Online)", research.get('fdp_days_online', 0), "-"),
            ("MOOC (4-week)", research.get('mooc_4w', 0), "-"),
            ("Mandatory Courses", research.get('mandatory_courses', 0), 
             research_breakdown.get('mandatoryMarks', 0)),
        ]
        
        for activity, value, points in activities:
            y = draw_table_row([activity, value, f"{points} pts" if points != "-" else "-"], x_pos, y)
        y -= 20
    
    # Administration Activities Section
    administration = submission.get('administration', {})
    if isinstance(administration, dict):
        y = draw_section_header("Administration Activities", y)
        
        x_pos = [50, 300, 450]
        y = draw_table_header(["Activity", "Value", "Score"], x_pos, y)
        
        admin_breakdown = score_debug.get('administration', {}) if isinstance(score_debug, dict) else {}
        activities = [
            ("Convener Days", administration.get('convener_days', 0), 
             admin_breakdown.get('convener_marks', 0)),
            ("Convener Online Days", administration.get('convener_online_days', 0), "-"),
            ("Guest Lecture Hours", administration.get('guest_hours', 0), "-"),
            ("Committee Events", administration.get('committee_events', 0), 
             admin_breakdown.get('events_marks', 0)),
            ("Conferences Organized", administration.get('conferences_organized', 0), "-"),
            ("Events Category A", administration.get('events_a', 0), "-"),
            ("Events Category B", administration.get('events_b', 0), "-"),
            ("Events Category C", administration.get('events_c', 0), "-"),
            ("Head Count", administration.get('head_count', 0), "-"),
            ("Member Count", administration.get('member_count', 0), "-"),
            ("Dept Responsibilities", administration.get('dept_responsibilities', 0), 
             admin_breakdown.get('resp_marks', 0)),
        ]
        
        for activity, value, points in activities:
            y = draw_table_row([activity, value, f"{points} pts" if points != "-" else "-"], x_pos, y)
        y -= 20
    
    # Outreach Activities Section
    outreach = submission.get('outreach', {})
    if isinstance(outreach, dict):
        y = draw_section_header("Outreach & Extension Activities", y)
        
        x_pos = [50, 300, 450]
        y = draw_table_header(["Activity", "Value", "Score"], x_pos, y)
        
        outreach_breakdown = score_debug.get('outreach', {}) if isinstance(score_debug, dict) else {}
        activities = [
            ("Outreach Activities", outreach.get('outreach_activities', 0), 
             outreach_breakdown.get('communityMarks', 0)),
            ("Resource Person Hours", outreach.get('resource_person_hours', 0), 
             outreach_breakdown.get('resourceMarks', 0)),
            ("Resource Outside Hours", outreach.get('resource_outside_hours', 0), "-"),
            ("Resource Inside Hours", outreach.get('resource_inside_hours', 0), "-"),
            ("Training Days", outreach.get('training_days', 0), 
             outreach_breakdown.get('trainingMarks', 0)),
            ("Awards", outreach.get('awards_count', 0), 
             outreach_breakdown.get('awardsTotal', 0)),
            ("Editorial Boards", outreach.get('editorial_count', 0), "-"),
            ("Reviews", outreach.get('reviews_count', 0), "-"),
        ]
        
        for activity, value, points in activities:
            y = draw_table_row([activity, value, f"{points} pts" if points != "-" else "-"], x_pos, y)
        y -= 20
    
    # AI Feedback Section (if available)
    ai_feedback = submission.get('ai_feedback')
    if ai_feedback:
        y = draw_section_header("AI-Generated Feedback", y)
        pdf.setFont("Helvetica", 9)
        
        # Word wrap the feedback
        feedback_lines = []
        words = ai_feedback.split()
        current_line = ""
        for word in words:
            test_line = current_line + " " + word if current_line else word
            if pdf.stringWidth(test_line, "Helvetica", 9) < (width - 100):
                current_line = test_line
            else:
                feedback_lines.append(current_line)
                current_line = word
        if current_line:
            feedback_lines.append(current_line)
        
        for line in feedback_lines:
            y = check_page(y)
            pdf.drawString(50, y, line)
            y -= 12
        y -= 10
    
    # Footer
    y = check_page(y, 80)
    pdf.setFont("Helvetica-Oblique", 8)
    pdf.setFillColor(HexColor("#718096"))
    from datetime import datetime
    pdf.drawString(50, 30, f"Generated on: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    pdf.drawString(50, 20, "Faculty Evaluation System - Confidential Document")
    
    # Save the PDF
    pdf.save()
    buffer.seek(0)
    return buffer
