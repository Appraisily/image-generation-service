# CLAUDE.md - Image Generation Service Guidelines

## Build/Test Commands
```
npm start           # Start the service
npm run dev         # Start with nodemon for auto-reloading
npm test            # Run Jest tests
node test-*.js      # Run individual test file (e.g., node test-generation.js)
npm run generate-bulk # Run bulk image generation
```

## Code Style
- **Imports**: CommonJS pattern with require/module.exports
- **Formatting**: 2-space indentation, semicolons required
- **Naming**: camelCase for variables/functions, descriptive names
- **Documentation**: JSDoc comments for functions, header comments for files
- **Error Handling**: try/catch blocks with detailed error objects, proper error propagation
- **Logging**: Use logger.{debug|info|warn|error|critical} with context-rich messages

## Architecture
- Service-oriented design with clients for external APIs
- Consistent API with JSON requests/responses
- Environment variables for configuration (via dotenv)
- All file paths must use absolute paths, not relative