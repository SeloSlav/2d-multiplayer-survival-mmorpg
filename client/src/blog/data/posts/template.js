/**
 * BLOG POST TEMPLATE
 * 
 * Copy this file to create a new blog post, and then import it in blogPosts.js
 * Rename the file to match the slug of your blog post, e.g., "my-new-post.js"
 */

export default {
  // URL slug (use kebab-case, e.g., "my-new-post")
  slug: "your-post-slug",
  
  // Post title
  title: "Your Post Title",
  
  // Post subtitle/tagline
  subtitle: "A brief description of your post",
  
  // Publication date (YYYY-MM-DD format)
  date: "2024-01-01",
  
  // Author name
  author: "Martin Erlic",
  
  // Author image path (relative to public folder)
  authorImage: "/images/blog/author-marty.jpg",
  
  // Author's Twitter/X username (without @)
  authorTwitter: "seloslav",
  
  // Brief summary shown in the blog list
  excerpt: "A brief excerpt summarizing your post. Keep it under 200 characters for best results.",
  
  // Cover image path (relative to public folder)
  coverImage: "/images/blog/your-cover-image.jpg",
  
  // Post content in HTML format
  content: `
    <p>Start with an introduction paragraph that hooks the reader.</p>
    
    <h2>First Section Heading</h2>
    
    <p>Add content for your first section.</p>
    
    <ul>
      <li>You can use bullet points</li>
      <li>For listing items</li>
      <li>Or highlighting key features</li>
    </ul>
    
    <h2>Second Section Heading</h2>
    
    <p>Continue with additional sections.</p>
    
    <p>You can include <strong>bold text</strong>, <em>italic text</em>, and other HTML formatting.</p>
    
    <p>End with a conclusion paragraph or call to action.</p>
  `,
  
  // Tags for categorization (array of strings)
  tags: ["Tag1", "Tag2", "Tag3"]
}; 