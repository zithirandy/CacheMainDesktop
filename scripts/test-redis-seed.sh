#!/usr/bin/env bash
# Put a spread of key types into the local test Redis, so the dashboard has
# something meaningful to render (sizes, types, TTLs, sub-items).
#
#   bash scripts/test-redis-seed.sh
#
# Talks to the container by name, so it works from Git Bash, WSL, or Linux.
#
# Password: this follows the same convention as the check scripts, i.e.
# PCA_TEST_REDIS_PASSWORD, because docker-compose.test.yml starts an
# unauthenticated server by default. REDIS_PASSWORD is accepted as an alias for
# people running a password-protected container.

set -euo pipefail

CONTAINER="${REDIS_CONTAINER:-cmd-test-redis}"
PASSWORD="${PCA_TEST_REDIS_PASSWORD:-${REDIS_PASSWORD:-}}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "test-redis-seed: container '$CONTAINER' is not running." >&2
    echo "  start it with: docker compose -f docker-compose.test.yml up -d" >&2
    exit 1
fi

if [ -n "$PASSWORD" ]; then
    cli() { docker exec -i "$CONTAINER" redis-cli -a "$PASSWORD" --no-auth-warning "$@"; }
else
    cli() { docker exec -i "$CONTAINER" redis-cli "$@"; }
fi

echo "test-redis-seed: clearing db 0 in $CONTAINER"
cli FLUSHDB >/dev/null

echo "test-redis-seed: writing keys"

# Strings
cli SET greeting "hello from docker redis" >/dev/null
cli SET counter 42 >/dev/null
cli SET cache:page:home "<html>cached homepage</html>" EX 3600 >/dev/null
cli SET session:tmp "expires soon" EX 600 >/dev/null

# Hash, list, set, sorted set - one of each so every type badge shows up.
cli HSET user:1 name Ada role engineer city "Cambridge" >/dev/null
cli RPUSH queue:tasks "task-a" "task-b" "task-c" >/dev/null
cli SADD tags:prod "redis" "cache" "memcached" >/dev/null
cli ZADD leaderboard 100 alice 250 bob 175 carol >/dev/null

# A JSON blob, the shape most apps actually cache. Kept single-line so it is
# safe to pass through the shell.
cli SET app:config '{"debug":false,"level":3,"features":["a","b"]}' >/dev/null

echo "test-redis-seed: done. DBSIZE = $(cli DBSIZE | tr -d '\r')"
cli --scan | tr -d '\r' | sort | sed 's/^/  /'
