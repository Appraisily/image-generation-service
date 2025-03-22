# Image Generation Service

A robust service for generating and managing AI-powered images for art appraisers and locations. This service leverages advanced AI models to create professional profile images while providing storage and CDN delivery through ImageKit.

## Features

- **AI-Powered Image Generation**: Create professional profile images for art appraisers and locations using advanced AI models
- **Multiple Generation Options**: Generate images for individual appraisers, locations, or in bulk
- **Custom Prompts**: Override automatic prompt generation with your own custom prompts
- **Image Uploads**: Upload images from URLs, base64 data, or buffers
- **Reliable Error Handling**: Detailed error messages with suggestions for resolution
- **Scalable Architecture**: Designed to handle large volumes of requests
- **Google Cloud Integration**: Securely manages credentials using Secret Manager
- **Robust Logging**: Comprehensive logging for troubleshooting
- **Caching System**: Efficient image caching to avoid unnecessary regeneration
- **Fault Tolerance**: Graceful handling of API disruptions and connectivity issues

## Architecture

The service is built with a modular architecture:

```
┌─────────────────┐     ┌────────────────┐     ┌───────────────┐
│  API Endpoints  │────▶│ Image Generator│────▶│  Black Forest │
└─────────────────┘     └────────────────┘     │  AI Service   │
        │                       │              └───────────────┘
        │                       ▼
        │               ┌────────────────┐
        │               │  Image Cache   │
        │               └────────────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌────────────────┐     ┌───────────────┐
│  Image Uploader │────▶│ ImageKit CDN   │◀───▶│   End Users   │
└─────────────────┘     └────────────────┘     └───────────────┘
```

## API Endpoints

### Base URL

```
https://image-generation-service-856401495068.us-central1.run.app
```

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

Upload an image from a URL, base64 data, or buffer to ImageKit.

#### Request Body
```json
{
  "source": "url",                            // Required - either "url", "base64", or "buffer"
  "data": "https://example.com/image.jpg",    // Required - URL, base64 string, or buffer data
  "fileName": "custom-file-name",             // Optional - defaults to timestamp-based name
  "folder": "custom/folder/path",             // Optional - defaults to "uploaded-images"
  "tags": ["tag1", "tag2"],                   // Optional - tags for the image
  "metadata": {                               // Optional - additional metadata
    "key": "value"
  }
}
```

#### Important Notes for Upload - UPDATED
- **RECOMMENDED**: When uploading images, use the base64 source type rather than URLs for improved reliability in Cloud Run
- **IMPORTANT**: Always ensure that base64 data is properly formatted and doesn't contain special characters
- When using `source: "buffer"`, the `data` must be a Buffer or base64 string representation of the buffer
- Do not attempt to send a stream directly through the API - convert streams to buffers or base64 on the client side first
- For large images, consider breaking them into smaller chunks or use the multipart upload endpoint
- **For Node.js clients**: If you're getting "stream is not readable" errors in Cloud Run, use the following pattern:
  ```javascript
  // Convert image to base64 string first
  const base64Data = fs.readFileSync('/path/to/image.jpg').toString('base64');
  
  // Send as base64 data
  const response = await axios.post('https://image-generation-service-856401495068.us-central1.run.app/api/upload', {
    source: 'base64',
    data: base64Data,
    fileName: 'my-image.jpg'
  });
  ```

### 5. Multipart Upload (New)
`POST /api/upload-multipart`

Upload an image using multipart form data. This is useful for avoiding stream issues in Cloud Run.

#### Request
Send a `multipart/form-data` request with the following fields:
- `file`: The image file to upload (required)
- `folder`: Target folder in ImageKit (optional, defaults to 'uploaded-images')
- `fileName`: Custom filename (optional, defaults to timestamp-based name)
- `tags`: JSON array of tags (optional)
- `metadata`: JSON object with metadata (optional)

#### Example with form-data
```javascript
const form = new FormData();
form.append('file', fs.createReadStream('/path/to/image.jpg'));
form.append('folder', 'my-folder');
form.append('fileName', 'custom-name.jpg');

const response = await axios.post('https://image-generation-service-856401495068.us-central1.run.app/api/upload-multipart', 
  form, 
  { headers: { ...form.getHeaders() } }
);
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

### 6. Get Prompt for Appraiser
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

### 7. Health Check
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

### 8. API Documentation
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
7. **IMPORTANT**: In Cloud Run, avoid uploading streams directly - convert to base64 strings first
8. Use the `/api/upload-multipart` endpoint for form-data uploads when dealing with large files
9. Implement request timeouts and retry logic in your client applications
10. Monitor response times and implement circuit breakers for high-traffic applications

## Recent Improvements

### Stream Handling Improvements
- **FIXED**: "Stream is not readable" errors in Cloud Run environment
- Added new `/api/upload-multipart` endpoint with busboy for more reliable multipart uploads
- Enhanced `/api/upload` endpoint to better handle base64 data
- Added validation for stream readability before attempting to read from streams
- Added better error recovery when streams are in an invalid state
- Enhanced stream-to-buffer conversion with proper timeouts and cleanup
- Added detailed logging for stream processing to aid in debugging

### API Robustness
- Improved JSON parsing with better error messages for invalid input
- Enhanced validation for image upload sources and data formats
- Added better fallback mechanisms for various data input types
- Improved error propagation and user-friendly error responses

### Performance Optimizations
- Implemented multi-level caching system to reduce generation costs and improve response times
- Optimized buffer handling for large images to reduce memory usage
- Added connection pooling for external API calls
- Improved concurrent request handling

### Deployment & Infrastructure
- Enhanced Docker configuration for better resource utilization
- Implemented health check endpoints with detailed status reporting
- Added automated scaling based on request volume
- Improved CI/CD pipeline for faster deployments

## Troubleshooting

### Fixing "Stream is not readable" Errors
If you're encountering "stream is not readable" errors when uploading images, follow these steps:

1. **PREFERRED APPROACH**: Use base64 encoding with the `/api/upload` endpoint
   ```javascript
   // Convert your image to base64 string first
   const base64Data = fs.readFileSync('/path/to/image.jpg').toString('base64');
   
   // Send using the base64 source type
   const response = await axios.post('/api/upload', {
     source: 'base64',
     data: base64Data,
     fileName: 'my-image.jpg'
   });
   ```

2. **ALTERNATIVE APPROACH**: Use the multipart upload endpoint
   ```javascript
   const form = new FormData();
   form.append('file', fs.createReadStream('/path/to/image.jpg'));
   form.append('fileName', 'my-image.jpg');
   
   const response = await axios.post('/api/upload-multipart', form, {
     headers: { ...form.getHeaders() }
   });
   ```

3. For URL-based uploads, ensure the URL is publicly accessible

## Installation & Deployment

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/image-generation-service.git
   cd image-generation-service
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables by creating a `.env` file:
   ```
   PORT=3000
   NODE_ENV=development
   IMAGEKIT_PUBLIC_KEY=your_public_key
   IMAGEKIT_PRIVATE_KEY=your_private_key
   IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/your_endpoint
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

### Production Deployment

The service is designed to run on Google Cloud Run. See `DEPLOYMENT.md` for detailed deployment instructions.

## Error Handling

The service implements comprehensive error handling:

1. **Validation Errors**: Returns 400 with specific feedback on required fields
2. **Payment Issues**: Returns 402 when AI generation service requires payment
3. **Stream Processing**: Properly handles stream data with validation and timeout prevention
4. **Malformed JSON**: Provides helpful feedback for improperly formatted JSON requests
5. **Service Errors**: Logs detailed error information while returning user-friendly messages

## Debugging & Testing

Several test scripts are available to validate functionality:

```bash
# Test image generation
node test-generation.js

# Test image upload functionality
node test-upload.js

# Test API endpoints
node test-api-debug.js

# Test bulk image generation
node test-bulk.js
```

## Support

For API support or to report issues, please contact the service administrators or open an issue in the repository.