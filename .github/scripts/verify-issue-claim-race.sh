#!/usr/bin/env bash
# Authorized manual GitHub Actions test only. Creates disposable-by-policy test refs;
# does not touch product Issues, source branches, releases or repository settings.
set -euo pipefail

mode="${1:?expected contend or verify}"
side="${2:-}"
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_SHA:?}"
: "${GITHUB_RUN_ID:?}"
: "${GITHUB_RUN_ATTEMPT:?}"
: "${GH_TOKEN:?}"
repo="$GITHUB_REPOSITORY"
prefix="test/atomic-issue-claim-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
claim_ref="refs/heads/$prefix"
api="https://api.github.com/repos/$repo"
token_header="Authorization: Bearer $GH_TOKEN"

post_ref() {
  local ref="$1" sha="$2" file="$3"
  local payload
  payload="$(jq -cn --arg ref "$ref" --arg sha "$sha" '{ref:$ref,sha:$sha}')"
  curl --silent --show-error --connect-timeout 10 --max-time 45 --retry 0 \
    -o "$file" -w '%{http_code}' -X POST \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    -H "$token_header" -H 'Content-Type: application/json' \
    "$api/git/refs" --data "$payload"
}

get_ref_sha() {
  local name="$1"
  gh api "repos/$repo/git/ref/heads/$name" --jq '.object.sha'
}

require_exists_collision() {
  local code="$1" file="$2"
  local message
  message="$(jq -r '.message // ""' "$file")"
  if [[ "$code" != "422" && "$code" != "409" ]] || [[ "$message" != *"Reference already exists"* ]]; then
    echo "::error::Unexpected failure response $code ($message). Not proven to be a duplicate claim."
    return 1
  fi
}

case "$mode" in
  contend)
    if [[ "$side" != "a" && "$side" != "b" ]]; then echo "Invalid contender"; exit 2; fi
    peer="a"; [[ "$side" == "a" ]] && peer="b"
    ready="$prefix-ready-$side"
    peer_ready="$prefix-ready-$peer"
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT

    # Each runner first advertises readiness via its own uniquely named ref.
    status="$(post_ref "refs/heads/$ready" "$GITHUB_SHA" "$tmp")"
    if [[ "$status" != "201" ]]; then echo "::error::Could not publish readiness ref (HTTP $status)"; exit 1; fi
    echo "Ready ref created for contender $side"

    # Both runners must reach the barrier before attempting the same claim.
    found=false
    for attempt in $(seq 1 60); do
      if peer_sha="$(get_ref_sha "$peer_ready" 2>/dev/null)" && [[ "$peer_sha" == "$GITHUB_SHA" ]]; then
        found=true
        break
      fi
      sleep 2
    done
    if [[ "$found" != true ]]; then echo "::error::Peer never reached race barrier"; exit 1; fi

    start_ms="$(date +%s%3N)"
    status="$(post_ref "$claim_ref" "$GITHUB_SHA" "$tmp")"
    result=""
    if [[ "$status" == "201" ]]; then
      result="created"
    else
      require_exists_collision "$status" "$tmp"
      result="occupied"
    fi
    actual="$(get_ref_sha "$prefix")"
    [[ "$actual" == "$GITHUB_SHA" ]] || { echo "::error::Claim ref unexpectedly changed"; exit 1; }
    {
      echo "outcome=$result"
      echo "attempt_ms=$start_ms"
    } >> "$GITHUB_OUTPUT"
    echo "Contender $side: $result (HTTP $status); source SHA verified; attempt_ms=$start_ms"
    ;;

  verify)
    : "${RESULT_A:?}"
    : "${RESULT_B:?}"
    : "${ATTEMPT_A_MS:?}"
    : "${ATTEMPT_B_MS:?}"
    [[ "$RESULT_A" != "$RESULT_B" ]] || { echo "::error::Expected one winner and one loser, got $RESULT_A/$RESULT_B"; exit 1; }
    [[ "$RESULT_A" == "created" || "$RESULT_B" == "created" ]] || exit 1
    [[ "$RESULT_A" == "occupied" || "$RESULT_B" == "occupied" ]] || exit 1
    delta=$((ATTEMPT_A_MS - ATTEMPT_B_MS))
    ((delta < 0)) && delta=$((-delta))
    echo "Two GitHub-hosted runners reached the barrier; request start delta: ${delta}ms"
    ((delta <= 15000)) || { echo "::error::Attempt gap exceeds 15 s; concurrency not demonstrated"; exit 1; }

    remote="$(get_ref_sha "$prefix")"
    [[ "$remote" == "$GITHUB_SHA" ]] || { echo "::error::Unexpected ref SHA after race"; exit 1; }

    parent="$(gh api "repos/$repo/commits/$GITHUB_SHA" --jq '.parents[0].sha')"
    [[ "$parent" != "$GITHUB_SHA" && -n "$parent" ]] || exit 1
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    status="$(post_ref "$claim_ref" "$parent" "$tmp")"
    require_exists_collision "$status" "$tmp"
    still="$(get_ref_sha "$prefix")"
    [[ "$still" == "$GITHUB_SHA" ]] || { echo "::error::Duplicate create modified remote ref"; exit 1; }
    echo "PASS: A=$RESULT_A; B=$RESULT_B; start delta=${delta}ms; duplicate attempt HTTP=$status; ref unchanged ($still)"
    ;;
  *)
    echo "Invalid mode: $mode"; exit 2 ;;
esac
