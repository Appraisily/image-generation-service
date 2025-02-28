/**
 * Image Generation Script
 * Scans the art appraiser directory for appraisers without profile images and generates them
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const md5 = require('md5');
const { imageGenerator } = require('./services/image-generator');
const { logger } = require('./utils/logger');

// Directory paths
const DIRECTORY_DATA_PATH = path.resolve(__dirname, '../../art-appraiser-directory-frontend/src/data');
const DIRECTORY_PUBLIC_PATH = path.resolve(__dirname, '../../art-appraiser-directory-frontend/public');
const OUTPUT_DIR = path.resolve(__dirname, '../data/images');
const PROMPTS_DIR = path.resolve(__dirname, '../data/prompts');

/**
 * Main function to generate images for appraisers without profile images
 */
async function generateImagesForAppraisersWithoutImages() {
  try {
    logger.info('Starting image generation for appraisers without profile images');
    
    // Create output directories if they don't exist
    await fs.ensureDir(OUTPUT_DIR);
    await fs.ensureDir(PROMPTS_DIR);
    
    // Get appraiser data
    const appraisers = await getAppraisersData();
    
    if (!appraisers || appraisers.length === 0) {
      logger.warn('No appraiser data found');
      return;
    }
    
    logger.info(`Found ${appraisers.length} appraisers in data`);
    
    // Filter for appraisers without profile images
    const appraisersWithoutImages = appraisers.filter(appraiser => 
      !appraiser.profileImage || 
      appraiser.profileImage === 'default.jpg' || 
      appraiser.profileImage.includes('placeholder')
    );
    
    logger.info(`Found ${appraisersWithoutImages.length} appraisers without profile images`);
    
    if (appraisersWithoutImages.length === 0) {
      logger.info('All appraisers have profile images. Nothing to do.');
      return;
    }
    
    // Generate images for each appraiser without an image
    const results = {
      totalProcessed: appraisersWithoutImages.length,
      successful: 0,
      failed: 0,
      skipped: 0,
      details: []
    };
    
    for (const appraiser of appraisersWithoutImages) {
      try {
        logger.info(`Processing appraiser: ${appraiser.id} - ${appraiser.name || 'Unknown'}`);
        
        // Generate appraiser data hash for tracking changes
        const appraiserDataHash = md5(JSON.stringify(appraiser));
        logger.debug(JSON.stringify({
          id: appraiser.id,
          name: appraiser.name || 'Unknown',
          gender: appraiser.gender || 'unknown',
          specialization: appraiser.specialization || 'unknown',
          age: appraiser.age || 'unknown'
        }));
        
        // Skip cache - directly generate an image
        logger.info(`Generating new image for appraiser ${appraiser.id}`);
        
        try {
          // Generate new image
          const result = await imageGenerator.generateImage(appraiser);
          
          if (result.error) {
            logger.error(`Error generating image for appraiser ${appraiser.id}: ${result.error}`);
            results.failed++;
            results.details.push({
              id: appraiser.id,
              name: appraiser.name || 'Unknown',
              status: 'failed',
              error: result.error
            });
            continue;
          }
          
          // Update the appraiser data with the image URL
          await updateAppraiserData(appraiser.id, result.imageUrl);
          
          // Add to results
          results.successful++;
          results.details.push({
            id: appraiser.id,
            name: appraiser.name || 'Unknown',
            status: 'success',
            imageUrl: result.imageUrl,
            source: result.source || 'fal-ai'
          });
          
          logger.info(`Image generated successfully for appraiser ${appraiser.id}`);
        } catch (error) {
          logger.error(`Error generating image for appraiser ${appraiser.id}: ${error.message}`);
          results.failed++;
          results.details.push({
            id: appraiser.id,
            name: appraiser.name || 'Unknown',
            status: 'failed',
            error: error.message
          });
        }
      } catch (error) {
        logger.error(`Error processing appraiser ${appraiser.id}: ${error.message}`);
        results.failed++;
        results.details.push({
          id: appraiser.id,
          name: appraiser.name || 'Unknown',
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Log results
    logger.info('Image generation completed');
    logger.info(`Total processed: ${results.totalProcessed}`);
    logger.info(`Successful: ${results.successful}`);
    logger.info(`Failed: ${results.failed}`);
    logger.info(`Skipped (cached): ${results.skipped}`);
    
    // Save results to a log file
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const logFile = path.join(__dirname, '../logs', `image-generation-${timestamp}.json`);
    await fs.writeJson(logFile, results, { spaces: 2 });
    
    logger.info(`Results saved to ${logFile}`);
  } catch (error) {
    logger.error(`Error generating images: ${error.message}`);
  }
}

/**
 * Get appraiser data from the directory frontend
 * @returns {Promise<Array>} - Array of appraiser objects
 */
async function getAppraisersData() {
  try {
    // Check for data directory
    if (!await fs.pathExists(DIRECTORY_DATA_PATH)) {
      logger.error(`Directory data path not found: ${DIRECTORY_DATA_PATH}`);
      return [];
    }
    
    // Look for appraiser data files
    const files = await fs.readdir(DIRECTORY_DATA_PATH);
    const dataFiles = files.filter(file => file.endsWith('.json') || file.endsWith('.js'));
    
    if (dataFiles.length === 0) {
      logger.warn('No data files found in directory');
      return [];
    }
    
    // Process each data file
    let allAppraisers = [];
    
    for (const file of dataFiles) {
      try {
        if (file.endsWith('.json')) {
          // Read JSON file
          const data = await fs.readJson(path.join(DIRECTORY_DATA_PATH, file));
          
          if (data.appraisers && Array.isArray(data.appraisers)) {
            allAppraisers = [...allAppraisers, ...data.appraisers];
          }
        }
        // Note: we don't handle JS files as they would need to be executed
      } catch (error) {
        logger.error(`Error reading data file ${file}: ${error.message}`);
      }
    }
    
    return allAppraisers;
  } catch (error) {
    logger.error(`Error getting appraiser data: ${error.message}`);
    return [];
  }
}

/**
 * Update appraiser data with the new image URL
 * @param {String} appraiserId - The appraiser ID
 * @param {String} imageUrl - The image URL
 * @returns {Promise<void>}
 */
async function updateAppraiserData(appraiserId, imageUrl) {
  try {
    // Get the filename and source
    const isImageKit = imageUrl.includes('ik.imagekit.io');
    const filename = isImageKit 
      ? `appraiser_${appraiserId}.jpg` // Standard filename for ImageKit images
      : path.basename(imageUrl);
    
    // Write a placeholder file in the appraisers directory to be replaced by CI/CD
    const appraiserImagePath = path.join(DIRECTORY_PUBLIC_PATH, 'images', 'appraisers');
    await fs.ensureDir(appraiserImagePath);
    
    // We're not actually modifying the source data files here
    // as that would be done by the CI/CD pipeline or manually
    // Instead we're documenting what changes need to be made
    const updatesPath = path.join(__dirname, '../data', 'appraiser-image-updates.json');
    
    // Load existing updates or create new array
    let updates = [];
    if (await fs.pathExists(updatesPath)) {
      updates = await fs.readJson(updatesPath);
    }
    
    // Add the new update
    updates.push({
      appraiserId,
      originalImageUrl: imageUrl,
      targetPath: `images/appraisers/appraiser_${appraiserId}.jpg`,
      source: isImageKit ? 'imagekit' : 'local',
      updatedAt: new Date().toISOString()
    });
    
    // Save the updates
    await fs.writeJson(updatesPath, updates, { spaces: 2 });
    
    logger.info(`Update recorded for appraiser ${appraiserId}: ${imageUrl}`);
  } catch (error) {
    logger.error(`Error updating appraiser data: ${error.message}`);
  }
}

// Run the script
if (require.main === module) {
  generateImagesForAppraisersWithoutImages()
    .then(() => {
      logger.info('Image generation script completed');
      process.exit(0);
    })
    .catch(error => {
      logger.error(`Image generation script failed: ${error.message}`);
      process.exit(1);
    });
} 