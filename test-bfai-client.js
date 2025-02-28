/**
 * Test script for the Black Forest AI client
 * 
 * This script tests the Black Forest AI client's ability to generate images
 * by making a test request with a simple prompt.
 * 
 * Run with: node test-bfai-client.js
 */

require('dotenv').config();
const bfaiClient = require('./src/services/bfai-client');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager').v1;

// Create a simple logger for the test
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

async function testImageGeneration() {
  logger.info('Starting Black Forest AI client test...');

  // Simple test prompt
  const testPrompt = 'A professional portrait of a person with a neutral background, photorealistic style';
  
  try {
    logger.info(`Sending test prompt: "${testPrompt}"`);
    
    // Call the generateImage function from the client
    const result = await bfaiClient.generateImage(testPrompt);
    
    if (result && result.imageUrl) {
      logger.info('✅ Test successful!');
      logger.info(`Generated image URL: ${result.imageUrl}`);
      return true;
    } else {
      logger.error('❌ Test failed: No image URL returned');
      return false;
    }
  } catch (error) {
    logger.error(`❌ Test failed: ${error.message}`);
    return false;
  }
}

// Run the test
testImageGeneration()
  .then(success => {
    if (success) {
      logger.info('Black Forest AI client is working correctly');
      process.exit(0);
    } else {
      logger.error('Black Forest AI client test failed');
      process.exit(1);
    }
  })
  .catch(error => {
    logger.error(`Unexpected error in test: ${error.message}`);
    process.exit(1);
  }); 