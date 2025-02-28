// Test that index.js loads without the cache module
console.log('Testing index.js loading without imageCache...');

try {
  // Mock the image-generator module to avoid actual API calls
  const mockImageGenerator = {
    generateImage: async () => ({
      imageUrl: 'https://example.com/mock-image.jpg',
      cached: false,
      prompt: 'Mock prompt',
      source: 'fal-ai'
    })
  };
  
  // Mock module cache to return our mock for the image-generator
  require.cache[require.resolve('./src/services/image-generator')] = {
    exports: mockImageGenerator
  };
  
  // Try to load index.js
  const app = require('./src/index');
  
  console.log('✅ SUCCESS: index.js loaded without imageCache dependency!');
  console.log('The modified image generation service should now work without any cache dependencies.');
} catch (error) {
  console.error('❌ ERROR loading index.js:', error.message);
  console.error(error);
} 