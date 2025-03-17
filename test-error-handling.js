/**
 * Test script for API error handling
 * This script tests how the API handles malformed JSON and other errors
 */

require('dotenv').config();
const axios = require('axios');

// Service URL - update this as needed
const SERVICE_URL = process.env.SERVICE_URL || 'http://localhost:3000';

// Test cases for different endpoints with malformed JSON
const testCases = [
  {
    name: 'Generate endpoint - Missing closing brace',
    endpoint: '/api/generate',
    data: '{"appraiser": {"id": "test-123", "name": "Test Appraiser"'
  },
  {
    name: 'Generate endpoint - Invalid quotes',
    endpoint: '/api/generate',
    data: '{"appraiser": {"id": test-123, "name": "Test Appraiser"}}'
  },
  {
    name: 'Upload endpoint - Missing quotes around keys',
    endpoint: '/api/upload',
    data: '{source: "url", data: "https://example.com/image.jpg"}'
  },
  {
    name: 'Upload endpoint - Trailing comma',
    endpoint: '/api/upload',
    data: '{"source": "url", "data": "https://example.com/image.jpg",}'
  },
  {
    name: 'Generate Location endpoint - Single quotes',
    endpoint: '/api/generate-location',
    data: "{'location': {'id': 'test-location', 'name': 'Test Gallery'}}"
  }
];

// Function to test a single case
async function runTestCase(testCase) {
  try {
    console.log(`\n--- Testing: ${testCase.name} ---`);
    console.log(`Endpoint: ${testCase.endpoint}`);
    console.log(`Sending malformed JSON: ${testCase.data}`);
    
    // Make the request with the raw data to trigger error handling
    await axios.post(`${SERVICE_URL}${testCase.endpoint}`, testCase.data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // If we get here, the request didn't fail as expected
    console.error('❌ Test failed: Expected request to fail but it succeeded');
    return false;
  } catch (error) {
    if (error.response) {
      // We expect a 400 Bad Request response
      if (error.response.status === 400) {
        console.log('✅ Test passed: Received 400 Bad Request as expected');
        console.log('Response:', JSON.stringify(error.response.data, null, 2));
        
        // Check if the response includes helpful information
        const data = error.response.data;
        let helpfulScore = 0;
        
        if (data.error) helpfulScore++;
        if (data.message) helpfulScore++;
        if (data.instruction || data.help) helpfulScore++;
        if (data.example) helpfulScore++;
        if (data.tip) helpfulScore++;
        
        if (helpfulScore >= 3) {
          console.log(`✅ Response is helpful (score: ${helpfulScore}/5)`);
        } else {
          console.log(`⚠️ Response could be more helpful (score: ${helpfulScore}/5)`);
        }
        
        return true;
      } else {
        console.error(`❌ Test failed: Expected status 400 but got ${error.response.status}`);
        console.log('Response:', JSON.stringify(error.response.data, null, 2));
        return false;
      }
    } else {
      console.error(`❌ Test failed: ${error.message}`);
      return false;
    }
  }
}

// Run all test cases
async function runTests() {
  console.log('Starting Error Handling Tests');
  console.log(`Service URL: ${SERVICE_URL}`);
  
  let passedCount = 0;
  
  for (const testCase of testCases) {
    const passed = await runTestCase(testCase);
    if (passed) passedCount++;
  }
  
  // Summary
  console.log('\n--- Test Summary ---');
  console.log(`Passed: ${passedCount}/${testCases.length}`);
  console.log(`Failed: ${testCases.length - passedCount}/${testCases.length}`);
  
  if (passedCount === testCases.length) {
    console.log('🎉 All tests passed! Error handling is working correctly.');
  } else {
    console.log('⚠️ Some tests failed. Error handling may need improvement.');
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Unhandled error running tests:', error.message);
});