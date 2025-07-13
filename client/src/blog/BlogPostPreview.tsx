import React from "react";
import { Link } from "react-router-dom";
// @ts-ignore - importing JavaScript module
import { getAuthor } from "./data/authors";

interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  date: string;
  author: string;
  excerpt: string;
  coverImage: string;
}

interface BlogPostPreviewProps {
  post: BlogPost;
}

function BlogPostPreview({ post }: BlogPostPreviewProps) {
  const { slug, title, subtitle, date, author, excerpt, coverImage } = post;

  // Get author information from centralized data
  const authorInfo = getAuthor(author);
  const authorImage = authorInfo?.image || "/images/blog/default-author.jpg";

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

          {/* Subtle author info under title */}
          <div className="blog-post-author-subtle">
            <img src={authorImage} alt={author} className="blog-post-author-subtle-image" />
            <span className="blog-post-author-subtle-name">{author}</span>
            <span className="blog-post-date-subtle">{formattedDate}</span>
          </div>

          <h3 className="blog-post-subtitle">{subtitle}</h3>

          <p className="blog-post-excerpt">{excerpt}</p>

          {/* Centered Read More button */}
          <div className="blog-post-actions">
            <Link to={`/blog/${slug}`} className="blog-post-read-more">
              Read Full Article
            </Link>
          </div>
        </div>

      </div>
    </article>
  );
}

export default BlogPostPreview; 