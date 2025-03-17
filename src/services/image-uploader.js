/**
 * Image Uploader Service
 * Provides functionality to upload images to ImageKit from various sources
 */

const { logger } = require('../utils/logger');
const https = require('https');
const imagekitClient = require('./imagekit-client');

const imageUploader = {
  /**
   * Upload an image to ImageKit from various sources (base64, URL, or Buffer)
   * @param {Object} options - Upload options
   * @param {String} options.source - Source type: 'base64', 'url', or 'buffer'
   * @param {String|Buffer} options.data - The image data (base64 string, URL, or Buffer)
   * @param {String} options.fileName - The filename to use (optional)
   * @param {String} options.folder - The target folder on ImageKit (optional)
   * @param {Object} options.metadata - Additional metadata for the image (optional)
   * @param {Boolean} options.useUniqueFileName - Whether to use a unique filename (default: true)
   * @returns {Promise<Object>} - The upload response
   */
  async uploadImage(options) {
    try {
      const {
        source,
        data,
        fileName = `image_${Date.now()}`,
        folder = 'uploaded-images',
        metadata = {},
        useUniqueFileName = true,
        tags = []
      } = options;

      if (!source || !data) {
        throw new Error('Source type and image data are required');
      }

      logger.info(`Processing image upload. Source: ${source}, FileName: ${fileName}, Folder: ${folder}`);

      const uploadOptions = {
        folder,
        useUniqueFileName,
        tags,
        ...metadata
      };

      let result;

      switch (source.toLowerCase()) {
        case 'base64':
          // Handle base64 data upload
          logger.debug(`Sending base64 data to ImageKit. Data type: ${typeof data}, length: ${data ? data.length : 0}`);
          try {
            result = await imagekitClient.uploadImageFromBase64(data, fileName, uploadOptions);
          } catch (base64Error) {
            logger.error(`Base64 upload failed: ${base64Error.message}`);
            logger.error(`Base64 error stack: ${base64Error.stack}`);
            throw base64Error;
          }
          break;

        case 'url':
          // Handle URL-based upload
          logger.debug(`Sending URL to ImageKit: ${data ? (typeof data === 'string' ? data.substring(0, 30) + '...' : typeof data) : 'undefined'}`);
          try {
            result = await imagekitClient.uploadImageFromUrl(data, fileName, uploadOptions);
          } catch (urlError) {
            logger.error(`URL upload failed: ${urlError.message}`);
            throw urlError;
          }
          break;

        case 'buffer':
          // Handle buffer upload
          logger.debug(`Sending buffer to ImageKit. Buffer size: ${data ? (Buffer.isBuffer(data) ? data.length : 'Not a buffer') : 'undefined'}`);
          try {
            result = await imagekitClient.uploadImage(data, fileName, uploadOptions);
          } catch (bufferError) {
            logger.error(`Buffer upload failed: ${bufferError.message}`);
            throw bufferError;
          }
          break;

        default:
          throw new Error(`Unsupported source type: ${source}. Supported types are 'base64', 'url', and 'buffer'`);
      }

      logger.info(`Successfully uploaded image to ImageKit: ${result.url}`);
      return result;
    } catch (error) {
      logger.error(`Error in image upload: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      throw error;
    }
  },

  /**
   * Download an image from a URL
   * @param {String} url - The image URL
   * @returns {Promise<Buffer>} - The image buffer
   */
  async downloadImage(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download image, status code: ${response.statusCode}`));
          return;
        }
        
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', (error) => reject(error));
      }).on('error', (error) => {
        reject(error);
      });
    });
  }
};

module.exports = imageUploader;