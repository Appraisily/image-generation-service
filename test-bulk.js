// Test bulk image generation using mocks
const path = require('path');
const imageGenerator = require('./src/services/image-generator');
const falAiClient = require('./src/services/fal-ai-client');
const imageCache = require('./src/services/image-cache');

// Mock external API calls
falAiClient.generateImage = async (prompt) => {
  console.log(`[MOCK] Would generate image with prompt for: ${prompt.substring(0, 30)}...`);
  return {
    imageUrl: 'https://example.com/mock-image.jpg',
    metadata: { prompt, model: 'mock-model' }
  };
};

imageCache.uploadImage = async (imageUrl, fileName) => {
  console.log(`[MOCK] Would upload image to ImageKit: ${fileName}`);
  return {
    url: `https://example.com/cached/${fileName}`,
    fileId: 'mock-file-id-12345'
  };
};

imageCache.saveToCache = async (appraiser_id, imageUrl, imageBuffer, metadata, prompt) => {
  console.log(`[MOCK] Cache save for: ${appraiser_id}`);
  return {
    imagekitUrl: `https://example.com/cached/${appraiser_id}.jpg`,
    localPath: `/tmp/${appraiser_id}.jpg`
  };
};

imageGenerator.downloadImage = async (url) => {
  console.log(`[MOCK] Would download image from: ${url}`);
  return Buffer.from('mock-image-data');
};

// Sample data
const mockAppraisers = [
  {
    id: 'app-001',
    firstName: 'John',
    lastName: 'Doe',
    company: 'ABC Appraisals',
    state: 'California',
    licenseNumber: 'CA12345',
    specialties: ['Residential']
  },
  {
    id: 'app-002',
    firstName: 'Jane',
    lastName: 'Smith',
    company: 'XYZ Valuations',
    state: 'Texas',
    licenseNumber: 'TX54321',
    specialties: ['Commercial']
  },
  {
    id: 'app-003',
    firstName: 'Robert',
    lastName: 'Johnson',
    company: 'Premier Appraisals',
    state: 'New York',
    licenseNumber: 'NY98765',
    specialties: ['Residential', 'Commercial']
  }
];

// Simple mock implementation of the bulk generation process
async function mockBulkGeneration() {
  try {
    console.log('🧪 TESTING BULK GENERATION PROCESS');
    console.log('=======================================');
    console.log(`📋 Processing ${mockAppraisers.length} appraisers...`);
    
    const results = {
      successful: 0,
      failed: 0,
      skipped: 0,
      details: []
    };
    
    // Process each appraiser
    for (const appraiser of mockAppraisers) {
      console.log(`\n🔄 Processing: ${appraiser.firstName} ${appraiser.lastName} (${appraiser.id})`);
      
      try {
        // Generate image using our mocked services
        const imageResult = await imageGenerator.generateImage(appraiser);
        
        console.log(`✅ Successfully generated image for ${appraiser.id}`);
        console.log(`📊 Result: ${imageResult.imageUrl}`);
        
        results.successful++;
        results.details.push({
          id: appraiser.id,
          name: `${appraiser.firstName} ${appraiser.lastName}`,
          status: 'success',
          imageUrl: imageResult.imageUrl
        });
      } catch (error) {
        console.error(`❌ Failed to generate image for ${appraiser.id}: ${error.message}`);
        
        results.failed++;
        results.details.push({
          id: appraiser.id,
          name: `${appraiser.firstName} ${appraiser.lastName}`,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Print summary
    console.log('\n=======================================');
    console.log('📊 BULK GENERATION RESULTS:');
    console.log(`✅ Successful: ${results.successful}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`⏭️ Skipped: ${results.skipped}`);
    console.log('=======================================');
    
    console.log('NOTE: This is a mock test. In a real environment with proper API keys,');
    console.log('actual images would be generated and uploaded to ImageKit.');
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error(error);
  }
}

// Run the test
mockBulkGeneration(); 