import React, { useEffect } from 'react';

const SEOHead = ({ 
  title, 
  description, 
  ogImage, 
  twitterImage, 
  type = 'website',
  url = window.location.href
}) => {
  useEffect(() => {
    // Set document title
    document.title = title;
    
    // Set meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.name = 'description';
      document.head.appendChild(metaDesc);
    }
    metaDesc.content = description;

    // Clean up function to restore original title if needed
    return () => {
      // Could restore original title here if needed
    };
  }, [title, description]);

  return null; // This component doesn't render anything visible
};

export default SEOHead; 