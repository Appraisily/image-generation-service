# Image Generation Service API Documentation

This service provides an API for generating AI-powered images for art appraisers. It uses advanced AI models to create professional profile images based on appraiser information.

## Base URL

```
https://image-generation-service-856401495068.us-central1.run.app
```

## API Endpoints

### 1. Generate Image for Single Appraiser
`POST /api/generate`

Generate a professional profile image for a single appraiser.

#### Request Body
```json
{
  "appraiser": {
    "id": "unique-appraiser-id",     // Required
    "name": "Appraiser Name",        // Optional
    "specialties": ["Fine Art", "Antiques"], // Optional
    "city": "City Name",             // Optional
    "state": "State Name"            // Optional
  },
  "customPrompt": "Optional custom prompt to override automatic generation"
}
```

#### Response
```json
{
  "success": true,
  "data": {
    "imageUrl": "https://example.com/image.jpg",
    "originalUrl": "https://original-source.com/image.jpg",
    "cached": false,
    "prompt": "The prompt used to generate the image",
    "source": "black-forest-ai"
  }
}
```

### 2. Generate Location Image
`POST /api/generate-location`

Generate an image for a specific location.

#### Request Body
```json
{
  "location": {
    "id": "unique-location-id",    // Required
    "name": "Location Name",       // Optional
    "state": "State Name"         // Optional
  },
  "customPrompt": "Optional custom prompt to override automatic generation"
}
```

### 3. Bulk Generate Images
`POST /api/generate-bulk`

Generate images for multiple appraisers in a single request.

#### Request Body
```json
{
  "appraisers": [
    {
      "id": "appraiser-id-1",
      "name": "Appraiser Name 1",
      "specialties": ["Fine Art", "Antiques"]
    },
    {
      "id": "appraiser-id-2",
      "name": "Appraiser Name 2",
      "specialties": ["Jewelry", "Watches"]
    }
  ]
}
```

#### Response
```json
{
  "message": "Processing 2 images in the background.",
  "jobId": "1234567890"
}
```

### 4. Upload Image
`POST /api/upload`

Upload an image from a URL or base64 data to ImageKit.

#### Request Body
```json
{
  "source": "url",                            // Required - either "url" or "base64"
  "data": "https://example.com/image.jpg",    // Required - URL or base64 string
  "fileName": "custom-file-name",             // Optional - defaults to timestamp-based name
  "folder": "custom/folder/path",             // Optional - defaults to "uploaded-images"
  "tags": ["tag1", "tag2"],                   // Optional - tags for the image
  "metadata": {                               // Optional - additional metadata
    "key": "value"
  }
}
```

#### Response
```json
{
  "success": true,
  "data": {
    "url": "https://ik.imagekit.io/yourEndpoint/path/to/image.jpg",
    "fileId": "file_id_returned_by_imagekit",
    "name": "final_file_name",
    "size": 12345
  }
}
```

### 5. Get Prompt for Appraiser
`GET /api/prompt/:appraiserId`

Retrieve the prompt used to generate an appraiser's image.

#### Response
```json
{
  "success": true,
  "appraiserId": "appraiser-id",
  "prompt": "The prompt used for generation",
  "source": "file"
}
```

### 6. Health Check
`GET /health`

Check the service's health and configuration status.

#### Response
```json
{
  "status": "ok",
  "timestamp": "2024-03-21T12:00:00Z",
  "environment": "production",
  "googleCloudProject": "configured",
  "imagekitConfigured": true,
  "openaiConfigured": true
}
```

### 7. API Documentation
`GET /api/docs`

Get detailed API documentation in JSON format.

## Error Codes

- `400`: Bad Request - Missing required fields or invalid source type
- `402`: Payment Required - Black Forest AI credit limit exceeded
- `404`: Not Found - Resource not found
- `500`: Internal Server Error - Error generating or processing image

## Error Response Format
```json
{
  "error": "Error message description",
  "help": "Additional help information when available"
}
```

## Rate Limiting

The service implements rate limiting to ensure fair usage. Please contact the service administrators for specific limits and enterprise usage options.

## Image Storage

Generated images are stored and served through ImageKit CDN for optimal delivery and performance. The service implements a multi-level caching strategy to avoid unnecessary regeneration of images.

## Best Practices

1. Always provide a unique `id` for each appraiser or location
2. Include as much relevant information as possible (name, specialties, location) for better image generation
3. Use bulk generation for multiple images to optimize processing
4. Implement proper error handling in your client code
5. Cache the returned image URLs on your end when possible
6. For custom images, use the `/api/upload` endpoint to directly upload images to ImageKit

## Support

For API support or to report issues, please contact the service administrators or open an issue in the repository.