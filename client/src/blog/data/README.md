# Blog Content Management

This directory contains the blog posts and data for the Broth & Bullets blog section.

## Structure

- `blogPosts.js` - Main index file that imports and exports all blog posts
- `posts/` - Directory containing individual blog post files
  - Each file represents a single blog post
  - Files are named after their URL slug (e.g., `procedural-world-generation.js`)
- `posts/template.js` - Template to use when creating new blog posts

## Adding a New Blog Post

1. Copy `posts/template.js` to a new file in the `posts/` directory
2. Name the file using the URL slug of your post (e.g., `my-new-post.js`)
3. Fill in all the required fields in the new file
4. Import and add your post to the array in `blogPosts.js`

Example:

```javascript
// In blogPosts.js
import myNewPost from './posts/my-new-post';

// Add to the array (posts are sorted newest first)
export const blogPosts = [
  myNewPost,           // Your new post
  earlyAccessRoadmap,  // Existing posts
  // ...other posts
];
```

## Helper Functions

The `blogPosts.js` file exports several helper functions for working with blog posts:

- `getPostBySlug(slug)` - Get a specific post by its slug
- `getPostsByTag(tag)` - Get all posts with a specific tag
- `getAllTags()` - Get a list of all unique tags used across all posts

## Image Assets

Blog images should be placed in the following directories:

- `/public/images/blog/` - Blog post cover images
- `/public/images/blog/authors/` - Author profile images

## Content Guidelines

- Keep post titles under 70 characters for best SEO results
- Excerpts should be 150-200 characters
- Use HTML in the content field for formatting
- Include at least 2-4 tags per post for better categorization
- Use consistent author information across posts 