// Score calculation logic

/**
 * Calculates the overlap score between a drawn silhouette and a mask.
 * Compares pixels based on thresholds.
 * 
 * @param {ImageData | null} silhouetteImageData - ImageData of the drawn body silhouette.
 * @param {ImageData | null} maskImageData - ImageData of the target mask.
 * @param {object} [config={}] - Configuration for score calculation.
 * @param {number} [config.silhouetteThreshold=128] - Alpha value threshold to consider a silhouette pixel 'on'.
 * @param {number} [config.maskThreshold=128] - Value threshold (e.g., R channel) to consider a mask pixel 'on'.
 * @returns {number} The overlap score as a percentage (0-100), or 0 if inputs are invalid.
 */
export function calculateOverlapScore(silhouetteImageData, maskImageData, config = {}) {
    const {
        silhouetteThreshold = 128,
        maskThreshold = 128
    } = config;

    if (!silhouetteImageData || !maskImageData) {
        // console.warn('Cannot calculate score: Missing silhouette or mask ImageData.');
        return 0;
    }

    if (silhouetteImageData.width !== maskImageData.width || silhouetteImageData.height !== maskImageData.height) {
        console.warn('Cannot calculate score: Silhouette and mask dimensions mismatch.');
        return 0;
    }

    const width = silhouetteImageData.width;
    const height = silhouetteImageData.height;
    const silhouetteData = silhouetteImageData.data;
    const maskData = maskImageData.data;

    let silhouettePixelsOn = 0;
    let overlapPixels = 0;

    for (let i = 0; i < silhouetteData.length; i += 4) {
        // Check silhouette pixel using alpha channel
        const isSilhouettePixelOn = silhouetteData[i + 3] >= silhouetteThreshold;

        if (isSilhouettePixelOn) {
            silhouettePixelsOn++;

            // Check mask pixel using one of the color channels (e.g., Red for grayscale)
            const isMaskPixelOn = maskData[i] >= maskThreshold; // Assuming mask is white on black (check R channel)

            if (isMaskPixelOn) {
                overlapPixels++;
            }
        }
    }

    // Calculate score: (overlapping pixels / total silhouette pixels) * 100
    // Avoid division by zero if no silhouette pixels are detected
    const score = (silhouettePixelsOn > 0) ? (overlapPixels / silhouettePixelsOn) * 100 : 0;

    // console.log(`Score Calculation: Overlap=${overlapPixels}, SilhouetteTotal=${silhouettePixelsOn}, Score=${score.toFixed(1)}%`);

    return score;
} 