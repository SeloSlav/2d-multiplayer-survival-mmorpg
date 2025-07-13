import React, { useState, useEffect } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { useSEO } from "../hooks/useSEO";
// @ts-ignore - TypeScript module resolution
import ImageGallery from "../common/ImageGallery";
// @ts-ignore - importing JavaScript module
import { getPostBySlug } from "./data/blogPosts";
// @ts-ignore - importing JavaScript module
import { getAuthor } from "./data/authors";
import BlogFooter from "./BlogFooter";
import BlogHeader from "../common/BlogHeader";
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

function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  
  // Gallery modal state
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [galleryImages, setGalleryImages] = useState<Array<{
    src: string;
    alt: string;
    caption?: string;
  }>>([]);
  
  // Find the post based on slug using helper function
  const post: BlogPost | null = getPostBySlug(slug);
  
  // If post doesn't exist, redirect to blog list
  if (!post) {
    return <Navigate to="/blog" />;
  }
  
    const { 
    title, 
    subtitle, 
    date, 
    author, 
    coverImage, 
    content,
    tags
  } = post;

  // Set SEO metadata for this blog post
  useSEO({
    title: `${title} | Broth & Bullets Blog`,
    description: subtitle,
    ogImage: coverImage,
    twitterImage: coverImage,
    type: 'article'
  });

  // Get author information from centralized data
  const authorInfo = getAuthor(author);
  const authorImage = authorInfo?.image || "/images/blog/default-author.jpg";
  const authorTwitter = authorInfo?.twitter;
  const authorBio = authorInfo?.bio;
  
  // Format the date
  const formattedDate = new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Extract images from content and cover image for gallery
  useEffect(() => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const imgElements = doc.querySelectorAll('img');
    
    const images = [];
    
    // Add cover image first
    images.push({
      src: coverImage,
      alt: title,
      caption: title
    });
    
    // Add content images
    imgElements.forEach((img) => {
      const src = img.getAttribute('src');
      const alt = img.getAttribute('alt') || '';
      const caption = img.getAttribute('data-caption') || alt;
      
      if (src) {
        images.push({
          src,
          alt,
          caption
        });
      }
    });
    
    setGalleryImages(images);
  }, [content, coverImage, title]);

  // Gallery handlers
  const openGallery = (imageIndex: number) => {
    setCurrentImageIndex(imageIndex);
    setIsGalleryOpen(true);
  };

  const closeGallery = () => {
    setIsGalleryOpen(false);
  };

  const navigateGallery = (index: number) => {
    setCurrentImageIndex(index);
  };

  // Make images in content clickable
  const processedContent = content.replace(
    /<img([^>]+)>/g,
    (match, attributes) => {
      const srcMatch = attributes.match(/src="([^"]+)"/);
      if (srcMatch) {
        const imgSrc = srcMatch[1];
        const imgIndex = galleryImages.findIndex(img => img.src === imgSrc);
        if (imgIndex !== -1) {
          return `<img${attributes} style="cursor: pointer;" onclick="window.openGalleryImage(${imgIndex})">`;
        }
      }
      return match;
    }
  );

  // Expose gallery opener to window for onclick handlers
  useEffect(() => {
    (window as any).openGalleryImage = openGallery;
    return () => {
      delete (window as any).openGalleryImage;
    };
  }, [galleryImages]);
  
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
        "url": "/images/blog/logo.png"
      }
    },
    "description": subtitle,
    "keywords": tags.join(", ")
  };

  return (
    <>
      <div className="blog-post-page">
        
        <script type="application/ld+json">
          {JSON.stringify(articleStructuredData)}
        </script>
        
        <BlogHeader />
        
        <div className="container" style={{ paddingTop: '100px' }}>
          
          <article className="blog-post">
            <header className="blog-post-header">
              <div className="blog-post-meta">
                <span className="blog-post-date">{formattedDate}</span>
                <div className="blog-post-tags">
                  {tags.map((tag, index) => (
                    <span key={index} className="blog-post-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              
              <h1 className="blog-post-title">{title}</h1>
              <h2 className="blog-post-subtitle">{subtitle}</h2>
              
              {/* Minimal author info at top */}
              <div className="blog-post-author-minimal">
                <span className="blog-post-author-byline">
                  By <strong>{author}</strong>
                  {authorTwitter && (
                    <>
                      {" "}(
                      <a 
                        href={`https://www.x.com/${authorTwitter}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="blog-post-author-twitter-link"
                      >
                        @{authorTwitter}
                      </a>
                      )
                    </>
                  )}
                </span>
              </div>
            </header>
            
            <div className="blog-post-cover" onClick={() => openGallery(0)} style={{ cursor: 'pointer' }}>
              <img src={coverImage} alt={title} />
            </div>
            
            <div 
              className="blog-post-article-content"
              dangerouslySetInnerHTML={{ __html: processedContent }}
            />
            
            {/* Full author card at bottom */}
            <footer className="blog-post-footer">
              <div className="blog-post-author-card">
                <img src={authorImage} alt={author} className="blog-post-author-card-image" />
                <div className="blog-post-author-card-content">
                  <div className="blog-post-author-card-header">
                    <h3 className="blog-post-author-card-name">{author}</h3>
                    {authorTwitter && (
                      <a 
                        href={`https://www.x.com/${authorTwitter}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="blog-post-author-card-twitter"
                      >
                        @{authorTwitter}
                      </a>
                    )}
                  </div>
                  {authorBio && (
                    <p className="blog-post-author-card-bio">{authorBio}</p>
                  )}
                </div>
              </div>
            </footer>
          </article>
        </div>
        
        <BlogFooter />
      </div>

      {/* Image Gallery Modal */}
      <ImageGallery
        images={galleryImages}
        currentIndex={currentImageIndex}
        isOpen={isGalleryOpen}
        onClose={closeGallery}
        onNavigate={navigateGallery}
      />
    </>
  );
}

export default BlogPostPage; 