# Appraisily Image Generation Service

This service generates professional portrait images for art appraisers using the Black Forest AI API (Flux Pro model) and stores them in ImageKit CDN.

## Overview

The image generation service provides functionality to:

1. Generate high-quality, photorealistic portrait images for art appraisers using Black Forest AI
2. Create detailed prompts using OpenAI's GPT-4o for better image results
3. Upload generated images to ImageKit CDN for persistent storage and fast delivery
4. Handle image generation in a Cloud Run environment using Google Secret Manager

## Key Features

- Direct integration with Black Forest AI's Flux Pro model
- Advanced prompt generation with GPT-4o
- Configurable image parameters (width, height, etc.)
- Polling mechanism for retrieving generation results
- Automatic uploading of generated images to ImageKit CDN
- Error handling and logging

## Setup

### Prerequisites

- Node.js 16+
- Google Cloud project with Secret Manager access
- Black Forest AI API key
- ImageKit account with API credentials
- OpenAI API key (optional, for better prompt generation)

### Environment Variables

The service can be configured using the following environment variables:

- `BFL_API_KEY`: Black Forest AI API key for image generation
- `IMAGEKIT_PUBLIC_KEY`: ImageKit public key
- `IMAGEKIT_PRIVATE_KEY`: ImageKit private key
- `IMAGEKIT_URL_ENDPOINT`: ImageKit URL endpoint (e.g. https://ik.imagekit.io/youraccount)
- `OPEN_AI_API_SEO`: OpenAI API key for advanced prompt generation

### Secret Manager Setup

In production environments, the service uses Google Secret Manager to retrieve API keys:

1. Create secrets in your Google Cloud project:
   - Secret name: `BFL_API_KEY` - Value: Your Black Forest AI API key
   - Secret name: `IMAGEKIT_PUBLIC_KEY` - Value: Your ImageKit public key
   - Secret name: `IMAGEKIT_PRIVATE_KEY` - Value: Your ImageKit private key
   - Secret name: `OPEN_AI_API_SEO` - Value: Your OpenAI API key

2. Ensure your Cloud Run service has access to Secret Manager with the appropriate permissions.

## Usage

### Running Locally

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file with your API keys
4. Run the service: `npm start`

### Testing

You can test the various components with these scripts:

```bash
# Test the Black Forest AI client
node test-bfai-client.js

# Test the ImageKit integration
node test-imagekit.js
```

### Generating Images

The service provides a command-line interface for generating images:

```bash
npm run generate-images -- --id <appraiser-id>
```

## API Integration

### Black Forest AI

The service integrates with the Black Forest AI API using:

1. POST request to initiate image generation
2. Polling GET requests to retrieve the generation result

### ImageKit

Generated images are uploaded to ImageKit CDN to provide:

1. Persistent storage of generated images
2. Fast global image delivery through CDN
3. Image transformation capabilities
4. Secure URL access

### API Endpoints

The service exposes the following endpoints:

- `POST /api/generate`: Generate an image for a single appraiser
- `POST /api/generate-bulk`: Generate images for multiple appraisers
- `GET /api/prompt/:appraiserId`: Get the prompt used for an appraiser's image
- `GET /health`: Health check endpoint
- `GET /api/docs`: Returns detailed API documentation including request formats and error codes

## Dependencies

- axios: HTTP client for making API requests
- imagekit: ImageKit SDK for image uploads
- @google-cloud/secret-manager: Client for accessing Google Secret Manager
- md5: For generating data hashes
- fs-extra: Enhanced file system operations

## Features

- **AI-Generated Images**: Creates professional profile images for appraisers using Google Vertex AI
- **Intelligent Caching**: Implements multi-level caching to avoid unnecessary regeneration
- **Build-time Integration**: Automatically detects appraisers without profile images during build
- **Cloud Storage**: Stores generated images in Google Cloud Storage and ImageKit CDN for persistence and fast delivery
- **API Endpoints**: Provides REST API endpoints for image generation

## Architecture

The service consists of the following components:

1. **Image Generator**: Interfaces with Vertex AI to generate images based on appraiser data
2. **Image Cache**: Manages local and cloud-based caching of generated images
3. **Generation Script**: Scans for appraisers without images during build time
4. **Web API**: Provides endpoints for on-demand image generation

## Deployment Note

**Important**: This service is **NOT** built or deployed as part of the Netlify build process for the main site. It is deployed separately as a standalone service on Google Cloud Run with its own configuration and secrets management.

## Usage

### Image Generation Process

The image generation workflow operates as follows:

1. This service runs independently on Cloud Run and exposes API endpoints
2. During the main site build process, a separate script in the main repository:
   - Scans the directory for appraisers without profile images
   - Calls this service's API to generate images if needed
   - Updates the appraiser records with the returned image URLs (typically from ImageKit)

### API Usage

The service provides API endpoints for image generation:

```javascript
// Generate an image for a single appraiser
fetch('/api/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    appraiser: {
      id: '123',
      name: 'Jane Smith',
      gender: 'female',
      specialization: 'Modern Art'
    }
  })
})
  .then(response => response.json())
  .then(data => console.log(data.imageUrl));

// Generate images for multiple appraisers
fetch('/api/generate-bulk', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    appraisers: [
      { id: '123', name: 'Jane Smith', gender: 'female', specialization: 'Modern Art' },
      { id: '124', name: 'John Doe', gender: 'male', specialization: 'Antique Furniture' }
    ]
  })
});
```

## Setup

### Prerequisites

- Node.js 18+
- Google Cloud Platform account with Vertex AI API enabled
- Service account with permissions for Vertex AI and Cloud Storage
- ImageKit account for CDN image delivery

### Installation

1. Clone the repository
2. Create a `.env` file from `.env.example`
3. Add your Google Cloud service account key to `config/service-account-key.json`
4. Install dependencies:

```bash
npm install
```

### Running Locally

```bash
npm start
```

### Deploying to Cloud Run

This service is designed to be deployed to Google Cloud Run:

```bash
gcloud run deploy appraisily-image-generation \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

## Secret Management

This service uses Google Cloud Secret Manager for sensitive API keys and credentials:

- **OPEN_AI_API_SEO**: OpenAI API key for GPT-4o prompt generation 
- **IMAGEKIT_API_KEY**: ImageKit private/API key for image uploads

These secrets are configured in the Cloud Run service directly and are **not** part of the Netlify build environment. When deploying updates to Cloud Run, ensure these secrets are properly configured.

## Caching Strategy

The service implements a multi-level caching strategy:

1. **ImageKit CDN**: Primary storage for production-ready images with fast global delivery 
2. **Local Filesystem Cache**: Images are stored locally in the `data/images` directory
3. **Google Cloud Storage Cache**: Images are also stored in Google Cloud Storage
4. **Manifest File**: A `cache-manifest.json`

## Request Format

### Generate Image for Appraiser
```json
POST /api/generate
{
  "appraiser": {
    "id": "unique-appraiser-id",
    "name": "Appraiser Name",
    "specialties": ["Fine Art", "Antiques"],
    "city": "City Name",
    "state": "State Name"
  },
  "customPrompt": "Optional custom prompt to override automatic generation"
}
```

The `appraiser.id` field is required. Other fields improve image quality but are optional.

## Error Handling

The service returns appropriate HTTP status codes and descriptive error messages:

- `400 Bad Request` - Missing required fields
- `402 Payment Required` - Black Forest AI credit limit exceeded
- `500 Internal Server Error` - Error generating or processing image

### Payment Required Errors (402)

When the Black Forest AI service returns a 402 error (payment required), the API will return a descriptive error message with the status code 402:

```json
{
  "error": "Payment required for image generation service",
  "details": "Request failed with status code 402",
  "resolution": "Please check the Black Forest AI account status and billing information."
}
```

## Debugging Tools

Several testing and debugging tools are available in the repository:

- `test-api-debug.js` - A comprehensive test script that makes various API calls and logs the responses
- `test-bfai-client.js` - Tests the Black Forest AI client directly
- `test-generation.js` - Tests the image generation functionality
- `test-bulk.js` - Tests the bulk generation endpoint

To run the debug test script:

```bash
# Install dependencies if needed
npm install

# Set the API URL in your .env file or use the default
echo "API_URL=https://your-api-url.app" > .env

# Run the test
node test-api-debug.js
```

The script will create a detailed log file with request and response information.