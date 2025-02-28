// Test module loading
console.log('Testing module loading...');

// Add a delay to ensure all async operations complete
const testModules = async () => {
  try {
    console.log('Loading fal-ai-client.js...');
    const falAiClient = require('./src/services/fal-ai-client');
    console.log('✓ fal-ai-client.js loaded successfully');

    console.log('Loading image-cache.js...');
    const imageCache = require('./src/services/image-cache');
    console.log('✓ image-cache.js loaded successfully');

    console.log('Loading image-generator.js...');
    const imageGenerator = require('./src/services/image-generator');
    console.log('✓ image-generator.js loaded successfully');

    // Wait for any pending async operations
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n=======================================');
    console.log('✅ ALL MODULES LOADED SUCCESSFULLY');
    console.log('=======================================\n');
    
    console.log('Note: The warnings about missing API keys and credentials are expected');
    console.log('in a development environment without actual API keys configured.');
    console.log('These warnings would not appear in production with proper credentials set.');
  } catch (error) {
    console.error(`\n❌ ERROR LOADING MODULES: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
};

// Run the test
testModules(); 