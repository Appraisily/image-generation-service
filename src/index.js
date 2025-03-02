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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve cached images
app.use('/images', express.static(path.join(__dirname, '../data/images')));

// Serve prompts for debugging/monitoring (disabled in production)
if (process.env.NODE_ENV !== 'production') {
  app.use('/prompts', express.static(path.join(__dirname, '../data/prompts')));
}

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
          logger.error(`Black Forest AI payment issue: ${result.error}`);
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
        logger.error(`Black Forest AI payment issue: ${error.message}`);
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

// Start server
app.listen(PORT, () => {
  logger.info(`Image Generation Service running on port ${PORT}`);
}); 