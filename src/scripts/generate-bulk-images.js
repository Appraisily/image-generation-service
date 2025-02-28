#!/usr/bin/env node

/**
 * Bulk Image Generation Script
 * 
 * This script helps generate profile images for multiple appraisers in bulk.
 * It can be used as part of the build process or for regenerating images for selected appraisers.
 * 
 * Usage:
 *   npm run generate-bulk -- --directory=../data/appraisers
 *   npm run generate-bulk -- --url=http://localhost:3000/api/appraisers
 *   npm run generate-bulk -- --count=10
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { program } = require('commander');
const { logger } = require('../utils/logger');

// Parse command line arguments
program
  .option('-d, --directory <path>', 'Directory containing appraiser JSON files')
  .option('-u, --url <url>', 'URL to fetch appraiser data from')
  .option('-c, --count <number>', 'Number of appraisers to process (default: all)', parseInt)
  .option('-f, --force', 'Force regeneration of images even if they exist')
  .option('-s, --server <url>', 'Image generation service URL', 'http://localhost:3000')
  .option('-b, --batch-size <number>', 'Batch size for API requests', parseInt, 5)
  .parse(process.argv);

const options = program.opts();

// Service URL for image generation
const serviceUrl = options.server;

/**
 * Load appraiser data from directory
 * @param {string} directory - Directory containing appraiser JSON files
 * @returns {Promise<Array>} - Array of appraiser objects
 */
async function loadAppraisersFromDirectory(directory) {
  try {
    const files = await fs.readdir(directory);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    const appraisers = [];
    for (const file of jsonFiles) {
      const data = await fs.readJson(path.join(directory, file));
      if (Array.isArray(data)) {
        appraisers.push(...data);
      } else {
        appraisers.push(data);
      }
    }
    
    return appraisers;
  } catch (error) {
    logger.error(`Error loading appraisers from directory: ${error.message}`);
    return [];
  }
}

/**
 * Load appraiser data from URL
 * @param {string} url - URL to fetch appraiser data from
 * @returns {Promise<Array>} - Array of appraiser objects
 */
async function loadAppraisersFromUrl(url) {
  try {
    const response = await axios.get(url);
    if (Array.isArray(response.data)) {
      return response.data;
    } else if (response.data.appraisers && Array.isArray(response.data.appraisers)) {
      return response.data.appraisers;
    } else {
      logger.error('Invalid response format from URL, expected array of appraisers');
      return [];
    }
  } catch (error) {
    logger.error(`Error loading appraisers from URL: ${error.message}`);
    return [];
  }
}

/**
 * Filter appraisers that need image generation
 * @param {Array} appraisers - Array of appraiser objects
 * @param {boolean} force - Force regeneration regardless of existing images
 * @returns {Array} - Filtered array of appraisers
 */
function filterAppraisersNeedingImages(appraisers, force) {
  if (force) {
    logger.info('Force flag is set, regenerating all images');
    return appraisers;
  }
  
  // Filter out appraisers that already have an imageUrl in ImageKit format
  return appraisers.filter(appraiser => {
    const hasImage = appraiser.imageUrl && appraiser.imageUrl.includes('ik.imagekit.io');
    return !hasImage;
  });
}

/**
 * Process a batch of appraisers
 * @param {Array} batch - Batch of appraisers to process
 * @returns {Promise<Array>} - Array of results
 */
async function processBatch(batch) {
  try {
    logger.info(`Processing batch of ${batch.length} appraisers`);
    
    const response = await axios.post(
      `${serviceUrl}/api/generate-bulk`,
      { appraisers: batch },
      { 
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000 // 2 minutes timeout for batch processing
      }
    );
    
    return response.data;
  } catch (error) {
    logger.error(`Error processing batch: ${error.message}`);
    
    // Return error result for each appraiser in the batch
    return batch.map(appraiser => ({
      appraiserId: appraiser.id,
      success: false,
      error: error.message
    }));
  }
}

/**
 * Generate images for all appraisers
 * @param {Array} appraisers - Array of appraiser objects
 * @param {number} batchSize - Number of appraisers to process in each batch
 * @returns {Promise<Array>} - Array of results
 */
async function generateImages(appraisers, batchSize) {
  const results = [];
  const totalAppraisers = appraisers.length;
  
  logger.info(`Starting bulk image generation for ${totalAppraisers} appraisers`);
  
  // Process in batches
  for (let i = 0; i < totalAppraisers; i += batchSize) {
    const batch = appraisers.slice(i, i + batchSize);
    logger.info(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(totalAppraisers / batchSize)}`);
    
    const batchResults = await processBatch(batch);
    results.push(...batchResults);
    
    // Small delay between batches to avoid rate limits
    if (i + batchSize < totalAppraisers) {
      logger.info('Pausing between batches...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return results;
}

/**
 * Main function
 */
async function main() {
  try {
    let appraisers = [];
    
    // Load appraisers from directory or URL
    if (options.directory) {
      appraisers = await loadAppraisersFromDirectory(options.directory);
      logger.info(`Loaded ${appraisers.length} appraisers from directory ${options.directory}`);
    } else if (options.url) {
      appraisers = await loadAppraisersFromUrl(options.url);
      logger.info(`Loaded ${appraisers.length} appraisers from URL ${options.url}`);
    } else {
      logger.error('Either --directory or --url must be specified');
      process.exit(1);
    }
    
    // Limit the number of appraisers if count option is provided
    if (options.count && options.count > 0 && options.count < appraisers.length) {
      appraisers = appraisers.slice(0, options.count);
      logger.info(`Limited to ${appraisers.length} appraisers based on --count option`);
    }
    
    // Filter appraisers that need image generation
    const filteredAppraisers = filterAppraisersNeedingImages(appraisers, options.force);
    logger.info(`${filteredAppraisers.length} appraisers need image generation`);
    
    if (filteredAppraisers.length === 0) {
      logger.info('No appraisers need image generation');
      process.exit(0);
    }
    
    // Generate images
    const batchSize = options.batchSize || 5;
    const results = await generateImages(filteredAppraisers, batchSize);
    
    // Count successful generations
    const successCount = results.filter(result => result.success).length;
    logger.info(`Image generation complete. ${successCount} of ${results.length} successful.`);
    
    // Save results to file
    const resultsPath = path.join(process.cwd(), 'image-generation-results.json');
    await fs.writeJson(resultsPath, {
      timestamp: new Date().toISOString(),
      total: results.length,
      successful: successCount,
      results
    }, { spaces: 2 });
    
    logger.info(`Results saved to ${resultsPath}`);
    
    if (successCount < results.length) {
      process.exit(1); // Exit with error if not all generations were successful
    }
  } catch (error) {
    logger.error(`Error in bulk image generation: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
main(); 