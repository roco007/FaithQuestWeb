# FaithQuest camera character roster

This folder is deployed with the web app. Creators select entries from
`manifest.json` when they add or edit a hunt character; players then see the
selected model or transparent photo through the hunt camera.

## Supported files

- **3D:** one self-contained `.glb` file. Use a `.gltf` source only if all
  buffers and textures are bundled into the resulting `.glb`.
- **Photo cutout:** one `.png`, `.webp`, `.jpg`, or `.jpeg` with transparency for
  PNG/WebP. JPEG is supported for ordinary rectangular images but cannot have a
  transparent background.

Keep models mobile-friendly (preferably under 8 MB, 5,000–30,000 triangles).
The app automatically centres every model horizontally, puts its lowest point
at the map pin, and scales it to the entry's `realHeightM`. It does not alter
GLB proportions.

## Add an asset

1. Put its file in this folder.
2. Add an entry to `manifest.json` with a unique, URL-safe `id`.
3. Use a path beginning with `/characters/`; arbitrary remote URLs are rejected.
4. Set `realHeightM` to the intended apparent height in metres and
   `aspectRatio` to visible width divided by visible height. These values tell
   the camera how to frame the character without covering the whole screen.
5. Choose the closest `fallbackType` (`guardian`, `angel`, `monk`, `flame`, or
   `oracle`) and an `accent` colour for its map marker and speech bubble.
6. Record attribution and licensing information. The included Zsky files were
   supplied with the project; confirm their source licence before public use.

Example:

```json
{
  "id": "maria-cutout",
  "name": "Maria",
  "description": "Transparent full-body photo cutout.",
  "kind": "image",
  "src": "/characters/maria.webp",
  "fallbackType": "monk",
  "accent": "#a78bfa",
  "realHeightM": 1.7,
  "aspectRatio": 0.45,
  "attribution": "Photo by Maria"
}
```

After changing this folder, restart/rebuild the Next.js deployment. A hunt only
stores the manifest `id`; its share payload never embeds the image or model.
