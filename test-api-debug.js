/**
 * Test Script for Debugging API Calls to the Image Generation Service
 * 
 * This script tests various API calls to help debug and troubleshoot issues with the image generation service.
 * It makes multiple API calls with different parameter formats to help identify what works and what doesn't.
 */

const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Configuration
const API_URL = process.env.API_URL || 'https://image-generation-service-856401495068.us-central1.run.app';
const LOG_FILE = path.join(__dirname, 'test-api-debug.log');

// Set up logging
const log = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  
  console.log(logMessage);
  fs.appendFileSync(LOG_FILE, logMessage + '\n');
};

const logRequestResponse = async (name, request, responsePromise) => {
  log(`\n=== TEST ${name} ===`);
  log(`Request: ${JSON.stringify(request, null, 2)}`);
  
  try {
    const response = await responsePromise;
    log(`Response Status: ${response.status}`);
    log(`Response Headers: ${JSON.stringify(response.headers, null, 2)}`);
    log(`Response Data: ${JSON.stringify(response.data, null, 2)}`);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    log(`Error: ${error.message}`);
    
    if (error.response) {
      log(`Response Status: ${error.response.status}`);
      log(`Response Headers: ${JSON.stringify(error.response.headers, null, 2)}`);
      log(`Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
      return { success: false, error: error.message, status: error.response.status, data: error.response.data };
    } else {
      log('No response received');
      return { success: false, error: error.message };
    }
  }
};

// Test runner
async function runTests() {
  log('Starting API test run');
  log(`Using API URL: ${API_URL}`);
  
  // Initialize log file
  if (fs.existsSync(LOG_FILE)) {
    fs.unlinkSync(LOG_FILE);
  }
  fs.writeFileSync(LOG_FILE, `API Test Run: ${new Date().toISOString()}\n\n`);
  
  // Test 1: API Documentation Endpoint
  await logRequestResponse('GET /api/docs', {}, 
    axios.get(`${API_URL}/api/docs`)
  );
  
  // Test 2: Health Check
  await logRequestResponse('GET /health', {}, 
    axios.get(`${API_URL}/health`)
  );
  
  // Test 3: Generate Image with Missing Appraiser
  await logRequestResponse('POST /api/generate (Missing Appraiser)', 
    { customPrompt: 'Test prompt without appraiser' },
    axios.post(`${API_URL}/api/generate`, { 
      customPrompt: 'Test prompt without appraiser' 
    })
  );
  
  // Test 4: Generate Image with ID Only
  await logRequestResponse('POST /api/generate (ID Only)', 
    { appraiser: { id: 'test-appraiser-1' } },
    axios.post(`${API_URL}/api/generate`, { 
      appraiser: { id: 'test-appraiser-1' } 
    })
  );
  
  // Test 5: Generate Image with Complete Appraiser Data
  await logRequestResponse('POST /api/generate (Complete Data)', 
    {
      appraiser: {
        id: 'test-appraiser-2',
        name: 'Test Appraiser',
        specialties: ['Fine Art', 'Antiques'],
        city: 'New York',
        state: 'NY'
      }
    },
    axios.post(`${API_URL}/api/generate`, {
      appraiser: {
        id: 'test-appraiser-2',
        name: 'Test Appraiser',
        specialties: ['Fine Art', 'Antiques'],
        city: 'New York',
        state: 'NY'
      }
    })
  );
  
  // Test 6: Generate Image with Custom Prompt
  await logRequestResponse('POST /api/generate (Custom Prompt)', 
    {
      appraiser: { id: 'test-appraiser-3' },
      customPrompt: 'Professional portrait of an art appraiser with a painting in the background, neutral studio lighting, high quality'
    },
    axios.post(`${API_URL}/api/generate`, {
      appraiser: { id: 'test-appraiser-3' },
      customPrompt: 'Professional portrait of an art appraiser with a painting in the background, neutral studio lighting, high quality'
    })
  );
  
  // Test 7: Generate Location Image
  await logRequestResponse('POST /api/generate-location', 
    {
      location: {
        id: 'test-location-1',
        name: 'New York',
        state: 'NY'
      }
    },
    axios.post(`${API_URL}/api/generate-location`, {
      location: {
        id: 'test-location-1',
        name: 'New York',
        state: 'NY'
      }
    })
  );
  
  log('Tests completed');
}

// Run the tests
runTests().catch(error => {
  console.error('Unhandled error:', error);
}); 