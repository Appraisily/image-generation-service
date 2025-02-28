/**
 * fal-ai Client Service
 * Provides functionality to interact with the fal-ai API for image generation
 */

const { FalClient } = require('@fal-ai/client');
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

// Initialize fal-ai credentials
let falApiKey = process.env.FAL_API_KEY;

// Log API key status without exposing the key
logger.info(`fal-ai API Key directly configured: ${falApiKey ? 'Yes' : 'No'}`);

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

// Try to get fal-ai API key from Secret Manager if not in environment
(async () => {
  if (!falApiKey) {
    logger.info('fal-ai API Key not found in environment, checking Secret Manager...');
    falApiKey = await getSecret('FAL_API_KEY');
    logger.info(`fal-ai API Key from Secret Manager: ${falApiKey ? 'Retrieved' : 'Not found'}`);
  }
})();

// Initialize fal-ai client
let falClient = null;

const initFalClient = async () => {
  if (falClient) return falClient;
  
  try {
    if (!falApiKey) {
      falApiKey = await getSecret('FAL_API_KEY');
    }
    
    if (!falApiKey) {
      throw new Error('fal-ai API Key not available');
    }
    
    falClient = new FalClient({
      credentials: {
        key: falApiKey
      }
    });
    
    logger.info('fal-ai client initialized successfully');
    return falClient;
  } catch (error) {
    logger.error(`Failed to initialize fal-ai client: ${error.message}`);
    throw error;
  }
};

/**
 * Generate an image using fal-ai's Flux Ultra model
 * @param {String} prompt - The prompt for image generation
 * @returns {Promise<Object>} - The generated image data
 */
const generateImage = async (prompt) => {
  try {
    const client = await initFalClient();
    
    logger.info('Sending request to fal-ai Flux Ultra model');
    
    const result = await client.run({
      connectionId: 'flux-ultra',
      input: {
        prompt: prompt,
        image_size: 'landscape_16_9',
        sync_mode: true,
        num_images: 1,
        enable_safety_checks: true
      }
    });
    
    if (result && result.images && result.images.length > 0) {
      logger.info('Successfully received image from fal-ai');
      return {
        imageUrl: result.images[0].url,
        success: true
      };
    } else {
      logger.error('No images returned from fal-ai');
      throw new Error('No images returned from fal-ai');
    }
  } catch (error) {
    logger.error(`Error generating image with fal-ai: ${error.message}`);
    throw error;
  }
};

module.exports = {
  generateImage,
  initFalClient
}; 