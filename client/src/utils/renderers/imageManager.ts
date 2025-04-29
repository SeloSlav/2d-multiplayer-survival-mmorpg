// import { logError, logInfo, logWarn } from './logger'; // Assuming a logger utility exists

interface ImageCacheEntry {
    image: HTMLImageElement;
    status: 'loading' | 'loaded' | 'error';
}

class ImageManager {
    private cache: Map<string, ImageCacheEntry> = new Map();

    /**
     * Starts preloading an image if not already cached or loading.
     * @param src The processed image source URL (typically from an import).
     */
    preloadImage(src: string): void {
        if (!src || this.cache.has(src)) {
            return; 
        }

        // console.log(`[ImageManager] Preloading: ${src}`);
        const image = new Image();
        const cacheEntry: ImageCacheEntry = { image, status: 'loading' };
        this.cache.set(src, cacheEntry); // Use the src directly as key

        image.onload = () => {
            cacheEntry.status = 'loaded';
            // console.log(`[ImageManager] Loaded: ${src}`);
        };
        image.onerror = () => {
            cacheEntry.status = 'error';
            console.error(`[ImageManager] Failed to load image: ${src}`);
        };
        image.src = src; // Use the src directly
    }

    /**
     * Retrieves an image from the cache. 
     * @param src The processed image source URL.
     * @returns The HTMLImageElement if loaded, otherwise null.
     */
    getImage(src: string): HTMLImageElement | null {
        if (!src) return null;

        const cacheEntry = this.cache.get(src); // Use src directly for lookup

        if (cacheEntry) {
            if (cacheEntry.status === 'loaded' && cacheEntry.image.complete && cacheEntry.image.naturalHeight !== 0) {
                return cacheEntry.image;
            } else if (cacheEntry.status === 'loading') {
                return null;
            } else { 
                return null; 
            }
        } else {
            console.warn(`[ImageManager] Image not preloaded, attempting to load now: ${src}`);
            this.preloadImage(src); // Call preload with the direct src
            return null;
        }
    }

     /**
      * Checks if a specific image is fully loaded and ready for drawing.
      * @param src The processed image source URL.
      * @returns True if the image is loaded, false otherwise.
      */
     isImageLoaded(src: string): boolean {
        if (!src) return false;
        const entry = this.cache.get(src); // Use src directly for lookup
        return !!entry && entry.status === 'loaded' && entry.image.complete && entry.image.naturalHeight !== 0;
     }
}

// Export a singleton instance
export const imageManager = new ImageManager(); 