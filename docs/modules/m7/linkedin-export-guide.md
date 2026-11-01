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

## Headers confirmed on a real export (Levon's archive, 2026-11-01, English interface)

Checked with a throwaway script that printed only headers, row counts and masked date shapes
(no values). The archive is named `Basic_LinkedInDataExport_<date>.zip`, holds 22 CSV files
and one subfolder (`Jobs/`), so **ZIP entries can have a path**. Other languages (ru/am) are
still unchecked; Narek and Pargev may send header lines for those.

| File | Headers, in order | Rows (this archive) |
|---|---|---|
| `Positions.csv` | Company Name, Title, Description, Location, Started On, Finished On | 6 |
| `Education.csv` | School Name, Start Date, End Date, Notes, Degree Name, Activities | 3 |
| `Skills.csv` | Name | 23 |
| `Certifications.csv` | Name, Url, Authority, Started On, Finished On, License Number | 5 |
| `Profile.csv` | First Name, Last Name, Maiden Name, Address, Birth Date, Headline, Summary, Industry, Zip Code, Geo Location, Twitter Handles, Websites, Instant Messengers | 1 |
| `Registration.csv` | Registered At, Registration Ip, Subscription Types | 1 (never read) |

Other files present, never read: Endorsement_Received_Info, Endorsement_Given_Info, messages,
SavedJobAlerts, Invitations, Company Follows, Whatsapp Phone Numbers, Job Applicant Saved
Screening Question Responses, Notes, Events, Rich_Media, PhoneNumbers, Email Addresses,
Jobs/Job Seeker Preferences, Jobs/Job Applications, Jobs/Saved Jobs, Jobs/Job Applicant Saved Answers.

Observed formats:
- Dates in Positions, Education and Certifications are **month-abbreviation + year** (shape
  `Mon YYYY`, e.g. a three-letter English month, a space, four digits). An empty
  `Finished On` / `End Date` means "present" or not given. A year-only or full date may
  occur in other accounts: the parser must accept `YYYY`, `Mon YYYY` and a full date, and
  report anything else as unparsed, never guess.
- No multi-line cells in this archive, but descriptions can be long: keep quoted multi-line
  support and a length cap.
- Files have no preamble lines here (header is line 1); still detect the header row.
- `Skills.csv` is a single column `Name`.
- `Profile.csv` holds sensitive fields (Birth Date, Address, Zip Code, Maiden Name,
  Instant Messengers). **Never read, store, log or return them.** Gradfolio reads only
  First Name, Last Name, Headline, Summary, Industry, Geo Location and Websites.

Format rules to build in: detect the header row; quoted commas, quotes and multi-line cells;
missing files and extra columns are normal; empty values; duplicate or empty header names;
no timezone assumed; validate ZIP entry paths (including subfolders), entry count and
decompressed sizes before reading.

The real archive stays on Levon's machine (`~/Downloads`), never committed, pasted or
uploaded to a PR. It is used only for the manual real run (T51) on production.
