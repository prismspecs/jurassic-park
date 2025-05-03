import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url'; // Import necessary function for __dirname replacement

// Replicate __dirname behavior in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve the module files from the root (needed for import { DinosaurGame } from '../index.js')
app.use(express.static(path.join(__dirname, '.'))); // Serve files from the root directory

// Optional: Specific route for the main page (redundant with static serving but good practice)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Dinosaur Game server listening at http://localhost:${port}`);
});
