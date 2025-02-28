/**
 * ImageKit Client Service
 * Provides functionality to upload images to ImageKit CDN
 */

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

// Initialize ImageKit credentials
let imagekitConfig = {
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/appraisily'
};

// Log credentials status without exposing the actual keys
logger.info(`ImageKit public key configured: ${imagekitConfig.publicKey ? 'Yes' : 'No'}`);
logger.info(`ImageKit private key configured: ${imagekitConfig.privateKey ? 'Yes' : 'No'}`);
logger.info(`ImageKit URL endpoint: ${imagekitConfig.urlEndpoint}`);

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

// Try to get ImageKit keys from Secret Manager if not in environment
(async () => {
  if (!imagekitConfig.publicKey) {
    logger.info('ImageKit public key not found in environment, checking Secret Manager...');
    imagekitConfig.publicKey = await getSecret('IMAGEKIT_PUBLIC_KEY');
    logger.info(`ImageKit public key from Secret Manager: ${imagekitConfig.publicKey ? 'Retrieved' : 'Not found'}`);
  }
  
  if (!imagekitConfig.privateKey) {
    logger.info('ImageKit private key not found in environment, checking Secret Manager...');
    // Check both possible secret names
    imagekitConfig.privateKey = await getSecret('IMAGEKIT_PRIVATE_KEY') || await getSecret('IMAGEKIT_API_KEY');
    logger.info(`ImageKit private key from Secret Manager: ${imagekitConfig.privateKey ? 'Retrieved' : 'Not found'}`);
  }
})();

// Initialize ImageKit instance
let imagekit = null;

// Ensure we have the ImageKit credentials before making requests
const ensureImageKitClient = async () => {
  if (imagekit) return imagekit;
  
  if (!imagekitConfig.publicKey || !imagekitConfig.privateKey) {
    // Try to get the keys from Secret Manager
    if (!imagekitConfig.publicKey) {
      imagekitConfig.publicKey = await getSecret('IMAGEKIT_PUBLIC_KEY');
    }
    
    if (!imagekitConfig.privateKey) {
      imagekitConfig.privateKey = await getSecret('IMAGEKIT_PRIVATE_KEY') || await getSecret('IMAGEKIT_API_KEY');
    }
    
    if (!imagekitConfig.publicKey || !imagekitConfig.privateKey) {
      throw new Error('ImageKit credentials not available');
    }
  }
  
  // Initialize ImageKit
  imagekit = new ImageKit({
    publicKey: imagekitConfig.publicKey,
    privateKey: imagekitConfig.privateKey,
    urlEndpoint: imagekitConfig.urlEndpoint
  });
  
  logger.info('ImageKit client initialized successfully');
  return imagekit;
};

/**
 * Upload an image buffer to ImageKit
 * @param {Buffer} imageBuffer - The image buffer to upload
 * @param {String} fileName - The file name to use
 * @param {String} folder - The folder to upload to (optional)
 * @returns {Promise<Object>} - The upload response including the URL
 */
const uploadImage = async (imageBuffer, fileName, folder = 'appraiser-images') => {
  try {
    const client = await ensureImageKitClient();
    
    logger.info(`Uploading image to ImageKit: ${fileName}`);
    
    const uploadOptions = {
      file: imageBuffer,
      fileName: fileName,
      folder: folder,
      useUniqueFileName: true
    };
    
    const response = await client.upload(uploadOptions);
    
    if (!response || !response.url) {
      throw new Error('Failed to get URL from ImageKit upload response');
    }
    
    logger.info(`Successfully uploaded image to ImageKit: ${response.url}`);
    return {
      url: response.url,
      fileId: response.fileId,
      name: response.name,
      size: response.size
    };
  } catch (error) {
    logger.error(`Error uploading image to ImageKit: ${error.message}`);
    throw error;
  }
};

/**
 * Upload an image from a URL to ImageKit
 * @param {String} imageUrl - The URL of the image to upload
 * @param {String} fileName - The file name to use (optional)
 * @param {String} folder - The folder to upload to (optional)
 * @returns {Promise<Object>} - The upload response including the URL
 */
const uploadImageFromUrl = async (imageUrl, fileName = null, folder = 'appraiser-images') => {
  try {
    const client = await ensureImageKitClient();
    
    // Generate a filename if not provided
    if (!fileName) {
      fileName = `image_${Date.now()}.jpg`;
    }
    
    logger.info(`Uploading image from URL to ImageKit: ${fileName}`);
    
    const uploadOptions = {
      file: imageUrl,
      fileName: fileName,
      folder: folder,
      useUniqueFileName: true
    };
    
    const response = await client.upload(uploadOptions);
    
    if (!response || !response.url) {
      throw new Error('Failed to get URL from ImageKit upload response');
    }
    
    logger.info(`Successfully uploaded image to ImageKit: ${response.url}`);
    return {
      url: response.url,
      fileId: response.fileId,
      name: response.name,
      size: response.size
    };
  } catch (error) {
    logger.error(`Error uploading image to ImageKit: ${error.message}`);
    throw error;
  }
};

module.exports = {
  uploadImage,
  uploadImageFromUrl,
  ensureImageKitClient
}; 