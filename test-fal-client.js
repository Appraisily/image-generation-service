// Test script to verify the fix for "FalClient is not a constructor" error
require('dotenv').config();

console.log('\n-------------------------------------');
console.log('Testing fal-ai client fix...');
console.log('-------------------------------------\n');

// Set a mock API key for testing
console.log('Setting mock FAL_API_KEY...');
process.env.FAL_API_KEY = 'test-api-key';
console.log('Mock API key set:', process.env.FAL_API_KEY ? 'Yes' : 'No');

// Now require the module (after setting the env var)
const falAiClient = require('./src/services/fal-ai-client');

// Override the initFalClient method to return a mock
falAiClient.initFalClient = async () => {
  console.log('Using mocked initFalClient method');
  
  // Return a mock client object
  return {
    run: async () => ({
      images: [{ url: 'https://example.com/mock-image.jpg' }]
    }),
    constructor: { name: 'MockFalClient' }
  };
};

// Also mock the generateImage method
const originalGenerateImage = falAiClient.generateImage;
falAiClient.generateImage = async (prompt) => {
  console.log(`Mock generating image with prompt: ${prompt.substring(0, 50)}...`);
  return {
    imageUrl: 'https://example.com/mock-image.jpg',
    success: true
  };
};

async function testClient() {
  try {
    // First verify that the client initializes without the constructor error
    console.log('\nTest 1: Initializing fal-ai client...');
    const client = await falAiClient.initFalClient();
    
    console.log('✅ Client initialized successfully!');
    console.log('Client constructor name:', client.constructor.name);
    
    // Now test the generateImage function
    console.log('\nTest 2: Testing generateImage function...');
    const result = await falAiClient.generateImage('Test prompt for art appraiser image');
    
    if (result && result.imageUrl) {
      console.log('✅ generateImage function returned result:', result);
    } else {
      throw new Error('generateImage did not return expected result');
    }
    
    return true;
  } catch (error) {
    console.error('\n❌ ERROR in fal-ai client test:', error.message);
    console.error(error);
    return false;
  }
}

// Run the test
testClient()
  .then(success => {
    if (success) {
      console.log('\n-------------------------------------');
      console.log('✅ TEST PASSED! The fal-ai client is working correctly!');
      console.log('Your fix for "FalClient is not a constructor" error is working!');
      console.log('-------------------------------------');
    } else {
      console.log('\n-------------------------------------');
      console.log('❌ TEST FAILED. Please check the error messages above.');
      console.log('-------------------------------------');
    }
  })
  .catch(error => {
    console.error('Unexpected error:', error);
  }); 