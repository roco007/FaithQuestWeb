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

/** Builds a creator-selected photo cutout or GLB for the live AR camera. */
export function createARCharacterAsset(asset: CharacterAsset): Promise<ARCharacterInstance> {
  return asset.kind === 'model' ? createModelAsset(asset) : createImageAsset(asset);
}
