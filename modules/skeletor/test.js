// Example usage in test.js or similar:
import { extractPeopleFromVideo } from './app.js';

// Use default 90%
//extractPeopleFromVideo('input.mp4', 'output_default.webm');

// Arguments: inputPath, outputPath, thickness, threadUsagePercentage
extractPeopleFromVideo('test-vids/dancing_1080p.mp4', 'test-vids/output.webm', 10, 90);