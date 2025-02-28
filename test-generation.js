// Test image generation flow
const imageGenerator = require('./src/services/image-generator');
const falAiClient = require('./src/services/fal-ai-client');
const imageCache = require('./src/services/image-cache');

// Mock external API calls to prevent actual API requests
falAiClient.generateImage = async (prompt) => {
  console.log(`[MOCK] Would generate image with prompt: "${prompt}"`);
  return {
    imageUrl: 'https://example.com/mock-image.jpg',
    metadata: { prompt, model: 'mock-model' }
  };
};

imageCache.uploadImage = async (imageUrl, fileName) => {
  console.log(`[MOCK] Would upload image from ${imageUrl} with filename ${fileName}`);
  return {
    url: `https://example.com/cached/${fileName}`,
    fileId: 'mock-file-id-12345'
  };
};

imageCache.saveToCache = async (appraiser_id, imageUrl, imageBuffer, metadata, prompt) => {
  console.log(`[MOCK] Would save image to cache with ID: ${appraiser_id}`);
  console.log(`[MOCK] Metadata: ${JSON.stringify(metadata)}`);
  return {
    imagekitUrl: `https://example.com/cached/${appraiser_id}.jpg`,
    localPath: `/tmp/${appraiser_id}.jpg`
  };
};

imageGenerator.downloadImage = async (url) => {
  console.log(`[MOCK] Would download image from: ${url}`);
  return Buffer.from('mock-image-data');
};

// Test function
async function testImageGeneration() {
  try {
    console.log('🧪 TESTING IMAGE GENERATION FLOW');
    console.log('=======================================');
    
    // Test data
    const mockAppraiser = {
      id: 'mock-123',
      firstName: 'John',
      lastName: 'Doe',
      company: 'ABC Appraisals',
      state: 'California',
      licenseNumber: 'CA12345',
      specialties: ['Residential', 'Commercial']
    };
    
    console.log('📋 Test data:', JSON.stringify(mockAppraiser, null, 2));
    console.log('---------------------------------------');
    
    // Test generation
    console.log('🖼️  Generating image...');
    const result = await imageGenerator.generateImage(mockAppraiser);
    
    console.log('✅ Image generation successful!');
    console.log('---------------------------------------');
    console.log('📊 RESULT:', JSON.stringify(result, null, 2));
    console.log('=======================================');
    
    console.log('NOTE: This is a mock test. In a real environment with proper API keys,');
    console.log('actual images would be generated and uploaded to ImageKit.');
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error(error);
  }
}

// Run the test
testImageGeneration(); 