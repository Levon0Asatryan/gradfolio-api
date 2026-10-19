"""Counts the projected log fields into the answers of docs/modules/m7/plan.md §2.1.

Input: a JSON array of entries with only the fields `m7-prod-observe.sh verdict`
projects (message, code, status, cause, result, path, url, status code). It
prints counts and conclusions; nothing else is in its input, so nothing else can
be in its output.
"""

import json
import sys
from collections import Counter

entries = json.load(sys.stdin)
payload = [e.get("jsonPayload", {}) for e in entries]
msgs = Counter(p.get("msg", "") for p in payload)
causes = Counter(p.get("cause", "") for p in payload if p.get("cause"))
codes = Counter((p.get("code", ""), p.get("path", "")) for p in payload if p.get("code"))
results = Counter(p.get("result", "") for p in payload if p.get("msg") == "github grant revoked")

m7 = [
    (p.get("req", {}).get("url", ""), p.get("res", {}).get("statusCode"))
    for p in payload
    if p.get("msg") == "request completed"
    and ("/v1/me/integrations" in p.get("req", {}).get("url", "")
         or "/v1/me/github" in p.get("req", {}).get("url", "")
         or "/github/sync" in p.get("req", {}).get("url", ""))
]

def has(text):
    return sum(n for c, n in causes.items() if text in c)

print("== M7 requests (path, status): count")
for (url, status), n in sorted(Counter(m7).items()):
    print(f"  {n:3d}  {status}  {url}")

print("== GitHub lines")
for m in ("github connected", "github linked", "github disconnected", "github grant revoked",
          "github link refused by auth0", "github link outcome unknown", "github link settled"):
    print(f"  {msgs.get(m, 0):3d}  {m}")

print("== answers (plan §2.1)")
connected = msgs.get("github connected", 0) + msgs.get("github linked", 0)
no_token = has("github identity without a token")
print(f"  IdP token returned and GitHub accepted it: "
      f"{'YES' if connected else 'not observed'} ({connected} connect/link)")
print(f"  Auth0 gave an identity without a token (M2M scope or dev keys): "
      f"{'YES, ' + str(no_token) + ' time(s)' if no_token else 'no'}")
print(f"  Management API rate limit (429) hit: {has('management api 429')} time(s)")
print(f"  Other Management API failures: "
      f"{sum(n for c, n in causes.items() if c.startswith('integration unavailable: management api') and '429' not in c)}")
print(f"  M2M token failures: {has('m2m token')}")
print(f"  Link outcomes: linked={msgs.get('github linked', 0)} "
      f"refused={msgs.get('github link refused by auth0', 0)} "
      f"unknown={msgs.get('github link outcome unknown', 0)} "
      f"settled-by-reconcile={msgs.get('github link settled', 0)}")
print(f"  Grant revocation results (revoked = 204; already_gone = the status in GRANT_ALREADY_GONE): "
      f"{dict(results) or 'none'}")
print(f"  Revocation refusals (cause shows GitHub's status): "
      f"{[c for c in causes if c.startswith('github revoke failed')] or 'none'}")
print(f"  GitHub refused a token (401 -> GITHUB_NOT_LINKED): "
      f"{sum(n for (c, _), n in codes.items() if c == 'GITHUB_NOT_LINKED')}")
print(f"  GitHub rate limited (GITHUB_RATE_LIMITED): "
      f"{sum(n for (c, _), n in codes.items() if c == 'GITHUB_RATE_LIMITED')}")
print("== error codes by path")
for (code, path), n in sorted(codes.items()):
    print(f"  {n:3d}  {code}  {path}")
