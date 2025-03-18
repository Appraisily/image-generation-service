/**
 * Main server file for the Appraisily Image Generation Service
 * This service provides an API for generating and managing AI-generated profile images for art appraisers
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const imageGenerator = require('./services/image-generator');
const imageUploader = require('./services/image-uploader');
const { logger } = require('./utils/logger');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Ensure required directories exist
(async () => {
  try {
    await fs.ensureDir(path.join(__dirname, '../data/images'));
    await fs.ensureDir(path.join(__dirname, '../data/prompts'));
    await fs.ensureDir(path.join(__dirname, '../logs'));
    logger.info('Required directories have been created');
  } catch (error) {
    logger.error(`Error creating directories: ${error.message}`);
  }
})();

// Get Google Cloud Project ID from available environment variables
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || 'civil-forge-403609';

// Check critical environment variables
if (!process.env.GOOGLE_CLOUD_PROJECT) {
  logger.error('Neither GOOGLE_CLOUD_PROJECT nor GOOGLE_CLOUD_PROJECT_ID environment variables are set');
  logger.error('This is required for Vertex AI and Secret Manager to work properly');
  logger.error('Please set one of these variables in your .env file or in your Cloud Run configuration');
  // We'll continue execution, but log a clear warning
}

// Log environment configuration without exposing sensitive information
logger.info(`Starting service with configuration:`);
logger.info(`- NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
logger.info(`- PORT: ${PORT}`);
logger.info(`- GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT || 'not set'}`);
logger.info(`- IMAGEKIT configured: ${process.env.IMAGEKIT_PUBLIC_KEY ? 'Yes' : 'No'}`);
logger.info(`- OpenAI API Key configured: ${process.env.OPEN_AI_API_SEO ? 'Yes' : 'No'}`);

// Middleware
app.use(cors());

// Custom JSON parsing middleware with error handling
app.use((req, res, next) => {
  // Only apply to JSON content type
  if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
    let body = '';
    let bodySize = 0;
    const maxBodySize = 50 * 1024 * 1024; // 50MB limit
    
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > maxBodySize) {
        // If body exceeds limit, respond with 413 error
        logger.error(`Request entity too large: ${bodySize} bytes exceeds ${maxBodySize} bytes limit`);
        res.status(413).json({ 
          error: 'Request entity too large',
          message: `Request body exceeds ${maxBodySize / (1024 * 1024)}MB limit`,
          help: 'Try reducing the size of your request or use a different upload method'
        });
        req.destroy(); // End the request
        return;
      }
      body += chunk.toString();
    });
    
    req.on('end', () => {
      if (body) {
        try {
          req.body = JSON.parse(body);
          next();
        } catch (error) {
          // Get the endpoint being accessed
          const endpoint = req.originalUrl;
          
          // Log the error with the malformed JSON
          logger.error(`Malformed JSON in request to ${endpoint}: ${error.message}`);
          logger.debug(`Malformed JSON body: ${body}`);
          
          // Send helpful response based on the endpoint
          let instruction = '';
          let example = {};
          
          switch (endpoint) {
            case '/api/generate':
              instruction = 'This endpoint requires a valid JSON object with an appraiser object containing at least an id field.';
              example = {
                appraiser: {
                  id: "appraiser-123",
                  firstName: "John",
                  lastName: "Doe",
                  specialty: "Fine Art"
                },
                customPrompt: "Optional custom prompt"
              };
              break;
              
            case '/api/generate-location':
              instruction = 'This endpoint requires a valid JSON object with a location object containing at least an id field.';
              example = {
                location: {
                  id: "location-123",
                  name: "Art Gallery Name",
                  type: "gallery",
                  city: "New York",
                  state: "NY"
                },
                customPrompt: "Optional custom prompt"
              };
              break;
              
            case '/api/generate-bulk':
              instruction = 'This endpoint requires a valid JSON object with an appraisers array containing at least one appraiser with an id.';
              example = {
                appraisers: [
                  {
                    id: "appraiser-123",
                    firstName: "John",
                    lastName: "Doe"
                  },
                  {
                    id: "appraiser-456",
                    firstName: "Jane",
                    lastName: "Smith"
                  }
                ]
              };
              break;
              
            case '/api/upload':
              instruction = 'This endpoint requires a valid JSON object with source (url or base64) and data fields.';
              example = {
                source: "url",
                data: "https://example.com/image.jpg",
                fileName: "optional-filename",
                folder: "optional/folder/path"
              };
              break;
              
            default:
              instruction = 'This endpoint requires a valid JSON payload.';
              example = { message: "Please check the API documentation for the correct format" };
          }
          
          // Return helpful error response
          return res.status(400).json({
            error: 'Malformed JSON in request body',
            message: `Unable to parse JSON: ${error.message}`,
            instruction: instruction,
            example: example,
            tip: 'Ensure your JSON is properly formatted with quotes around keys and string values.'
          });
        }
      } else {
        next();
      }
    });
  } else {
    next();
  }
});

// Standard middleware for already parsed bodies (e.g., from form submissions)
app.use(express.json({ 
  limit: '50mb',  // Increase JSON body size limit to 50MB
  verify: (req, res, buf, encoding) => {
    // This will be skipped if our custom middleware already parsed the JSON
    if (req.body && Object.keys(req.body).length > 0) {
      // Body already parsed by our custom middleware
      return;
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Increase URL-encoded body size limit to 50MB

// Serve cached images
app.use('/images', express.static(path.join(__dirname, '../data/images')));

// Serve prompts for debugging/monitoring (disabled in production)
if (process.env.NODE_ENV !== 'production') {
  app.use('/prompts', express.static(path.join(__dirname, '../data/prompts')));
}

// Basic HTML documentation page for the root route
app.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Art Appraiser Image Generation API</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 { color: #2c3e50; }
    h2 { color: #3498db; margin-top: 30px; }
    h3 { color: #2980b9; }
    pre {
      background-color: #f8f8f8;
      border: 1px solid #ddd;
      border-radius: 3px;
      padding: 15px;
      overflow: auto;
    }
    code {
      font-family: Consolas, Monaco, 'Andale Mono', monospace;
      background-color: #f8f8f8;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .error { color: #e74c3c; }
    .note { 
      background-color: #f9f9f9;
      border-left: 4px solid #3498db;
      padding: 10px 15px;
      margin: 20px 0;
    }
    .warning {
      background-color: #fff8dc;
      border-left: 4px solid #f39c12;
      padding: 10px 15px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <h1>Art Appraiser Image Generation API</h1>
  <p>This service provides an API for generating AI-powered images for art appraisers.</p>
  
  <div class="note">
    <strong>Developer Note:</strong> For detailed API documentation in JSON format, visit <a href="/api/docs">/api/docs</a>
  </div>
  
  <h2>API Endpoints</h2>
  
  <h3>GET /api/docs</h3>
  <p>Returns detailed API documentation in JSON format.</p>
  
  <h3>GET /health</h3>
  <p>Returns the health status and configuration of the service.</p>
  
  <h3>POST /api/generate</h3>
  <p>Generate an image for an art appraiser.</p>
  <h4>Request Format:</h4>
  <pre><code>{
  "appraiser": {
    "id": "unique-appraiser-id",
    "name": "Appraiser Name",
    "specialties": ["Fine Art", "Antiques"],
    "city": "City Name",
    "state": "State Name"
  },
  "customPrompt": "Optional custom prompt to override automatic generation"
}</code></pre>

  <h3>POST /api/upload</h3>
  <p>Upload an image from URL or base64 to ImageKit.</p>
  <h4>Request Format:</h4>
  <pre><code>{
  "source": "url", // or "base64"
  "data": "https://example.com/image.jpg", // or base64 string
  "fileName": "optional-file-name",
  "folder": "optional/folder/path", 
  "tags": ["optional", "image", "tags"],
  "metadata": {
    "optional": "metadata"
  }
}</code></pre>
  
  <h4>Required Fields:</h4>
  <ul>
    <li><code>appraiser.id</code> - A unique identifier for the appraiser</li>
  </ul>
  
  <h4>Optional Fields:</h4>
  <ul>
    <li><code>appraiser.name</code> - The appraiser's name</li>
    <li><code>appraiser.specialties</code> - An array of specialties</li>
    <li><code>appraiser.city</code> - The city where the appraiser is located</li>
    <li><code>appraiser.state</code> - The state where the appraiser is located</li>
    <li><code>customPrompt</code> - A custom prompt to override the automatic prompt generation</li>
  </ul>
  
  <h2>Common Errors</h2>
  
  <h3>400 Bad Request</h3>
  <p>Missing required fields in the request.</p>
  <pre><code>{
  "error": "Missing appraiser object in request body",
  "help": "Request body must include an appraiser object. See /api/docs for proper format."
}</code></pre>
  
  <h3>402 Payment Required</h3>
  <p>The image generation service has exhausted its credits or requires payment.</p>
  <pre><code>{
  "error": "Payment required for image generation service",
  "details": "Request failed with status code 402",
  "resolution": "Please check the Black Forest AI account status and billing information."
}</code></pre>
  
  <div class="warning">
    <strong>Important:</strong> If you encounter 402 errors, the Black Forest AI service account needs to be recharged with credits.
    This cannot be fixed through code changes.
  </div>
  
  <h2>Debugging</h2>
  <p>For debugging issues with the API, try running the <code>test-api-debug.js</code> script in the repository which makes various API calls with different parameter formats.</p>
</body>
</html>
  `;
  
  res.set('Content-Type', 'text/html');
  res.send(html);
});

// Health check endpoint
app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT ? 'configured' : 'not configured',
    googleCloudProjectSource: process.env.GOOGLE_CLOUD_PROJECT_ID ? 'GOOGLE_CLOUD_PROJECT_ID' : 
                              process.env.GOOGLE_CLOUD_PROJECT ? 'GOOGLE_CLOUD_PROJECT' : 'default fallback',
    imagekitConfigured: process.env.IMAGEKIT_PUBLIC_KEY ? true : false,
    openaiConfigured: process.env.OPEN_AI_API_SEO ? true : false,
  };
  
  res.status(200).json(healthStatus);
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  const apiDocs = {
    service: 'Art Appraiser Image Generation API',
    version: '1.0.0',
    endpoints: [
      {
        path: '/api/generate',
        method: 'POST',
        description: 'Generate an image for an art appraiser',
        requestFormat: {
          appraiser: {
            id: 'unique-appraiser-id',
            name: 'Appraiser Name',
            specialties: ['Fine Art', 'Antiques'],
            city: 'City Name',
            state: 'State Name'
          },
          customPrompt: 'Optional custom prompt to override automatic generation'
        },
        responseFormat: {
          success: true,
          data: {
            imageUrl: 'https://example.com/image.jpg',
            originalUrl: 'https://original-source.com/image.jpg',
            cached: false,
            prompt: 'The prompt used to generate the image',
            source: 'black-forest-ai'
          }
        },
        notes: 'The appraiser.id field is required. Other fields improve image quality but are optional.'
      },
      {
        path: '/api/generate-location',
        method: 'POST',
        description: 'Generate an image for a location',
        requestFormat: {
          location: {
            id: 'unique-location-id',
            name: 'Location Name',
            state: 'State Name'
          },
          customPrompt: 'Optional custom prompt to override automatic generation'
        }
      },
      {
        path: '/api/generate-bulk',
        method: 'POST',
        description: 'Generate images for multiple appraisers',
        requestFormat: {
          appraisers: [
            {
              id: 'appraiser-id-1',
              name: 'Appraiser Name 1',
              specialties: ['Fine Art', 'Antiques']
            },
            {
              id: 'appraiser-id-2',
              name: 'Appraiser Name 2',
              specialties: ['Jewelry', 'Watches']
            }
          ]
        }
      },
      {
        path: '/api/upload',
        method: 'POST',
        description: 'Upload an image to ImageKit from a URL or base64 data',
        requestFormat: {
          source: 'url or base64',
          data: 'The URL or base64 string of the image',
          fileName: 'Optional filename (default: timestamp-based name)',
          folder: 'Optional folder path on ImageKit (default: uploaded-images)',
          tags: ['Optional', 'tags', 'for', 'the', 'image'],
          metadata: {
            optional: 'Additional metadata for the image'
          }
        },
        responseFormat: {
          success: true,
          data: {
            url: 'https://ik.imagekit.io/yourEndpoint/path/to/image.jpg',
            fileId: 'file_id_returned_by_imagekit',
            name: 'final_file_name',
            size: 12345
          }
        },
        notes: 'Source must be either "url" or "base64". Data must contain the corresponding URL or base64 string.'
      }
    ],
    errorCodes: {
      400: 'Bad Request - Missing required fields',
      402: 'Payment Required - Black Forest AI credit limit exceeded',
      500: 'Internal Server Error - Error generating or processing image'
    }
  };
  
  res.status(200).json(apiDocs);
});

// Generate image endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const { appraiser, customPrompt } = req.body;
    
    // Improved request validation with helpful error messages
    if (!appraiser) {
      return res.status(400).json({ 
        error: 'Missing appraiser object in request body', 
        help: 'Request body must include an appraiser object. See /api/docs for proper format.'
      });
    }
    
    if (!appraiser.id) {
      return res.status(400).json({ 
        error: 'Invalid appraiser data. ID is required.',
        help: 'The appraiser object must include an id field. See /api/docs for proper format.'
      });
    }
    
    logger.info(`Received request to generate image for appraiser: ${appraiser.id}`);
    
    // Skip cache check - directly generate an image
    logger.info(`Generating new image for appraiser: ${appraiser.id}`);
    
    try {
      // Generate a new image
      const result = await imageGenerator.generateImage(appraiser, customPrompt);
      
      if (result.error) {
        // Handle payment required errors specifically
        if (result.error.includes('Payment required') || result.error.includes('402')) {
          logger.paymentError(`Black Forest AI payment issue: ${result.error}`);
          return res.status(402).json({ 
            error: 'Payment required for image generation service',
            details: result.error,
            resolution: 'Please check the Black Forest AI account status and billing information.'
          });
        }
        
        logger.error(`Error generating image: ${result.error}`);
        return res.status(500).json({ error: result.error });
      }
      
      return res.status(200).json({ 
        success: true,
        data: result
      });
    } catch (error) {
      // Special handling for 402 errors
      if (error.message.includes('402') || error.message.toLowerCase().includes('payment required')) {
        logger.paymentError(`Black Forest AI payment issue: ${error.message}`);
        return res.status(402).json({ 
          error: 'Payment required for image generation service',
          details: error.message,
          resolution: 'Please check the Black Forest AI account status and billing information.'
        });
      }
      
      logger.error(`Error generating image: ${error.message}`);
      return res.status(500).json({ error: `Error generating image: ${error.message}` });
    }
  } catch (error) {
    logger.error(`API error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Generate location image endpoint
app.post('/api/generate-location', async (req, res) => {
  try {
    const { location, customPrompt } = req.body;
    
    if (!location || !location.id) {
      return res.status(400).json({ error: 'Invalid location data. ID is required.' });
    }
    
    logger.info(`Received request to generate image for location: ${location.id}`);
    
    // Skip cache check - directly generate an image
    logger.info(`Generating new image for location: ${location.id}`);
    
    try {
      // Generate a new image
      // Note: This assumes imageGenerator has or will have a generateLocationImage method
      // You may need to implement this method in the image-generator.js file
      const result = await imageGenerator.generateLocationImage(location, customPrompt);
      
      if (result.error) {
        logger.error(`Error generating location image: ${result.error}`);
        return res.status(500).json({ error: result.error });
      }
      
      return res.status(200).json({ 
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`Error generating location image: ${error.message}`);
      return res.status(500).json({ error: `Error generating location image: ${error.message}` });
    }
  } catch (error) {
    logger.error(`API error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Bulk generate images endpoint
app.post('/api/generate-bulk', async (req, res) => {
  try {
    const { appraisers } = req.body;
    
    if (!appraisers || !Array.isArray(appraisers) || appraisers.length === 0) {
      return res.status(400).json({ error: 'Invalid request. Array of appraisers is required.' });
    }
    
    // Start processing in the background
    logger.info(`Starting bulk generation for ${appraisers.length} appraisers`);
    
    res.status(202).json({ 
      message: `Processing ${appraisers.length} images in the background.`,
      jobId: new Date().getTime().toString()
    });
    
    // Process images asynchronously after response
    (async () => {
      const results = [];
      
      for (const appraiser of appraisers) {
        try {
          // Skip cache check - directly generate an image
          logger.info(`Generating new image for appraiser: ${appraiser.id}`);
          
          const result = await imageGenerator.generateImage(appraiser);
          
          if (result.error) {
            logger.error(`Error generating image for appraiser ${appraiser.id}: ${result.error}`);
            results.push({
              id: appraiser.id,
              success: false,
              error: result.error
            });
            continue;
          }
          
          // Add result to results array
          results.push({
            id: appraiser.id,
            success: true,
            cached: false,
            imageUrl: result.imageUrl,
            source: result.source
          });
          
          logger.info(`Successfully generated image for appraiser: ${appraiser.id}`);
        } catch (error) {
          logger.error(`Error processing appraiser ${appraiser.id}: ${error.message}`);
          results.push({
            id: appraiser.id,
            success: false,
            error: error.message
          });
        }
      }
      
      logger.info(`Bulk generation completed. Results: ${JSON.stringify(results)}`);
    })().catch(error => {
      logger.error(`Unhandled error in bulk processing: ${error.message}`);
    });
  } catch (error) {
    logger.error(`API error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Get prompt for an appraiser
app.get('/api/prompt/:appraiserId', async (req, res) => {
  try {
    const { appraiserId } = req.params;
    
    if (!appraiserId) {
      return res.status(400).json({ error: 'Appraiser ID is required' });
    }
    
    // Skip cache check - we're not using cache anymore
    logger.info(`Checking local prompt file for appraiser: ${appraiserId}`);
    
    // Check prompt files
    const promptsDir = path.join(__dirname, '../data/prompts');
    const promptFile = path.join(promptsDir, `appraiser_${appraiserId}_prompt.txt`);
    
    if (await fs.pathExists(promptFile)) {
      const prompt = await fs.readFile(promptFile, 'utf8');
      return res.status(200).json({
        success: true,
        appraiserId,
        prompt,
        source: 'file'
      });
    }
    
    return res.status(404).json({
      success: false,
      error: 'No prompt found for the specified appraiser'
    });
  } catch (error) {
    logger.error(`Error retrieving prompt: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Upload image endpoint
app.post('/api/upload', async (req, res) => {
  try {
    const { source, data, fileName, folder, tags, metadata } = req.body;
    
    // Validate required fields
    if (!source || !data) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        help: 'Request must include "source" (url or base64) and "data" fields'
      });
    }
    
    // Validate source type
    if (!['url', 'base64', 'buffer'].includes(source.toLowerCase())) {
      return res.status(400).json({
        error: 'Invalid source type',
        help: 'Source must be either "url", "base64", or "buffer"'
      });
    }
    
    logger.info(`Received image upload request. Source: ${source}, Folder: ${folder || 'default'}`);
    
    // Enhanced debug information about the data being received
    const dataType = typeof data;
    const isBuffer = Buffer.isBuffer(data);
    const isStream = data && typeof data === 'object' && typeof data.pipe === 'function';
    
    logger.debug(`Image data details: Type: ${dataType}, IsBuffer: ${isBuffer}, IsStream: ${isStream}, Length: ${isBuffer ? data.length : 'unknown'}, HasToJSON: ${data && typeof data.toJSON === 'function'}`);
    
    // Handle stream data by converting to buffer
    let processedData = data;
    let processedSource = source;
    
    if (isStream) {
      logger.info(`Detected stream data. Attempting to convert to buffer before uploading...`);
      try {
        // Create a function to read a stream into a buffer
        const streamToBuffer = (stream) => {
          return new Promise((resolve, reject) => {
            // Check if the stream is readable before attaching listeners
            if (!stream.readable) {
              return reject(new Error('stream is not readable'));
            }
            
            const chunks = [];
            
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', (err) => reject(err));
            
            // Set a timeout to prevent hanging
            const timeout = setTimeout(() => {
              reject(new Error('Timeout while reading stream'));
            }, 10000); // 10 second timeout
            
            // Clear timeout on success or error
            stream.on('end', () => clearTimeout(timeout));
            stream.on('error', () => clearTimeout(timeout));
          });
        };
        
        // Try to convert the stream to a buffer
        processedData = await streamToBuffer(data);
        processedSource = 'buffer'; // Change the source type to buffer
        logger.info(`Successfully converted stream to buffer: ${processedData.length} bytes`);
      } catch (streamError) {
        logger.error(`Error processing stream data: ${streamError.message}`);
        return res.status(500).json({
          error: `Failed to process stream data: ${streamError.message}`,
          help: 'Please convert the stream to buffer or base64 string before uploading'
        });
      }
    }
    
    // If we receive a buffer for a base64 source, convert it to base64 string
    if (source.toLowerCase() === 'base64' && isBuffer) {
      logger.info(`Converting buffer to base64 string for base64 source type`);
      processedData = data.toString('base64');
    }
    
    // If we receive an object that's not a buffer for base64 source, try to handle it
    if (source.toLowerCase() === 'base64' && dataType === 'object' && !isBuffer && !isStream) {
      logger.warn(`Received object for base64 source that is not a buffer. Attempting to stringify...`);
      try {
        processedData = JSON.stringify(data);
        logger.warn(`Converted object to string, but this may not be valid base64`);
      } catch (jsonError) {
        logger.error(`Failed to stringify object: ${jsonError.message}`);
        return res.status(400).json({
          error: 'Invalid base64 data',
          help: 'For base64 source, data must be a valid base64 string'
        });
      }
    }
    
    try {
      // Upload the image with the processed data
      const result = await imageUploader.uploadImage({
        source: processedSource || source,
        data: processedData || data,
        fileName: fileName || `upload_${Date.now()}`,
        folder: folder || 'uploaded-images',
        tags: tags || [],
        metadata: metadata || {},
        useUniqueFileName: true
      });
      
      return res.status(200).json({
        success: true,
        data: result
      });
      
    } catch (error) {
      logger.error(`Error uploading image: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      return res.status(500).json({ 
        error: `Failed to upload image: ${error.message}` 
      });
    }
  } catch (error) {
    logger.error(`API error in upload endpoint: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Global error handler middleware
app.use((err, req, res, next) => {
  // Log the error
  logger.error(`Unhandled error: ${err.message}`);
  logger.debug(err.stack);
  
  // Get the endpoint being accessed for customized help
  const endpoint = req.originalUrl;
  
  // Default error response
  let errorResponse = {
    error: 'Internal server error',
    message: err.message
  };
  
  // Check for specific error types
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    // JSON syntax error
    errorResponse = {
      error: 'Invalid JSON syntax',
      message: 'The request contains malformed JSON'
    };
    
    // Add endpoint-specific help
    switch (endpoint) {
      case '/api/generate':
        errorResponse.help = 'This endpoint requires an appraiser object with an id field';
        errorResponse.example = {
          appraiser: { id: "appraiser-123" }
        };
        break;
      case '/api/upload':
        errorResponse.help = 'This endpoint requires source and data fields';
        errorResponse.example = {
          source: "url",
          data: "https://example.com/image.jpg"
        };
        break;
      // Add other endpoints as needed
    }
    
    return res.status(400).json(errorResponse);
  }
  
  // For 4xx errors, we can be more helpful
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      error: err.message,
      help: 'Check the API documentation at /api/docs for correct usage'
    });
  }
  
  // Default to 500 for other errors
  res.status(500).json(errorResponse);
});

// Start server
app.listen(PORT, () => {
  logger.info(`Image Generation Service running on port ${PORT}`);
}); 