# Appraisily Image Generation Service

This service automatically generates professional profile images for art appraisers in the Appraisily directory using Google's Vertex AI Imagen model.

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
4. **Manifest File**: A `cache-manifest.json` file tracks all cached images with metadata
5. **Content-based Hashing**: Images are only regenerated when appraiser data changes
6. **Time-based Expiry**: Cached images expire after 6 months

## ImageKit Integration

This service uses ImageKit.io as the primary image CDN for serving generated images to production environments. Benefits include:

1. **Global CDN**: Fast image delivery worldwide with low latency
2. **Image Optimization**: Automatic image optimization for different devices
3. **Transformation API**: On-the-fly image resizing and transformations
4. **Secure Delivery**: URL-based security parameters
5. **Reliable Persistence**: Secure and stable image hosting

### ImageKit Configuration

To use ImageKit with this service, configure the following environment variables:

```dotenv
IMAGEKIT_PUBLIC_KEY=your-imagekit-public-key
IMAGEKIT_PRIVATE_KEY=your-imagekit-private-key  # or IMAGEKIT_API_KEY from Secret Manager
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/appraisily
IMAGEKIT_FOLDER=appraiser-images
```

Images are uploaded to ImageKit during the image generation process and the resulting URLs are used throughout the system.

## Integration with Main Repo

This service is integrated with the main Appraisily monorepo as a Git submodule, which allows it to:

1. Access appraiser data from the directory frontend (when running locally or during development)
2. Generate images during testing and development
3. Store images in the correct locations for development preview
4. Share cache between development sessions 