// Simple test script to verify the fal-ai client module loads correctly
console.log('\n-------------------------------------');
console.log('Testing fal-ai client loading...');
console.log('-------------------------------------\n');

try {
  // Simply test loading fal-ai-client directly
  console.log('Attempting to load fal-ai-client.js...');
  const falAiClient = require('./src/services/fal-ai-client');
  console.log('✅ fal-ai-client.js loaded successfully');
  
  // Print out what's exported
  console.log('Exported from fal-ai-client:', Object.keys(falAiClient));
  
  console.log('\n✅ SUCCESS: fal-ai-client loaded without errors!');
  console.log('The FalClient constructor error should be fixed.');
} catch (error) {
  console.error('\n❌ ERROR loading fal-ai-client:', error.message);
  console.error(error);
} 