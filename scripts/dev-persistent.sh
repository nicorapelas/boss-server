#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="electropos-mongo"
VOLUME_NAME="electropos_mongo"
IMAGE="mongo:7"
MONGO_PORT="27017"

if ! command -v docker >/dev/null 2>&1; then
  echo "[dev:persistent] Docker is not installed or not in PATH."
  echo "[dev:persistent] Install Docker (or use npm run dev:local)."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[dev:persistent] Docker daemon is not running."
  echo "[dev:persistent] Start Docker and retry."
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  if [ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}")" != "true" ]; then
    echo "[dev:persistent] Starting existing Mongo container: ${CONTAINER_NAME}"
    docker start "${CONTAINER_NAME}" >/dev/null
  else
    echo "[dev:persistent] Mongo container already running: ${CONTAINER_NAME}"
  fi
else
  echo "[dev:persistent] Creating Mongo container: ${CONTAINER_NAME}"
  docker run -d \
    --name "${CONTAINER_NAME}" \
    -p "${MONGO_PORT}:27017" \
    -v "${VOLUME_NAME}:/data/db" \
    "${IMAGE}" >/dev/null
fi

echo "[dev:persistent] Waiting for Mongo to accept connections..."
READY=0
for _ in $(seq 1 45); do
  if docker exec "${CONTAINER_NAME}" mongosh --quiet --eval "db.runCommand({ ping: 1 }).ok" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [ "${READY}" -ne 1 ]; then
  echo "[dev:persistent] Mongo did not become ready in time."
  exit 1
fi

echo "[dev:persistent] Mongo ready on mongodb://127.0.0.1:27017/electropos"
echo "[dev:persistent] Starting API server..."
NODE_ENV=development npx tsx watch src/index.ts

