import React from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import SEOHead from "../../common/SEOHead";
import ImageGallery from "../../common/ImageGallery";
import { getPostBySlug } from "./data/blogPosts";

function BlogPostPage() {
  const { slug } = useParams();
  
  // Find the post based on slug using helper function
  const post = getPostBySlug(slug);
  
  // If post doesn't exist, redirect to blog list
  if (!post) {
    return <Navigate to="/blog" />;
  }
  
  const { 
    title, 
    subtitle, 
    date, 
    author, 
    authorImage, 
    authorTwitter,
    coverImage, 
    content,
    tags
  } = post;
  
  // Format the date
  const formattedDate = new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  // Structured data for SEO
  const articleStructuredData = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": title,
    "image": coverImage,
    "datePublished": date,
    "author": {
      "@type": "Person",
      "name": author,
      "image": authorImage,
      "url": authorTwitter ? `https://www.x.com/${authorTwitter}` : undefined
    },
    "publisher": {
      "@type": "Organization",
      "name": "Broth & Bullets",
      "logo": {
        "@type": "ImageObject",
        "url": "/images/logo.png"
      }
    },
    "description": subtitle,
    "keywords": tags.join(", ")
  };

  return (
    <div className="blog-post-page">
      <SEOHead 
        title={`${title} | Broth & Bullets Blog`}
        description={subtitle}
        ogImage={coverImage}
        twitterImage={coverImage}
        type="article"
      />
      
      {/* Inject structured data */}
      <script type="application/ld+json">
        {JSON.stringify(articleStructuredData)}
      </script>
      
      <div className="container">
        <div className="blog-post-header">
          <Link to="/blog" className="back-to-blog">← Back to Blog</Link>
          
          <h1 className="blog-post-title">{title}</h1>
          <h2 className="blog-post-subtitle">{subtitle}</h2>
          
          <div className="blog-post-meta">
            <div className="blog-post-author">
              <img src={authorImage} alt={author} className="blog-post-author-image" />
              <span className="blog-post-author-name">{author}</span>
            </div>
            <span className="blog-post-date">{formattedDate}</span>
          </div>
        </div>
        
        <div className="blog-post-cover">
          <img src={coverImage} alt={title} className="blog-post-cover-image" />
        </div>
        
        <ImageGallery>
          <div className="blog-post-content" dangerouslySetInnerHTML={{ __html: content }} />
        </ImageGallery>
        
        <div className="blog-post-tags">
          {tags.map(tag => (
            <span key={tag} className="blog-post-tag">{tag}</span>
          ))}
        </div>
        
        <div className="blog-post-author-bio">
          <img src={authorImage} alt={author} className="blog-post-author-bio-image" />
          <div className="blog-post-author-bio-content">
            <div className="blog-post-author-bio-header">
              <h3 className="blog-post-author-bio-name">{author}</h3>
              {authorTwitter && (
                <a 
                  href={`https://www.x.com/${authorTwitter}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="blog-post-author-social"
                >
                  @{authorTwitter}
                </a>
              )}
            </div>
            <p className="blog-post-author-bio-description">
              Lead developer and babushka-in-chief at Broth & Bullets. Combining a passion for pixel art survival games with a deep appreciation for Slavic folklore and cuisine.
            </p>
          </div>
        </div>
        
        <div className="blog-post-navigation">
          <Link to="/blog" className="blog-post-navigation-link">
            ← Back to All Posts
          </Link>
        </div>
      </div>
    </div>
  );
}

export default BlogPostPage; 