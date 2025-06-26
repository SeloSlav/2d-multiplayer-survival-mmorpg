import React from "react";
import { Link } from "react-router-dom";
import PropTypes from "prop-types";

function BlogPostPreview({ post }) {
  const { slug, title, subtitle, date, author, authorImage, excerpt, coverImage } = post;
  
  // Format the date
  const formattedDate = new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <article className="blog-post-preview">
      <Link to={`/blog/${slug}`} className="blog-post-link">
        <div className="blog-post-image-container">
          <img src={coverImage} alt={title} className="blog-post-cover-image" />
        </div>
      </Link>
      
      <div className="blog-post-content">
        <div className="blog-post-main-content">
          <Link to={`/blog/${slug}`} className="blog-post-title-link">
            <h2 className="blog-post-title">{title}</h2>
          </Link>
          
          <h3 className="blog-post-subtitle">{subtitle}</h3>
          
          <p className="blog-post-excerpt">{excerpt}</p>
        </div>
        
        <div className="blog-post-footer">
          <div className="blog-post-meta">
            <div className="blog-post-author">
              <img src={authorImage} alt={author} className="blog-post-author-image" />
              <div className="blog-post-author-details">
                <span className="blog-post-author-name">{author}</span>
                <span className="blog-post-date">{formattedDate}</span>
              </div>
            </div>
            
            <Link to={`/blog/${slug}`} className="blog-post-read-more">
              Read More
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

BlogPostPreview.propTypes = {
  post: PropTypes.shape({
    slug: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    subtitle: PropTypes.string.isRequired,
    date: PropTypes.string.isRequired,
    author: PropTypes.string.isRequired,
    authorImage: PropTypes.string.isRequired,
    excerpt: PropTypes.string.isRequired,
    coverImage: PropTypes.string.isRequired
  }).isRequired
};

export default BlogPostPreview; 