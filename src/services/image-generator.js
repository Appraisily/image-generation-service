/**
 * Image Generator Service
 * Provides functionality to generate images using Vertex AI's Imagen model
 */

const { VertexAI } = require('@google-cloud/vertexai');
const md5 = require('md5');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const { logger } = require('../utils/logger');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager').v1;

// Initialize Secret Manager
let secretManagerClient;
try {
  secretManagerClient = new SecretManagerServiceClient();
  logger.info('Secret Manager client initialized successfully');
} catch (error) {
  logger.error(`Failed to initialize Secret Manager: ${error.message}`);
}

// Initialize Vertex AI
let vertexAI;
try {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'your-project-id';
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  
  vertexAI = new VertexAI({
    project: projectId,
    location: location,
  });
  
  logger.info(`Vertex AI initialized successfully for project: ${projectId}, location: ${location}`);
} catch (error) {
  logger.error(`Failed to initialize Vertex AI: ${error.message}`);
}

// GPT-4o API configuration
let GPT_API_KEY = process.env.OPEN_AI_API_SEO;
const GPT_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

// Attempt to log if we have API keys configured (without exposing the actual keys)
logger.info(`OpenAI API Key directly configured: ${GPT_API_KEY ? 'Yes' : 'No'}`);

// Function to get secret from Secret Manager
async function getSecret(secretName) {
  if (!secretManagerClient) {
    logger.warn(`Cannot access Secret Manager to retrieve ${secretName}`);
    return null;
  }

  try {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) {
      logger.warn('GOOGLE_CLOUD_PROJECT environment variable not set');
      return null;
    }

    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    logger.info(`Attempting to access secret: ${secretName}`);
    
    const [version] = await secretManagerClient.accessSecretVersion({ name });
    const secretValue = version.payload.data.toString('utf8');
    
    logger.info(`Successfully retrieved secret: ${secretName}`);
    return secretValue;
  } catch (error) {
    logger.error(`Error accessing secret ${secretName}: ${error.message}`);
    return null;
  }
}

// Try to get OpenAI API key from Secret Manager if not in environment
(async () => {
  if (!GPT_API_KEY) {
    logger.info('OpenAI API Key not found in environment, checking Secret Manager...');
    GPT_API_KEY = await getSecret('OPEN_AI_API_SEO');
    logger.info(`OpenAI API Key from Secret Manager: ${GPT_API_KEY ? 'Retrieved' : 'Not found'}`);
  }
})();

const imageGenerator = {
  /**
   * Generate an image for an appraiser
   * @param {Object} appraiser - The appraiser data
   * @returns {Promise<Object>} - The generated image data
   */
  async generateImage(appraiser) {
    try {
      // Generate data hash for caching purposes
      const appraiserDataHash = this.generateAppraiserDataHash(appraiser);
      
      // Generate a detailed prompt using GPT-4o
      const prompt = await this.createPromptWithGPT(appraiser);
      
      // Ensure directories exist
      const imageDir = path.join(__dirname, '../../data/images');
      await fs.ensureDir(imageDir);
      
      if (!vertexAI) {
        throw new Error('Vertex AI client is not initialized');
      }
      
      // Create a preview parameter for the Vertex Imagen model
      logger.info(`Sending prompt to Vertex AI: "${prompt.substring(0, 100)}..."`);
      
      // Get the generative model
      const model = process.env.IMAGEN_MODEL || 'imagegeneration@002';
      logger.info(`Using Vertex AI model: ${model}`);
      
      // Updated Vertex AI API call format
      try {
        // Different approach to access the generative model based on API version
        let imageResponse;
        try {
          // For version 0.2.1 of @google-cloud/vertexai, we need to access the Generation API differently
          logger.info('Attempting to use Vertex AI with compatible method for version 0.2.1');
          
          // Initialize the Generation client
          const aiplatformPath = '@google-cloud/vertexai';
          const ai = require(aiplatformPath);
          
          // Get model name
          const modelId = model;
          logger.info(`Using model ID: ${modelId}`);
          
          // Create a Generation client directly with lower-level API
          if (vertexAI.preview && typeof vertexAI.preview.generation === 'function') {
            logger.info('Using Vertex AI preview.generation API');
            const generation = vertexAI.preview.generation();
            imageResponse = await generation.generateImage({
              prompt: prompt,
              modelId: modelId
            });
          } else if (vertexAI.generation && typeof vertexAI.generation === 'function') {
            logger.info('Using Vertex AI generation API');
            const generation = vertexAI.generation();
            imageResponse = await generation.generateImage({
              prompt: prompt,
              modelId: modelId
            });
          } else {
            // Try creating a completely new client
            logger.info('Creating new Vertex AI Prediction client');
            const { PredictionServiceClient } = require('@google-cloud/vertexai').v1;
            const predictionClient = new PredictionServiceClient();
            
            const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'your-project-id';
            const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
            
            const name = `projects/${projectId}/locations/${location}/models/${modelId}`;
            logger.info(`Using model path: ${name}`);
            
            const instances = [{
              prompt: prompt
            }];
            
            const [predictionResponse] = await predictionClient.predict({
              name,
              instances: instances
            });
            
            logger.info('Prediction response received');
            imageResponse = {
              images: [predictionResponse.predictions[0].bytesValue]
            };
          }
          
          logger.info('Image generation response received from Vertex AI');
          logger.debug(`Response structure: ${JSON.stringify(Object.keys(imageResponse || {}))}`);
          
          // Extract the image data from the response, handling different response formats
          let imageData;
          if (imageResponse && imageResponse.response && Array.isArray(imageResponse.response.images)) {
            imageData = imageResponse.response.images[0].bytes;
            logger.info('Found image data in response.images[0].bytes');
          } else if (imageResponse && Array.isArray(imageResponse.images)) {
            imageData = imageResponse.images[0];
            logger.info('Found image data in images[0]');
          } else if (imageResponse && imageResponse.images && imageResponse.images.length > 0) {
            imageData = imageResponse.images[0];
            logger.info('Found image data in images[0]');
          } else if (imageResponse && imageResponse.image) {
            imageData = imageResponse.image;
            logger.info('Found image data in image property');
          } else {
            throw new Error('Unexpected response format from Vertex AI: ' + JSON.stringify(imageResponse));
          }
          
          // Save image to file system
          const imageBuffer = Buffer.from(imageData, 'base64');
          const filename = `appraiser_${appraiser.id}_${appraiserDataHash}.jpg`;
          const filePath = path.join(imageDir, filename);
          
          await fs.writeFile(filePath, imageBuffer);
          
          // Return image data
          const imageUrl = `/images/${filename}`;
          
          logger.info(`Successfully generated image for appraiser ${appraiser.id}`);
          
          return {
            imageUrl,
            imageBuffer,
            appraiserDataHash,
            prompt // Include the prompt in the response for reference
          };
        } catch (error) {
          logger.error(`Error in Vertex AI image generation: ${error.message}`);
          logger.error(error.stack);
          throw new Error(`Failed to generate image using Vertex AI: ${error.message}`);
        }
      } catch (error) {
        logger.error(`Error in Vertex AI image generation: ${error.message}`);
        logger.error(error.stack);
        throw new Error(`Failed to generate image using Vertex AI: ${error.message}`);
      }
    } catch (error) {
      logger.error(`Error generating image: ${error.message}`);
      throw new Error(`Failed to generate image: ${error.message}`);
    }
  },
  
  /**
   * Create a prompt using GPT-4o based on appraiser information
   * @param {Object} appraiser - The appraiser data
   * @returns {Promise<String>} - The generated prompt
   */
  async createPromptWithGPT(appraiser) {
    try {
      if (!GPT_API_KEY) {
        logger.warn('OpenAI API Key not provided. Falling back to basic prompt generation.');
        logger.info('In production, ensure OPEN_AI_API_SEO is available from Secret Manager');
        return this.createBasicPrompt(appraiser);
      }
      
      // Create system and user messages for GPT-4o
      const messages = [
        {
          role: "system",
          content: `You are a professional portrait photography director specializing in creating prompts for AI image generation. 
          Your job is to create detailed, professional prompts for generating portrait images of art appraisers. 
          The prompts should result in professional, photorealistic portraits suitable for a business profile.
          Focus on creating prompts that:
          1. Capture professional appearance appropriate for the art appraisal industry
          2. Reflect the appraiser's specialization in the background elements
          3. Use appropriate lighting, composition, and setting for a professional profile
          4. Avoid generating any text, watermarks, or signatures in the image
          5. Ensure the prompt will create a photorealistic, high-quality portrait`
        },
        {
          role: "user",
          content: `Create a detailed portrait generation prompt for an art appraiser with the following characteristics:
          ${appraiser.id ? `ID: ${appraiser.id}` : ''}
          ${appraiser.name ? `Name: ${appraiser.name}` : ''}
          ${appraiser.gender ? `Gender: ${appraiser.gender}` : ''}
          ${appraiser.age ? `Approximate age: ${appraiser.age}` : ''}
          ${appraiser.specialization ? `Specialization: ${appraiser.specialization}` : ''}
          
          The portrait will be used as a professional profile image on an art appraisal service website.`
        }
      ];
      
      // Call GPT-4o API
      const response = await this.callGPTAPI(messages);
      
      if (response && response.choices && response.choices.length > 0) {
        const generatedPrompt = response.choices[0].message.content.trim();
        logger.info(`Generated prompt using GPT-4o for appraiser ${appraiser.id}`);
        return generatedPrompt;
      } else {
        logger.warn(`Invalid response from GPT API. Falling back to basic prompt.`);
        return this.createBasicPrompt(appraiser);
      }
    } catch (error) {
      logger.error(`Error generating prompt with GPT: ${error.message}`);
      logger.info(`Falling back to basic prompt generation`);
      return this.createBasicPrompt(appraiser);
    }
  },
  
  /**
   * Call the GPT-4o API
   * @param {Array} messages - The messages to send to GPT-4o
   * @returns {Promise<Object>} - The API response
   */
  async callGPTAPI(messages) {
    return new Promise((resolve, reject) => {
      const requestData = JSON.stringify({
        model: "gpt-4o",
        messages: messages,
        max_tokens: 500,
        temperature: 0.7
      });
      
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GPT_API_KEY}`
        }
      };
      
      const req = https.request(GPT_API_ENDPOINT, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsedData = JSON.parse(data);
              resolve(parsedData);
            } catch (error) {
              reject(new Error(`Failed to parse GPT API response: ${error.message}`));
            }
          } else {
            reject(new Error(`GPT API request failed with status code ${res.statusCode}: ${data}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(error);
      });
      
      req.write(requestData);
      req.end();
    });
  },
  
  /**
   * Create a basic prompt for the image generation (fallback method)
   * @param {Object} appraiser - The appraiser data
   * @returns {String} - The generated prompt
   */
  createBasicPrompt(appraiser) {
    // Base prompt for all art appraisers
    let prompt = 'Professional portrait photograph of an art appraiser in a professional setting. ';
    
    // Add gender-specific details if available
    if (appraiser.gender) {
      prompt += `The person is ${appraiser.gender}. `;
    }
    
    // Add age-specific details if available
    if (appraiser.age) {
      prompt += `They appear to be approximately ${appraiser.age} years old. `;
    }
    
    // Add specialization details if available
    if (appraiser.specialization) {
      prompt += `They specialize in ${appraiser.specialization} art. `;
      
      // Add specialization-specific background elements
      if (appraiser.specialization.toLowerCase().includes('painting')) {
        prompt += 'There are elegant framed paintings visible in the background. ';
      } else if (appraiser.specialization.toLowerCase().includes('sculpture')) {
        prompt += 'There are small sculptures visible on shelves in the background. ';
      } else if (appraiser.specialization.toLowerCase().includes('modern')) {
        prompt += 'The background features modern art pieces and a contemporary office setting. ';
      } else if (appraiser.specialization.toLowerCase().includes('antique')) {
        prompt += 'The background shows antique furniture and classical art elements. ';
      }
    } else {
      // Generic art background
      prompt += 'The background shows a professional office with art pieces. ';
    }
    
    // Add professional attire details
    prompt += 'The person is wearing professional business attire appropriate for an art expert. ';
    
    // Add quality specifications
    prompt += 'High quality portrait, photorealistic, professional lighting, sharp focus, 4K, detailed. ';
    
    // Add note about AI-generated content
    prompt += 'This is for a professional website profile. The image should look professionally photographed but not of any real person.';
    
    return prompt;
  },
  
  /**
   * Generate a hash of appraiser data for caching purposes
   * @param {Object} appraiser - The appraiser data
   * @returns {String} - The generated hash
   */
  generateAppraiserDataHash(appraiser) {
    // Extract only the relevant fields that would affect the image
    const relevantData = {
      id: appraiser.id,
      gender: appraiser.gender || 'unknown',
      age: appraiser.age || 'unknown',
      specialization: appraiser.specialization || 'unknown',
    };
    
    // Create a hash of the data
    return md5(JSON.stringify(relevantData));
  },

  /**
   * Generate an image using a custom prompt
   * @param {Object} appraiser - The appraiser data
   * @param {String} customPrompt - The custom prompt to use
   * @returns {Promise<Object>} - The generated image data
   */
  async generateImageWithCustomPrompt(appraiser, customPrompt) {
    try {
      // Generate data hash for caching purposes
      const appraiserDataHash = this.generateAppraiserDataHash(appraiser);
      
      // Log the custom prompt
      logger.info(`Using custom prompt for appraiser ${appraiser.id}: "${customPrompt.substring(0, 100)}..."`);
      
      // Ensure directories exist
      const imageDir = path.join(__dirname, '../../data/images');
      await fs.ensureDir(imageDir);
      
      if (!vertexAI) {
        throw new Error('Vertex AI client is not initialized');
      }
      
      // Get the generative model
      const model = process.env.IMAGEN_MODEL || 'imagegeneration@002';
      logger.info(`Using Vertex AI model: ${model}`);
      
      // Different approach to access the generative model based on API version
      let imageResponse;
      try {
        // For version 0.2.1 of @google-cloud/vertexai, we need to access the Generation API differently
        logger.info('Attempting to use Vertex AI with compatible method for version 0.2.1');
        
        // Initialize the Generation client
        const aiplatformPath = '@google-cloud/vertexai';
        const ai = require(aiplatformPath);
        
        // Get model name
        const modelId = model;
        logger.info(`Using model ID: ${modelId}`);
        
        // Create a Generation client directly with lower-level API
        if (vertexAI.preview && typeof vertexAI.preview.generation === 'function') {
          logger.info('Using Vertex AI preview.generation API');
          const generation = vertexAI.preview.generation();
          imageResponse = await generation.generateImage({
            prompt: customPrompt,
            modelId: modelId
          });
        } else if (vertexAI.generation && typeof vertexAI.generation === 'function') {
          logger.info('Using Vertex AI generation API');
          const generation = vertexAI.generation();
          imageResponse = await generation.generateImage({
            prompt: customPrompt,
            modelId: modelId
          });
        } else {
          // Try creating a completely new client
          logger.info('Creating new Vertex AI Prediction client');
          const { PredictionServiceClient } = require('@google-cloud/vertexai').v1;
          const predictionClient = new PredictionServiceClient();
          
          const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'your-project-id';
          const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
          
          const name = `projects/${projectId}/locations/${location}/models/${modelId}`;
          logger.info(`Using model path: ${name}`);
          
          const instances = [{
            prompt: customPrompt
          }];
          
          const [predictionResponse] = await predictionClient.predict({
            name,
            instances: instances
          });
          
          logger.info('Prediction response received');
          imageResponse = {
            images: [predictionResponse.predictions[0].bytesValue]
          };
        }
        
        logger.info('Custom prompt image generation response received from Vertex AI');
        logger.debug(`Response structure: ${JSON.stringify(Object.keys(imageResponse || {}))}`);
        
        // Extract the image data from the response, handling different response formats
        let imageData;
        if (imageResponse && imageResponse.response && Array.isArray(imageResponse.response.images)) {
          imageData = imageResponse.response.images[0].bytes;
          logger.info('Found image data in response.images[0].bytes');
        } else if (imageResponse && Array.isArray(imageResponse.images)) {
          imageData = imageResponse.images[0];
          logger.info('Found image data in images[0]');
        } else if (imageResponse && imageResponse.images && imageResponse.images.length > 0) {
          imageData = imageResponse.images[0];
          logger.info('Found image data in images[0]');
        } else if (imageResponse && imageResponse.image) {
          imageData = imageResponse.image;
          logger.info('Found image data in image property');
        } else {
          throw new Error('Unexpected response format from Vertex AI: ' + JSON.stringify(imageResponse));
        }
        
        // Save image to file system
        const imageBuffer = Buffer.from(imageData, 'base64');
        const filename = `appraiser_${appraiser.id}_${appraiserDataHash}_custom.jpg`;
        const filePath = path.join(imageDir, filename);
        
        await fs.writeFile(filePath, imageBuffer);
        
        // Return image data
        const imageUrl = `/images/${filename}`;
        
        logger.info(`Successfully generated image with custom prompt for appraiser ${appraiser.id}`);
        
        return {
          imageUrl,
          imageBuffer,
          appraiserDataHash,
          prompt: customPrompt
        };
      } catch (error) {
        logger.error(`Error in Vertex AI custom prompt image generation: ${error.message}`);
        logger.error(error.stack);
        throw new Error(`Failed to generate image with custom prompt using Vertex AI: ${error.message}`);
      }
    } catch (error) {
      logger.error(`Error generating image with custom prompt: ${error.message}`);
      throw new Error(`Failed to generate image with custom prompt: ${error.message}`);
    }
  }
};

module.exports = { imageGenerator }; 