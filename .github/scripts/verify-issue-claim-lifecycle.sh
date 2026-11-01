#!/usr/bin/env bash
# Test-ref-only multi-round claim experiment; never operate on product work/issue refs.
set -euo pipefail
mode="$1"; side="$2"
: "$GITHUB_REPOSITORY" "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$GH_TOKEN"
repo="$GITHUB_REPOSITORY"; prefix="test/claim-lifecycle-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
api="https://api.github.com/repos/$repo"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
req() {
  local method="$1" endpoint="$2" data="$3"
  curl --silent --show-error --connect-timeout 10 --max-time 45 --retry 0 -o "$tmp" -w '%{http_code}' \
    -X "$method" -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' -H 'Content-Type: application/json' \
    "$api/$endpoint" --data "$data"
}
create_ref() {
  req POST git/refs "$(jq -cn --arg ref "refs/heads/$1" --arg sha "$2" '{ref:$ref,sha:$sha}')"
}
get_head() { gh api "repos/$repo/git/ref/heads/$prefix" --jq '.object.sha'; }
assert_head() { [[ "$(get_head)" == "$1" ]] || { echo '::error::Unexpected remote ref'; exit 1; }; }
child() {
  local parent="$1" msg="$2" tree code
  tree="$(gh api "repos/$repo/git/commits/$parent" --jq '.tree.sha')"
  code="$(req POST git/commits "$(jq -cn --arg m "$msg" --arg t "$tree" --arg p "$parent" '{message:$m,tree:$t,parents:[$p]}')")"
  [[ "$code" == 201 ]] || { echo "::error::Commit failed HTTP $code" >&2; return 1; }
  jq -er '.sha' "$tmp"
}
advance() {
  req PATCH "git/refs/heads/$prefix" "$(jq -cn --arg sha "$1" '{sha:$sha,force:false}')"
}
refused() {
  local message
  message="$(jq -r '.message // ""' "$tmp")"
  message="$(printf "%s" "$message" | tr "[:upper:]" "[:lower:]")"
  [[ "$1" == 422 && "$message" == *'not a fast forward'* || "$1" == 422 && "$message" == *'not a fast-forward'* ]] || {
    echo "::error::Expected non-fast-forward HTTP 422, got $1: $message" >&2; exit 1;
  }
}
case "$mode" in
  init)
    [[ "$GITHUB_REF" == 'refs/heads/main' ]] || exit 1
    [[ "$(create_ref "$prefix" "$GITHUB_SHA")" == 201 ]] || exit 1
    first="$(child "$GITHUB_SHA" 'test-only round 1 claimed')"
    [[ "$(advance "$first")" == 200 ]] || exit 1
    assert_head "$first"
    release="$(child "$first" 'test-only round 1 released')"
    [[ "$(advance "$release")" == 200 ]] || exit 1
    assert_head "$release"
    printf 'release=%s\nfirst=%s\n' "$release" "$first" >> "$GITHUB_OUTPUT"
    ;;
  contend)
    [[ "$side" == a || "$side" == b ]] || exit 2
    assert_head "$RELEASE_SHA"
    peer=a; [[ "$side" == a ]] && peer=b
    [[ "$(create_ref "$prefix-ready-$side" "$GITHUB_SHA")" == 201 ]] || exit 1
    ready=false
    for _ in $(seq 1 60); do
      if [[ "$(gh api "repos/$repo/git/ref/heads/$prefix-ready-$peer" --jq '.object.sha' 2>/dev/null || true)" == "$GITHUB_SHA" ]]; then ready=true; break; fi
      sleep 2
    done
    [[ "$ready" == true ]] || exit 1
    candidate="$(child "$RELEASE_SHA" "test-only round 2 contender $side")"
    start="$(date +%s%3N)"
    code="$(advance "$candidate")"
    if [[ "$code" == 200 ]]; then outcome=created; else refused "$code"; outcome=occupied; fi
    printf 'outcome=%s\ncandidate=%s\nstart=%s\n' "$outcome" "$candidate" "$start" >> "$GITHUB_OUTPUT"
    echo "Independent contender $side: $outcome HTTP $code"
    ;;
  verify)
    [[ "$OUTCOME_A" != "$OUTCOME_B" ]] || exit 1
    [[ "$OUTCOME_A" == created || "$OUTCOME_B" == created ]] || exit 1
    [[ "$OUTCOME_A" == occupied || "$OUTCOME_B" == occupied ]] || exit 1
    delta=$((START_A-START_B)); ((delta < 0)) && delta=$((-delta))
    ((delta <= 20000)) || { echo "::error::Attempt gap $delta ms exceeds 20 seconds"; exit 1; }
    winner="$CANDIDATE_A"; loser="$CANDIDATE_B"
    [[ "$OUTCOME_B" == created ]] && { winner="$CANDIDATE_B"; loser="$CANDIDATE_A"; }
    [[ "$(gh api "repos/$repo/git/commits/$winner" --jq '.parents[0].sha')" == "$RELEASE_SHA" ]] || exit 1
    assert_head "$winner"
    refused "$(advance "$loser")"; assert_head "$winner"
    release2="$(child "$winner" 'test-only round 2 released')"
    [[ "$(advance "$release2")" == 200 ]] || exit 1
    assert_head "$release2"
    refused "$(advance "$FIRST_CLAIM_SHA")"; assert_head "$release2"
    third="$(child "$release2" 'test-only round 3 claimed')"
    [[ "$(advance "$third")" == 200 ]] || exit 1
    assert_head "$third"
    echo "PASS: one reacquisition winner; stale sibling and round-one replay rejected; round three succeeds; delta=$delta ms"
    ;;
  *) echo 'Expected init/contend/verify'; exit 2 ;;
esac
