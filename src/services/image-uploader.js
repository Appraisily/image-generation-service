/**
 * Image Uploader Service
 * Provides functionality to upload images to ImageKit from various sources
 */

const { logger } = require('../utils/logger');
const https = require('https');
const imagekitClient = require('./imagekit-client');

// Helper function to log detailed object information for debugging
const logObjectDetails = (obj, label = 'Object') => {
  if (!obj) {
    logger.debug(`${label}: null or undefined`);
    return;
  }
  
  if (typeof obj !== 'object') {
    logger.debug(`${label}: Not an object, type = ${typeof obj}`);
    return;
  }
  
  const isBuffer = Buffer.isBuffer(obj);
  const isStream = obj && typeof obj.pipe === 'function';
  const hasToJSON = obj && typeof obj.toJSON === 'function';
  const constructor = obj.constructor ? obj.constructor.name : 'Unknown';
  
  logger.debug(`${label} details:`);
  logger.debug(`- Type: ${typeof obj}`);
  logger.debug(`- Constructor: ${constructor}`);
  logger.debug(`- Is Buffer: ${isBuffer}`);
  logger.debug(`- Is Stream: ${isStream}`);
  logger.debug(`- Has toJSON: ${hasToJSON}`);
  
  if (isBuffer) {
    logger.debug(`- Buffer length: ${obj.length} bytes`);
  } else if (!isStream) {
    try {
      const keys = Object.keys(obj);
      logger.debug(`- Keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`);
    } catch (e) {
      logger.debug(`- Error getting keys: ${e.message}`);
    }
  }
};

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
      
      // Enhanced logging for debugging the data object
      logObjectDetails(data, 'Upload data');
      
      const uploadOptions = {
        folder,
        useUniqueFileName,
        tags,
        ...metadata
      };

      // Preprocess data if it's a stream
      let processedData = data;
      if (data && typeof data === 'object' && typeof data.pipe === 'function') {
        logger.warn('Detected stream data - attempting to read it into a buffer');
        logger.info('Processing stream data...');
        
        try {
          // Create a function to read a stream into a buffer
          const streamToBuffer = (stream) => {
            return new Promise((resolve, reject) => {
              // Enhanced stream validation
              if (!stream.readable) {
                logger.error('Stream is not in readable state');
                // Try to recover by creating a new empty buffer
                logger.info('Creating empty buffer as fallback');
                return resolve(Buffer.alloc(0));
              }
              
              const chunks = [];
              
              // Safer event attachment with error handling
              try {
                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('end', () => {
                  try {
                    const buffer = Buffer.concat(chunks);
                    logger.info(`Stream read complete: ${buffer.length} bytes`);
                    resolve(buffer);
                  } catch (concatError) {
                    logger.error(`Error concatenating chunks: ${concatError.message}`);
                    resolve(Buffer.alloc(0));
                  }
                });
                stream.on('error', (err) => {
                  logger.error(`Stream error: ${err.message}`);
                  reject(err);
                });
              } catch (eventError) {
                logger.error(`Error attaching stream events: ${eventError.message}`);
                return reject(eventError);
              }
              
              // Set a timeout to prevent hanging
              const timeout = setTimeout(() => {
                logger.error('Stream reading timed out');
                reject(new Error('Timeout while reading stream'));
              }, 10000); // 10 second timeout
              
              // Clear timeout on success or error
              try {
                stream.on('end', () => clearTimeout(timeout));
                stream.on('error', () => clearTimeout(timeout));
              } catch (error) {
                // Ignore errors when attaching cleanup listeners
                clearTimeout(timeout);
              }
            });
          };
          
          // Try to read the stream
          processedData = await streamToBuffer(data);
          
          // Verify we got a valid buffer
          if (!Buffer.isBuffer(processedData) || processedData.length === 0) {
            logger.warn('Stream produced empty or invalid buffer, checking if stream has a buffer property');
            
            // Some streams have a buffer property we can use directly
            if (data.buffer && Buffer.isBuffer(data.buffer)) {
              logger.info('Using stream.buffer property instead');
              processedData = data.buffer;
            } else {
              logger.warn('No valid buffer found in stream, upload may fail');
            }
          } else {
            logger.info(`Successfully read stream into buffer: ${processedData.length} bytes`);
          }
          
          // If source is 'stream', change it to 'buffer' for further processing
          if (source.toLowerCase() === 'stream') {
            processedSource = 'buffer';
            logger.info('Changed source type from stream to buffer for processing');
          }
        } catch (streamError) {
          logger.error(`Failed to read stream: ${streamError.message}`);
          
          // Try to recover - check if the stream has a direct buffer property we can use
          if (data.buffer && Buffer.isBuffer(data.buffer)) {
            logger.info('Recovering using stream.buffer property');
            processedData = data.buffer;
            logger.info(`Recovery successful: ${processedData.length} bytes`);
          } else {
            throw new Error(`Stream data cannot be processed: ${streamError.message}. Please convert to buffer or base64 before uploading.`);
          }
        }
      }

      let result;

      switch (source.toLowerCase()) {
        case 'base64':
          // Handle base64 data upload
          logger.debug(`Sending base64 data to ImageKit. Data type: ${typeof processedData}, length: ${processedData ? (typeof processedData === 'string' ? processedData.length : 'not a string') : 0}`);
          try {
            // Ensure data is a valid base64 string
            if (typeof processedData !== 'string') {
              logger.warn(`Base64 data is not a string. Converting to base64 string...`);
              
              // If it's a Buffer, convert to base64 string
              if (Buffer.isBuffer(processedData)) {
                processedData = processedData.toString('base64');
                logger.debug(`Converted Buffer to base64 string. New length: ${processedData.length}`);
              } else {
                throw new Error(`Unsupported data type for base64 upload: ${typeof processedData}. Must be a string or Buffer.`);
              }
            }
            
            // Validate base64 string format (basic check)
            if (!/^[A-Za-z0-9+/=]+$/.test(processedData.replace(/\s/g, ''))) {
              logger.warn('Warning: Base64 data contains invalid characters. This might not be properly encoded base64.');
            }
            
            result = await imagekitClient.uploadImageFromBase64(processedData, fileName, uploadOptions);
          } catch (base64Error) {
            logger.error(`Base64 upload failed: ${base64Error.message}`);
            logger.error(`Base64 error stack: ${base64Error.stack}`);
            throw base64Error;
          }
          break;

        case 'url':
          // Handle URL-based upload
          logger.debug(`Sending URL to ImageKit: ${processedData ? (typeof processedData === 'string' ? processedData.substring(0, 30) + '...' : typeof processedData) : 'undefined'}`);
          try {
            // Make sure data is a URL string
            if (typeof processedData !== 'string') {
              throw new Error(`URL upload requires a string URL, got ${typeof processedData}`);
            }
            
            // Validate URL format (basic check)
            if (!processedData.match(/^https?:\/\//i)) {
              logger.warn(`Warning: URL doesn't start with http:// or https:// - ${processedData.substring(0, 30)}...`);
            }
            
            result = await imagekitClient.uploadImageFromUrl(processedData, fileName, uploadOptions);
          } catch (urlError) {
            logger.error(`URL upload failed: ${urlError.message}`);
            throw urlError;
          }
          break;

        case 'buffer':
          // Handle buffer upload
          logger.debug(`Sending buffer to ImageKit. Buffer type: ${typeof processedData}, is Buffer: ${Buffer.isBuffer(processedData)}`);
          try {
            // Ensure data is a buffer or convert it
            if (!Buffer.isBuffer(processedData)) {
              logger.warn(`Data is not a Buffer. Converting...`);
              
              // If it's a string, try to convert from base64
              if (typeof processedData === 'string') {
                try {
                  // First, remove any data URI prefix if present
                  if (processedData.startsWith('data:')) {
                    const matches = processedData.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
                    if (matches && matches.length === 3) {
                      processedData = matches[2];
                      logger.debug('Removed data URI prefix from base64 string');
                    }
                  }
                  
                  processedData = Buffer.from(processedData, 'base64');
                  logger.debug(`Converted base64 string to Buffer. Size: ${processedData.length} bytes`);
                } catch (convError) {
                  throw new Error(`Failed to convert string to Buffer: ${convError.message}`);
                }
              } else {
                throw new Error(`Unsupported data type for buffer upload: ${typeof processedData}. Must be a Buffer or base64 string.`);
              }
            }
            
            result = await imagekitClient.uploadImage(processedData, fileName, uploadOptions);
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