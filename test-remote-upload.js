/**
 * Test script for debugging remote service uploads
 * This script helps diagnose issues with image uploads to the remote service
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// Remote service URL - replace with your actual remote service URL
const REMOTE_SERVICE_URL = process.env.REMOTE_SERVICE_URL || 'https://image-generation-service-856401495068.us-central1.run.app';

// A function to read an image file and convert to base64
async function getBase64FromFile(filePath) {
  try {
    const data = await fs.readFile(filePath);
    return data.toString('base64');
  } catch (error) {
    console.error(`Error reading file: ${error.message}`);
    return null;
  }
}

// A function to download a sample image for testing
async function downloadSampleImage() {
  try {
    const sampleImageUrl = 'https://picsum.photos/800/600';
    console.log(`Downloading sample image from ${sampleImageUrl}`);
    
    const response = await axios.get(sampleImageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    const filePath = path.join(__dirname, 'test-remote-image.jpg');
    await fs.writeFile(filePath, buffer);
    console.log(`Downloaded sample image to ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`Error downloading image: ${error.message}`);
    return null;
  }
}

// Test sending base64 data to remote service
async function testRemoteBase64Upload() {
  try {
    console.log('\n--- Testing Remote Base64 Upload ---');
    
    // Download a sample image first
    const imagePath = await downloadSampleImage();
    if (!imagePath) {
      throw new Error('Failed to get sample image for testing');
    }
    
    // Convert the image to base64
    console.log('Converting image to base64...');
    const base64Data = await getBase64FromFile(imagePath);
    if (!base64Data) {
      throw new Error('Failed to convert image to base64');
    }
    console.log(`Converted image to base64 (${base64Data.length} characters)`);
    
    // Create the payload
    const payload = {
      source: 'base64',
      data: base64Data,
      fileName: 'remote-base64-test',
      folder: 'test-uploads',
      tags: ['test', 'remote-base64']
    };
    
    // Log request information
    console.log(`Sending request to ${REMOTE_SERVICE_URL}/api/upload`);
    console.log('Request data:');
    console.log('- source:', payload.source);
    console.log('- fileName:', payload.fileName);
    console.log('- folder:', payload.folder);
    console.log('- data length:', payload.data.length, 'characters');
    console.log('- data preview:', payload.data.substring(0, 30) + '...');
    
    // Send the request with a longer timeout
    const response = await axios.post(`${REMOTE_SERVICE_URL}/api/upload`, payload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    console.log('Remote Base64 Upload Test: SUCCESS ✅');
    return response.data;
  } catch (error) {
    console.error('Remote Base64 Upload Test: FAILED ❌');
    console.error('Error:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      console.error('Response headers:', JSON.stringify(error.response.headers, null, 2));
    } else if (error.request) {
      console.error('No response received. Request details:', error.request._header);
    }
    
    return null;
  }
}

// Test sending URL data to remote service
async function testRemoteUrlUpload() {
  try {
    console.log('\n--- Testing Remote URL Upload ---');
    
    // Create the payload
    const payload = {
      source: 'url',
      data: 'https://picsum.photos/800/600',
      fileName: 'remote-url-test',
      folder: 'test-uploads',
      tags: ['test', 'remote-url']
    };
    
    // Log request information
    console.log(`Sending request to ${REMOTE_SERVICE_URL}/api/upload`);
    console.log('Request data:', JSON.stringify(payload, null, 2));
    
    // Send the request with a longer timeout
    const response = await axios.post(`${REMOTE_SERVICE_URL}/api/upload`, payload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    console.log('Remote URL Upload Test: SUCCESS ✅');
    return response.data;
  } catch (error) {
    console.error('Remote URL Upload Test: FAILED ❌');
    console.error('Error:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    
    return null;
  }
}

// Run the tests
async function runTests() {
  console.log('Starting Remote Upload Tests');
  console.log(`Remote Service URL: ${REMOTE_SERVICE_URL}`);
  
  // Run URL upload test first (simpler)
  await testRemoteUrlUpload();
  
  // Run base64 upload test (more complex)
  await testRemoteBase64Upload();
  
  // Clean up
  try {
    await fs.remove(path.join(__dirname, 'test-remote-image.jpg'));
    console.log('Cleaned up test files');
  } catch (error) {
    console.error(`Error cleaning up: ${error.message}`);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Unhandled error running tests:', error.message);
});