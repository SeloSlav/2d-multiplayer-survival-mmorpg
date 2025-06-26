import React from "react";
import { Link } from "react-router-dom";
import SEOHead from "../../common/SEOHead";
import BlogPostPreview from "./BlogPostPreview";
import { blogPosts } from "./data/blogPosts";

function BlogPage() {
  return (
    <div className="blog-page-container">
      <SEOHead 
        title="Blog | Broth & Bullets - Development Updates & Guides"
        description="Stay updated with the latest news, development updates, and gameplay guides for Broth & Bullets - the 2D pixel art open-world survival game where babushkas battle for dominance in a procedurally generated tundra."
        ogImage="/images/og-blog.jpg"
        twitterImage="/images/twitter-blog.jpg"
      />
      
      <div className="container">
        <div className="blog-header">
          <h1 className="blog-title">Babushka Battlegrounds Blog</h1>
          <p className="blog-subtitle">Development updates, gameplay guides, and tundra survival tips</p>
        </div>
        
        <div className="blog-post-grid">
          {blogPosts.map((post) => (
            <BlogPostPreview key={post.slug} post={post} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default BlogPage; 