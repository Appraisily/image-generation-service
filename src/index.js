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

// Generate image endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const { appraiser, customPrompt } = req.body;
    
    if (!appraiser || !appraiser.id) {
      return res.status(400).json({ error: 'Invalid appraiser data. ID is required.' });
    }
    
    logger.info(`Received request to generate image for appraiser: ${appraiser.id}`);
    
    // Skip cache check - directly generate an image
    logger.info(`Generating new image for appraiser: ${appraiser.id}`);
    
    try {
      // Generate a new image
      const result = await imageGenerator.generateImage(appraiser, customPrompt);
      
      if (result.error) {
        logger.error(`Error generating image: ${result.error}`);
        return res.status(500).json({ error: result.error });
      }
      
      return res.status(200).json({ 
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`Error generating image: ${error.message}`);
      return res.status(500).json({ error: `Error generating image: ${error.message}` });
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