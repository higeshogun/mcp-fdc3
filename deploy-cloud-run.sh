#!/bin/bash
# =============================================================================
# Google Cloud Run Deployment Script for MCP-FDC3
# =============================================================================
#
# Prerequisites:
#   - gcloud CLI installed and authenticated: gcloud auth login
#   - Docker installed and running
#   - OPENAI_API_KEY environment variable set
#
# Usage:
#   PROJECT_ID=my-gcp-project OPENAI_API_KEY=sk-... ./deploy-cloud-run.sh
#
# Optional env vars (with defaults):
#   REGION        GCP region           (default: us-central1)
#   OPENAI_MODEL  OpenAI model name    (default: gpt-4.1-mini)
#
# Approximate cost for this demo stack: ~$1-3/month
# The MCP server runs with min-instances=1 to keep sessions alive.
# All other services scale to zero when idle.
# =============================================================================
set -euo pipefail

# ---------- Config ------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-4.1-mini}"
REPO_NAME="mcp-fdc3"

# ---------- Validation --------------------------------------------------------
if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: PROJECT_ID is required."
  echo "Usage: PROJECT_ID=my-gcp-project OPENAI_API_KEY=sk-... ./deploy-cloud-run.sh"
  exit 1
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "ERROR: OPENAI_API_KEY is required."
  exit 1
fi

if ! command -v gcloud &>/dev/null; then
  echo "ERROR: gcloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker not found. Install it from https://docs.docker.com/get-docker/"
  exit 1
fi

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"

echo "=============================================="
echo " MCP-FDC3 — Google Cloud Run Deployment"
echo "=============================================="
echo " Project : $PROJECT_ID"
echo " Region  : $REGION"
echo " Registry: $REGISTRY"
echo "=============================================="
echo ""

# ---------- 1. Enable APIs ----------------------------------------------------
echo "[1/8] Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  --project="$PROJECT_ID"

# ---------- 2. Artifact Registry repo ----------------------------------------
echo "[2/8] Creating Artifact Registry repository (skipped if already exists)..."
gcloud artifacts repositories create "$REPO_NAME" \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null || true

# ---------- 3. Docker auth ----------------------------------------------------
echo "[3/8] Configuring Docker to authenticate with Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ---------- 4. MCP Server -----------------------------------------------------
echo "[4/8] Building and deploying MCP Server..."
docker build \
  -t "${REGISTRY}/mcp-server:latest" \
  -f demos/backend-mcp-server-ts/Dockerfile \
  .
docker push "${REGISTRY}/mcp-server:latest"

gcloud run deploy mcp-fdc3-mcp-server \
  --image="${REGISTRY}/mcp-server:latest" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --port=3000 \
  --allow-unauthenticated \
  --min-instances=1 \
  --max-instances=1 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=60 \
  --quiet

MCP_SERVER_URL=$(gcloud run services describe mcp-fdc3-mcp-server \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")
echo "  -> MCP Server: $MCP_SERVER_URL"

# ---------- 5. AI Agent -------------------------------------------------------
echo "[5/8] Building and deploying AI Agent..."
docker build \
  -t "${REGISTRY}/ai-agent:latest" \
  -f demos/backend-ai-agent-ts/Dockerfile \
  .
docker push "${REGISTRY}/ai-agent:latest"

# Deploy with FRONTEND_PLATFORM_ORIGIN=* initially; tightened in step 7
gcloud run deploy mcp-fdc3-ai-agent \
  --image="${REGISTRY}/ai-agent:latest" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --port=4000 \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --set-env-vars="OPENAI_API_KEY=${OPENAI_API_KEY},OPENAI_MODEL=${OPENAI_MODEL},BACKEND_MCP_SERVER_URL=${MCP_SERVER_URL}/mcp,FRONTEND_PLATFORM_ORIGIN=*" \
  --quiet

AI_AGENT_URL=$(gcloud run services describe mcp-fdc3-ai-agent \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")
echo "  -> AI Agent: $AI_AGENT_URL"

# ---------- 6. Frontend -------------------------------------------------------
echo "[6/8] Building and deploying Frontend..."
docker build \
  -t "${REGISTRY}/frontend:latest" \
  -f demos/frontend-platform/Dockerfile \
  .
docker push "${REGISTRY}/frontend:latest"

gcloud run deploy mcp-fdc3-frontend \
  --image="${REGISTRY}/frontend:latest" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --port=8080 \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=3 \
  --memory=256Mi \
  --cpu=1 \
  --timeout=30 \
  --set-env-vars="VITE_AI_AGENT_ENDPOINT=${AI_AGENT_URL}/api/chat" \
  --quiet

FRONTEND_URL=$(gcloud run services describe mcp-fdc3-frontend \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")
echo "  -> Frontend: $FRONTEND_URL"

# ---------- 7. Tighten AI Agent CORS -----------------------------------------
echo "[7/8] Updating AI Agent CORS to allow only the frontend origin..."
gcloud run services update mcp-fdc3-ai-agent \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --update-env-vars="FRONTEND_PLATFORM_ORIGIN=${FRONTEND_URL}" \
  --quiet

# ---------- 8. Done -----------------------------------------------------------
echo "[8/8] Deployment complete!"
echo ""
echo "=============================================="
echo "  Frontend  : $FRONTEND_URL"
echo "  AI Agent  : $AI_AGENT_URL"
echo "  MCP Server: $MCP_SERVER_URL"
echo "=============================================="
echo ""
echo "Open the frontend URL in your browser and try:"
echo '  "Get trades for apple"'
echo '  "Get trades for microsoft"'
echo ""
echo "Note: The AI Agent may take ~10-15 seconds on first request (cold start)."
