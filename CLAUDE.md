# CLAUDE.md - Image Generation Service Guidelines

## Build/Test Commands
```
npm start                     # Start the service
npm run dev                   # Start with nodemon for auto-reloading
npm test                      # Run all Jest tests
node test-*.js                # Run individual test file (e.g., node test-generation.js)
npm run test-upload           # Test image upload functionality
npm run test-errors           # Test error handling
npm run generate-bulk         # Run bulk image generation script
npm run generate-images       # Run image generation script
```

## Code Style
- **Imports**: CommonJS pattern with require/module.exports, group external modules first
- **Formatting**: 2-space indentation, semicolons required, consistent spacing
- **Naming**: camelCase for variables/functions, PascalCase for classes, descriptive names
- **Documentation**: JSDoc comments for functions, header comments for files
- **Error Handling**: try/catch blocks with proper propagation, detailed error objects, use logger service
- **Logging**: Use logger.{debug|info|warn|error|critical|apiError} with context-rich messages
- **Services**: Implement as singleton exports with `module.exports = serviceName`
- **Environment**: Use dotenv for configuration, access secrets via Secret Manager in production

## Architecture
- Service-oriented design with dedicated clients for external APIs (BFAI, ImageKit)
- RESTful API with JSON requests/responses and consistent error formats
- File storage pattern: use absolute paths via path.join(__dirname, '../path') 
- Cache-first with fallback generation strategy for performance