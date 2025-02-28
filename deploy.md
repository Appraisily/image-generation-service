# Deploying the Updated Image Generation Service

Follow these steps to deploy the updated image generation service without caching:

## 1. Build the Service

```bash
npm run build
```

## 2. Deploy to Cloud Run

```bash
gcloud run deploy image-generation-service \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80 \
  --max-instances 10 \
  --update-env-vars FAL_API_KEY=YOUR_FAL_API_KEY
```

Replace `YOUR_FAL_API_KEY` with your actual fal-ai API key.

## 3. Verify Deployment

After deployment, test the service using the curl command from `test-api.md`:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "appraiser": {
      "id": "test-'$(date +%s)'",
      "firstName": "John",
      "lastName": "Doe",
      "company": "Premier Appraisals",
      "state": "California",
      "licenseNumber": "CA12345",
      "specialties": ["Residential", "Fine Art"]
    }
  }' \
  https://image-generation-service-856401495068.us-central1.run.app/api/generate
```

## 4. Monitor Logs

Monitor the Cloud Run logs to ensure everything is working correctly:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=image-generation-service" --limit 50 --format json
``` 