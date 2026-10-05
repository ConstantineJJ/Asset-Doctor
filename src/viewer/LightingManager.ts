import * as THREE from 'three';
import type { LightingConfig, LightingPreset } from '../types';

export class LightingManager {
  private scene: THREE.Scene;
  private lightsGroup: THREE.Group;
  private ambientLight: THREE.AmbientLight;
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private currentConfig: LightingConfig;

  // Interactive Light Bulb Gizmo
  private lightBulbGroup: THREE.Group;
  private bulbMesh: THREE.Mesh;
  private bulbSocketMesh: THREE.Mesh;
  private bulbGlowMesh: THREE.Mesh;
  private lightBeamLine: THREE.Line;
  private isBulbVisible: boolean = true;
  private isBulbHovered: boolean = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.lightsGroup = new THREE.Group();
    this.lightsGroup.name = '__ascope_internal_lights';

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    this.keyLight = new THREE.DirectionalLight(0xfffbf5, 1.3);
    this.fillLight = new THREE.DirectionalLight(0xdce5ef, 0.6);
    this.rimLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x3a3e47, 0.4);

    this.keyLight.position.set(5, 8, 5);
    this.fillLight.position.set(-5, 4, 3);
    this.rimLight.position.set(0, 6, -7);

    // Setup High Quality Shadows on Key Light
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 2048;
    this.keyLight.shadow.mapSize.height = 2048;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 40;
    this.keyLight.shadow.camera.left = -10;
    this.keyLight.shadow.camera.right = 10;
    this.keyLight.shadow.camera.top = 10;
    this.keyLight.shadow.camera.bottom = -10;
    this.keyLight.shadow.bias = -0.0003;
    this.keyLight.shadow.normalBias = 0.02;

    this.lightsGroup.add(
      this.ambientLight,
      this.keyLight,
      this.fillLight,
      this.rimLight,
      this.hemiLight
    );
    this.scene.add(this.lightsGroup);

    // Build Draggable Light Bulb Gizmo
    this.lightBulbGroup = new THREE.Group();
    this.lightBulbGroup.name = '__ascope_internal_light_bulb_gizmo';

    // Bulb glass
    const bulbGeom = new THREE.SphereGeometry(0.3, 24, 24);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff0aa,
      emissive: 0xfff0aa,
      emissiveIntensity: 1.2,
      roughness: 0.1,
      metalness: 0.0,
      depthTest: true,
    });
    this.bulbMesh = new THREE.Mesh(bulbGeom, bulbMat);
    this.bulbMesh.name = '__ascope_internal_light_bulb_target';

    // Metal socket/cap
    const socketGeom = new THREE.CylinderGeometry(0.12, 0.14, 0.2, 16);
    const socketMat = new THREE.MeshStandardMaterial({
      color: 0x4a505b,
      metalness: 0.8,
      roughness: 0.2,
    });
    this.bulbSocketMesh = new THREE.Mesh(socketGeom, socketMat);
    this.bulbSocketMesh.position.y = 0.32;

    // Glowing halo
    const glowGeom = new THREE.SphereGeometry(0.48, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffe888,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.bulbGlowMesh = new THREE.Mesh(glowGeom, glowMat);

    // Light ray beam line to origin
    const beamGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ]);
    const beamMat = new THREE.LineDashedMaterial({
      color: 0xffe57f,
      dashSize: 0.2,
      gapSize: 0.15,
      opacity: 0.45,
      transparent: true,
      depthWrite: false,
    });
    this.lightBeamLine = new THREE.Line(beamGeom, beamMat);
    this.lightBeamLine.computeLineDistances();

    this.lightBulbGroup.add(this.bulbMesh);
    this.lightBulbGroup.add(this.bulbSocketMesh);
    this.lightBulbGroup.add(this.bulbGlowMesh);
    this.scene.add(this.lightBeamLine);
    this.scene.add(this.lightBulbGroup);

    this.currentConfig = {
      preset: 'neutral-studio',
      exposure: 1.0,
      environmentIntensity: 0.5,
      keyIntensity: 1.3,
      fillIntensity: 0.6,
      rimIntensity: 0.8,
      keyColor: '#fffbf5',
      fillColor: '#dce5ef',
      rimColor: '#ffffff',
      keyPosition: [5, 8, 5],
      castShadows: true,
      showLightBulb: true,
    };

    this.updateBulbGizmoTransform();
  }

  public applyPreset(preset: LightingPreset) {
    this.currentConfig.preset = preset;

    switch (preset) {
      case 'neutral-studio':
        this.ambientLight.color.setHex(0xffffff);
        this.ambientLight.intensity = 0.45;
        this.keyLight.color.setHex(0xfffbf5);
        this.keyLight.intensity = 1.3;
        this.keyLight.position.set(5, 8, 5);
        this.fillLight.color.setHex(0xdce5ef);
        this.fillLight.intensity = 0.6;
        this.fillLight.position.set(-5, 4, 3);
        this.rimLight.color.setHex(0xffffff);
        this.rimLight.intensity = 0.8;
        this.rimLight.position.set(0, 6, -7);
        this.hemiLight.color.setHex(0xffffff);
        this.hemiLight.groundColor.setHex(0x3a3e47);
        this.hemiLight.intensity = 0.4;
        break;

      case 'soft-studio':
        this.ambientLight.color.setHex(0xffffff);
        this.ambientLight.intensity = 0.7;
        this.keyLight.color.setHex(0xffffff);
        this.keyLight.intensity = 0.8;
        this.keyLight.position.set(4, 6, 4);
        this.fillLight.color.setHex(0xf0f4f8);
        this.fillLight.intensity = 0.6;
        this.fillLight.position.set(-4, 4, 4);
        this.rimLight.color.setHex(0xffffff);
        this.rimLight.intensity = 0.4;
        this.rimLight.position.set(0, 5, -5);
        this.hemiLight.intensity = 0.6;
        break;

      case 'hard-studio':
        this.ambientLight.color.setHex(0xffffff);
        this.ambientLight.intensity = 0.2;
        this.keyLight.color.setHex(0xffffff);
        this.keyLight.intensity = 2.2;
        this.keyLight.position.set(7, 9, 4);
        this.fillLight.color.setHex(0x99aabf);
        this.fillLight.intensity = 0.3;
        this.fillLight.position.set(-6, 2, 2);
        this.rimLight.color.setHex(0xffeedd);
        this.rimLight.intensity = 1.4;
        this.rimLight.position.set(-2, 8, -6);
        this.hemiLight.intensity = 0.2;
        break;

      case 'outdoor':
        this.ambientLight.color.setHex(0xc9e4ff);
        this.ambientLight.intensity = 0.5;
        this.keyLight.color.setHex(0xfffaea);
        this.keyLight.intensity = 1.8;
        this.keyLight.position.set(8, 12, 6);
        this.fillLight.color.setHex(0x8cb6e0);
        this.fillLight.intensity = 0.8;
        this.fillLight.position.set(-6, 4, -4);
        this.rimLight.color.setHex(0xd0e8ff);
        this.rimLight.intensity = 0.7;
        this.rimLight.position.set(-3, 6, -8);
        this.hemiLight.color.setHex(0x6eb7ff);
        this.hemiLight.groundColor.setHex(0x4a4536);
        this.hemiLight.intensity = 0.7;
        break;

      case 'sunset':
        this.ambientLight.color.setHex(0x5c4266);
        this.ambientLight.intensity = 0.4;
        this.keyLight.color.setHex(0xff8c42);
        this.keyLight.intensity = 2.0;
        this.keyLight.position.set(10, 3, 4);
        this.fillLight.color.setHex(0x6e527d);
        this.fillLight.intensity = 0.5;
        this.fillLight.position.set(-6, 5, 2);
        this.rimLight.color.setHex(0xffd59e);
        this.rimLight.intensity = 1.6;
        this.rimLight.position.set(-5, 6, -7);
        this.hemiLight.color.setHex(0xff9966);
        this.hemiLight.groundColor.setHex(0x2d1f3b);
        this.hemiLight.intensity = 0.5;
        break;

      case 'top-light':
        this.ambientLight.color.setHex(0xffffff);
        this.ambientLight.intensity = 0.25;
        this.keyLight.color.setHex(0xffffff);
        this.keyLight.intensity = 2.4;
        this.keyLight.position.set(0, 14, 0);
        this.fillLight.color.setHex(0x8ca0b8);
        this.fillLight.intensity = 0.3;
        this.fillLight.position.set(-5, 2, 4);
        this.rimLight.color.setHex(0xffffff);
        this.rimLight.intensity = 0.4;
        this.rimLight.position.set(0, 2, -6);
        this.hemiLight.intensity = 0.2;
        break;

      case 'rim-light':
        this.ambientLight.color.setHex(0x222233);
        this.ambientLight.intensity = 0.15;
        this.keyLight.color.setHex(0x667788);
        this.keyLight.intensity = 0.4;
        this.keyLight.position.set(2, 3, 5);
        this.fillLight.color.setHex(0x334455);
        this.fillLight.intensity = 0.2;
        this.fillLight.position.set(-4, 2, 3);
        this.rimLight.color.setHex(0x00d2ff);
        this.rimLight.intensity = 2.5;
        this.rimLight.position.set(-4, 6, -7);
        this.hemiLight.intensity = 0.15;
        break;

      case 'dark-studio':
        this.ambientLight.color.setHex(0x111317);
        this.ambientLight.intensity = 0.1;
        this.keyLight.color.setHex(0xffffff);
        this.keyLight.intensity = 0.7;
        this.keyLight.position.set(4, 5, 4);
        this.fillLight.color.setHex(0x334455);
        this.fillLight.intensity = 0.2;
        this.fillLight.position.set(-4, 2, -3);
        this.rimLight.color.setHex(0x6688aa);
        this.rimLight.intensity = 0.5;
        this.rimLight.position.set(0, 5, -6);
        this.hemiLight.intensity = 0.1;
        break;
    }

    this.currentConfig.keyIntensity = this.keyLight.intensity;
    this.currentConfig.fillIntensity = this.fillLight.intensity;
    this.currentConfig.rimIntensity = this.rimLight.intensity;
    this.currentConfig.keyColor = '#' + this.keyLight.color.getHexString();
    this.currentConfig.fillColor = '#' + this.fillLight.color.getHexString();
    this.currentConfig.rimColor = '#' + this.rimLight.color.getHexString();
    this.currentConfig.keyPosition = [
      this.keyLight.position.x,
      this.keyLight.position.y,
      this.keyLight.position.z,
    ];

    this.updateBulbGizmoTransform();
  }

  public updateManualIntensities(config: Partial<LightingConfig>) {
    Object.assign(this.currentConfig, config);

    if (config.keyIntensity !== undefined) {
      this.keyLight.intensity = config.keyIntensity;
    }
    if (config.fillIntensity !== undefined) {
      this.fillLight.intensity = config.fillIntensity;
    }
    if (config.rimIntensity !== undefined) {
      this.rimLight.intensity = config.rimIntensity;
    }
    if (config.environmentIntensity !== undefined) {
      this.ambientLight.intensity = config.environmentIntensity * 0.8;
      this.hemiLight.intensity = config.environmentIntensity * 0.6;
    }
    if (config.keyColor) {
      this.keyLight.color.set(config.keyColor);
    }
    if (config.fillColor) {
      this.fillLight.color.set(config.fillColor);
    }
    if (config.rimColor) {
      this.rimLight.color.set(config.rimColor);
    }
    if (config.keyPosition) {
      this.keyLight.position.set(
        config.keyPosition[0],
        config.keyPosition[1],
        config.keyPosition[2]
      );
    }
    if (config.castShadows !== undefined) {
      this.keyLight.castShadow = config.castShadows;
    }
    if (config.showLightBulb !== undefined) {
      this.setLightBulbVisible(config.showLightBulb);
    }

    this.updateBulbGizmoTransform();
  }

  public setKeyLightPosition(x: number, y: number, z: number) {
    this.keyLight.position.set(x, y, z);
    this.currentConfig.keyPosition = [x, y, z];
    this.updateBulbGizmoTransform();
  }

  public getKeyLightPosition(): [number, number, number] {
    return [
      this.keyLight.position.x,
      this.keyLight.position.y,
      this.keyLight.position.z,
    ];
  }

  public updateBulbGizmoTransform() {
    this.lightBulbGroup.position.copy(this.keyLight.position);

    // Update bulb material color
    const bulbMat = this.bulbMesh.material as THREE.MeshStandardMaterial;
    bulbMat.color.copy(this.keyLight.color);
    bulbMat.emissive.copy(this.keyLight.color);
    bulbMat.emissiveIntensity = Math.min(2.5, Math.max(0.6, this.keyLight.intensity));

    const glowMat = this.bulbGlowMesh.material as THREE.MeshBasicMaterial;
    glowMat.color.copy(this.keyLight.color);

    // Update dashed connection beam from bulb to scene center
    const points = [
      this.keyLight.position.clone(),
      new THREE.Vector3(0, 0, 0),
    ];
    this.lightBeamLine.geometry.setFromPoints(points);
    this.lightBeamLine.computeLineDistances();
  }

  public setLightBulbVisible(visible: boolean) {
    this.isBulbVisible = visible;
    this.lightBulbGroup.visible = visible;
    this.lightBeamLine.visible = visible;
    this.currentConfig.showLightBulb = visible;
  }

  public getLightBulbVisible(): boolean {
    return this.isBulbVisible;
  }

  public setBulbHovered(hovered: boolean) {
    this.isBulbHovered = hovered;
    const bulbMat = this.bulbMesh.material as THREE.MeshStandardMaterial;
    bulbMat.emissiveIntensity = hovered
      ? Math.max(2.2, this.keyLight.intensity * 1.5)
      : Math.min(2.5, Math.max(0.6, this.keyLight.intensity));
    this.bulbGlowMesh.scale.setScalar(hovered ? 1.3 : 1.0);
  }

  public getBulbMesh(): THREE.Mesh {
    return this.bulbMesh;
  }

  public getKeyLight(): THREE.DirectionalLight {
    return this.keyLight;
  }

  public getConfig(): LightingConfig {
    return { ...this.currentConfig };
  }

  public dispose() {
    this.scene.remove(this.lightsGroup);
    this.lightsGroup.clear();
    this.scene.remove(this.lightBulbGroup);
    this.lightBulbGroup.clear();
    this.scene.remove(this.lightBeamLine);
    this.lightBeamLine.geometry.dispose();
  }
}
