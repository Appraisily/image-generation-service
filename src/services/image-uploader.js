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

      // Preprocess data if it's a stream (enhanced version)
      let processedData = data;
      if (data && typeof data === 'object' && typeof data.pipe === 'function') {
        logger.warn('Detected stream data - attempting to handle it safely');
        logger.info('Processing stream data...');
        
        try {
          // Instead of throwing an error for streams that aren't readable,
          // create a new empty buffer and proceed with the upload
          if (!data.readable) {
            logger.error('Stream is not in readable state - attempting recovery');
            
            // Try recovery paths
            if (data._readableState && data._readableState.buffer) {
              // Try to access internal buffer (for some stream types)
              logger.info('Attempting to recover stream data from internal buffer');
              const bufferObj = data._readableState.buffer;
              
              if (bufferObj && typeof bufferObj.slice === 'function') {
                try {
                  processedData = Buffer.from(bufferObj.slice());
                  logger.info(`Recovery from internal buffer successful: ${processedData.length} bytes`);
                } catch (bufferError) {
                  logger.error(`Failed to recover from internal buffer: ${bufferError.message}`);
                  // Create an empty buffer instead of throwing an error
                  processedData = Buffer.alloc(0);
                  logger.info('Created empty buffer as fallback');
                }
              }
            } else if (data.buffer && Buffer.isBuffer(data.buffer)) {
              // Some streams have a buffer property directly accessible
              logger.info('Using stream.buffer property for recovery');
              processedData = data.buffer; 
              logger.info(`Recovery from stream.buffer successful: ${processedData.length} bytes`);
            } else {
              // Create an empty buffer instead of throwing an error
              logger.warn('Stream is not readable and no recovery option available, creating empty buffer');
              processedData = Buffer.alloc(0);
              logger.info('Created empty buffer as fallback');
            }
          } else {
            // Stream is readable, so we can process it normally
            logger.info('Stream is readable, proceeding with normal processing');
            
            // Create a function to read a stream into a buffer
            const streamToBuffer = (stream) => {
              return new Promise((resolve, reject) => {
                // First check if stream is actually readable
                if (!stream.readable) {
                  logger.warn('Stream is not in readable state - attempting recovery with empty buffer');
                  resolve(Buffer.alloc(0));
                  return;
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
                  
                  // Set a timeout to prevent hanging
                  const timeout = setTimeout(() => {
                    logger.error('Stream reading timed out');
                    reject(new Error('Timeout while reading stream'));
                  }, 10000); // 10 second timeout
                  
                  // Clear timeout on success or error
                  stream.on('end', () => clearTimeout(timeout));
                  stream.on('error', () => clearTimeout(timeout));
                } catch (eventError) {
                  logger.error(`Error attaching stream events: ${eventError.message}`);
                  return reject(eventError);
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
          }
          
          // If source is 'stream', change it to 'buffer' for further processing
          if (source.toLowerCase() === 'stream') {
            processedSource = 'buffer';
            logger.info('Changed source type from stream to buffer for processing');
          }
        } catch (streamError) {
          logger.error(`Failed to process stream: ${streamError.message}`);
          
          // More detailed error logging to help diagnose the issue
          logger.error(`Stream error stack: ${streamError.stack}`);
          
          // Try multiple recovery mechanisms
          let recovered = false;
          
          // Recovery method 1: Check for buffer property
          if (data.buffer && Buffer.isBuffer(data.buffer)) {
            logger.info('Recovering using stream.buffer property');
            processedData = data.buffer;
            logger.info(`Recovery successful: ${processedData.length} bytes`);
            recovered = true;
          } 
          // Recovery method 2: Check for _readableState buffer 
          else if (data._readableState && data._readableState.buffer) {
            logger.info('Recovering using _readableState.buffer property');
            try {
              const bufferObj = data._readableState.buffer;
              if (bufferObj && typeof bufferObj.slice === 'function') {
                processedData = Buffer.from(bufferObj.slice());
                logger.info(`Recovery from internal buffer successful: ${processedData.length} bytes`);
                recovered = true;
              }
            } catch (bufferError) {
              logger.error(`Failed to recover from internal buffer: ${bufferError.message}`);
            }
          }
          
          // If all recovery methods failed, create empty buffer and continue
          if (!recovered) {
            logger.warn(`No recovery method succeeded. Creating empty buffer fallback.`);
            processedData = Buffer.alloc(0);
            logger.info('Created empty buffer as fallback');
          }
        }
      }

      let result;

      switch (source.toLowerCase()) {
        case 'base64':
          // Handle base64 data upload (enhanced version)
          logger.debug(`Sending base64 data to ImageKit. Data type: ${typeof processedData}, length: ${processedData ? (typeof processedData === 'string' ? processedData.length : 'not a string') : 0}`);
          try {
            // Ensure data is a valid base64 string
            if (typeof processedData !== 'string') {
              logger.warn(`Base64 data is not a string. Converting to base64 string...`);
              
              // If it's a Buffer, convert to base64 string
              if (Buffer.isBuffer(processedData)) {
                processedData = processedData.toString('base64');
                logger.debug(`Converted Buffer to base64 string. New length: ${processedData.length}`);
              } else if (processedData instanceof Uint8Array) {
                // Handle Uint8Array conversion
                processedData = Buffer.from(processedData).toString('base64');
                logger.debug(`Converted Uint8Array to base64 string. New length: ${processedData.length}`);
              } else if (processedData && typeof processedData === 'object') {
                // Attempt to convert object to string
                try {
                  if (typeof processedData.toString === 'function') {
                    // Try using toString() method
                    const strData = processedData.toString();
                    if (strData && strData !== '[object Object]') {
                      processedData = strData;
                      logger.debug(`Converted object to string using toString(). New value: ${processedData.substring(0, 50)}...`);
                    } else {
                      // toString() returned default value, try JSON stringify
                      processedData = JSON.stringify(processedData);
                      logger.debug(`Converted object to JSON string. New length: ${processedData.length}`);
                      // This likely isn't base64, but we'll proceed and let error handling catch it
                    }
                  } else {
                    // No toString() method, use JSON stringify
                    processedData = JSON.stringify(processedData);
                    logger.debug(`Converted object to JSON string. New length: ${processedData.length}`);
                  }
                } catch (conversionError) {
                  logger.error(`Failed to convert object to string: ${conversionError.message}`);
                  throw new Error(`Cannot convert data to base64 string: ${conversionError.message}`);
                }
              } else {
                throw new Error(`Unsupported data type for base64 upload: ${typeof processedData}. Must be a string or Buffer.`);
              }
            }
            
            // Check if this is a data URI and handle it properly
            if (processedData.startsWith('data:')) {
              logger.info('Detected base64 with data URI prefix, handling appropriately');
              // Extract the MIME type if available for better extension handling
              try {
                const mimeMatch = processedData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,/);
                if (mimeMatch && mimeMatch[1]) {
                  const mimeType = mimeMatch[1];
                  logger.debug(`Extracted MIME type from data URI: ${mimeType}`);
                  
                  // Add file extension to fileName if it doesn't have one
                  if (fileName && !fileName.includes('.')) {
                    const ext = mimeType === 'image/jpeg' ? '.jpg' : 
                               mimeType === 'image/png' ? '.png' : 
                               mimeType === 'image/gif' ? '.gif' : 
                               mimeType === 'image/webp' ? '.webp' : '.jpg';
                    fileName += ext;
                    logger.debug(`Added file extension based on MIME type: ${fileName}`);
                  }
                }
                
                // Check for proper base64 content
                const base64Content = processedData.split(',')[1];
                if (!base64Content || base64Content.trim().length === 0) {
                  logger.error('Invalid data URI: missing base64 content after comma');
                  throw new Error('Invalid data URI: missing base64 content');
                }
              } catch (mimeError) {
                logger.warn(`Error parsing MIME type from data URI: ${mimeError.message}`);
                // Continue without MIME type extraction
              }
              // The imagekitClient.uploadImageFromBase64 will handle the data URI correctly
            } else {
              // Validate base64 string format (basic check)
              if (!/^[A-Za-z0-9+/=]+$/.test(processedData.replace(/\s/g, ''))) {
                logger.warn('Warning: Base64 data contains invalid characters. This might not be properly encoded base64.');
                
                // Try to clean up the string (remove non-base64 chars)
                try {
                  const cleanedBase64 = processedData.replace(/[^A-Za-z0-9+/=]/g, '');
                  if (cleanedBase64.length < processedData.length) {
                    logger.info(`Cleaned base64 string: removed ${processedData.length - cleanedBase64.length} invalid characters`);
                    processedData = cleanedBase64;
                  }
                } catch (cleanError) {
                  logger.warn(`Failed to clean base64 string: ${cleanError.message}`);
                  // Continue with the original string
                }
              }
              
              // Add data URI prefix if missing
              if (!processedData.startsWith('data:')) {
                // Default to image/jpeg if we can't determine the type
                processedData = `data:image/jpeg;base64,${processedData}`;
                logger.debug('Added data URI prefix (image/jpeg) to base64 string');
              }
            }
            
            // Ensure the base64 string isn't empty after processing
            if (!processedData || processedData.length === 0) {
              throw new Error('Base64 data is empty after processing');
            }
            
            logger.debug(`Calling uploadImageFromBase64 with data length: ${processedData.length}`);
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
  },

  /**
   * Upload from base64 string directly to avoid stream issues
   * @param {String} base64String - The raw base64 string (without data URI prefix)
   * @param {String} fileName - The filename to use
   * @param {String} folder - Target folder in ImageKit
   * @param {Array} tags - Array of tags to apply
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Upload result with URL
   */
  async uploadFromBase64String(base64String, fileName, folder, tags = [], metadata = {}) {
    try {
      logger.info(`Processing direct base64 string upload, length: ${base64String?.length || 0}`);
      
      if (!base64String || typeof base64String !== 'string') {
        throw new Error('Base64 string is required and must be a string');
      }
      
      // Clean the base64 string (remove whitespace and non-base64 characters)
      const cleanedBase64 = base64String.replace(/[^A-Za-z0-9+/=]/g, '');
      
      if (cleanedBase64.length < base64String.length) {
        logger.info(`Cleaned base64 string: removed ${base64String.length - cleanedBase64.length} invalid characters`);
      }
      
      // Convert base64 to buffer
      let imageBuffer;
      try {
        imageBuffer = Buffer.from(cleanedBase64, 'base64');
        logger.info(`Converted base64 to buffer: ${imageBuffer.length} bytes`);
        
        if (imageBuffer.length === 0) {
          logger.warn('Converted buffer is empty, base64 string may be invalid');
        }
      } catch (bufferError) {
        logger.error(`Error converting base64 to buffer: ${bufferError.message}`);
        throw new Error(`Failed to convert base64 to buffer: ${bufferError.message}`);
      }
      
      // Detect MIME type from the buffer if possible
      let mimeType = 'image/jpeg'; // Default
      if (imageBuffer.length > 2) {
        const header = imageBuffer.slice(0, 2).toString('hex');
        if (header === 'ffd8') {
          mimeType = 'image/jpeg';
        } else if (header === '8950') {
          mimeType = 'image/png';
        } else if (header === '4749') {
          mimeType = 'image/gif';
        }
        logger.info(`Detected MIME type from buffer: ${mimeType}`);
      }
      
      // Ensure fileName has proper extension
      if (fileName && !fileName.includes('.')) {
        const ext = mimeType === 'image/jpeg' ? '.jpg' : 
                    mimeType === 'image/png' ? '.png' : 
                    mimeType === 'image/gif' ? '.gif' : '.jpg';
        fileName += ext;
        logger.info(`Added extension to filename: ${fileName}`);
      }
      
      // Upload directly using imagekit client
      const client = await imagekitClient.ensureImageKitClient();
      
      logger.info(`Uploading to ImageKit using client. File: ${fileName}, Folder: ${folder}`);
      const uploadOptions = {
        file: imageBuffer,
        fileName: fileName || `upload_${Date.now()}.jpg`,
        folder: folder || 'uploaded-images',
        useUniqueFileName: true,
        tags: tags || [],
        metadata: metadata || {}
      };
      
      logger.info(`Calling ImageKit client with options: ${JSON.stringify({
        ...uploadOptions,
        file: `<Buffer of ${imageBuffer.length} bytes>`
      })}`);
      
      const response = await client.upload(uploadOptions);
      
      if (!response || !response.url) {
        throw new Error('Failed to get URL from ImageKit upload response');
      }
      
      logger.info(`Successfully uploaded image to ImageKit: ${response.url}`);
      return {
        url: response.url,
        fileId: response.fileId,
        name: response.name,
        size: response.size || imageBuffer.length
      };
    } catch (error) {
      logger.error(`Error in uploadFromBase64String: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      throw error;
    }
  },
};

module.exports = imageUploader;