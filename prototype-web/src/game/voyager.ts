import * as THREE from 'three';

export interface VoyagerRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  coreHalo: THREE.Mesh;
  thrusterLeft: THREE.Mesh;
  thrusterRight: THREE.Mesh;
  contactShadow: THREE.Mesh;
  updatePose: (params: {
    dt: number;
    time: number;
    isLanded: boolean;
    walkDistance: number;
    speedNorm: number;
    isBoosting: boolean;
    isJumping: boolean;
    turnBank: number;
    landingSquash: number;
  }) => void;
  dispose: () => void;
}

/**
 * Build the 10-part composite procedural Astralis Cosmic Voyager (`THREE.Group`),
 * pivoted at bottom-center (feet at y = 0) so surface walking & landing sit flush on terrain.
 */
export function createVoyagerCharacter(): VoyagerRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = 1.02; // Pelvis height when standing
  bodyGroup.rotation.order = 'YXZ';
  root.add(bodyGroup);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Grounded NASA / Interstellar EVA aerospace material register (no plastic toy gloss)
  const matteCeramic = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xbac3cf,
      roughness: 0.74,
      metalness: 0.08,
    }),
  );

  const darkUnderSuit = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x11151f,
      roughness: 0.84,
      metalness: 0.14,
    }),
  );

  const brushedTitanium = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x5c6778,
      roughness: 0.28,
      metalness: 0.9,
      clearcoat: 0.35,
    }),
  );

  const visorGold = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xd6a54b,
      emissive: 0x3b2608,
      emissiveIntensity: 0.22,
      roughness: 0.06,
      metalness: 0.96,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
    }),
  );

  const plasmaEmissive = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x9ad8ff,
      transparent: true,
      opacity: 0.72,
    }),
  );

  const thrusterMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x76c8ff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  // 1. Sculpted Armored Torso (LatheGeometry silhouette)
  const torsoProfile = [
    new THREE.Vector2(0.01, -0.22),
    new THREE.Vector2(0.16, -0.18),
    new THREE.Vector2(0.19, 0.02),
    new THREE.Vector2(0.26, 0.28),
    new THREE.Vector2(0.22, 0.42),
    new THREE.Vector2(0.11, 0.46),
  ];
  const torsoGeo = trackGeo(new THREE.LatheGeometry(torsoProfile, 16));
  const torso = new THREE.Mesh(torsoGeo, matteCeramic);
  torso.scale.set(1.08, 1.0, 0.78);
  bodyGroup.add(torso);

  // 2. Chest Titanium Core Plate & Sternum Reactor
  const chestPlate = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.32, 0.26, 0.12)),
    brushedTitanium,
  );
  chestPlate.position.set(0, 0.2, 0.13);
  bodyGroup.add(chestPlate);

  const chestCore = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16)),
    plasmaEmissive,
  );
  chestCore.rotation.x = Math.PI / 2;
  chestCore.position.set(0, 0.22, 0.19);
  bodyGroup.add(chestCore);

  // 3. Helmet & Reflective Visor
  const helmetGroup = new THREE.Group();
  helmetGroup.position.set(0, 0.62, 0);
  bodyGroup.add(helmetGroup);

  const helmetShell = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.19, 18, 16)),
    matteCeramic,
  );
  helmetShell.scale.set(0.95, 1.05, 1.04);
  helmetGroup.add(helmetShell);

  const visor = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.175, 18, 14, -Math.PI * 0.38, Math.PI * 0.76, Math.PI * 0.25, Math.PI * 0.45)),
    visorGold,
  );
  visor.rotation.y = Math.PI / 2;
  visor.position.set(0, 0.01, 0.032);
  helmetGroup.add(visor);

  // 4. Shoulder Pauldrons (beveled metallic accents)
  const pauldronGeo = trackGeo(new THREE.SphereGeometry(0.13, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62));
  const leftPauldron = new THREE.Mesh(pauldronGeo, brushedTitanium);
  leftPauldron.position.set(-0.32, 0.36, 0);
  leftPauldron.rotation.z = 0.45;
  bodyGroup.add(leftPauldron);

  const rightPauldron = new THREE.Mesh(pauldronGeo, brushedTitanium);
  rightPauldron.position.set(0.32, 0.36, 0);
  rightPauldron.rotation.z = -0.45;
  bodyGroup.add(rightPauldron);

  // 5. Back Gravitic Pack + Plasma Halo Ring
  const pack = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.28, 0.36, 0.16)),
    darkUnderSuit,
  );
  pack.position.set(0, 0.22, -0.18);
  bodyGroup.add(pack);

  const coreHalo = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.165, 0.011, 10, 28)),
    plasmaEmissive,
  );
  coreHalo.position.set(0, 0.26, -0.27);
  bodyGroup.add(coreHalo);

  // 6. Beveled Extruded Gravitic Aero-Wings
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(0.68, 0.22);
  wingShape.lineTo(0.56, -0.05);
  wingShape.lineTo(0.08, -0.18);
  wingShape.closePath();

  const wingGeo = trackGeo(
    new THREE.ExtrudeGeometry(wingShape, {
      depth: 0.025,
      bevelEnabled: true,
      bevelSize: 0.01,
      bevelThickness: 0.01,
      bevelSegments: 2,
    }),
  );

  const leftWing = new THREE.Mesh(wingGeo, brushedTitanium);
  leftWing.position.set(-0.14, 0.32, -0.24);
  leftWing.scale.x = -1;
  leftWing.rotation.y = 0.26;
  bodyGroup.add(leftWing);

  const rightWing = new THREE.Mesh(wingGeo, brushedTitanium);
  rightWing.position.set(0.14, 0.32, -0.24);
  rightWing.rotation.y = -0.26;
  bodyGroup.add(rightWing);

  // 7-8. Articulated Arms (Upper + Forearm Gauntlets)
  const makeArm = (side: -1 | 1) => {
    const g = new THREE.Group();
    g.position.set(side * 0.31, 0.33, 0);
    const upper = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.068, 0.058, 0.34, 10)),
      darkUnderSuit,
    );
    upper.position.y = -0.17;
    g.add(upper);

    const gauntlet = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.062, 0.05, 0.32, 10)),
      matteCeramic,
    );
    gauntlet.position.y = -0.46;
    g.add(gauntlet);

    const cuffRing = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.056, 0.011, 8, 14)),
      plasmaEmissive,
    );
    cuffRing.rotation.x = Math.PI / 2;
    cuffRing.position.y = -0.58;
    g.add(cuffRing);
    return g;
  };

  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);
  bodyGroup.add(leftArm, rightArm);

  // 9-10. Articulated Legs + Thruster Boots
  const thrusterGeo = trackGeo(new THREE.ConeGeometry(0.065, 0.85, 10, 1, true));
  thrusterGeo.translate(0, -0.425, 0);

  const makeLeg = (side: -1 | 1) => {
    const g = new THREE.Group();
    g.position.set(side * 0.13, -0.16, 0);

    const thigh = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.09, 0.072, 0.44, 10)),
      darkUnderSuit,
    );
    thigh.position.y = -0.22;
    g.add(thigh);

    const greave = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.075, 0.062, 0.42, 10)),
      matteCeramic,
    );
    greave.position.y = -0.62;
    g.add(greave);

    const boot = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.14, 0.1, 0.24)),
      brushedTitanium,
    );
    boot.position.set(0, -0.82, 0.04);
    g.add(boot);

    const plume = new THREE.Mesh(thrusterGeo, thrusterMat);
    plume.position.set(0, -0.88, -0.02);
    g.add(plume);

    return { group: g, plume };
  };

  const lLeg = makeLeg(-1);
  const rLeg = makeLeg(1);
  const leftLeg = lLeg.group;
  const rightLeg = rLeg.group;
  const thrusterLeft = lLeg.plume;
  const thrusterRight = rLeg.plume;
  bodyGroup.add(leftLeg, rightLeg);

  // Soft radial contact shadow disc for crisp surface grounding
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 64;
  shadowCanvas.height = 64;
  const sCtx = shadowCanvas.getContext('2d')!;
  const sGrad = sCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
  sGrad.addColorStop(0, 'rgba(0,0,0,0.62)');
  sGrad.addColorStop(0.6, 'rgba(0,0,0,0.24)');
  sGrad.addColorStop(1, 'rgba(0,0,0,0)');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 64, 64);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);

  const contactShadow = new THREE.Mesh(
    trackGeo(new THREE.CircleGeometry(0.75, 20)),
    trackMat(
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      }),
    ),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.025;
  root.add(contactShadow);

  let currentPitch = 0;
  let currentBank = 0;
  let currentPlume = 0;

  const updatePose: VoyagerRig['updatePose'] = ({
    dt,
    time,
    isLanded,
    walkDistance,
    speedNorm,
    isBoosting,
    isJumping,
    turnBank,
    landingSquash,
  }) => {
    const damp = 1 - Math.exp(-8 * dt);

    // Subtle squash-and-stretch on landing / takeoff
    const sy = 1 - landingSquash * 0.22;
    const sxz = 1 + landingSquash * 0.14;
    bodyGroup.scale.set(sxz, sy, sxz);

    if (isLanded) {
      contactShadow.visible = true;
      currentPitch += (0 - currentPitch) * damp;
      currentBank += (0 - currentBank) * damp;
      bodyGroup.rotation.set(currentPitch, Math.PI, currentBank);
      bodyGroup.position.y = 1.02 + Math.abs(Math.sin(walkDistance * 2.4)) * 0.05;

      const stride = isJumping ? 0.32 : Math.sin(walkDistance * 2.4) * 0.58;
      leftLeg.rotation.x = stride;
      rightLeg.rotation.x = -stride;
      leftArm.rotation.x = -stride * 0.72;
      rightArm.rotation.x = stride * 0.72;
      leftArm.rotation.z = 0.14;
      rightArm.rotation.z = -0.14;

      // Fold gravitic wings neatly while walking
      leftWing.rotation.y += (0.58 - leftWing.rotation.y) * damp;
      rightWing.rotation.y += (-0.58 - rightWing.rotation.y) * damp;
      currentPlume += ((isJumping ? 0.45 : 0) - currentPlume) * damp;
    } else {
      contactShadow.visible = false;
      // Megaton Rainfall-style forward super-flight pitch (head tilts forward into flight vector)
      const targetPitch = Math.min(1.18, speedNorm * 1.12 + (isBoosting ? 0.22 : 0));
      currentPitch += (targetPitch - currentPitch) * damp;
      currentBank += (-turnBank * 0.48 - currentBank) * damp;

      bodyGroup.rotation.set(currentPitch, Math.PI, -currentBank);
      bodyGroup.position.y = 1.06 + Math.sin(time * 2.6) * 0.07;

      // Swept aerodynamic arms & trailing legs
      const sweep = Math.min(1, speedNorm * 1.3 + (isBoosting ? 0.4 : 0));
      leftArm.rotation.x = -0.25 - sweep * 0.42;
      rightArm.rotation.x = -0.25 - sweep * 0.42;
      leftArm.rotation.z = 0.22 + sweep * 0.22;
      rightArm.rotation.z = -(0.22 + sweep * 0.22);

      leftLeg.rotation.x = -0.12 + Math.sin(time * 3.1) * 0.05;
      rightLeg.rotation.x = -0.22 - Math.sin(time * 3.1) * 0.05;

      // Spread gravitic aero-wings wide during high-speed flight
      const targetWingY = 0.22 - sweep * 0.18;
      leftWing.rotation.y += (targetWingY - leftWing.rotation.y) * damp;
      rightWing.rotation.y += (-targetWingY - rightWing.rotation.y) * damp;

      const targetPlume = Math.min(0.85, 0.14 + speedNorm * 0.45 + (isBoosting ? 0.32 : 0));
      currentPlume += (targetPlume - currentPlume) * damp;
    }

    // Rotate plasma core halo & update thruster plumes
    coreHalo.rotation.z = time * (isBoosting ? 4.2 : 1.1);
    thrusterMat.opacity = currentPlume * 0.65;
    const plumeScaleY = 0.45 + currentPlume * (isBoosting ? 1.25 : 0.85);
    thrusterLeft.scale.set(1, plumeScaleY, 1);
    thrusterRight.scale.set(1, plumeScaleY, 1);
  };

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    shadowTex.dispose();
  };

  return {
    root,
    bodyGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    leftWing,
    rightWing,
    coreHalo,
    thrusterLeft,
    thrusterRight,
    contactShadow,
    updatePose,
    dispose,
  };
}
