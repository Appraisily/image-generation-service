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
 * @param {Object|String} options - The upload options or folder string
 * @returns {Promise<Object>} - The upload response including the URL
 */
const uploadImage = async (imageBuffer, fileName, options = {}) => {
  try {
    const client = await ensureImageKitClient();
    
    // Validate imageBuffer
    if (!imageBuffer) {
      logger.error('Invalid image buffer: buffer is null or undefined');
      throw new Error('Image buffer cannot be null or undefined');
    }
    
    if (!Buffer.isBuffer(imageBuffer)) {
      logger.error(`Invalid image buffer: expected Buffer object but got ${typeof imageBuffer}`);
      throw new Error(`Expected Buffer object but got ${typeof imageBuffer}`);
    }
    
    logger.debug(`Image buffer validation passed. Buffer size: ${imageBuffer.length} bytes`);
    
    // Handle case where options is a string (backward compatibility)
    const folder = typeof options === 'string' ? options : (options.folder || 'appraiser-images');
    
    logger.info(`Uploading image to ImageKit: ${fileName} in folder: ${folder}`);
    
    // Create upload options, merging any provided options
    const uploadOptions = {
      file: imageBuffer,
      fileName: fileName,
      folder: folder,
      useUniqueFileName: true,
      ...(typeof options === 'object' ? options : {})
    };
    
    // Remove folder from uploadOptions if it was added above to avoid duplication
    if (typeof options === 'object' && options.folder) {
      delete uploadOptions.folder;
      uploadOptions.folder = folder;
    }
    
    logger.debug(`Prepared upload options: ${JSON.stringify({
      ...uploadOptions,
      file: `<Buffer of ${imageBuffer.length} bytes>`
    })}`);
    
    try {
      logger.debug('Calling ImageKit SDK upload method...');
      const response = await client.upload(uploadOptions);
      
      if (!response) {
        logger.error('ImageKit upload returned null or undefined response');
        throw new Error('ImageKit upload failed with an empty response');
      }
      
      logger.debug(`ImageKit upload response: ${JSON.stringify(response)}`);
      
      if (!response.url) {
        logger.error(`ImageKit response missing URL: ${JSON.stringify(response)}`);
        throw new Error('Failed to get URL from ImageKit upload response');
      }
      
      logger.info(`Successfully uploaded image to ImageKit: ${response.url}`);
      return {
        url: response.url,
        fileId: response.fileId,
        name: response.name,
        size: response.size
      };
    } catch (uploadError) {
      logger.error(`ImageKit upload SDK error: ${uploadError.message}`);
      logger.error(`ImageKit error stack: ${uploadError.stack}`);
      throw uploadError;
    }
  } catch (error) {
    logger.error(`Error uploading image to ImageKit: ${error.message}`);
    logger.error(`Upload error stack: ${error.stack}`);
    throw error;
  }
};

/**
 * Upload an image from a URL to ImageKit
 * @param {String} imageUrl - The URL of the image to upload
 * @param {String} fileName - The file name to use (optional)
 * @param {Object|String} options - The upload options or folder string
 * @returns {Promise<Object>} - The upload response including the URL
 */
const uploadImageFromUrl = async (imageUrl, fileName = null, options = {}) => {
  try {
    const client = await ensureImageKitClient();
    
    // Generate a filename if not provided
    if (!fileName) {
      fileName = `image_${Date.now()}.jpg`;
    }
    
    // Handle case where options is a string (backward compatibility)
    const folder = typeof options === 'string' ? options : (options.folder || 'appraiser-images');
    
    logger.info(`Uploading image from URL to ImageKit: ${fileName} in folder: ${folder}`);
    
    // Create upload options, merging any provided options
    const uploadOptions = {
      file: imageUrl,
      fileName: fileName,
      folder: folder,
      useUniqueFileName: true,
      ...(typeof options === 'object' ? options : {})
    };
    
    // Remove folder from uploadOptions if it was added above to avoid duplication
    if (typeof options === 'object' && options.folder) {
      delete uploadOptions.folder;
      uploadOptions.folder = folder;
    }
    
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
 * Upload an image from base64 string to ImageKit
 * @param {String} base64Data - The base64 string of the image (with or without data URI prefix)
 * @param {String} fileName - The file name to use
 * @param {Object|String} options - The upload options or folder string
 * @returns {Promise<Object>} - The upload response including the URL
 */
const uploadImageFromBase64 = async (base64Data, fileName, options = {}) => {
  try {
    logger.debug(`Processing base64 upload for fileName: ${fileName}`);
    
    // Validate input
    if (!base64Data) {
      logger.error('Base64 data is empty or undefined');
      throw new Error('Base64 data cannot be empty');
    }
    
    logger.debug(`Base64 data type: ${typeof base64Data}, length: ${base64Data.length}`);

    // If base64 string includes data URI prefix, remove it
    let imageData = base64Data;
    if (base64Data.startsWith('data:')) {
      logger.debug('Base64 data contains data URI prefix, attempting to extract content');
      const matches = base64Data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const mimeType = matches[1];
        imageData = matches[2];
        logger.debug(`Data URI prefix removed. MIME type: ${mimeType}, data length: ${imageData.length}`);
      } else {
        logger.warn('Failed to parse data URI prefix properly, using raw input');
      }
    }
    
    // Basic validation of base64 characters
    if (!/^[A-Za-z0-9+/=]+$/.test(imageData)) {
      logger.warn('Base64 data contains invalid characters');
    }
    
    try {
      // Convert base64 to buffer
      logger.debug('Converting base64 to buffer...');
      const imageBuffer = Buffer.from(imageData, 'base64');
      logger.debug(`Buffer created successfully. Size: ${imageBuffer.length} bytes`);
      
      // Check if buffer is valid
      if (imageBuffer.length === 0) {
        logger.error('Generated buffer is empty');
        throw new Error('Failed to create valid buffer from base64 data');
      }
      
      // Use the uploadImage function with the buffer
      logger.debug('Proceeding to upload buffer to ImageKit');
      return await uploadImage(imageBuffer, fileName, options);
      
    } catch (bufferError) {
      logger.error(`Buffer conversion error: ${bufferError.message}`);
      logger.error(`Buffer error stack: ${bufferError.stack}`);
      throw new Error(`Failed to process base64 data: ${bufferError.message}`);
    }
    
  } catch (error) {
    logger.error(`Error uploading base64 image to ImageKit: ${error.message}`);
    logger.error(`Base64 upload error stack: ${error.stack}`);
    throw error;
  }
};

module.exports = {
  uploadImage,
  uploadImageFromUrl,
  uploadImageFromBase64,
  ensureImageKitClient
}; 