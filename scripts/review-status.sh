#!/bin/sh
# Says whether each reviewer of record has reviewed the pull request's current
# head commit. A push is reviewed only when BOTH have:
#
#   Copilot  a review whose commit is the head, and which is a real review --
#            "Copilot was unable to review this pull request ... quota limit"
#            is posted as a review on the head too, and does not count.
#   Codex    a review whose commit is the head; or, when it has nothing to
#            report, a no-findings answer (a 👍 reaction on the PR or on the
#            request comment, or a "Didn't find any major issues" comment)
#            given after the `@codex review` request that names this head.
#            The request comment, not the commit's date, anchors the time: a
#            commit's committer date is when it was made, not when it was
#            pushed, so a 👍 for the previous head could postdate it.
#            👀 from Codex means it is still reviewing.
#
# Heads are requested with scripts/request-review.sh, whose Codex comment
# names the head's short SHA.
#
# Usage: sh scripts/review-status.sh [pr-number]
# Exit status: 0 when both reviewed the head, 1 otherwise.
set -eu

pr=${1:-$(gh pr view --json number --jq .number)}
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
head=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
short=$(printf '%s' "$head" | cut -c1-7)
FAILED='unable to review'

status=0

# --- Copilot ---------------------------------------------------------------
copilot_reviews=$(gh api "repos/$repo/pulls/$pr/reviews" --paginate \
  --jq ".[] | select(.user.login | test(\"copilot\"; \"i\")) | select(.commit_id == \"$head\") | .body | split(\"\n\")[0]")
if printf '%s\n' "$copilot_reviews" | grep -v "$FAILED" | grep -q .; then
  echo "Copilot: reviewed $short"
elif printf '%s\n' "$copilot_reviews" | grep -q "$FAILED"; then
  echo "Copilot: FAILED on $short -- $(printf '%s\n' "$copilot_reviews" | grep "$FAILED" | tail -1)"
  status=1
else
  echo "Copilot: NOT yet reviewed $short"
  status=1
fi

# --- Codex -----------------------------------------------------------------
codex_review=$(gh api "repos/$repo/pulls/$pr/reviews" --paginate \
  --jq ".[] | select(.user.login | test(\"codex\")) | select(.commit_id == \"$head\") | .id" | head -1)

if [ -n "$codex_review" ]; then
  echo "Codex:   reviewed $short"
else
  # The latest request comment that names this head.
  request=$(gh api "repos/$repo/issues/$pr/comments" --paginate \
    --jq "[.[] | select(.body | test(\"^@codex review\")) | select(.body | contains(\"$short\"))] | last | \"\(.id) \(.created_at)\"")
  request_id=${request%% *}
  requested_at=${request#* }

  if [ -z "$request" ] || [ "$request_id" = "null" ]; then
    echo "Codex:   NOT requested for $short -- run: sh scripts/request-review.sh $pr"
    status=1
  else
    answered=$(
      {
        gh api "repos/$repo/issues/$pr/reactions" \
          --jq ".[] | select(.user.login | test(\"codex\")) | select(.content == \"+1\") | select(.created_at > \"$requested_at\") | .id"
        gh api "repos/$repo/issues/comments/$request_id/reactions" \
          --jq ".[] | select(.user.login | test(\"codex\")) | select(.content == \"+1\") | .id"
        gh api "repos/$repo/issues/$pr/comments" --paginate \
          --jq ".[] | select(.user.login | test(\"codex\")) | select(.created_at > \"$requested_at\") | select(.body | test(\"find any major issues\")) | .id"
      } | head -1
    )
    if [ -n "$answered" ]; then
      echo "Codex:   reviewed $short (no findings)"
    else
      echo "Codex:   NOT yet reviewed $short (requested $requested_at)"
      status=1
    fi
  fi
fi

exit $status
