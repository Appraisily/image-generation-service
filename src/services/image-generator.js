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
  // GOOGLE_CLOUD_PROJECT will already include GOOGLE_CLOUD_PROJECT_ID fallback
  // from the index.js file's normalization
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'civil-forge-403609';
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  
  logger.info(`Initializing Vertex AI with project ID: ${projectId}, location: ${location}`);
  
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
    // Use the normalized project ID from the environment variable
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'civil-forge-403609';
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
      // Generate appraiser data hash for caching
      const appraiserDataHash = this.generateAppraiserDataHash(appraiser);
      logger.info(`Generating new image for appraiser: ${appraiser.id}`);
      
      // Create a prompt for the image generation
      let prompt;
      try {
        // Try to use OpenAI API for generating a detailed prompt
        prompt = await this.createPromptWithGPT(appraiser);
      } catch (error) {
        logger.warn(`OpenAI API Key not provided. Falling back to basic prompt generation.`);
        logger.info(`In production, ensure OPEN_AI_API_SEO is available from Secret Manager`);
        prompt = this.createBasicPrompt(appraiser);
      }
      
      // Log the prompt (without PII)
      const truncatedPrompt = prompt.length > 100 ? prompt.substring(0, 100) + '...' : prompt;
      logger.info(`Sending prompt to Vertex AI: "${truncatedPrompt}"`);
      
      // Get the image generation model name from env vars or use default
      const modelName = process.env.IMAGEN_MODEL || 'imagen-3.0-generate-002';
      logger.info(`Using Vertex AI model: ${modelName}`);
      
      // Check if Vertex AI is initialized
      if (!vertexAI) {
        throw new Error('Vertex AI client is not initialized');
      }
      
      let imageBase64;
      
      try {
        logger.info(`Attempting to use Vertex AI with compatible method for version 1.4.0`);
        
        // Get the location from environment or default to us-central1
        const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
        const projectId = process.env.GOOGLE_CLOUD_PROJECT;
        
        logger.info(`Using model ID: ${modelName}`);
        
        try {
          // Direct API call to Imagen 3 model
          logger.info('Attempting direct API call to Imagen 3 model');
          
          // Create prediction client
          const { PredictionServiceClient } = require('@google-cloud/aiplatform');
          const predictionClient = new PredictionServiceClient();
          
          const endpoint = `projects/${projectId}/locations/${location}/publishers/google/models/${modelName}`;
          
          // Format the request for the Imagen 3 API
          const request = {
            endpoint,
            instances: [
              {
                prompt: prompt
              }
            ],
            parameters: {
              sampleCount: 1,
              // The following params are optional but can be adjusted based on needs
              // negativePrompt: "blurry, distorted, low quality",
              // enhancePrompt: true
            }
          };
          
          logger.info(`Sending prediction request to ${modelName}`);
          const [response] = await predictionClient.predict(request);
          
          if (response && 
              response.predictions && 
              response.predictions.length > 0 && 
              response.predictions[0].bytesBase64Encoded) {
            
            imageBase64 = response.predictions[0].bytesBase64Encoded;
            logger.info(`Successfully generated image using Imagen 3 model: ${modelName}`);
          } else {
            logger.warn('Unexpected response structure from Imagen 3 API');
            logger.warn(JSON.stringify(response));
            throw new Error('Unexpected response structure from Imagen 3 API');
          }
        } catch (directApiError) {
          logger.warn(`Error using direct Imagen 3 API: ${directApiError.message}`);
          
          // Fallback to generative model interface if direct API fails
          try {
            logger.info('Falling back to generativeModel interface');
            
            // Try using the preview API first
            const model = await vertexAI.preview.getGenerativeModel({
              model: modelName,
            });
            
            logger.info('Successfully created Imagen 3 model using preview.getGenerativeModel');
            
            // Use generateContent for Imagen 3
            const result = await model.generateContent({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            
            // Extract image data from response based on Imagen 3 response format
            if (result && 
                result.response && 
                result.response.candidates && 
                result.response.candidates[0] && 
                result.response.candidates[0].content && 
                result.response.candidates[0].content.parts && 
                result.response.candidates[0].content.parts[0] && 
                result.response.candidates[0].content.parts[0].inlineData && 
                result.response.candidates[0].content.parts[0].inlineData.data) {
              imageBase64 = result.response.candidates[0].content.parts[0].inlineData.data;
              logger.info('Successfully generated image using Imagen 3 with preview.getGenerativeModel');
            } else {
              logger.warn('Unexpected response structure from Imagen 3 using generative model API');
              logger.warn(JSON.stringify(result));
              throw new Error('Unexpected response structure from Imagen 3 using generative model API');
            }
          } catch (previewError) {
            logger.warn(`Error using preview API with Imagen 3: ${previewError.message}`);
            
            // Try the non-preview API as final fallback
            try {
              const model = await vertexAI.getGenerativeModel({
                model: modelName,
              });
              
              logger.info('Successfully created Imagen 3 model using getGenerativeModel');
              
              const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
              });
              
              if (result && 
                  result.response && 
                  result.response.candidates && 
                  result.response.candidates[0] && 
                  result.response.candidates[0].content && 
                  result.response.candidates[0].content.parts && 
                  result.response.candidates[0].content.parts[0] && 
                  result.response.candidates[0].content.parts[0].inlineData && 
                  result.response.candidates[0].content.parts[0].inlineData.data) {
                imageBase64 = result.response.candidates[0].content.parts[0].inlineData.data;
                logger.info('Successfully generated image using Imagen 3 with getGenerativeModel');
              } else {
                logger.warn('Unexpected response structure from Imagen 3');
                logger.warn(JSON.stringify(result));
                throw new Error('Unexpected response structure from Imagen 3');
              }
            } catch (nonPreviewError) {
              logger.warn(`Error using non-preview API with Imagen 3: ${nonPreviewError.message}`);
              throw new Error(`All Imagen 3 methods failed: ${directApiError.message}, ${previewError.message}, ${nonPreviewError.message}`);
            }
          }
        }
      } catch (error) {
        logger.error(`Error in Vertex AI image generation: ${error.message}`);
        logger.error(error);
        throw new Error(`Failed to generate image using Vertex AI: ${error.message}`);
      }
      
      // Check if we got an image
      if (!imageBase64) {
        throw new Error('No image was generated by Vertex AI');
      }
      
      // Convert base64 to buffer
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      
      // Save the image locally for caching
      const fileName = `appraiser_${appraiser.id}_${new Date().getTime()}.jpg`;
      const imagePath = path.join(__dirname, '../../data/images', fileName);
      await fs.writeFile(imagePath, imageBuffer);
      
      // Generate URL for the image
      const imageUrl = `/images/${fileName}`;
      
      logger.info(`Successfully generated image for appraiser ${appraiser.id}`);
      
      // Return the result
      return {
        success: true,
        imageUrl,
        imageBuffer,
        prompt,
        appraiserDataHash
      };
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
      // Generate appraiser data hash for caching
      const appraiserDataHash = this.generateAppraiserDataHash(appraiser);
      logger.info(`Generating new image for appraiser: ${appraiser.id} with custom prompt`);
      
      // Log the prompt (without PII)
      const truncatedPrompt = customPrompt.length > 100 ? customPrompt.substring(0, 100) + '...' : customPrompt;
      logger.info(`Sending custom prompt to Vertex AI: "${truncatedPrompt}"`);
      
      // Get the image generation model name from env vars or use default (now using Imagen 3)
      const modelName = process.env.IMAGEN_MODEL || 'imagen-3.0-generate-002';
      logger.info(`Using Vertex AI model: ${modelName}`);
      
      // Check if Vertex AI is initialized
      if (!vertexAI) {
        throw new Error('Vertex AI client is not initialized');
      }
      
      let imageBase64;
      
      try {
        logger.info(`Attempting to use Vertex AI with compatible method for version 1.4.0`);
        
        // Get the location from environment or default to us-central1
        const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
        const projectId = process.env.GOOGLE_CLOUD_PROJECT;
        
        try {
          // Direct API call to Imagen 3 model
          logger.info('Attempting direct API call to Imagen 3 model for custom prompt');
          
          // Create prediction client
          const { PredictionServiceClient } = require('@google-cloud/aiplatform');
          const predictionClient = new PredictionServiceClient();
          
          const endpoint = `projects/${projectId}/locations/${location}/publishers/google/models/${modelName}`;
          
          // Format the request for the Imagen 3 API
          const request = {
            endpoint,
            instances: [
              {
                prompt: customPrompt
              }
            ],
            parameters: {
              sampleCount: 1,
              // The following params are optional but can be adjusted based on needs
              // negativePrompt: "blurry, distorted, low quality",
              // enhancePrompt: true
            }
          };
          
          logger.info(`Sending prediction request to ${modelName} with custom prompt`);
          const [response] = await predictionClient.predict(request);
          
          if (response && 
              response.predictions && 
              response.predictions.length > 0 && 
              response.predictions[0].bytesBase64Encoded) {
            
            imageBase64 = response.predictions[0].bytesBase64Encoded;
            logger.info(`Successfully generated image using Imagen 3 model: ${modelName} with custom prompt`);
          } else {
            logger.warn('Unexpected response structure from Imagen 3 API');
            logger.warn(JSON.stringify(response));
            throw new Error('Unexpected response structure from Imagen 3 API');
          }
        } catch (directApiError) {
          logger.warn(`Error using direct Imagen 3 API: ${directApiError.message}`);
          
          // Fallback to generative model interface if direct API fails
          try {
            logger.info('Falling back to generativeModel interface for custom prompt');
            
            // Try using the preview API first
            const model = await vertexAI.preview.getGenerativeModel({
              model: modelName,
            });
            
            logger.info('Successfully created Imagen 3 model using preview.getGenerativeModel for custom prompt');
            
            // Use generateContent for Imagen 3
            const result = await model.generateContent({
              contents: [{ role: 'user', parts: [{ text: customPrompt }] }],
            });
            
            // Extract image data from response based on Imagen 3 response format
            if (result && 
                result.response && 
                result.response.candidates && 
                result.response.candidates[0] && 
                result.response.candidates[0].content && 
                result.response.candidates[0].content.parts && 
                result.response.candidates[0].content.parts[0] && 
                result.response.candidates[0].content.parts[0].inlineData && 
                result.response.candidates[0].content.parts[0].inlineData.data) {
              imageBase64 = result.response.candidates[0].content.parts[0].inlineData.data;
              logger.info('Successfully generated image using Imagen 3 with preview.getGenerativeModel for custom prompt');
            } else {
              logger.warn('Unexpected response structure from Imagen 3 using generative model API');
              logger.warn(JSON.stringify(result));
              throw new Error('Unexpected response structure from Imagen 3 using generative model API');
            }
          } catch (previewError) {
            logger.warn(`Error using preview API with Imagen 3: ${previewError.message}`);
            
            // Try the non-preview API as final fallback
            try {
              const model = await vertexAI.getGenerativeModel({
                model: modelName,
              });
              
              logger.info('Successfully created Imagen 3 model using getGenerativeModel for custom prompt');
              
              const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: customPrompt }] }],
              });
              
              if (result && 
                  result.response && 
                  result.response.candidates && 
                  result.response.candidates[0] && 
                  result.response.candidates[0].content && 
                  result.response.candidates[0].content.parts && 
                  result.response.candidates[0].content.parts[0] && 
                  result.response.candidates[0].content.parts[0].inlineData && 
                  result.response.candidates[0].content.parts[0].inlineData.data) {
                imageBase64 = result.response.candidates[0].content.parts[0].inlineData.data;
                logger.info('Successfully generated image using Imagen 3 with getGenerativeModel for custom prompt');
              } else {
                logger.warn('Unexpected response structure from Imagen 3');
                logger.warn(JSON.stringify(result));
                throw new Error('Unexpected response structure from Imagen 3');
              }
            } catch (nonPreviewError) {
              logger.warn(`Error using non-preview API with Imagen 3: ${nonPreviewError.message}`);
              throw new Error(`All Imagen 3 methods failed: ${directApiError.message}, ${previewError.message}, ${nonPreviewError.message}`);
            }
          }
        }
      } catch (error) {
        logger.error(`Error in Vertex AI image generation: ${error.message}`);
        logger.error(error);
        throw new Error(`Failed to generate image using Vertex AI: ${error.message}`);
      }
      
      // Check if we got an image
      if (!imageBase64) {
        throw new Error('No image was generated by Vertex AI');
      }
      
      // Convert base64 to buffer
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      
      // Save the image locally for caching
      const fileName = `appraiser_${appraiser.id}_${new Date().getTime()}.jpg`;
      const imagePath = path.join(__dirname, '../../data/images', fileName);
      await fs.writeFile(imagePath, imageBuffer);
      
      // Generate URL for the image
      const imageUrl = `/images/${fileName}`;
      
      logger.info(`Successfully generated image for appraiser ${appraiser.id} with custom prompt`);
      
      // Return the result
      return {
        success: true,
        imageUrl,
        imageBuffer,
        prompt: customPrompt,
        appraiserDataHash
      };
    } catch (error) {
      logger.error(`Error generating image with custom prompt: ${error.message}`);
      throw new Error(`Failed to generate image with custom prompt: ${error.message}`);
    }
  }
};

module.exports = { imageGenerator }; 