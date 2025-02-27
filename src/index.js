/**
 * Main server file for the Appraisily Image Generation Service
 * This service provides an API for generating and managing AI-generated profile images for art appraisers
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { imageGenerator } = require('./services/image-generator');
const { imageCache } = require('./services/image-cache');
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
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Generate image endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const { appraiser, customPrompt } = req.body;
    
    if (!appraiser || !appraiser.id) {
      return res.status(400).json({ error: 'Invalid appraiser data. ID is required.' });
    }
    
    logger.info(`Received request to generate image for appraiser: ${appraiser.id}`);
    
    // Check cache first
    const cachedImage = await imageCache.getFromCache(appraiser.id);
    if (cachedImage) {
      logger.info(`Using cached image for appraiser: ${appraiser.id}`);
      return res.status(200).json({ 
        success: true, 
        cached: true,
        imageUrl: cachedImage.imageUrl,
        metadata: cachedImage.metadata,
        prompt: cachedImage.prompt
      });
    }
    
    // Generate new image
    logger.info(`Generating new image for appraiser: ${appraiser.id}`);
    
    // If customPrompt is provided, use it instead of generating one with GPT
    const result = customPrompt 
      ? await imageGenerator.generateImageWithCustomPrompt(appraiser, customPrompt)
      : await imageGenerator.generateImage(appraiser);
    
    // Cache the image with prompt
    const cacheResult = await imageCache.saveToCache(
      appraiser.id, 
      result.imageUrl, 
      result.imageBuffer, 
      {
        generatedAt: new Date().toISOString(),
        appraiserDataHash: result.appraiserDataHash
      },
      result.prompt
    );
    
    // Use ImageKit URL if available, otherwise use local URL
    const imageUrl = cacheResult.imagekitUrl || result.imageUrl;
    
    return res.status(200).json({
      success: true,
      cached: false,
      imageUrl: imageUrl,
      metadata: {
        generatedAt: new Date().toISOString(),
        appraiserDataHash: result.appraiserDataHash,
        source: cacheResult.imagekitUrl ? 'imagekit' : 'local'
      },
      prompt: result.prompt
    });
  } catch (error) {
    logger.error(`Error generating image: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate image', message: error.message });
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
          // Check cache first
          const cachedImage = await imageCache.getFromCache(appraiser.id);
          
          if (cachedImage) {
            logger.info(`Using cached image for appraiser: ${appraiser.id}`);
            results.push({
              id: appraiser.id,
              success: true,
              cached: true,
              imageUrl: cachedImage.imageUrl,
              source: cachedImage.imageUrl.includes('ik.imagekit.io') ? 'imagekit' : 'local',
              promptCached: !!cachedImage.prompt
            });
            continue;
          }
          
          // Generate new image
          logger.info(`Generating new image for appraiser: ${appraiser.id}`);
          const result = await imageGenerator.generateImage(appraiser);
          
          // Cache the image with prompt
          const cacheResult = await imageCache.saveToCache(
            appraiser.id, 
            result.imageUrl, 
            result.imageBuffer, 
            {
              generatedAt: new Date().toISOString(),
              appraiserDataHash: result.appraiserDataHash
            },
            result.prompt
          );
          
          // Use ImageKit URL if available, otherwise use local URL
          const imageUrl = cacheResult.imagekitUrl || result.imageUrl;
          
          results.push({
            id: appraiser.id,
            success: true,
            cached: false,
            imageUrl: imageUrl,
            source: cacheResult.imagekitUrl ? 'imagekit' : 'local',
            promptGenerated: !!result.prompt
          });
        } catch (error) {
          logger.error(`Error generating image for appraiser ${appraiser.id}: ${error.message}`);
          results.push({
            id: appraiser.id,
            success: false,
            error: error.message
          });
        }
      }
      
      // Save results to a log file
      const resultsLog = {
        timestamp: new Date().toISOString(),
        totalProcessed: appraisers.length,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length,
        results: results
      };
      
      await fs.writeJSON(
        path.join(__dirname, '../logs', `bulk-generation-${new Date().toISOString().replace(/:/g, '-')}.json`),
        resultsLog
      );
      
      logger.info(`Bulk generation completed. Success: ${resultsLog.successCount}, Failures: ${resultsLog.failureCount}`);
    })();
  } catch (error) {
    logger.error(`Error starting bulk generation: ${error.message}`);
    res.status(500).json({ error: 'Failed to start bulk generation', message: error.message });
  }
});

// Get prompt for an appraiser
app.get('/api/prompt/:appraiserId', async (req, res) => {
  try {
    const { appraiserId } = req.params;
    
    if (!appraiserId) {
      return res.status(400).json({ error: 'Appraiser ID is required' });
    }
    
    // Check cache for prompt
    const cachedImage = await imageCache.getFromCache(appraiserId);
    
    if (cachedImage && cachedImage.prompt) {
      return res.status(200).json({
        success: true,
        appraiserId,
        prompt: cachedImage.prompt,
        metadata: cachedImage.metadata
      });
    }
    
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
    res.status(500).json({ error: 'Failed to retrieve prompt', message: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  logger.info(`Image Generation Service running on port ${PORT}`);
}); 