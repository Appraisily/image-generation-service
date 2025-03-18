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
const imagekitClient = require('./imagekit-client');

// Initialize Secret Manager
let secretManagerClient;
try {
  secretManagerClient = new SecretManagerServiceClient();
  logger.info('Secret Manager client initialized successfully');
} catch (error) {
  logger.error(`Failed to initialize Secret Manager: ${error.message}`);
}

// GPT-4o API configuration
let GPT_API_KEY = process.env.OPEN_AI_API_SEO || process.env.OPENAI_API_KEY;
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
    // Try both possible secret names
    GPT_API_KEY = await getSecret('OPENAI_API_KEY') || await getSecret('OPEN_AI_API_SEO');
    logger.info(`OpenAI API Key from Secret Manager: ${GPT_API_KEY ? 'Retrieved' : 'Not found'}`);
    
    if (!GPT_API_KEY) {
      logger.warn('Could not find OpenAI API key under either OPENAI_API_KEY or OPEN_AI_API_SEO');
      logger.info('Please ensure the correct secret name is set in Secret Manager');
    }
  }
})();

const imageGenerator = {
  /**
   * Generate an image for an appraiser
   * @param {Object} appraiser - The appraiser data
   * @param {string} customPrompt - Optional custom prompt to override automatic generation
   * @returns {Promise<Object>} - The generated image data
   */
  async generateImage(appraiser, customPrompt = null) {
    try {
      // Generate appraiser data hash for caching
      const appraiserDataHash = this.generateAppraiserDataHash(appraiser);
      logger.info(`Generating new image for appraiser: ${appraiser.id}`);
      
      // Skip cache check - we don't want to use the cache at all
      logger.info(`Cache check bypassed for appraiser: ${appraiser.id}`);
      
      // Create a prompt for the image generation
      let prompt;
      
      // If customPrompt is provided, use it directly instead of generating one
      if (customPrompt) {
        logger.info(`Using provided custom prompt for appraiser: ${appraiser.id}`);
        prompt = customPrompt;
      } else {
        // Otherwise, generate a prompt automatically
        try {
          // Try to use OpenAI API for generating a detailed prompt
          prompt = await this.createPromptWithGPT(appraiser);
        } catch (error) {
          logger.warn(`OpenAI API Key not provided. Falling back to basic prompt generation.`);
          logger.info(`In production, ensure OPEN_AI_API_SEO is available from Secret Manager`);
          prompt = this.createBasicPrompt(appraiser);
        }
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
        
        // Download the image from Black Forest AI
        const imageBuffer = await this.downloadImage(generatedImage.imageUrl);
        logger.info(`Successfully downloaded image from Black Forest AI, size: ${imageBuffer.length} bytes`);
        
        // Generate a file name for the image
        const fileName = `appraiser_${appraiser.id}_${Date.now()}.jpg`;
        
        // Upload the image to ImageKit
        let imagekitResponse;
        
        // Check if we're running remotely (based on environment)
        const isRemoteEnvironment = process.env.NODE_ENV === 'production' || process.env.IS_CLOUD_RUN === 'true';
        
        if (isRemoteEnvironment) {
          // In remote environment, always use base64 to avoid stream issues
          logger.info('Running in remote environment, using base64 upload to avoid stream issues');
          try {
            // Convert buffer to base64 string
            const base64Data = imageBuffer.toString('base64');
            logger.info(`Converted image buffer to base64 string (${base64Data.length} characters)`);
            
            // Upload using base64
            imagekitResponse = await imagekitClient.uploadImageFromBase64(base64Data, fileName);
          } catch (base64Error) {
            logger.error(`Base64 upload failed: ${base64Error.message}`);
            logger.info('Falling back to URL-based upload to ImageKit');
            
            // Fall back to URL-based upload if base64 upload fails
            imagekitResponse = await imagekitClient.uploadImageFromUrl(generatedImage.imageUrl, fileName);
          }
        } else {
          // In local environment, try direct buffer upload first
          try {
            logger.info('Attempting to upload image buffer to ImageKit');
            imagekitResponse = await imagekitClient.uploadImage(imageBuffer, fileName);
          } catch (uploadError) {
            logger.warn(`Error uploading image buffer to ImageKit: ${uploadError.message}`);
            logger.info('Falling back to URL-based upload to ImageKit');
            
            // Fall back to URL-based upload if buffer upload fails
            imagekitResponse = await imagekitClient.uploadImageFromUrl(generatedImage.imageUrl, fileName);
          }
        }
        
        if (!imagekitResponse || !imagekitResponse.url) {
          throw new Error('Failed to upload image to ImageKit');
        }
        
        logger.info(`Successfully uploaded image to ImageKit: ${imagekitResponse.url}`);
        
        // Return the image data with the ImageKit URL
        return {
          imageUrl: imagekitResponse.url,
          originalUrl: generatedImage.imageUrl, // Keep the original URL for reference
          cached: false,
          prompt,
          source: 'black-forest-ai'
        };
      } catch (error) {
        logger.error(`Error in image generation process: ${error.message}`);
        
        // If we have a generated image URL but failed to upload to ImageKit,
        // return the original URL from Black Forest AI
        if (generatedImage && generatedImage.imageUrl) {
          logger.warn('Using original Black Forest AI URL due to ImageKit upload failure');
          return {
            imageUrl: generatedImage.imageUrl,
            cached: false,
            prompt,
            source: 'black-forest-ai',
            note: 'Using original AI provider URL (ImageKit upload failed)'
          };
        }
        
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
        // Try both possible secret names
        GPT_API_KEY = await getSecret('OPENAI_API_KEY') || await getSecret('OPEN_AI_API_SEO');
        
        if (!GPT_API_KEY) {
          throw new Error('OpenAI API Key not available - checked both OPENAI_API_KEY and OPEN_AI_API_SEO secrets');
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
  },

  /**
   * Generate a location image based on location data
   * @param {Object} location - Location data with id, name, type, etc.
   * @param {string} customPrompt - Optional custom prompt to override the generated one
   * @returns {Promise<Object>} - Result object with imageUrl and other data
   */
  async generateLocationImage(location, customPrompt = null) {
    try {
      logger.info(`Generating image for location: ${location.id}`);
      
      // Extract location data
      const locationName = location.name || '';
      const locationType = location.type || 'Office';
      const locationCity = location.city || '';
      const locationState = location.state || '';
      const locationDescription = location.description || '';
      const locationFeatures = Array.isArray(location.features) ? location.features : [];
      
      // Generate a unique identifier for this location
      const locationHash = md5(`${location.id}_${locationName}_${locationType}`);
      const outputDir = path.join(__dirname, '../../data/images');
      const outputFilename = `location_${locationHash}.jpg`;
      const outputPath = path.join(outputDir, outputFilename);
      
      // Save the prompt to file for reference
      const promptsDir = path.join(__dirname, '../../data/prompts');
      const promptFilename = `location_${location.id}_prompt.txt`;
      const promptPath = path.join(promptsDir, promptFilename);
      
      // Generate a prompt for the image
      let prompt;
      if (customPrompt) {
        prompt = customPrompt;
      } else {
        // Let's build a prompt for this location type
        let basePrompt = '';
        let featuresText = '';
        
        if (locationFeatures.length > 0) {
          featuresText = `It features ${locationFeatures.join(', ')}.`;
        }
        
        // Different prompts based on location type
        switch (locationType.toLowerCase()) {
          case 'gallery':
            basePrompt = `A professional photograph of ${locationName}, an art gallery ${locationCity ? `in ${locationCity}, ${locationState}` : locationState ? `in ${locationState}` : ''}. ${locationDescription} ${featuresText} The image should show a elegant art gallery with high ceilings, well-lit display areas, and a modern entrance.`;
            break;
          case 'museum':
            basePrompt = `A professional photograph of ${locationName}, a museum ${locationCity ? `in ${locationCity}, ${locationState}` : locationState ? `in ${locationState}` : ''}. ${locationDescription} ${featuresText} The image should show a prestigious museum with grand architecture, columns, and a prominent entrance with visitors approaching.`;
            break;
          case 'auction house':
            basePrompt = `A professional photograph of ${locationName}, an auction house ${locationCity ? `in ${locationCity}, ${locationState}` : locationState ? `in ${locationState}` : ''}. ${locationDescription} ${featuresText} The image should show an elegant auction house with a classic façade, refined entrance, and signs indicating it's an auction venue.`;
            break;
          case 'office':
          default:
            basePrompt = `A professional photograph of ${locationName}, a professional office building ${locationCity ? `in ${locationCity}, ${locationState}` : locationState ? `in ${locationState}` : ''}. ${locationDescription} ${featuresText} The image should show a modern office building with a clean entrance, professional signage, and business-appropriate architecture.`;
        }
        
        prompt = `${basePrompt} The photograph should be high quality, professionally lit, with no people visible. It should be a daytime shot with good natural lighting, blue sky, and should focus on the building's exterior and entrance.`;
      }
      
      // Save prompt to file
      await fs.writeFile(promptPath, prompt, 'utf8');
      logger.info(`Saved prompt to ${promptPath}`);
      
      // Generate image using the Black Forest AI service
      logger.info(`Calling Black Forest AI for location image generation...`);
      const bfaiResponse = await bfaiClient.generateImage(prompt);
      
      if (!bfaiResponse.success || !bfaiResponse.imageUrl) {
        logger.error(`Failed to generate image with Black Forest AI: ${bfaiResponse.error || 'Unknown error'}`);
        return {
          error: bfaiResponse.error || 'Failed to generate image',
          source: 'bfai'
        };
      }
      
      // Download the image and save it locally
      logger.info(`Downloading image from Black Forest AI...`);
      const imageBuffer = await this.downloadImage(bfaiResponse.imageUrl);
      await fs.writeFile(outputPath, imageBuffer);
      logger.info(`Saved image to ${outputPath}`);
      
      // Upload to ImageKit if configured
      let imagekitUrl = null;
      
      try {
        logger.info(`Uploading image to ImageKit...`);
        
        // Check if we're running remotely (based on environment)
        const isRemoteEnvironment = process.env.NODE_ENV === 'production' || process.env.IS_CLOUD_RUN === 'true';
        const uploadOptions = {
          folder: '/locations/',
          tags: ['location', locationType, locationCity, locationState].filter(Boolean),
          useUniqueFileName: true,
          isPrivateFile: false,
          metadata: {
            locationId: location.id,
            locationName: locationName,
            locationType: locationType,
            locationCity: locationCity,
            locationState: locationState
          }
        };
        
        let imagekitResponse;
        
        if (isRemoteEnvironment) {
          // In remote environment, convert to base64 first to avoid stream issues
          logger.info('Running in remote environment, using base64 upload to avoid stream issues');
          const base64Data = imageBuffer.toString('base64');
          logger.info(`Converted image buffer to base64 string (${base64Data.length} characters)`);
          imagekitResponse = await imagekitClient.uploadImageFromBase64(
            base64Data,
            `location_${location.id}`,
            uploadOptions
          );
        } else {
          // In local environment, use buffer directly
          imagekitResponse = await imagekitClient.uploadImage(
            imageBuffer,
            `location_${location.id}`,
            uploadOptions
          );
        }
        
        if (imagekitResponse && imagekitResponse.url) {
          imagekitUrl = imagekitResponse.url;
          logger.info(`Successfully uploaded to ImageKit: ${imagekitUrl}`);
        } else {
          logger.warn('ImageKit upload completed but no URL returned');
        }
      } catch (error) {
        logger.error(`ImageKit upload failed: ${error.message}`);
        // Continue with the original URL as fallback
      }
      
      // Return result with ImageKit URL if available, otherwise the original URL
      return {
        locationId: location.id,
        imageUrl: imagekitUrl || bfaiResponse.imageUrl,
        originalUrl: bfaiResponse.imageUrl,
        source: imagekitUrl ? 'imagekit' : 'bfai',
        prompt: prompt
      };
    } catch (error) {
      logger.error(`Error generating location image: ${error.message}`);
      return {
        error: `Failed to generate location image: ${error.message}`,
        source: 'internal_error'
      };
    }
  }
};

module.exports = imageGenerator; 