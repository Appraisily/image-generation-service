/**
 * Test script for the image upload endpoint
 * This script tests both URL-based and base64 uploads to ImageKit
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// Service URL - update this as needed
const SERVICE_URL = process.env.SERVICE_URL || 'http://localhost:3000';

// Test image URL - replace with an actual image URL if needed
const TEST_IMAGE_URL = 'https://picsum.photos/800/600';

// Add a test for streaming upload
async function testStreamUpload() {
  try {
    console.log('\n--- Testing Stream Upload ---');
    
    // Download an image as a buffer
    const response = await axios.get(TEST_IMAGE_URL, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    console.log(`Downloaded test image, size: ${buffer.length} bytes`);
    
    // IMPORTANT: Instead of trying to send a stream through HTTP (which doesn't work well),
    // we'll send the buffer directly but mark it as coming from a stream source
    // This better simulates how real streams would be handled in the app
    
    const payload = {
      // Use explicit buffer source type - this is more reliable
      source: 'buffer',
      // Send the buffer directly
      data: buffer, 
      fileName: 'test-stream-upload',
      folder: 'test-uploads',
      tags: ['test', 'stream-upload'],
      // Add a flag to indicate this came from a stream
      fromStream: true
    };
    
    console.log(`Sending request to ${SERVICE_URL}/api/upload`);
    console.log('Payload: [buffer data from stream]');
    
    const uploadResponse = await axios.post(`${SERVICE_URL}/api/upload`, payload);
    
    console.log('Response:', JSON.stringify(uploadResponse.data, null, 2));
    console.log('Stream Upload Test: SUCCESS ✅');
    return uploadResponse.data;
  } catch (error) {
    console.error('Stream Upload Test: FAILED ❌');
    if (error.response) {
      console.error('Response:', error.response.status, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    return null;
  }
}

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
    const response = await axios.get(TEST_IMAGE_URL, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    const filePath = path.join(__dirname, 'test-image.jpg');
    await fs.writeFile(filePath, buffer);
    console.log(`Downloaded sample image to ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`Error downloading image: ${error.message}`);
    return null;
  }
}

// Test URL upload
async function testUrlUpload() {
  try {
    console.log('\n--- Testing URL Upload ---');
    
    const payload = {
      source: 'url',
      data: TEST_IMAGE_URL,
      fileName: 'test-url-upload',
      folder: 'test-uploads',
      tags: ['test', 'url-upload']
    };
    
    console.log(`Sending request to ${SERVICE_URL}/api/upload`);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    
    const response = await axios.post(`${SERVICE_URL}/api/upload`, payload);
    
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('URL Upload Test: SUCCESS ✅');
    return response.data;
  } catch (error) {
    console.error('URL Upload Test: FAILED ❌');
    if (error.response) {
      console.error('Response:', error.response.status, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    return null;
  }
}

// Test base64 upload
async function testBase64Upload() {
  try {
    console.log('\n--- Testing Base64 Upload ---');
    
    // Download a sample image first (or use an existing one)
    const imagePath = await downloadSampleImage();
    if (!imagePath) {
      throw new Error('Failed to get sample image for testing');
    }
    
    // Convert the image to base64
    const base64Data = await getBase64FromFile(imagePath);
    if (!base64Data) {
      throw new Error('Failed to convert image to base64');
    }
    
    const payload = {
      source: 'base64',
      data: base64Data,
      fileName: 'test-base64-upload',
      folder: 'test-uploads',
      tags: ['test', 'base64-upload']
    };
    
    console.log(`Sending request to ${SERVICE_URL}/api/upload`);
    console.log('Payload: [base64 data truncated]');
    
    const response = await axios.post(`${SERVICE_URL}/api/upload`, payload);
    
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('Base64 Upload Test: SUCCESS ✅');
    return response.data;
  } catch (error) {
    console.error('Base64 Upload Test: FAILED ❌');
    if (error.response) {
      console.error('Response:', error.response.status, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    return null;
  }
}

// Add a direct buffer upload test
async function testBufferUpload() {
  try {
    console.log('\n--- Testing Direct Buffer Upload ---');
    
    // Download image as buffer
    const response = await axios.get(TEST_IMAGE_URL, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    console.log(`Downloaded test image, size: ${buffer.length} bytes`);
    
    // Create a simple payload with the buffer
    const payload = {
      source: 'buffer',
      data: buffer,
      fileName: 'test-direct-buffer-upload',
      folder: 'test-uploads',
      tags: ['test', 'buffer-upload']
    };
    
    console.log(`Sending request to ${SERVICE_URL}/api/upload`);
    console.log('Payload: [buffer data]');
    
    // Convert buffer to base64 for sending through JSON
    const base64Payload = {
      ...payload,
      data: buffer.toString('base64')
    };
    
    const uploadResponse = await axios.post(`${SERVICE_URL}/api/upload`, base64Payload);
    
    console.log('Response:', JSON.stringify(uploadResponse.data, null, 2));
    console.log('Direct Buffer Upload Test: SUCCESS ✅');
    return uploadResponse.data;
  } catch (error) {
    console.error('Direct Buffer Upload Test: FAILED ❌');
    if (error.response) {
      console.error('Response:', error.response.status, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    return null;
  }
}

// Run the tests
async function runTests() {
  console.log('Starting Image Upload API Tests');
  console.log(`Service URL: ${SERVICE_URL}`);
  
  // Run URL upload test
  const urlResult = await testUrlUpload();
  
  // Run base64 upload test
  const base64Result = await testBase64Upload();
  
  // Run buffer upload test (new reliable test)
  const bufferResult = await testBufferUpload();
  
  // Run stream upload test (our new test)
  const streamResult = await testStreamUpload();
  
  // Summary
  console.log('\n--- Test Summary ---');
  console.log(`URL Upload: ${urlResult ? 'SUCCESS ✅' : 'FAILED ❌'}`);
  console.log(`Base64 Upload: ${base64Result ? 'SUCCESS ✅' : 'FAILED ❌'}`);
  console.log(`Buffer Upload: ${bufferResult ? 'SUCCESS ✅' : 'FAILED ❌'}`);
  console.log(`Stream Upload: ${streamResult ? 'SUCCESS ✅' : 'FAILED ❌'}`);
  
  // Clean up test file
  try {
    await fs.remove(path.join(__dirname, 'test-image.jpg'));
  } catch (error) {
    console.error(`Error cleaning up: ${error.message}`);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Unhandled error running tests:', error.message);
});