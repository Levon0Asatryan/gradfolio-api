# LinkedIn export: how a student gets the ZIP

Source of record for the wizard texts (T43) and the screenshots (queue M7-T7). Steps given by
Levon on 2026-11-01 from the live LinkedIn interface (English). Labels differ by interface
language; the screenshots per language (en/ru/am) are queue M7-T7.

## Steps

1. Open the page directly: <https://www.linkedin.com/mypreferences/d/download-my-data>.
   Or by hand: header → **Me** → **Settings & Privacy** → **Data privacy** → section
   **How LinkedIn uses your data** → **Download my data**.
2. Choose how much to download. Two ways:
   - **Recommended: "Download larger data archive"** (connections, verifications, contacts,
     account history, inferred data). One check mark; gives every file, including the ones
     Gradfolio reads.
   - Or **"Want something in particular? Select the data files you're most interested in"**:
     tick **Profile**. Other boxes (Articles, Invitations, Recommendations, Registration) are
     not needed. *Not verified:* that Profile alone contains Positions, Education, Skills
     and Certifications; confirm on the first real export, then fix this line.
3. Press **Request archive** and confirm with your password (LinkedIn asks; Gradfolio never
   sees it). LinkedIn shows "We will send you an email when your download is ready".
4. Wait for the email (minutes to about 24 hours; the larger archive takes longer).
5. Open the link in the email, sign in, **Download** the ZIP. Do **not** unzip it.
6. In Gradfolio, upload that ZIP. Pick what to keep on the preview step; nothing is saved
   before you confirm.

## What Gradfolio reads

Only `Positions.csv`, `Education.csv`, `Skills.csv`, `Certifications.csv` and (for the name
and headline) `Profile.csv`. Everything else in the ZIP (messages, connections, invitations)
is never read or stored.

## Provisional headers (public sample, NOT from a real archive)

Until the real exports are checked (queue M7-T1), the parser is built on these headers from a
public export sample (not personal data). Every column stays "provisional" in the code and
PR until a real export confirms it.

| File | Headers, in order |
|---|---|
| `Positions.csv` | Company Name, Title, Description, Location, Started On, Finished On |
| `Education.csv` | School Name, Start Date, End Date, Notes, Degree Name, Activities |
| `Skills.csv` | Name |
| `Certifications.csv` | Name, Url, Authority, Started On, Finished On, License Number |
| `Projects.csv` | Title, Description, Url, Started On, Finished On |
| `Profile.csv` | not known yet |

Format rules to build in (from the sample's notes): detect the header row (some files start
with explanatory lines); quoted commas, quotes and multi-line cells; missing files and extra
columns are normal; empty values; several date formats (no timezone assumed); duplicate or
empty header names; validate ZIP paths and decompressed sizes before reading. Files vary by
interface language: unknown, check on real exports.
