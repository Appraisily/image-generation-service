/**
 * Black Forest AI Client Service
 * Provides functionality to interact with the Black Forest AI API for image generation
 */

const axios = require('axios');
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

// Initialize Black Forest API credentials
let bflApiKey = process.env.BFL_API_KEY;

// Log API key status without exposing the key
logger.info(`Black Forest API Key directly configured: ${bflApiKey ? 'Yes' : 'No'}`);

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

// Try to get Black Forest API key from Secret Manager if not in environment
(async () => {
  if (!bflApiKey) {
    logger.info('Black Forest API Key not found in environment, checking Secret Manager...');
    bflApiKey = await getSecret('BFL_API_KEY');
    logger.info(`Black Forest API Key from Secret Manager: ${bflApiKey ? 'Retrieved' : 'Not found'}`);
  }
})();

// Ensure we have the API key before making requests
const ensureApiKey = async () => {
  if (!bflApiKey) {
    logger.info('Black Forest API Key not found, attempting to retrieve from Secret Manager...');
    bflApiKey = await getSecret('BFL_API_KEY');
    
    if (!bflApiKey) {
      throw new Error('Black Forest API Key not available');
    }
  }
  
  return bflApiKey;
};

/**
 * Generate an image using Black Forest AI's Flux Pro model
 * @param {String} prompt - The prompt for image generation
 * @returns {Promise<Object>} - The generated image data
 */
const generateImage = async (prompt) => {
  try {
    // Ensure we have the API key
    const apiKey = await ensureApiKey();
    
    logger.info('Sending request to Black Forest AI Flux Pro model');
    
    // First, submit the generation request
    const submitResponse = await axios.post(
      'https://api.us1.bfl.ai/v1/flux-pro-1.1',
      {
        prompt: prompt,
        width: 1024,
        height: 576, // 16:9 aspect ratio
      },
      {
        headers: {
          'accept': 'application/json',
          'x-key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!submitResponse.data || !submitResponse.data.id) {
      throw new Error('Failed to obtain request ID from Black Forest AI API');
    }
    
    const requestId = submitResponse.data.id;
    logger.info(`Generation request submitted, ID: ${requestId}`);
    
    // Poll for results
    let result = null;
    let attempts = 0;
    const maxAttempts = 30; // Maximum polling attempts (15 seconds at 500ms intervals)
    
    while (attempts < maxAttempts) {
      attempts++;
      
      // Wait 500ms between polls
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const resultResponse = await axios.get(
        `https://api.us1.bfl.ai/v1/get_result?id=${requestId}`,
        {
          headers: {
            'accept': 'application/json',
            'x-key': apiKey
          }
        }
      );
      
      if (resultResponse.data.status === 'Error') {
        throw new Error(`Error generating image: ${resultResponse.data.error || 'Unknown error'}`);
      }
      
      if (resultResponse.data.status === 'Ready') {
        result = resultResponse.data;
        break;
      }
      
      logger.info(`Generation status: ${resultResponse.data.status}, attempt ${attempts}/${maxAttempts}`);
    }
    
    if (!result) {
      throw new Error('Timed out waiting for image generation');
    }
    
    if (!result.result || !result.result.sample) {
      throw new Error('No image URL in response');
    }
    
    logger.info('Successfully received image from Black Forest AI');
    return {
      imageUrl: result.result.sample,
      success: true
    };
  } catch (error) {
    logger.error(`Error generating image with Black Forest AI: ${error.message}`);
    throw error;
  }
};

module.exports = {
  generateImage,
  ensureApiKey
}; 