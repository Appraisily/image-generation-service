/**
 * Image Cache Service
 * Provides functionality to cache and retrieve generated images
 */

const fs = require('fs-extra');
const path = require('path');
const ImageKit = require('imagekit');
const { logger } = require('../utils/logger');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager').v1;

// Initialize Secret Manager
let secretManagerClient;
try {
  secretManagerClient = new SecretManagerServiceClient();
  logger.info('Secret Manager client initialized successfully');
} catch (error) {
  logger.error(`Failed to initialize Secret Manager: ${error.message}`);
}

// Function to get secret from Secret Manager
async function getSecret(secretName) {
  if (!secretManagerClient) {
    logger.warn(`Cannot access Secret Manager to retrieve ${secretName}`);
    return null;
  }

  try {
    // Use the normalized project ID from the environment variable
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
    if (!projectId) {
      logger.warn('GOOGLE_CLOUD_PROJECT environment variable not set');
      return null;
    }

    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    logger.info(`Attempting to access secret: ${secretName}`);
    
    const [version] = await secretManagerClient.accessSecretVersion({ name });
    const secretValue = version.payload.data.toString('utf8');
    
    logger.info(`Successfully retrieved secret: ${secretName}`);
    return secretValue;
  } catch (error) {
    logger.error(`Error accessing secret ${secretName}: ${error.message}`);
    return null;
  }
}

// ImageKit configuration
let imagekitPrivateKey = process.env.IMAGEKIT_PRIVATE_KEY || process.env.IMAGEKIT_API_KEY;
let imagekitPublicKey = process.env.IMAGEKIT_PUBLIC_KEY;
const imagekitUrlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/appraisily';

// Try to get ImageKit keys from Secret Manager if not in environment
(async () => {
  if (!imagekitPrivateKey) {
    logger.info('ImageKit Private Key not found in environment, checking Secret Manager...');
    imagekitPrivateKey = await getSecret('IMAGEKIT_API_KEY');
    logger.info(`ImageKit Private Key from Secret Manager: ${imagekitPrivateKey ? 'Retrieved' : 'Not found'}`);
  }

  if (!imagekitPublicKey) {
    logger.info('ImageKit Public Key not found in environment, checking Secret Manager...');
    imagekitPublicKey = await getSecret('IMAGEKIT_PUBLIC_KEY');
    logger.info(`ImageKit Public Key from Secret Manager: ${imagekitPublicKey ? 'Retrieved' : 'Not found'}`);
  }
})();

// Initialize ImageKit
let imagekit;
try {
  imagekit = new ImageKit({
    publicKey: imagekitPublicKey,
    privateKey: imagekitPrivateKey,
    urlEndpoint: imagekitUrlEndpoint
  });
  logger.info('ImageKit initialized successfully');
} catch (error) {
  logger.error(`Failed to initialize ImageKit: ${error.message}`);
}

// Cache configuration
const CACHE_DIR = path.join(__dirname, '../../data/images');
const CACHE_MANIFEST_PATH = path.join(__dirname, '../../data/cache-manifest.json');
const PROMPTS_LOG_PATH = path.join(__dirname, '../../data/prompts-log.json');
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
          // File not found locally, remove from manifest
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
      // Generate a unique filename based on appraiser ID and timestamp
      const filename = `appraiser_${appraiserId}_${Date.now()}.jpg`;
      const filePath = path.join(CACHE_DIR, filename);
      
      // Ensure the cache directory exists
      await fs.ensureDir(CACHE_DIR);
      
      // Save the image locally
      await fs.writeFile(filePath, imageBuffer);
      
      // Upload to ImageKit if available
      let imagekitUrl = null;
      if (imagekit && imageBuffer) {
        try {
          logger.info(`Attempting to upload image to ImageKit for appraiser ${appraiserId}`);
          
          // Create folder structure: appraiser-images/[appraiser_id]
          const appraiserId_folder = `${IMAGEKIT_FOLDER}/${appraiserId}`;
          
          const uploadResult = await imagekit.upload({
            file: imageBuffer,
            fileName: 'profile.jpg', // Standardize the filename
            folder: appraiserId_folder,
            useUniqueFileName: false, // Overwrite if exists
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
      } else {
        logger.warn(`ImageKit not configured or image buffer not available, skipping upload for appraiser ${appraiserId}`);
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
      
      return {
        imageUrl: `/images/${filename}`,
        imagekitUrl,
        success: true
      };
    } catch (error) {
      logger.error(`Error saving image to cache: ${error.message}`);
      return {
        error: error.message,
        success: false
      };
    }
  },
  
  /**
   * Save the cache manifest to disk
   * @returns {Promise<void>}
   */
  async saveManifest() {
    try {
      await fs.writeJson(CACHE_MANIFEST_PATH, cacheManifest, { spaces: 2 });
      logger.info('Cache manifest saved successfully');
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
      await fs.writeJson(PROMPTS_LOG_PATH, promptsLog, { spaces: 2 });
      logger.info('Prompts log saved successfully');
    } catch (error) {
      logger.error(`Error saving prompts log: ${error.message}`);
    }
  }
};

module.exports = imageCache; 