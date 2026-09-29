#!/bin/sh
# Says whether each reviewer of record has reviewed the pull request's current
# head commit. A push is reviewed only when BOTH have: a review whose commit is
# the head, or (Codex, when it has nothing to report) a 👍 reaction or comment
# timestamped after the head commit was pushed. 👀 from Codex means it is still
# reviewing.
#
# Usage: sh scripts/review-status.sh [pr-number]
# Exit status: 0 when both reviewed the head, 1 otherwise.
set -eu

pr=${1:-$(gh pr view --json number --jq .number)}
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
head=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
pushed=$(gh api "repos/$repo/commits/$head" --jq .commit.committer.date)

reviewed_by() {
  gh api "repos/$repo/pulls/$pr/reviews" --paginate \
    --jq ".[] | select(.user.login | test(\"$1\")) | select(.commit_id == \"$head\") | .id" | head -1
}

copilot=$(reviewed_by 'copilot')
codex=$(reviewed_by 'codex')

if [ -z "$codex" ]; then
  # Codex answers "no findings" with a 👍 on the PR rather than a review.
  codex=$(gh api "repos/$repo/issues/$pr/reactions" \
    --jq ".[] | select(.user.login | test(\"codex\")) | select(.content == \"+1\") | select(.created_at > \"$pushed\") | .id" | head -1)
fi

status=0
if [ -n "$copilot" ]; then echo "Copilot: reviewed $head"; else echo "Copilot: NOT yet reviewed $head"; status=1; fi
if [ -n "$codex" ]; then echo "Codex:   reviewed $head"; else echo "Codex:   NOT yet reviewed $head"; status=1; fi
exit $status
