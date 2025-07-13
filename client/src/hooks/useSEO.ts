import { useEffect } from 'react';

interface SEOProps {
  title?: string;
  description?: string;
  ogImage?: string;
  twitterImage?: string;
  type?: 'website' | 'article';
}

export const useSEO = ({
  title,
  description,
  ogImage,
  twitterImage,
  type = 'website'
}: SEOProps) => {
  useEffect(() => {
    // Update document title
    if (title) {
      document.title = title;
    }

    // Helper function to update or create meta tags
    const updateMetaTag = (property: string, content: string) => {
      let meta = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement;
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('property', property);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

    const updateMetaName = (name: string, content: string) => {
      let meta = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement;
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', name);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

    // Update meta tags
    if (title) {
      updateMetaTag('og:title', title);
      updateMetaName('twitter:title', title);
    }

    if (description) {
      updateMetaName('description', description);
      updateMetaTag('og:description', description);
      updateMetaName('twitter:description', description);
    }

    if (ogImage) {
      updateMetaTag('og:image', ogImage);
    }

    if (twitterImage) {
      updateMetaName('twitter:image', twitterImage);
    }

    // Set type
    updateMetaTag('og:type', type);
    updateMetaName('twitter:card', 'summary_large_image');

    // Set current URL
    updateMetaTag('og:url', window.location.href);

    // Cleanup function to reset to defaults when component unmounts
    return () => {
      document.title = 'Broth & Bullets';
      updateMetaName('description', 'A top-down 2D multiplayer survival game');
      updateMetaTag('og:title', 'Broth & Bullets');
      updateMetaTag('og:description', 'A top-down 2D multiplayer survival game');
      updateMetaTag('og:type', 'website');
    };
  }, [title, description, ogImage, twitterImage, type]);
}; 