// Centralized author information
export const authors = {
  "Martin Erlic": {
    name: "Martin Erlic",
    image: "/images/blog/author-marty.jpg",
    twitter: "seloslav",
    bio: "Lead developer and founder of Broth & Bullets. Former software engineer and olive oil farmer turned indie game developer who believes the singularity will look more like Ready Player One than The Matrix. Otherwise spending time on the Croatian coast."
  }
  // Add more authors here as needed
};

// Helper function to get author by name
export const getAuthor = (authorName) => {
  return authors[authorName] || null;
}; 