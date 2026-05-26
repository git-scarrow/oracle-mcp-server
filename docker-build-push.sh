#!/usr/bin/env bash
set -euo pipefail

# Configuration
REGISTRY="nix:5000"
IMAGE_NAME="oracle-mcp"
SHA=$(git rev-parse --short HEAD)

echo "Building ${REGISTRY}/${IMAGE_NAME}..."
docker build -t "${REGISTRY}/${IMAGE_NAME}:latest" -t "${REGISTRY}/${IMAGE_NAME}:${SHA}" .

echo "Pushing to registry..."
docker push "${REGISTRY}/${IMAGE_NAME}:latest"
docker push "${REGISTRY}/${IMAGE_NAME}:${SHA}"

echo "Build and push complete."
echo "Images pushed:"
echo "  - ${REGISTRY}/${IMAGE_NAME}:latest"
echo "  - ${REGISTRY}/${IMAGE_NAME}:${SHA}"
