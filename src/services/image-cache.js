/**
 * Image Cache Service
 * Provides functionality to cache and retrieve generated images
 */

const fs = require('fs-extra');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const ImageKit = require('imagekit');
const { logger } = require('../utils/logger');

// Initialize Google Cloud Storage
let storage;
try {
  storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'your-project-id',
  });
  logger.info('Google Cloud Storage initialized successfully');
} catch (error) {
  logger.error(`Failed to initialize Google Cloud Storage: ${error.message}`);
}

// Initialize ImageKit
let imagekit;
try {
  imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY || process.env.IMAGEKIT_API_KEY, // Use either private key or API key
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/appraisily'
  });
  logger.info('ImageKit initialized successfully');
} catch (error) {
  logger.error(`Failed to initialize ImageKit: ${error.message}`);
}

// Cache configuration
const CACHE_DIR = path.join(__dirname, '../../data/images');
const CACHE_MANIFEST_PATH = path.join(__dirname, '../../data/cache-manifest.json');
const PROMPTS_LOG_PATH = path.join(__dirname, '../../data/prompts-log.json');
const BUCKET_NAME = process.env.STORAGE_BUCKET || 'appraisily-generated-images';
const IMAGEKIT_FOLDER = process.env.IMAGEKIT_FOLDER || 'appraiser-images';

// Make sure the cache directory exists
fs.ensureDirSync(CACHE_DIR);

// Initialize or load the cache manifest
let cacheManifest = { images: {} };
if (fs.existsSync(CACHE_MANIFEST_PATH)) {
  try {
    cacheManifest = fs.readJsonSync(CACHE_MANIFEST_PATH);
  } catch (error) {
    logger.error(`Error loading cache manifest: ${error.message}`);
  }
}

// Initialize or load the prompts log
let promptsLog = { prompts: {} };
if (fs.existsSync(PROMPTS_LOG_PATH)) {
  try {
    promptsLog = fs.readJsonSync(PROMPTS_LOG_PATH);
  } catch (error) {
    logger.error(`Error loading prompts log: ${error.message}`);
  }
}

const imageCache = {
  /**
   * Get an image from cache
   * @param {String} appraiserId - The appraiser ID
   * @returns {Promise<Object|null>} - The cached image data or null if not found
   */
  async getFromCache(appraiserId) {
    try {
      // Check the manifest
      if (cacheManifest.images[appraiserId]) {
        const cacheEntry = cacheManifest.images[appraiserId];
        
        // Check if we have an ImageKit URL
        if (cacheEntry.imagekitUrl) {
          logger.info(`ImageKit cache hit for appraiser ${appraiserId}`);
          return {
            imageUrl: cacheEntry.imagekitUrl,
            metadata: cacheEntry.metadata,
            prompt: promptsLog.prompts[appraiserId]?.prompt || null
          };
        }
        
        const filePath = path.join(CACHE_DIR, cacheEntry.filename);
        
        // Check if the file exists locally
        if (await fs.pathExists(filePath)) {
          logger.info(`Local cache hit for appraiser ${appraiserId}`);
          return {
            imageUrl: `/images/${cacheEntry.filename}`,
            metadata: cacheEntry.metadata,
            prompt: promptsLog.prompts[appraiserId]?.prompt || null
          };
        } else {
          // Try to fetch from cloud storage if available
          try {
            if (storage) {
              logger.info(`Local cache miss, attempting to fetch from cloud storage for ${appraiserId}`);
              const bucket = storage.bucket(BUCKET_NAME);
              const file = bucket.file(`images/${cacheEntry.filename}`);
              const [exists] = await file.exists();
              
              if (exists) {
                // Download the file from cloud storage
                await file.download({ destination: filePath });
                logger.info(`Downloaded image from cloud storage for ${appraiserId}`);
                
                return {
                  imageUrl: `/images/${cacheEntry.filename}`,
                  metadata: cacheEntry.metadata,
                  prompt: promptsLog.prompts[appraiserId]?.prompt || null
                };
              }
            }
          } catch (cloudError) {
            logger.error(`Error fetching from cloud storage: ${cloudError.message}`);
          }
          
          // File not found locally or in cloud storage, remove from manifest
          delete cacheManifest.images[appraiserId];
          await this.saveManifest();
        }
      }
      
      logger.info(`Cache miss for appraiser ${appraiserId}`);
      return null;
    } catch (error) {
      logger.error(`Error getting image from cache: ${error.message}`);
      return null;
    }
  },
  
  /**
   * Save an image to cache
   * @param {String} appraiserId - The appraiser ID
   * @param {String} imageUrl - The image URL
   * @param {Buffer} imageBuffer - The image buffer
   * @param {Object} metadata - Metadata about the image
   * @param {String} prompt - The prompt used to generate the image
   * @returns {Promise<Object>} - Result with ImageKit URL if available
   */
  async saveToCache(appraiserId, imageUrl, imageBuffer, metadata, prompt) {
    try {
      // Extract the filename from the URL
      const filename = path.basename(imageUrl);
      const filePath = path.join(CACHE_DIR, filename);
      
      // Ensure the file exists
      if (!await fs.pathExists(filePath) && imageBuffer) {
        await fs.writeFile(filePath, imageBuffer);
      }
      
      // Upload to ImageKit if available
      let imagekitUrl = null;
      if (imagekit && imageBuffer) {
        try {
          const uploadResult = await imagekit.upload({
            file: imageBuffer,
            fileName: filename,
            folder: IMAGEKIT_FOLDER,
            useUniqueFileName: false,
            tags: [`appraiser-${appraiserId}`, 'ai-generated'],
            metadata: {
              appraiserId: appraiserId,
              generatedAt: metadata.generatedAt,
              appraiserDataHash: metadata.appraiserDataHash
            }
          });
          
          if (uploadResult && uploadResult.url) {
            imagekitUrl = uploadResult.url;
            logger.info(`Uploaded image to ImageKit: ${imagekitUrl}`);
          }
        } catch (imagekitError) {
          logger.error(`Error uploading to ImageKit: ${imagekitError.message}`);
        }
      }
      
      // Update the manifest
      cacheManifest.images[appraiserId] = {
        filename,
        imagekitUrl,  // Add the ImageKit URL to the manifest
        metadata: {
          ...metadata,
          cachedAt: new Date().toISOString()
        }
      };
      
      // Save the manifest
      await this.saveManifest();
      
      // Save the prompt to the log
      if (prompt) {
        promptsLog.prompts[appraiserId] = {
          prompt,
          generatedAt: new Date().toISOString(),
          appraiserDataHash: metadata.appraiserDataHash
        };
        
        await this.savePromptsLog();
        logger.info(`Saved prompt to log for appraiser ${appraiserId}`);
      }
      
      // Upload to cloud storage if available
      if (storage) {
        try {
          const bucket = storage.bucket(BUCKET_NAME);
          await bucket.upload(filePath, {
            destination: `images/${filename}`,
            metadata: {
              contentType: 'image/jpeg',
              metadata: {
                appraiserId,
                generatedAt: metadata.generatedAt,
                appraiserDataHash: metadata.appraiserDataHash,
                prompt: prompt ? 'yes' : 'no',
                imagekitUrl: imagekitUrl || 'none'
              }
            }
          });
          logger.info(`Uploaded image to cloud storage: ${filename}`);
          
          // Also save the prompt to cloud storage
          if (prompt) {
            const promptFile = `prompts/${appraiserId}_${metadata.appraiserDataHash}.txt`;
            const localPromptPath = path.join(CACHE_DIR, '..', 'prompts', `${appraiserId}_${metadata.appraiserDataHash}.txt`);
            
            // Ensure prompts directory exists
            await fs.ensureDir(path.dirname(localPromptPath));
            await fs.writeFile(localPromptPath, prompt);
            
            await bucket.upload(localPromptPath, {
              destination: promptFile,
              metadata: {
                contentType: 'text/plain',
                metadata: {
                  appraiserId,
                  generatedAt: metadata.generatedAt,
                  appraiserDataHash: metadata.appraiserDataHash
                }
              }
            });
            logger.info(`Uploaded prompt to cloud storage: ${promptFile}`);
          }
        } catch (cloudError) {
          logger.error(`Error uploading to cloud storage: ${cloudError.message}`);
        }
      }
      
      logger.info(`Image saved to cache for appraiser ${appraiserId}`);
      
      // Return result with ImageKit URL if available
      return {
        success: true,
        imagekitUrl: imagekitUrl,
        localUrl: `/images/${filename}`
      };
    } catch (error) {
      logger.error(`Error saving image to cache: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  },
  
  /**
   * Save the cache manifest to disk
   * @returns {Promise<void>}
   */
  async saveManifest() {
    try {
      // Add a timestamp to the manifest
      cacheManifest.lastUpdated = new Date().toISOString();
      
      // Save the manifest
      await fs.writeJson(CACHE_MANIFEST_PATH, cacheManifest, { spaces: 2 });
      logger.info('Cache manifest saved');
    } catch (error) {
      logger.error(`Error saving cache manifest: ${error.message}`);
    }
  },
  
  /**
   * Save the prompts log to disk
   * @returns {Promise<void>}
   */
  async savePromptsLog() {
    try {
      // Add a timestamp to the log
      promptsLog.lastUpdated = new Date().toISOString();
      
      // Save the log
      await fs.writeJson(PROMPTS_LOG_PATH, promptsLog, { spaces: 2 });
      logger.info('Prompts log saved');
    } catch (error) {
      logger.error(`Error saving prompts log: ${error.message}`);
    }
  },
  
  /**
   * Check if an image needs to be regenerated based on appraiser data
   * @param {String} appraiserId - The appraiser ID
   * @param {Object} appraiser - The appraiser data
   * @param {String} newHash - The new hash of appraiser data
   * @returns {Boolean} - Whether the image needs to be regenerated
   */
  shouldRegenerateImage(appraiserId, appraiser, newHash) {
    if (!cacheManifest.images[appraiserId]) {
      return true; // No cache entry exists
    }
    
    const cacheEntry = cacheManifest.images[appraiserId];
    
    // Check if the data hash has changed
    if (cacheEntry.metadata.appraiserDataHash !== newHash) {
      return true;
    }
    
    // Check if the cache is too old (older than 6 months)
    const cachedAt = new Date(cacheEntry.metadata.cachedAt);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    if (cachedAt < sixMonthsAgo) {
      return true;
    }
    
    return false;
  }
};

module.exports = { imageCache }; 