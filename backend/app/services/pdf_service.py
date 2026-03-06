from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
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

    # Add title
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(100, 750, "KPI Submission Report")

    # Add submission details
    pdf.setFont("Helvetica", 12)
    pdf.drawString(50, 720, f"Faculty: {submission.get('faculty_user_id')}")
    pdf.drawString(50, 700, f"Rank: {submission.get('faculty_rank')}")
    pdf.drawString(50, 680, f"Academic Year: {submission.get('academic_year')}")
    pdf.drawString(50, 660, f"Department: {submission.get('department')}")

    # Add table header
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(50, 630, "Activity")
    pdf.drawString(250, 630, "Rubric")
    pdf.drawString(400, 630, "Max")

    # Add table rows
    pdf.setFont("Helvetica", 12)
    y = 610
    for section, data in submission.items():
        if isinstance(data, dict):
            for key, value in data.items():
                pdf.drawString(50, y, key)
                pdf.drawString(250, y, str(value))
                pdf.drawString(400, y, "N/A")  # Replace with actual max value if available
                y -= 20
                if y < 50:  # Add a new page if content exceeds the page
                    pdf.showPage()
                    pdf.setFont("Helvetica", 12)
                    y = 750

    # Save the PDF
    pdf.save()
    buffer.seek(0)
    return buffer
