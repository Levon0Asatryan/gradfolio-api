from pathlib import Path
import re
import sys
from xml.sax.saxutils import escape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

root = Path(__file__).resolve().parents[4]
language = sys.argv[1] if len(sys.argv) > 1 else 'hy'
if language not in ('hy', 'en'):
    raise ValueError('Expected report language hy or en')
source = root / f'gradfolio-api/docs/qa/final-report-{language}-2026-10-17.md'
output = root / f'output/pdf/gradfolio-qa-final-{language}-2026-10-17.pdf'
output.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('QA', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('QA-Bold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('QA', normal='QA', bold='QA-Bold', italic='QA', boldItalic='QA-Bold')
body = ParagraphStyle('Body', fontName='QA', fontSize=10, leading=15, spaceAfter=7)
heading = ParagraphStyle('Heading', parent=body, fontName='QA-Bold', fontSize=13, leading=18,
                         spaceBefore=13, spaceAfter=8, keepWithNext=False)
subheading = ParagraphStyle('Subheading', parent=heading, fontSize=11, leading=16, spaceBefore=9, keepWithNext=True)
title = ParagraphStyle('Title', parent=heading, fontSize=20, leading=27, spaceBefore=0, spaceAfter=13)
cell = ParagraphStyle('Cell', parent=body, fontSize=8.7, leading=12, spaceAfter=0)
header = ParagraphStyle('Header', parent=cell, fontName='QA-Bold', textColor=colors.white)

def inline(text):
    text = escape(text.replace('\u2024', '.'))
    def link(match):
        label, url = match.groups()
        return f'<link href="{url}" color="#1D4ED8">{label}</link>' if url.startswith('https://') else label
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link, text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    return re.sub(r'`([^`]+)`', r'\1', text)

story = []
lines = source.read_text(encoding='utf-8').splitlines()
i = 0
while i < len(lines):
    line = lines[i].strip()
    if not line:
        i += 1
        continue
    if line.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].strip().startswith('|'):
            row = [part.strip() for part in lines[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r':?-+:?', part) for part in row):
                rows.append(row)
            i += 1
        count = len(rows[0])
        widths = [120, 375] if count == 2 else [155, 185, 155]
        table = Table([[Paragraph(inline(value), header if n == 0 else cell) for value in row]
                       for n, row in enumerate(rows)], colWidths=widths, repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#243B53')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F3F6F8')]),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D9D9D9')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]))
        story.extend([table, Spacer(1, 9)])
        continue
    if line.startswith('# '):
        story.append(Paragraph(inline(line[2:]), title))
    elif line.startswith('## '):
        story.append(Paragraph(inline(line[3:]), heading))
    elif line.startswith('### '):
        story.append(Paragraph(inline(line[4:]), subheading))
    else:
        story.append(Paragraph(inline(line), body))
    i += 1

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('QA', 8)
    canvas.setFillColor(colors.HexColor('#607080'))
    canvas.drawString(50, 27, 'Gradfolio QA | 2026-10-17')
    canvas.drawRightString(A4[0] - 50, 27, str(doc.page))
    canvas.restoreState()

doc = SimpleDocTemplate(str(output), pagesize=A4, leftMargin=50, rightMargin=50,
                        topMargin=44, bottomMargin=44, title='Gradfolio QA 2026-10-17',
                        author='Gradfolio QA')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(output)
