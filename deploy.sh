#!/bin/bash

# Exit on any error
set -e

# Check if .env file exists
if [ ! -f .env ]; then
  echo "Error: .env file not found"
  exit 1
fi

# Load environment variables from .env file
echo "Loading environment variables from .env file..."
export $(grep -v '^#' .env | xargs)

# Check if required environment variables are set
if [ -z "$ANTHROPIC_API_KEY" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ] || [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ] || [ -z "$R2_BUCKET" ] || [ -z "$R2_PUBLIC_ID" ]; then
  echo "Error: Required environment variables are missing in .env file"
  exit 1
fi

# Define project and image
PROJECT_ID="appily-dev"
IMAGE_NAME="gcr.io/${PROJECT_ID}/appily-agent"

# Parse command line arguments
SKIP_BUILD=false
REGION="us-central1"
MEMORY="16Gi"
CPU="4"
TIMEOUT="20m"
MAX_INSTANCES="10"

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --skip-build) SKIP_BUILD=true ;;
    --region) REGION="$2"; shift ;;
    --memory) MEMORY="$2"; shift ;;
    --cpu) CPU="$2"; shift ;;
    --timeout) TIMEOUT="$2"; shift ;;
    --max-instances) MAX_INSTANCES="$2"; shift ;;
    *) echo "Unknown parameter: $1"; exit 1 ;;
  esac
  shift
done

# Build the container image (unless skipped)
if [ "$SKIP_BUILD" = false ]; then
  echo "Building container image with Cloud Build..."
  gcloud builds submit --tag $IMAGE_NAME
else
  echo "Skipping build step..."
fi

# Create environment variables string from .env file
ENV_VARS=""
# List of reserved environment variables in Cloud Run
RESERVED_ENV_VARS=("PORT")

while IFS='=' read -r key value || [ -n "$key" ]; do
  # Skip comments and empty lines
  if [[ $key =~ ^# ]] || [[ -z $key ]]; then
    continue
  fi
  
  # Trim whitespace
  key=$(echo $key | xargs)
  value=$(echo $value | xargs)
  
  # Skip reserved environment variables
  if [[ " ${RESERVED_ENV_VARS[@]} " =~ " ${key} " ]]; then
    echo "Skipping reserved environment variable: ${key}"
    continue
  fi
  
  # Add to env vars string
  if [ -n "$ENV_VARS" ]; then
    ENV_VARS="$ENV_VARS,$key=$value"
  else
    ENV_VARS="$key=$value"
  fi
done < .env

# Deploy to Cloud Run
echo "Deploying to Cloud Run in region ${REGION}..."
gcloud run deploy appily-agent \
  --image $IMAGE_NAME \
  --platform managed \
  --region $REGION \
  --memory $MEMORY \
  --cpu $CPU \
  --timeout $TIMEOUT \
  --max-instances $MAX_INSTANCES \
  --allow-unauthenticated \
  --set-env-vars="$ENV_VARS"

# Get the deployed URL
SERVICE_URL=$(gcloud run services describe appily-agent --region $REGION --format='value(status.url)')

echo "Deployment complete!"
echo "Your service is available at: $SERVICE_URL"
