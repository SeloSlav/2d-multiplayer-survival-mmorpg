import React from "react";
import { Link } from "react-router-dom";
import SEOHead from "../common/SEOHead";
import BlogPostPreview from "./BlogPostPreview";
import BlogFooter from "./BlogFooter";
import BlogHeader from "../common/BlogHeader";
// @ts-ignore - importing JavaScript module
import { blogPosts } from "./data/blogPosts";
// @ts-ignore - importing JavaScript module
import { getAuthor } from "./data/authors";
import "./blog.css";

interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  date: string;
  author: string;
  excerpt: string;
  coverImage: string;
  content: string;
  tags: string[];
}

function BlogPage() {
  return (
    <div className="blog-page-container">
      <SEOHead 
        title="Broth & Bullets Blog | Top-Down Survival Game Development"
        description="Development updates, gameplay guides, and survival strategies for Broth & Bullets - the ultimate 2D top-down multiplayer survival game. Explore crafting systems, base building, and PvP combat in a harsh procedurally generated world."
        ogImage="/images/blog/og-blog.jpg"
        twitterImage="/images/blog/twitter-blog.jpg"
      />
      
      <BlogHeader />
      
      <div className="container" style={{ paddingTop: '100px' }}>
        <div className="blog-header">
          <h1 className="blog-title">Broth & Bullets Blog</h1>
          <p className="blog-subtitle">Top-Down Survival Game Development Updates & Strategy Guides</p>
        </div>
        
        <div className="blog-post-grid">
          {(blogPosts as BlogPost[]).map((post: BlogPost) => (
            <BlogPostPreview key={post.slug} post={post} />
          ))}
        </div>
      </div>
      
      <BlogFooter />
    </div>
  );
}

export default BlogPage; 