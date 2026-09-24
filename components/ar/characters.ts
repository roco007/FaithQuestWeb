import * as THREE from 'three';
import { HuntCharacterType } from '../../types/hunt';
import { ARCharacterSizing } from '../../utils/arPlacement';

/**
 * Procedurally-built animated 3D characters for the AR treasure hunt.
 *
 * Models are composed from three.js primitives (no binary GLB assets needed),
 * each anchored with the group origin at the character's base so the geolocation
 * point maps to where the creator placed their feet — or their hover base for
 * floating types. Swap any builder for a GLTF-loaded model later if desired.
 */
export interface ARCharacterInstance {
  /** Origin = base of the character (ground/altitude anchor point). */
  group: THREE.Group;
  /** Model height in scene units (for scale maths). */
  naturalHeight: number;
  /** Real-world height in meters (for perspective-correct sizing). */
  realHeightM: number;
  /** Called every render frame with elapsed seconds. */
  update: (elapsed: number) => void;
  dispose: () => void;
}

interface BuildContext {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

/**
 * Single source of truth for each archetype's model height in scene units and
 * the real-world height it stands for. The 3D builders report these and the AR
 * screen reads them to frame the model without instantiating any geometry.
 */
export const CHARACTER_SIZING: Record<HuntCharacterType, ARCharacterSizing> = {
  guardian: { naturalHeight: 2.0, realHeightM: 1.9 },
  angel: { naturalHeight: 2.1, realHeightM: 1.75 },
  monk: { naturalHeight: 1.95, realHeightM: 1.7 },
  flame: { naturalHeight: 1.1, realHeightM: 1.0 },
  oracle: { naturalHeight: 1.7, realHeightM: 1.4 },
};

/** Model metrics for a character type, safe for unknown values. */
export function getHuntCharacterSizing(type: HuntCharacterType): ARCharacterSizing {
  return CHARACTER_SIZING[type] ?? CHARACTER_SIZING.guardian;
}

function track(ctx: BuildContext) {
  return {
    box: (w: number, h: number, d: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      ctx.geometries.push(g);
      return g;
    },
    sphere: (r: number, ws = 16, hs = 12) => {
      const g = new THREE.SphereGeometry(r, ws, hs);
      ctx.geometries.push(g);
      return g;
    },
    cone: (r: number, h: number, seg = 16) => {
      const g = new THREE.ConeGeometry(r, h, seg);
      ctx.geometries.push(g);
      return g;
    },
    cyl: (rt: number, rb: number, h: number, seg = 16) => {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg);
      ctx.geometries.push(g);
      return g;
    },
    torus: (r: number, tube: number) => {
      const g = new THREE.TorusGeometry(r, tube, 10, 28);
      ctx.geometries.push(g);
      return g;
    },
    octa: (r: number) => {
      const g = new THREE.OctahedronGeometry(r, 0);
      ctx.geometries.push(g);
      return g;
    },
    mat: (params: THREE.MeshPhongMaterialParameters) => {
      const m = new THREE.MeshPhongMaterial(params);
      ctx.materials.push(m);
      return m;
    },
    mesh: (geometry: THREE.BufferGeometry, material: THREE.Material) =>
      new THREE.Mesh(geometry, material),
  };
}

function disposeInstance(ctx: BuildContext, group: THREE.Group): void {
  group.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
    }
  });
  ctx.geometries.forEach(g => g.dispose());
  ctx.materials.forEach(m => m.dispose());
}

// ---------------------------------------------------------------------------
// Guardian — an armored holy knight with a glowing sword
// ---------------------------------------------------------------------------
function buildGuardian(): ARCharacterInstance {
  const ctx: BuildContext = { geometries: [], materials: [] };
  const t = track(ctx);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const steel = t.mat({ color: 0xc7d2e0, shininess: 90, specular: 0x94a3b8 });
  const gold = t.mat({
    color: 0xf59e0b,
    emissive: 0xb45309,
    emissiveIntensity: 0.55,
    shininess: 100,
  });
  const dark = t.mat({ color: 0x1e293b, shininess: 40 });

  // Legs
  const legGeo = t.box(0.2, 0.8, 0.22);
  const legL = t.mesh(legGeo, steel);
  legL.position.set(-0.16, 0.4, 0);
  const legR = t.mesh(legGeo, steel);
  legR.position.set(0.16, 0.4, 0);
  body.add(legL, legR);

  // Torso + belt
  const torso = t.mesh(t.box(0.6, 0.68, 0.3), steel);
  torso.position.y = 1.15;
  const belt = t.mesh(t.box(0.62, 0.1, 0.32), gold);
  belt.position.y = 0.85;
  body.add(torso, belt);

  // Shoulder pads
  const shoulderGeo = t.sphere(0.15);
  const shoulderL = t.mesh(shoulderGeo, steel);
  shoulderL.position.set(-0.36, 1.5, 0);
  const shoulderR = t.mesh(shoulderGeo, steel);
  shoulderR.position.set(0.36, 1.5, 0);
  body.add(shoulderL, shoulderR);

  // Arms
  const armGeo = t.box(0.14, 0.55, 0.16);
  const armL = t.mesh(armGeo, steel);
  armL.position.set(-0.38, 1.15, 0.02);
  const armR = t.mesh(armGeo, steel);
  armR.position.set(0.38, 1.15, 0.02);
  body.add(armL, armR);

  // Head + helmet crest + glowing visor
  const head = t.mesh(t.sphere(0.19), steel);
  head.position.y = 1.68;
  const crest = t.mesh(t.cone(0.07, 0.24, 8), gold);
  crest.position.y = 1.92;
  const visor = t.mesh(t.box(0.22, 0.06, 0.06), gold);
  visor.position.set(0, 1.68, 0.17);
  body.add(head, crest, visor);

  // Sword (right hand)
  const sword = new THREE.Group();
  const blade = t.mesh(t.box(0.07, 0.95, 0.03), t.mat({
    color: 0xe2e8f0,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.35,
    shininess: 120,
  }));
  blade.position.y = 0.55;
  const guard = t.mesh(t.box(0.24, 0.06, 0.06), gold);
  guard.position.y = 0.05;
  const grip = t.mesh(t.cyl(0.035, 0.035, 0.18, 8), dark);
  grip.position.y = -0.06;
  sword.add(blade, guard, grip);
  sword.position.set(0.5, 0.95, 0.08);
  sword.rotation.z = -0.18;
  body.add(sword);

  const bladeMat = blade.material as THREE.MeshPhongMaterial;

  return {
    group,
    ...CHARACTER_SIZING.guardian,
    update: elapsed => {
      body.position.y = Math.sin(elapsed * 1.6) * 0.03;
      body.rotation.y = Math.sin(elapsed * 0.6) * 0.12;
      bladeMat.emissiveIntensity = 0.35 + Math.sin(elapsed * 3.2) * 0.25;
      gold.emissiveIntensity = 0.5 + Math.sin(elapsed * 2.4) * 0.2;
    },
    dispose: () => disposeInstance(ctx, group),
  };
}

// ---------------------------------------------------------------------------
// Angel — robed figure with flapping wings and a spinning halo
// ---------------------------------------------------------------------------
function buildAngel(): ARCharacterInstance {
  const ctx: BuildContext = { geometries: [], materials: [] };
  const t = track(ctx);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const robe = t.mat({ color: 0xf8fafc, emissive: 0xcbd5e1, emissiveIntensity: 0.25, shininess: 70 });
  const gold = t.mat({ color: 0xfbbf24, emissive: 0xd97706, emissiveIntensity: 0.7, shininess: 100 });
  const skin = t.mat({ color: 0xfde68a, shininess: 50 });

  // Robe (cone) + shoulders
  const robeMesh = t.mesh(t.cone(0.42, 1.3, 20), robe);
  robeMesh.position.y = 0.65;
  const chest = t.mesh(t.sphere(0.24), robe);
  chest.position.y = 1.35;
  const head = t.mesh(t.sphere(0.17), skin);
  head.position.y = 1.62;
  body.add(robeMesh, chest, head);

  // Halo
  const halo = t.mesh(t.torus(0.22, 0.03), gold);
  halo.position.y = 1.95;
  halo.rotation.x = Math.PI / 2;
  body.add(halo);

  // Wings (flattened spheres), pivoted at the back
  const wingGeo = t.sphere(0.5, 12, 8);
  const wingMat = t.mat({
    color: 0xeff6ff,
    emissive: 0x93c5fd,
    emissiveIntensity: 0.35,
    shininess: 80,
    side: THREE.DoubleSide,
  });
  const wingLPivot = new THREE.Group();
  wingLPivot.position.set(-0.18, 1.35, -0.14);
  const wingL = t.mesh(wingGeo, wingMat);
  wingL.scale.set(0.75, 1.05, 0.14);
  wingL.position.set(-0.3, 0.18, 0);
  wingLPivot.add(wingL);

  const wingRPivot = new THREE.Group();
  wingRPivot.position.set(0.18, 1.35, -0.14);
  const wingR = t.mesh(wingGeo, wingMat);
  wingR.scale.set(0.75, 1.05, 0.14);
  wingR.position.set(0.3, 0.18, 0);
  wingRPivot.add(wingR);
  body.add(wingLPivot, wingRPivot);

  return {
    group,
    ...CHARACTER_SIZING.angel,
    update: elapsed => {
      // Graceful hover + gentle sway
      body.position.y = 0.12 + Math.sin(elapsed * 1.4) * 0.07;
      body.rotation.y = Math.sin(elapsed * 0.5) * 0.18;
      const flap = Math.sin(elapsed * 2.4) * 0.35;
      wingLPivot.rotation.y = 0.4 + flap;
      wingRPivot.rotation.y = -0.4 - flap;
      halo.rotation.z = elapsed * 1.4;
      gold.emissiveIntensity = 0.55 + Math.sin(elapsed * 2.8) * 0.3;
    },
    dispose: () => disposeInstance(ctx, group),
  };
}

// ---------------------------------------------------------------------------
// Monk — hooded pilgrim guide with a glowing staff orb
// ---------------------------------------------------------------------------
function buildMonk(): ARCharacterInstance {
  const ctx: BuildContext = { geometries: [], materials: [] };
  const t = track(ctx);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const robe = t.mat({ color: 0x78350f, shininess: 30 });
  const robeTrim = t.mat({ color: 0xd97706, emissive: 0x92400e, emissiveIntensity: 0.3, shininess: 60 });
  const hoodDark = t.mat({ color: 0x1c1917, shininess: 20 });
  const orbMat = t.mat({
    color: 0x2dd4bf,
    emissive: 0x14b8a6,
    emissiveIntensity: 0.9,
    shininess: 120,
  });

  // Robe body + trim
  const robeMesh = t.mesh(t.cone(0.4, 1.45, 20), robe);
  robeMesh.position.y = 0.72;
  const trim = t.mesh(t.cyl(0.31, 0.34, 0.1, 20), robeTrim);
  trim.position.y = 0.75;
  body.add(robeMesh, trim);

  // Hood + shadowed face
  const hood = t.mesh(t.sphere(0.24), robe);
  hood.position.y = 1.5;
  const face = t.mesh(t.sphere(0.15), hoodDark);
  face.position.set(0, 1.46, 0.12);
  body.add(hood, face);

  // Glowing eyes
  const eyeGeo = t.sphere(0.03, 8, 6);
  const eyeL = t.mesh(eyeGeo, orbMat);
  eyeL.position.set(-0.06, 1.5, 0.24);
  const eyeR = t.mesh(eyeGeo, orbMat);
  eyeR.position.set(0.06, 1.5, 0.24);
  body.add(eyeL, eyeR);

  // Staff + orb
  const staff = t.mesh(t.cyl(0.03, 0.035, 1.8, 10), robeTrim);
  staff.position.set(0.42, 0.9, 0.05);
  const orb = t.mesh(t.sphere(0.11, 14, 10), orbMat);
  orb.position.set(0.42, 1.88, 0.05);
  body.add(staff, orb);

  return {
    group,
    ...CHARACTER_SIZING.monk,
    update: elapsed => {
      body.position.y = Math.sin(elapsed * 1.2) * 0.025;
      body.rotation.y = Math.sin(elapsed * 0.4) * 0.1;
      orb.scale.setScalar(1 + Math.sin(elapsed * 3.6) * 0.15);
      orbMat.emissiveIntensity = 0.7 + Math.sin(elapsed * 3.6) * 0.35;
    },
    dispose: () => disposeInstance(ctx, group),
  };
}

// ---------------------------------------------------------------------------
// Flame — hovering fire spirit with flickering tongues
// ---------------------------------------------------------------------------
function buildFlame(): ARCharacterInstance {
  const ctx: BuildContext = { geometries: [], materials: [] };
  const t = track(ctx);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const outer = t.mat({
    color: 0xf97316,
    emissive: 0xea580c,
    emissiveIntensity: 0.9,
    shininess: 30,
    transparent: true,
    opacity: 0.92,
  });
  const inner = t.mat({
    color: 0xfde047,
    emissive: 0xfacc15,
    emissiveIntensity: 1.0,
    shininess: 30,
  });
  const ember = t.mat({ color: 0x431407, shininess: 20 });

  // Ember base + layered flame tongues
  const base = t.mesh(t.sphere(0.22, 12, 8), ember);
  base.position.y = 0.1;
  base.scale.y = 0.5;
  const outerFlame = t.mesh(t.cone(0.34, 0.9, 14), outer);
  outerFlame.position.y = 0.62;
  const innerFlame = t.mesh(t.cone(0.2, 0.6, 12), inner);
  innerFlame.position.y = 0.5;
  const wispL = t.mesh(t.cone(0.12, 0.4, 8), outer);
  wispL.position.set(-0.2, 0.75, 0.05);
  wispL.rotation.z = 0.4;
  const wispR = t.mesh(t.cone(0.1, 0.35, 8), outer);
  wispR.position.set(0.2, 0.7, -0.05);
  wispR.rotation.z = -0.45;

  // Friendly glowing eyes
  const eyeGeo = t.sphere(0.045, 8, 6);
  const eyeMat = t.mat({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9 });
  const eyeL = t.mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.09, 0.55, 0.24);
  const eyeR = t.mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.09, 0.55, 0.24);

  body.add(base, outerFlame, innerFlame, wispL, wispR, eyeL, eyeR);

  return {
    group,
    ...CHARACTER_SIZING.flame,
    update: elapsed => {
      // Spirit always hovers slightly above its anchor
      body.position.y = 0.18 + Math.sin(elapsed * 2.1) * 0.08;
      const flicker = 1 + Math.sin(elapsed * 9.3) * 0.06 + Math.sin(elapsed * 15.7) * 0.03;
      outerFlame.scale.set(1 / flicker, flicker, 1 / flicker);
      innerFlame.scale.set(1 / flicker, flicker * 1.05, 1 / flicker);
      outerFlame.rotation.y = elapsed * 0.8;
      wispL.rotation.z = 0.4 + Math.sin(elapsed * 6.1) * 0.18;
      wispR.rotation.z = -0.45 + Math.cos(elapsed * 5.3) * 0.18;
      outer.emissiveIntensity = 0.8 + Math.sin(elapsed * 8.4) * 0.25;
      body.rotation.y = elapsed * 0.5;
    },
    dispose: () => disposeInstance(ctx, group),
  };
}

// ---------------------------------------------------------------------------
// Oracle — levitating crystal core encircled by energy rings
// ---------------------------------------------------------------------------
function buildOracle(): ARCharacterInstance {
  const ctx: BuildContext = { geometries: [], materials: [] };
  const t = track(ctx);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const coreMat = t.mat({
    color: 0x67e8f9,
    emissive: 0x06b6d4,
    emissiveIntensity: 1.0,
    shininess: 120,
    transparent: true,
    opacity: 0.95,
  });
  const ringMat = t.mat({
    color: 0xa78bfa,
    emissive: 0x7c3aed,
    emissiveIntensity: 0.7,
    shininess: 90,
  });
  const pedestalMat = t.mat({ color: 0x334155, shininess: 60 });

  // Floating crystal core
  const core = t.mesh(t.octa(0.34), coreMat);
  core.position.y = 1.0;
  const innerCore = t.mesh(
    t.octa(0.18),
    t.mat({
      color: 0xf0abfc,
      emissive: 0xd946ef,
      emissiveIntensity: 1.0,
      shininess: 120,
    })
  );
  innerCore.position.y = 1.0;

  // Energy rings
  const ringA = t.mesh(t.torus(0.52, 0.035), ringMat);
  ringA.position.y = 1.0;
  const ringB = t.mesh(t.torus(0.52, 0.035), ringMat);
  ringB.position.y = 1.0;
  ringB.rotation.x = Math.PI / 2;

  // Hover pedestal disc
  const pedestal = t.mesh(t.cyl(0.3, 0.38, 0.1, 18), pedestalMat);
  pedestal.position.y = 0.05;

  body.add(core, innerCore, ringA, ringB, pedestal);

  return {
    group,
    ...CHARACTER_SIZING.oracle,
    update: elapsed => {
      const hover = 0.12 + Math.sin(elapsed * 1.7) * 0.06;
      body.position.y = hover;
      core.position.y = 1.0 + Math.sin(elapsed * 2.2) * 0.05;
      innerCore.position.y = core.position.y;
      core.rotation.y = elapsed * 1.1;
      innerCore.rotation.y = -elapsed * 1.6;
      innerCore.rotation.x = elapsed * 0.9;
      ringA.rotation.x = elapsed * 0.9;
      ringA.rotation.y = elapsed * 0.6;
      ringB.rotation.y = -elapsed * 0.8;
      ringB.rotation.z = elapsed * 0.5;
      coreMat.emissiveIntensity = 0.85 + Math.sin(elapsed * 3.4) * 0.3;
      ringMat.emissiveIntensity = 0.55 + Math.sin(elapsed * 3.4 + 1.2) * 0.3;
    },
    dispose: () => disposeInstance(ctx, group),
  };
}

// ---------------------------------------------------------------------------
// Factory + UI metadata
// ---------------------------------------------------------------------------

export interface HuntCharacterMeta {
  type: HuntCharacterType;
  label: string;
  blurb: string;
  /** UI accent color matching the character's materials. */
  accent: string;
}

export const HUNT_CHARACTER_META: HuntCharacterMeta[] = [
  { type: 'guardian', label: 'Holy Guardian', blurb: 'Armored knight with a glowing sword', accent: '#38bdf8' },
  { type: 'angel', label: 'Angel', blurb: 'Winged messenger with a golden halo', accent: '#fbbf24' },
  { type: 'monk', label: 'Monk Guide', blurb: 'Hooded pilgrim carrying a glowing staff', accent: '#d97706' },
  { type: 'flame', label: 'Flame Spirit', blurb: 'Hovering fire wisp with friendly eyes', accent: '#f97316' },
  { type: 'oracle', label: 'Crystal Oracle', blurb: 'Levitating crystal ringed by energy', accent: '#a78bfa' },
];

export function getHuntCharacterMeta(type: HuntCharacterType): HuntCharacterMeta {
  return HUNT_CHARACTER_META.find(m => m.type === type) ?? HUNT_CHARACTER_META[0];
}

/** Builds the animated 3D model for a placed character. */
export function createARCharacter(type: HuntCharacterType): ARCharacterInstance {
  switch (type) {
    case 'angel':
      return buildAngel();
    case 'monk':
      return buildMonk();
    case 'flame':
      return buildFlame();
    case 'oracle':
      return buildOracle();
    case 'guardian':
    default:
      return buildGuardian();
  }
}



