# Art Generation Prompts

This document contains the prompts used for generating game assets with AI tools like GPT-4o.

## Item Icons

For generating game item icons (weapons, tools, consumables, etc.):

```
A pixel art style SUBJECT (i.e., hammer) with consistent pixel width and clean black outlines, designed as a game item icon. Rendered with a transparent background, PNG format. The object should have a clear silhouette, sharp pixel-level detail, and fit naturally in a top-down RPG game like Secret of Mana. No background, no shadows outside the object. Stylized with a warm palette and light dithering where appropriate.
```

**Usage**: Replace "SUBJECT" with the specific item (e.g., "hammer", "health potion", "wooden sword")

## Environment Assets / Doodads

For generating environment objects, structures, and decorative elements:

```
Pixel art sprite in a 16-bit RPG style, 3/4 top-down view (slightly angled perspective), clean outlines, vibrant color palette, soft shading with no directional highlights (shading handled via in-game shaders), set on a transparent background. Focus on a blocky, detailed silhouette with depth visible in the form. Centered and properly grounded in the scene.

Subject: SUBJECT, i.e. Oak Tree
```

**Usage**: Replace "SUBJECT" with the specific environment object (e.g., "Oak Tree", "Stone Boulder", "Wooden Campfire", "Small Bush")

## Spritesheets

For generating character animations and complex sprite sequences, use **[retrodiffusion.ai](https://retrodiffusion.ai)** to generate spritesheets.

This specialized tool is designed specifically for creating pixel art spritesheets with consistent character designs across multiple frames, making it ideal for:
- Character walking animations
- Idle animations
- Object state variations
- Multi-directional sprites

The tool maintains consistency between frames and generates properly formatted spritesheets that can be directly imported into game engines.
