# FaithQuest camera character roster

This folder is deployed with the web app. Creators select entries from
`manifest.json` when they add or edit a hunt character; players then see the
selected model, transparent photo, or cutout video through the hunt camera.

## Supported files

- **3D:** one self-contained `.glb` file. Use a `.gltf` source only if all
  buffers and textures are bundled into the resulting `.glb`.
- **Photo cutout:** one `.png`, `.webp`, `.jpg`, or `.jpeg` with transparency for
  PNG/WebP. JPEG is supported for ordinary rectangular images but cannot have a
  transparent background.
- **Cutout video:** one VP9 `.webm` exported **with an alpha channel**
  (transparent background — e.g. `yuva420p`, not `yuv420p`; an alpha-less clip
  plays as an opaque rectangle over the camera feed). The clip is looped in the
  camera and its own audio track plays after the key is accepted, so a video
  character carries its own soundtrack and gets no spoken voiceover. iOS Safari
  cannot play VP9 alpha, so a video entry may name an HEVC-with-alpha
  `.mov`/`.mp4` twin in `fallbackSrc` for iPhones. Set `aspectRatio` to the
  full frame width divided by height (e.g. `0.5625` for 720×1280).

  Verify a new clip actually carries alpha before adding it — ffmpeg's *native*
  VP9 decoder silently drops the alpha plane, so decode with the libvpx decoder
  when checking:

  ```bash
  ffmpeg -v error -c:v libvpx-vp9 -i clip.webm -frames:v 1 -pix_fmt rgba -f rawvideo frame.rgba
  # every fourth byte is alpha: 0 in the background, 255 on the subject
  ```

  `~/Documents/scripts/make_ar.py` (MediaPipe selfie segmentation → VP9
  `yuva420p`) is the pipeline these clips were made with.

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
