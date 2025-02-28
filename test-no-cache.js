// Test image generation without cache
const imageGenerator = require('./src/services/image-generator');
const falAiClient = require('./src/services/fal-ai-client');

// Mock external API calls to prevent actual API requests
falAiClient.generateImage = async (prompt) => {
  console.log(`[MOCK] Would generate image with prompt: "${prompt}"`);
  return {
    imageUrl: 'https://example.com/mock-image.jpg',
    metadata: { prompt, model: 'mock-model' }
  };
};

imageGenerator.downloadImage = async (url) => {
  console.log(`[MOCK] Would download image from: ${url}`);
  return Buffer.from('mock-image-data');
};

// Test function
async function testImageGeneration() {
  try {
    console.log('🧪 TESTING CACHE-FREE IMAGE GENERATION');
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
    
    // Verify that cache was bypassed
    if (result.cached === false && result.source === 'fal-ai') {
      console.log('✅ Cache successfully bypassed!');
    } else {
      console.error('❌ Cache not properly bypassed!');
    }
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error(error);
  }
}

// Run the test
testImageGeneration(); 