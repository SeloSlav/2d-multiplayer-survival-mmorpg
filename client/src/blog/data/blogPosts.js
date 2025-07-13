// Import all blog posts
import brothBulletsAlphaLaunch from './posts/broth-bullets-alpha-launch';
import spacetimedbRevolution from './posts/spacetimedb-revolution';
import proceduralWorldGeneration from './posts/procedural-world-generation';
import resourceSystemImplementation from './posts/resource-system-implementation';
import fieldCauldronAIRecipeGeneration from './posts/field-cauldron-ai-recipe-generation';
import best2DSurvivalGames from './posts/best-2d-survival-games';
import babushkaSpriteEvolution from './posts/babushka-sprite-evolution';

// Export posts as an array, sorted by date (newest first)
export const blogPosts = [
  brothBulletsAlphaLaunch, // January 15, 2025 - Alpha Launch!
  spacetimedbRevolution, // January 15, 2025
  babushkaSpriteEvolution, // April 6, 2025
  best2DSurvivalGames, // April 5, 2025
  fieldCauldronAIRecipeGeneration, // April 2, 2025
  resourceSystemImplementation, // March 15, 2025
  proceduralWorldGeneration, // October 15, 2023
];

/**
 * Helper function to get a post by slug
 * @param {string} slug - The post slug to find
 * @returns {Object|null} - The post object or null if not found
 */
export const getPostBySlug = (slug) => {
  return blogPosts.find(post => post.slug === slug) || null;
};

/**
 * Helper function to get posts by tag
 * @param {string} tag - The tag to filter by
 * @returns {Array} - Array of posts with the given tag
 */
export const getPostsByTag = (tag) => {
  return blogPosts.filter(post => post.tags.includes(tag));
};

/**
 * Helper function to get all unique tags
 * @returns {Array} - Array of unique tags
 */
export const getAllTags = () => {
  const tags = blogPosts.flatMap(post => post.tags);
  return [...new Set(tags)];
};

export default blogPosts; 