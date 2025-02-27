# Deployment Guide for Image Generation Service

This guide provides instructions for deploying the Image Generation Service to Google Cloud Run with proper secret management.

## Prerequisites

- Google Cloud SDK installed and configured
- Access to Google Cloud Console with appropriate permissions
- ImageKit account with API credentials
- OpenAI API key with access to GPT-4o

## Setting Up Google Secret Manager

The service requires access to API keys that should be stored securely in Google Secret Manager:

1. Navigate to Google Cloud Console > Security > Secret Manager
2. Create the following secrets:

### Setting up the OpenAI API Key secret

```bash
# Create the secret
gcloud secrets create OPEN_AI_API_SEO --replication-policy="automatic"

# Add your API key as the secret value
echo -n "your-openai-api-key" | gcloud secrets versions add OPEN_AI_API_SEO --data-file=-
```

### Setting up the ImageKit API Key secret

```bash
# Create the secret
gcloud secrets create IMAGEKIT_API_KEY --replication-policy="automatic"

# Add your ImageKit private key as the secret value
echo -n "your-imagekit-private-key" | gcloud secrets versions add IMAGEKIT_API_KEY --data-file=-
```

## Giving Service Account Access to Secrets

1. Identify the service account that Cloud Run will use:

```bash
# List service accounts
gcloud iam service-accounts list
```

2. Grant the service account access to the secrets:

```bash
# Grant access to OpenAI API Key
gcloud secrets add-iam-policy-binding OPEN_AI_API_SEO \
    --member="serviceAccount:YOUR-SERVICE-ACCOUNT@YOUR-PROJECT.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

# Grant access to ImageKit API Key
gcloud secrets add-iam-policy-binding IMAGEKIT_API_KEY \
    --member="serviceAccount:YOUR-SERVICE-ACCOUNT@YOUR-PROJECT.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

## Deploying to Cloud Run

1. Build and deploy the service with secrets configured:

```bash
gcloud run deploy image-generation-service \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=your-project-id,IMAGEKIT_PUBLIC_KEY=your-public-key,IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/your-endpoint,IMAGEKIT_FOLDER=appraiser-images" \
  --set-secrets="OPEN_AI_API_SEO=OPEN_AI_API_SEO:latest,IMAGEKIT_API_KEY=IMAGEKIT_API_KEY:latest"
```

## Troubleshooting

### Checking Logs

To view the logs for your deployed service:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=image-generation-service" --limit 50
```

### Common Issues

1. **Secret Access Denied**: Ensure your service account has the proper permissions to access the secrets.

2. **API Key Not Found**: Verify that the secrets are correctly configured and that the correct secret names are used in the deployment command.

3. **Vertex AI API Issues**: Ensure the Vertex AI API is enabled in your project and that your service account has permission to use it.

4. **Image Generation Fails**: Check the logs for detailed error messages. The most common issues are API key configuration problems or insufficient permissions.

### Testing the Deployment

After deployment, you can test your service with:

```bash
# Test the health endpoint
curl -X GET https://image-generation-service-URL.a.run.app/health

# Test image generation (replace with your actual URL)
curl -X POST https://image-generation-service-URL.a.run.app/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "appraiser": {
      "id": "test123",
      "name": "Jane Smith",
      "gender": "female",
      "specialization": "Modern Art"
    }
  }'
```

## Updating an Existing Deployment

To update your existing deployment with new code and/or configuration:

```bash
gcloud run deploy image-generation-service \
  --source . \
  --platform managed \
  --region us-central1
```

This will keep your existing environment variables and secret configurations. 