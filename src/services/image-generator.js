/**
 * Image Generator Service
 * Provides functionality to generate images using Black Forest AI's Flux Pro model
 */

const md5 = require('md5');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const { logger } = require('../utils/logger');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager').v1;
const bfaiClient = require('./bfai-client');

// Initialize Secret Manager
let secretManagerClient;
try {
  secretManagerClient = new SecretManagerServiceClient();
  logger.info('Secret Manager client initialized successfully');
} catch (error) {
  logger.error(`Failed to initialize Secret Manager: ${error.message}`);
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
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
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
      
      // Skip cache check - we don't want to use the cache at all
      logger.info(`Cache check bypassed for appraiser: ${appraiser.id}`);
      
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
      logger.info(`Sending prompt to Black Forest AI: "${truncatedPrompt}"`);
      
      let generatedImage;
      
      try {
        // Use Black Forest AI client to generate the image
        generatedImage = await bfaiClient.generateImage(prompt);
        
        if (!generatedImage || !generatedImage.imageUrl) {
          throw new Error('Failed to generate image with Black Forest AI');
        }
        
        logger.info(`Successfully generated image using Black Forest AI: ${generatedImage.imageUrl}`);
        
        // Download the image
        const imageBuffer = await this.downloadImage(generatedImage.imageUrl);
        
        // Skip saving to cache - we don't want to use the cache at all
        logger.info(`Skipping cache save for appraiser: ${appraiser.id}`);
        
        // Return the image data directly from Black Forest AI
        return {
          imageUrl: generatedImage.imageUrl,
          cached: false,
          prompt,
          source: 'black-forest-ai'
        };
      } catch (error) {
        logger.error(`Error in Black Forest AI image generation: ${error.message}`);
        
        // Return a fallback or error response
        return {
          error: `Failed to generate image: ${error.message}`,
          success: false
        };
      }
    } catch (error) {
      logger.error(`Error in image generation process: ${error.message}`);
      return {
        error: error.message,
        success: false
      };
    }
  },
  
  /**
   * Generate a hash for appraiser data to detect changes
   * @param {Object} appraiser - The appraiser data
   * @returns {String} - The hash of the appraiser data
   */
  generateAppraiserDataHash(appraiser) {
    const relevantData = {
      id: appraiser.id,
      firstName: appraiser.firstName,
      lastName: appraiser.lastName,
      specialty: appraiser.specialty,
      experience: appraiser.experience,
      credentials: appraiser.credentials,
      education: appraiser.education
    };
    
    return md5(JSON.stringify(relevantData));
  },
  
  /**
   * Create a detailed prompt using OpenAI GPT-4o
   * @param {Object} appraiser - The appraiser data
   * @returns {Promise<String>} - The detailed prompt
   */
  async createPromptWithGPT(appraiser) {
    try {
      if (!GPT_API_KEY) {
        GPT_API_KEY = await getSecret('OPEN_AI_API_SEO');
        
        if (!GPT_API_KEY) {
          throw new Error('OpenAI API Key not available');
        }
      }
      
      const systemPrompt = `You are an AI assistant specialized in creating detailed art-themed prompts for AI image generators. 
      You will be provided with details about an art appraiser, and your task is to create a photorealistic portrait prompt 
      that represents this expert.`;
      
      const userPrompt = `Create a prompt for generating a professional portrait of an art appraiser with the following details:
      
      Name: ${appraiser.firstName} ${appraiser.lastName}
      Specialty: ${appraiser.specialty || 'General art appraisal'}
      Experience: ${appraiser.experience || 'Experienced'} art appraiser
      ${appraiser.education ? `Education: ${appraiser.education}` : ''}
      ${appraiser.credentials ? `Credentials: ${appraiser.credentials}` : ''}
      
      The portrait should be:
      - Professional and dignified
      - Photorealistic (not abstract or stylized)
      - Showing the appraiser against a subtle background related to their specialty
      - Focus on the upper body and face
      - Business professional attire
      - Natural lighting that highlights their expertise and authority
      - Clean, high-quality image suitable for a professional website
      
      The prompt should be detailed yet concise, and focus on creating a realistic portrait that could be used on an art appraisal website.
      IMPORTANT: Output ONLY the prompt text - no explanations, intros, or other text.`;
      
      const response = await fetch(GPT_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GPT_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 500
        })
      });
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(`OpenAI API error: ${data.error.message}`);
      }
      
      if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        const promptText = data.choices[0].message.content.trim();
        return promptText;
      } else {
        throw new Error('Unexpected response format from OpenAI API');
      }
    } catch (error) {
      logger.error(`Error creating prompt with GPT: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Create a basic prompt when OpenAI API is not available
   * @param {Object} appraiser - The appraiser data
   * @returns {String} - The basic prompt
   */
  createBasicPrompt(appraiser) {
    const specialty = appraiser.specialty || 'General art';
    const experience = appraiser.experience || 'Experienced';
    
    return `Professional portrait photo of ${appraiser.firstName} ${appraiser.lastName}, 
    a ${experience} art appraiser specializing in ${specialty}. 
    The image should be photorealistic, high-quality, show the person from chest up, 
    wearing business attire, with a neutral background related to art appraisal. 
    Natural lighting, professional setting, facing slightly to the side. 
    The image should look like a professional headshot for an expert art appraiser.`;
  },
  
  /**
   * Download an image from a URL
   * @param {String} url - The image URL
   * @returns {Promise<Buffer>} - The image buffer
   */
  async downloadImage(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download image, status code: ${response.statusCode}`));
          return;
        }
        
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', (error) => reject(error));
      }).on('error', (error) => {
        reject(error);
      });
    });
  }
};

module.exports = imageGenerator; 