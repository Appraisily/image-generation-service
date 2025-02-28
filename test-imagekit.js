/**
 * Test script for the ImageKit integration
 * 
 * This script tests the ability to upload images to ImageKit from both
 * a buffer and a URL.
 * 
 * Run with: node test-imagekit.js
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const imagekitClient = require('./src/services/imagekit-client');

// Create a simple logger for the test
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

// Function to download an image from a URL
const downloadImage = async (url) => {
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
};

// Test uploading an image buffer to ImageKit
const testBufferUpload = async () => {
  try {
    logger.info('Testing buffer upload to ImageKit...');
    
    // Sample image URL (a placeholder image)
    const sampleImageUrl = 'https://via.placeholder.com/800x600/3498db/ffffff?text=Test+Image';
    
    // Download the sample image
    logger.info(`Downloading sample image from ${sampleImageUrl}`);
    const imageBuffer = await downloadImage(sampleImageUrl);
    logger.info(`Successfully downloaded image, size: ${imageBuffer.length} bytes`);
    
    // Upload the image buffer to ImageKit
    const fileName = `test_buffer_${Date.now()}.jpg`;
    const uploadResult = await imagekitClient.uploadImage(imageBuffer, fileName, 'test-images');
    
    if (!uploadResult || !uploadResult.url) {
      throw new Error('Failed to get URL from ImageKit upload response');
    }
    
    logger.info('✅ Buffer upload test successful!');
    logger.info(`Uploaded image URL: ${uploadResult.url}`);
    return true;
  } catch (error) {
    logger.error(`❌ Buffer upload test failed: ${error.message}`);
    return false;
  }
};

// Test uploading an image from a URL to ImageKit
const testUrlUpload = async () => {
  try {
    logger.info('Testing URL upload to ImageKit...');
    
    // Sample image URL (a placeholder image)
    const sampleImageUrl = 'https://via.placeholder.com/800x600/e74c3c/ffffff?text=Test+URL+Image';
    
    // Upload the image URL to ImageKit
    const fileName = `test_url_${Date.now()}.jpg`;
    const uploadResult = await imagekitClient.uploadImageFromUrl(sampleImageUrl, fileName, 'test-images');
    
    if (!uploadResult || !uploadResult.url) {
      throw new Error('Failed to get URL from ImageKit upload response');
    }
    
    logger.info('✅ URL upload test successful!');
    logger.info(`Uploaded image URL: ${uploadResult.url}`);
    return true;
  } catch (error) {
    logger.error(`❌ URL upload test failed: ${error.message}`);
    return false;
  }
};

// Run the tests
const runTests = async () => {
  let success = true;
  
  logger.info('Starting ImageKit integration tests...');
  
  // Test buffer upload
  const bufferUploadSuccess = await testBufferUpload();
  success = success && bufferUploadSuccess;
  
  // Test URL upload
  const urlUploadSuccess = await testUrlUpload();
  success = success && urlUploadSuccess;
  
  if (success) {
    logger.info('🎉 All ImageKit integration tests passed!');
    return 0;
  } else {
    logger.error('❌ One or more ImageKit integration tests failed.');
    return 1;
  }
};

// Run the tests and exit with appropriate code
runTests()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(error => {
    logger.error(`Unexpected error in tests: ${error.message}`);
    process.exit(1);
  }); 