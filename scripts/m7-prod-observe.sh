#!/bin/sh
# Read-only observation of the M7 GitHub run against PRODUCTION (docs/modules/m7/prod-run.md).
#
#   sh scripts/m7-prod-observe.sh preflight        revision, env var NAMES, unauthenticated checks
#   sh scripts/m7-prod-observe.sh logs [minutes]   the GitHub lines of the API log (default 60)
#   sh scripts/m7-prod-observe.sh requests [min]   the M7 requests: method, path, status, ms
#   sh scripts/m7-prod-observe.sh verdict [min]    what the lines answer (plan §2.1), counted
#
# It only reads: `gcloud run services describe`, `gcloud logging read`, and plain
# GETs that carry no credential. It never prints an env var VALUE, a header or a
# request body: log fields are projected one by one (no `json` of a whole entry).
# gcloud runs against the university sandbox only.
set -eu

SANDBOX=/Users/levon/Dev/university/.sandbox/gcloud
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$SANDBOX}"
if [ "$CLOUDSDK_CONFIG" != "$SANDBOX" ]; then
  echo "refusing: CLOUDSDK_CONFIG must be $SANDBOX (deploy.md)" >&2
  exit 2
fi
dir=$(gcloud info --format='value(config.paths.global_config_dir)')
[ "$dir" = "$SANDBOX" ] || { echo "refusing: gcloud uses $dir" >&2; exit 2; }

REGION=us-east1
SERVICE=gradfolio-api
API=https://gradfolio-api-1058577031182.us-east1.run.app
cmd=${1:-preflight}
minutes=${2:-60}
base='resource.type="cloud_run_revision" AND resource.labels.service_name="gradfolio-api"'
m7_url='(jsonPayload.req.url=~"/v1/me/(integrations|github)" OR jsonPayload.req.url=~"/v1/me/projects/.*/github/sync")'
m7_path='(jsonPayload.path=~"/v1/me/(integrations|github)" OR jsonPayload.path=~"/v1/me/projects/.*/github/sync")'

read_logs() { # $1 filter, $2 format
  gcloud logging read "$base AND $1" --freshness="${minutes}m" --order=asc --limit=500 --format="$2"
}

case "$cmd" in
  preflight)
    echo "== revision"
    gcloud run services describe "$SERVICE" --region "$REGION" \
      --format='value(status.latestReadyRevisionName, status.latestCreatedRevisionName)'
    echo "== required settings (names only; a value is never read)"
    names=$(gcloud run services describe "$SERVICE" --region "$REGION" \
      --format='value(spec.template.spec.containers[0].env[].name)' | tr ';' '\n')
    for n in AUTH0_CLIENT_ID AUTH0_M2M_CLIENT_ID AUTH0_M2M_CLIENT_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET; do
      if printf '%s\n' "$names" | grep -qx "$n"; then echo "  present  $n"; else echo "  MISSING  $n"; fi
    done
    echo "== readiness"
    curl -s -o /dev/null -w '  /readyz %{http_code}\n' "$API/readyz"
    echo "== every M7 route is deployed and refuses an anonymous caller (401)"
    for r in "GET /v1/me/integrations" "POST /v1/me/integrations/github/connect" \
             "POST /v1/me/integrations/github/link" "DELETE /v1/me/integrations/github" \
             "GET /v1/me/github/repos" "POST /v1/me/github/import" \
             "POST /v1/me/projects/00000000-0000-0000-0000-000000000000/github/sync"; do
      method=${r%% *}; path=${r#* }
      code=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$API$path")
      printf '  %s %s -> %s\n' "$method" "$path" "$code"
    done
    ;;
  logs)
    read_logs "(jsonPayload.msg=~\"^github \" OR (jsonPayload.msg=~\"request (rejected|failed)\" AND $m7_path))" \
      'table(timestamp.date("%H:%M:%S"),jsonPayload.level,jsonPayload.msg,jsonPayload.status,jsonPayload.code,jsonPayload.path,jsonPayload.result,jsonPayload.cause)'
    ;;
  requests)
    read_logs "jsonPayload.msg=\"request completed\" AND $m7_url" \
      'table(timestamp.date("%H:%M:%S"),jsonPayload.req.method,jsonPayload.req.url,jsonPayload.res.statusCode,jsonPayload.responseTime)'
    ;;
  verdict)
    read_logs "(jsonPayload.msg=~\"^github \" OR ($m7_url AND jsonPayload.msg=\"request completed\") OR (jsonPayload.msg=~\"request (rejected|failed)\" AND $m7_path))" \
      'json(jsonPayload.msg,jsonPayload.code,jsonPayload.status,jsonPayload.cause,jsonPayload.result,jsonPayload.path,jsonPayload.req.url,jsonPayload.res.statusCode)' \
      | python3 "$(dirname "$0")/m7-prod-verdict.py"
    ;;
  *)
    echo "usage: $0 preflight | logs [minutes] | requests [minutes] | verdict [minutes]" >&2
    exit 2
    ;;
esac
