# Testing the Image Generation API

## API Endpoint

The API endpoint for generating images is:

```
https://image-generation-service-856401495068.us-central1.run.app/api/generate
```

## Basic Test Command

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

Note: This command includes a timestamp in the ID to ensure a unique appraiser ID for each request.

## Expected Response

If successful, the API should return a JSON response similar to:

```json
{
  "success": true,
  "data": {
    "imageUrl": "https://example.com/generated-image.jpg",
    "cached": false,
    "prompt": "Professional portrait photo of John Doe...",
    "source": "fal-ai"
  }
}
```

## Monitoring

To monitor the logs during the request, you can check the Cloud Run logs in the Google Cloud Console. 