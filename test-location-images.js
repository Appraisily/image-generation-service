/**
 * Test script for location image generation
 * 
 * Usage: node test-location-images.js
 */

const axios = require('axios');
const fs = require('fs');

// Configuration
const CONFIG = {
  // Endpoint for location image generation (default: local service)
  endpoint: process.env.SERVICE_URL || 'http://localhost:3000/api/generate-location',
  // Test location data
  testLocation: {
    id: 'test-loc-001',
    name: 'Premier Art Gallery',
    address: '123 Art Avenue',
    city: 'Los Angeles',
    state: 'California',
    type: 'Gallery',
    description: 'A prestigious gallery specializing in contemporary art',
    features: ['High ceilings', 'Natural lighting', 'Modern architecture']
  }
};

/**
 * Run the location image test
 */
async function testLocationImageGeneration() {
  try {
    console.log('Testing location image generation...');
    console.log(`Endpoint: ${CONFIG.endpoint}`);
    console.log(`Location: ${CONFIG.testLocation.name} (${CONFIG.testLocation.id})`);
    
    // Make the API call
    console.log('\nSending request...');
    const response = await axios.post(CONFIG.endpoint, {
      location: CONFIG.testLocation
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000 // 2-minute timeout for image generation
    });
    
    // Log the response
    console.log('\nResponse:');
    console.log(`Status: ${response.status}`);
    
    if (response.status === 200 && response.data.success) {
      console.log('\n✅ Success!');
      console.log(`Location ID: ${response.data.data.locationId}`);
      console.log(`Image URL: ${response.data.data.imageUrl}`);
      console.log(`Original URL: ${response.data.data.originalUrl}`);
      console.log(`Source: ${response.data.data.source}`);
      
      // Save response to file
      const outputPath = './location-image-test-result.json';
      fs.writeFileSync(outputPath, JSON.stringify(response.data, null, 2));
      console.log(`\nSaved response to ${outputPath}`);
      
      // Suggest next steps
      console.log('\nNext steps:');
      console.log('1. View the generated image using the URL above');
      console.log('2. Examine the response data in the saved JSON file');
      console.log('3. Try updating the test location data in this file to test with different parameters');
    } else {
      console.log('\n❌ Failed to generate image');
      console.log(response.data);
    }
  } catch (error) {
    console.error('\n❌ Error testing location image generation:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response data:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

// Run the test
testLocationImageGeneration().catch(console.error); 