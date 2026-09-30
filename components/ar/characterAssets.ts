import * as THREE from 'three';
import {
  CharacterAsset,
  CHARACTER_ASSET_NATURAL_HEIGHT,
} from '../../services/characterAssets';
import { ARCharacterInstance } from './characters';

/** Disposes a loaded hierarchy, including textures embedded in a GLB/photo. */
function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

/**
 * Centres a model around X/Z, places its lowest point at the group origin, and
 * normalises its height to the framing contract. This makes exports from
 * Sketchfab/photogrammetry tools safe even when their pivot is at the waist or
 * the origin is in the middle of the mesh.
 */
function normalizeModel(model: THREE.Object3D): void {
  model.updateMatrixWorld(true);
  const initialBox = new THREE.Box3().setFromObject(model);
  const initialSize = initialBox.getSize(new THREE.Vector3());
  if (
    !Number.isFinite(initialSize.y) ||
    initialSize.y <= 0.0001 ||
    !Number.isFinite(initialSize.x) ||
    !Number.isFinite(initialSize.z)
  ) {
    throw new Error('The character model has invalid or empty bounds.');
  }
  model.scale.multiplyScalar(CHARACTER_ASSET_NATURAL_HEIGHT / initialSize.y);
  model.updateMatrixWorld(true);
  const normalizedBox = new THREE.Box3().setFromObject(model);
  const center = normalizedBox.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= normalizedBox.min.y;
  model.position.z -= center.z;
  model.updateMatrixWorld(true);
}

/** Loads one validated public GLB into the same interface as built-in models. */
async function createModelAsset(asset: CharacterAsset): Promise<ARCharacterInstance> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(asset.src);
  const group = new THREE.Group();
  group.add(gltf.scene);
  normalizeModel(gltf.scene);
  gltf.scene.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  const mixer = new THREE.AnimationMixer(gltf.scene);
  const firstClip = gltf.animations[0];
  if (firstClip) mixer.clipAction(firstClip).play();
  let previousElapsed = 0;
  return {
    group,
    naturalHeight: CHARACTER_ASSET_NATURAL_HEIGHT,
    realHeightM: asset.realHeightM,
    update: elapsed => {
      const delta = Math.max(elapsed - previousElapsed, 0);
      previousElapsed = elapsed;
      mixer.update(delta);
    },
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      disposeObject(group);
    },
  };
}

/** Creates a transparent photo as a camera-facing plane, bottom-anchored at y=0. */
async function createImageAsset(asset: CharacterAsset): Promise<ARCharacterInstance> {
  const texture = await new THREE.TextureLoader().loadAsync(asset.src);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(asset.aspectRatio, CHARACTER_ASSET_NATURAL_HEIGHT);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.02,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.position.y = CHARACTER_ASSET_NATURAL_HEIGHT / 2;
  group.add(plane);
  return {
    group,
    naturalHeight: CHARACTER_ASSET_NATURAL_HEIGHT,
    realHeightM: asset.realHeightM,
    update: () => {},
    dispose: () => disposeObject(group),
  };
}

/** MIME hint used to pick the video source the browser can actually play. */
function videoMime(path: string): string {
  const extension = path.toLowerCase().split('.').pop() ?? '';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'mp4') return 'video/mp4';
  return 'video/webm';
}

/**
 * Picks the first video source the browser reports it can play — typically the
 * VP9 `.webm` everywhere except iOS Safari, which falls through to the HEVC
 * `.mov`/`.mp4` twin named in `fallbackSrc`.
 */
function pickVideoSource(asset: CharacterAsset, video: HTMLVideoElement): string {
  if (asset.fallbackSrc) {
    const candidates = [asset.src, asset.fallbackSrc];
    for (const candidate of candidates) {
      try {
        if (video.canPlayType(videoMime(candidate)) !== '') return candidate;
      } catch {
        /* ignore and keep scanning */
      }
    }
  }
  return asset.src;
}

/**
 * Plays a transparent cutout video (VP9 WebM with alpha, optionally with an
 * HEVC `.mov` twin for iOS Safari) as a camera-facing plane, bottom-anchored
 * at y=0 — the animated sibling of `createImageAsset`.
 *
 * The clip starts paused on its first frame and stays there until the AR
 * layer calls `play()` — the camera holds the frozen frame while hunting and
 * during key entry, then plays once with the reveal and holds its final frame
 * (nothing loops; only the Replay button rewinds it). It plays with the sound
 * baked into the clip — the hunt itself has no voiceover, so the clip's own
 * audio is all the sound a video character makes. If the browser
 * blocks playback with audio, the attempt falls back to silent so the
 * animation still rolls; the next play/restart retries with audio.
 */
async function createVideoAsset(asset: CharacterAsset): Promise<ARCharacterInstance> {
  const video = document.createElement('video');
  video.muted = false;
  video.defaultMuted = false;
  // Plays once per cue; Replay (or a fresh reveal) rewinds it via restart().
  video.loop = false;
  video.autoplay = false;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = pickVideoSource(asset, video);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onError);
    };
    const onCanPlay = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Could not load cutout video “${asset.src}”.`));
    };
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onError);
    video.load();
  });

  // Hold the first frame: the AR layer plays only once the key is accepted.
  video.pause();
  try {
    video.currentTime = 0;
  } catch {
    /* seeking before first frame is advisory only */
  }

  const playVideo = () => {
    try {
      if (video.ended) video.currentTime = 0;
    } catch {
      /* ignore seek failures */
    }
    // Always try with audio first: the reveal follows the key tap, which is
    // the user gesture browsers require before sound may play.
    video.muted = false;
    try {
      const result = video.play();
      if (result instanceof Promise) {
        result.catch(() => {
          // Autoplay-with-sound can still be blocked — roll silently rather
          // than hold a frozen frame; the next play/restart retries with audio.
          video.muted = true;
          try {
            const retry = video.play();
            if (retry instanceof Promise) retry.catch(() => {});
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      /* autoplay policies may delay playback until the next gesture */
    }
  };

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(asset.aspectRatio, CHARACTER_ASSET_NATURAL_HEIGHT);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.02,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.position.y = CHARACTER_ASSET_NATURAL_HEIGHT / 2;
  group.add(plane);
  return {
    group,
    naturalHeight: CHARACTER_ASSET_NATURAL_HEIGHT,
    realHeightM: asset.realHeightM,
    update: () => {},
    play: playVideo,
    pause: () => {
      video.pause();
    },
    restart: () => {
      try {
        video.currentTime = 0;
      } catch {
        /* ignore seek failures */
      }
      playVideo();
    },
    dispose: () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      disposeObject(group);
    },
  };
}

/** Builds a creator-selected cutout video, photo cutout, or GLB for the live AR camera. */
export function createARCharacterAsset(asset: CharacterAsset): Promise<ARCharacterInstance> {
  if (asset.kind === 'model') return createModelAsset(asset);
  if (asset.kind === 'video') return createVideoAsset(asset);
  return createImageAsset(asset);
}
