import * as THREE from 'three';
import type { SurfaceType } from '../types';

export class SurfaceManager {
  private scene: THREE.Scene;
  private currentSurface: SurfaceType = 'grid';
  private surfaceMesh: THREE.Mesh | null = null;
  private static cachedTextures: Map<string, THREE.CanvasTexture> = new Map();
  private groundHeight: number = 0;
  private groundRadius: number = 35;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public setGroundHeight(y: number) {
    this.groundHeight = y;
    if (this.surfaceMesh) {
      this.surfaceMesh.position.y = y - 0.005; // tiny offset to avoid z-fighting with grid
    }
  }

  public setSurface(type: SurfaceType) {
    this.currentSurface = type;

    // Remove existing surface mesh
    if (this.surfaceMesh) {
      this.scene.remove(this.surfaceMesh);
      if (this.surfaceMesh.geometry) this.surfaceMesh.geometry.dispose();
      if (Array.isArray(this.surfaceMesh.material)) {
        this.surfaceMesh.material.forEach((m) => m.dispose());
      } else if (this.surfaceMesh.material) {
        this.surfaceMesh.material.dispose();
      }
      this.surfaceMesh = null;
    }

    if (type === 'none' || type === 'grid') {
      return;
    }

    this.ensureSceneEnvironment();
    const { material } = this.createSurfaceMaterial(type);
    const geometry = new THREE.PlaneGeometry(70, 70, 64, 64);
    geometry.rotateX(-Math.PI / 2);

    this.surfaceMesh = new THREE.Mesh(geometry, material);
    this.surfaceMesh.name = '__ascope_internal_surface';
    this.surfaceMesh.receiveShadow = true;
    this.surfaceMesh.position.y = this.groundHeight - 0.005;
    this.scene.add(this.surfaceMesh);
  }

  public getSurface(): SurfaceType {
    return this.currentSurface;
  }

  private createSurfaceMaterial(type: SurfaceType): { material: THREE.Material } {
    switch (type) {
      case 'grass':
        return this.createGrassMaterial();
      case 'road':
        return this.createRoadMaterial();
      case 'sand':
        return this.createSandMaterial();
      case 'tile':
        return this.createTileMaterial();
      case 'wood':
        return this.createWoodMaterial();
      case 'cobblestone':
        return this.createCobblestoneMaterial();
      case 'countryside':
        return this.createCountrysideMaterial();
      case 'factory':
        return this.createFactoryMaterial();
      case 'moon':
        return this.createMoonMaterial();
      default:
        return { material: new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.8 }) };
    }
  }

  // 1. Grass / Lawn (Газон)
  private createGrassMaterial() {
    const diffuseKey = 'grass_diffuse';
    const bumpKey = 'grass_bump';

    let diffuseTex = SurfaceManager.cachedTextures.get(diffuseKey);
    let bumpTex = SurfaceManager.cachedTextures.get(bumpKey);

    if (!diffuseTex || !bumpTex) {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = size;
      bumpCanvas.height = size;
      const bumpCtx = bumpCanvas.getContext('2d')!;

      // Rich deep turf green base
      ctx.fillStyle = '#2d571f';
      ctx.fillRect(0, 0, size, size);

      bumpCtx.fillStyle = '#808080';
      bumpCtx.fillRect(0, 0, size, size);

      // Noise underlayer
      const imgData = ctx.getImageData(0, 0, size, size);
      const bumpData = bumpCtx.getImageData(0, 0, size, size);
      const data = imgData.data;
      const bData = bumpData.data;

      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 28;
        data[i] = Math.min(255, Math.max(0, data[i] + noise * 0.7)); // R
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise * 1.3)); // G
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise * 0.5)); // B
        const b = 128 + (Math.random() - 0.5) * 50;
        bData[i] = b;
        bData[i + 1] = b;
        bData[i + 2] = b;
      }
      ctx.putImageData(imgData, 0, 0);
      bumpCtx.putImageData(bumpData, 0, 0);

      // Paint dense blades of grass with varied hues
      const bladeColors = [
        '#3b7324', '#488b2c', '#579e32', '#68b33a', '#2c531a', '#79c742', '#355f20'
      ];

      for (let i = 0; i < 7000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const len = 4 + Math.random() * 8;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
        const col = bladeColors[Math.floor(Math.random() * bladeColors.length)];

        ctx.strokeStyle = col;
        ctx.lineWidth = 1 + Math.random() * 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
        ctx.stroke();

        bumpCtx.strokeStyle = Math.random() > 0.5 ? '#ffffff' : '#333333';
        bumpCtx.lineWidth = 1;
        bumpCtx.beginPath();
        bumpCtx.moveTo(x, y);
        bumpCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
        bumpCtx.stroke();
      }

      diffuseTex = new THREE.CanvasTexture(canvas);
      diffuseTex.wrapS = THREE.RepeatWrapping;
      diffuseTex.wrapT = THREE.RepeatWrapping;
      diffuseTex.repeat.set(16, 16);

      bumpTex = new THREE.CanvasTexture(bumpCanvas);
      bumpTex.wrapS = THREE.RepeatWrapping;
      bumpTex.wrapT = THREE.RepeatWrapping;
      bumpTex.repeat.set(16, 16);

      SurfaceManager.cachedTextures.set(diffuseKey, diffuseTex);
      SurfaceManager.cachedTextures.set(bumpKey, bumpTex);
    }

    const material = new THREE.MeshStandardMaterial({
      map: diffuseTex,
      bumpMap: bumpTex,
      bumpScale: 0.05,
      roughness: 0.88,
      metalness: 0.04,
      shadowSide: THREE.DoubleSide,
    });

    return { material };
  }

  // 2. Road & Sidewalk (Дорога / тротуар)
  private createRoadMaterial() {
    const diffuseKey = 'road_diffuse';
    const bumpKey = 'road_bump';

    let diffuseTex = SurfaceManager.cachedTextures.get(diffuseKey);
    let bumpTex = SurfaceManager.cachedTextures.get(bumpKey);

    if (!diffuseTex || !bumpTex) {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = size;
      bumpCanvas.height = size;
      const bumpCtx = bumpCanvas.getContext('2d')!;

      // Left portion: Asphalt roadway (0..340px)
      // Right portion: Concrete curbed sidewalk with paving blocks (340..512px)
      const asphaltWidth = 350;

      // Asphalt
      ctx.fillStyle = '#26282b';
      ctx.fillRect(0, 0, asphaltWidth, size);

      bumpCtx.fillStyle = '#808080';
      bumpCtx.fillRect(0, 0, asphaltWidth, size);

      // Fine asphalt pebbles
      const imgData = ctx.getImageData(0, 0, asphaltWidth, size);
      const bumpData = bumpCtx.getImageData(0, 0, asphaltWidth, size);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 35;
        imgData.data[i] = Math.min(255, Math.max(0, imgData.data[i] + noise));
        imgData.data[i + 1] = Math.min(255, Math.max(0, imgData.data[i + 1] + noise));
        imgData.data[i + 2] = Math.min(255, Math.max(0, imgData.data[i + 2] + noise));

        const b = 128 + (Math.random() - 0.5) * 60;
        bumpData.data[i] = b;
        bumpData.data[i + 1] = b;
        bumpData.data[i + 2] = b;
      }
      ctx.putImageData(imgData, 0, 0);
      bumpCtx.putImageData(bumpData, 0, 0);

      // Road markings: crisp dashed line in center of asphalt
      ctx.fillStyle = '#e8eaed';
      ctx.fillRect(asphaltWidth / 2 - 4, 30, 8, 80);
      ctx.fillRect(asphaltWidth / 2 - 4, 180, 8, 80);
      ctx.fillRect(asphaltWidth / 2 - 4, 330, 8, 80);
      ctx.fillRect(asphaltWidth / 2 - 4, 480, 8, 80);

      // Curb stone border (asphaltWidth..asphaltWidth+18)
      ctx.fillStyle = '#7a7f88';
      ctx.fillRect(asphaltWidth, 0, 18, size);
      bumpCtx.fillStyle = '#d0d0d0';
      bumpCtx.fillRect(asphaltWidth, 0, 18, size);

      // Curb joints
      ctx.fillStyle = '#3a3c42';
      for (let y = 0; y < size; y += 40) {
        ctx.fillRect(asphaltWidth, y, 18, 2);
        bumpCtx.fillStyle = '#101010';
        bumpCtx.fillRect(asphaltWidth, y, 18, 2);
      }

      // Sidewalk paving blocks (asphaltWidth+18..size)
      const swStart = asphaltWidth + 18;
      const swWidth = size - swStart;
      ctx.fillStyle = '#9aa0a6';
      ctx.fillRect(swStart, 0, swWidth, size);
      bumpCtx.fillStyle = '#a0a0a0';
      bumpCtx.fillRect(swStart, 0, swWidth, size);

      // Paving tiles grid (40x30 tiles)
      const tileW = 38;
      const tileH = 26;
      ctx.strokeStyle = '#5f6368';
      ctx.lineWidth = 2;
      bumpCtx.strokeStyle = '#202020';
      bumpCtx.lineWidth = 2;

      for (let x = swStart; x < size; x += tileW) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();

        bumpCtx.beginPath();
        bumpCtx.moveTo(x, 0);
        bumpCtx.lineTo(x, size);
        bumpCtx.stroke();
      }

      for (let y = 0; y < size; y += tileH) {
        ctx.beginPath();
        ctx.moveTo(swStart, y);
        ctx.lineTo(size, y);
        ctx.stroke();

        bumpCtx.beginPath();
        bumpCtx.moveTo(swStart, y);
        bumpCtx.lineTo(size, y);
        bumpCtx.stroke();
      }

      diffuseTex = new THREE.CanvasTexture(canvas);
      diffuseTex.wrapS = THREE.RepeatWrapping;
      diffuseTex.wrapT = THREE.RepeatWrapping;
      diffuseTex.repeat.set(6, 6);

      bumpTex = new THREE.CanvasTexture(bumpCanvas);
      bumpTex.wrapS = THREE.RepeatWrapping;
      bumpTex.wrapT = THREE.RepeatWrapping;
      bumpTex.repeat.set(6, 6);

      SurfaceManager.cachedTextures.set(diffuseKey, diffuseTex);
      SurfaceManager.cachedTextures.set(bumpKey, bumpTex);
    }

    const material = new THREE.MeshStandardMaterial({
      map: diffuseTex,
      bumpMap: bumpTex,
      bumpScale: 0.04,
      roughness: 0.82,
      metalness: 0.1,
      shadowSide: THREE.DoubleSide,
    });

    return { material };
  }

  // 3. Sand (Песок)
  private createSandMaterial() {
    const diffuseKey = 'sand_diffuse';
    const bumpKey = 'sand_bump';

    let diffuseTex = SurfaceManager.cachedTextures.get(diffuseKey);
    let bumpTex = SurfaceManager.cachedTextures.get(bumpKey);

    if (!diffuseTex || !bumpTex) {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = size;
      bumpCanvas.height = size;
      const bumpCtx = bumpCanvas.getContext('2d')!;

      // Warm golden dune sand base
      ctx.fillStyle = '#d8bb88';
      ctx.fillRect(0, 0, size, size);

      bumpCtx.fillStyle = '#808080';
      bumpCtx.fillRect(0, 0, size, size);

      // Procedural wind ripples
      for (let y = 0; y < size; y++) {
        // Dune ripple equation
        const wave = Math.sin((y / size) * Math.PI * 12 + Math.sin((y / 40)) * 1.5) * 16;
        const r = Math.min(255, Math.max(0, 216 + wave * 0.9));
        const g = Math.min(255, Math.max(0, 187 + wave * 0.8));
        const b = Math.min(255, Math.max(0, 136 + wave * 0.5));

        ctx.strokeStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();

        const bumpVal = Math.round(128 + wave * 3.5);
        bumpCtx.strokeStyle = `rgb(${bumpVal},${bumpVal},${bumpVal})`;
        bumpCtx.beginPath();
        bumpCtx.moveTo(0, y);
        bumpCtx.lineTo(size, y);
        bumpCtx.stroke();
      }

      // Fine sand grain speckles
      const imgData = ctx.getImageData(0, 0, size, size);
      const bumpData = bumpCtx.getImageData(0, 0, size, size);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 24;
        imgData.data[i] = Math.min(255, Math.max(0, imgData.data[i] + noise));
        imgData.data[i + 1] = Math.min(255, Math.max(0, imgData.data[i + 1] + noise * 0.8));
        imgData.data[i + 2] = Math.min(255, Math.max(0, imgData.data[i + 2] + noise * 0.6));

        const b = bumpData.data[i] + (Math.random() - 0.5) * 25;
        bumpData.data[i] = b;
        bumpData.data[i + 1] = b;
        bumpData.data[i + 2] = b;
      }
      ctx.putImageData(imgData, 0, 0);
      bumpCtx.putImageData(bumpData, 0, 0);

      diffuseTex = new THREE.CanvasTexture(canvas);
      diffuseTex.wrapS = THREE.RepeatWrapping;
      diffuseTex.wrapT = THREE.RepeatWrapping;
      diffuseTex.repeat.set(12, 12);

      bumpTex = new THREE.CanvasTexture(bumpCanvas);
      bumpTex.wrapS = THREE.RepeatWrapping;
      bumpTex.wrapT = THREE.RepeatWrapping;
      bumpTex.repeat.set(12, 12);

      SurfaceManager.cachedTextures.set(diffuseKey, diffuseTex);
      SurfaceManager.cachedTextures.set(bumpKey, bumpTex);
    }

    const material = new THREE.MeshStandardMaterial({
      map: diffuseTex,
      bumpMap: bumpTex,
      bumpScale: 0.06,
      roughness: 0.94,
      metalness: 0.02,
      shadowSide: THREE.DoubleSide,
    });

    return { material };
  }

  // 4. Porcelain Stoneware Tile (Керамогранитная плитка)
  private createTileMaterial() {
    const diffuseKey = 'tile_diffuse';
    const bumpKey = 'tile_bump';
    const roughKey = 'tile_roughness';

    let diffuseTex = SurfaceManager.cachedTextures.get(diffuseKey);
    let bumpTex = SurfaceManager.cachedTextures.get(bumpKey);
    let roughTex = SurfaceManager.cachedTextures.get(roughKey);

    if (!diffuseTex || !bumpTex || !roughTex) {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = size;
      bumpCanvas.height = size;
      const bumpCtx = bumpCanvas.getContext('2d')!;

      const roughCanvas = document.createElement('canvas');
      roughCanvas.width = size;
      roughCanvas.height = size;
      const roughCtx = roughCanvas.getContext('2d')!;

      // 4 large polished porcelain stoneware tiles (2x2 grid)
      const tileSize = size / 2;
      const grout = 6;

      ctx.fillStyle = '#262930'; // Grout color
      ctx.fillRect(0, 0, size, size);

      bumpCtx.fillStyle = '#080808'; // Grout is indented
      bumpCtx.fillRect(0, 0, size, size);

      roughCtx.fillStyle = '#f0f0f0'; // Grout is rough & matte
      roughCtx.fillRect(0, 0, size, size);

      for (let tx = 0; tx < 2; tx++) {
        for (let ty = 0; ty < 2; ty++) {
          const x0 = tx * tileSize + grout / 2;
          const y0 = ty * tileSize + grout / 2;
          const w = tileSize - grout;
          const h = tileSize - grout;

          // Porcelain stone surface with marble grain
          const grad = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
          grad.addColorStop(0, '#f0f3f6');
          grad.addColorStop(0.3, '#e2e6ea');
          grad.addColorStop(0.7, '#d8dde2');
          grad.addColorStop(1, '#eaf0f4');
          ctx.fillStyle = grad;
          ctx.fillRect(x0, y0, w, h);

          bumpCtx.fillStyle = '#dcdcdc';
          bumpCtx.fillRect(x0, y0, w, h);

          // Tile surface is mirror-smooth polished glaze (dark in roughnessMap = shiny!)
          roughCtx.fillStyle = '#1c1c1c';
          roughCtx.fillRect(x0, y0, w, h);

          // Subtle elegant marble veining
          ctx.strokeStyle = '#b8c0c8';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x0 + Math.random() * w * 0.3, y0);
          ctx.bezierCurveTo(
            x0 + w * 0.4 + (Math.random() - 0.5) * 20,
            y0 + h * 0.5,
            x0 + w * 0.6 + (Math.random() - 0.5) * 20,
            y0 + h * 0.7,
            x0 + w * (0.6 + Math.random() * 0.3),
            y0 + h
          );
          ctx.stroke();

          // Beveled tile edge highlight in bump
          bumpCtx.strokeStyle = '#ffffff';
          bumpCtx.lineWidth = 2.5;
          bumpCtx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);

          // Subtle perimeter micro-bevel roughness
          roughCtx.strokeStyle = '#484848';
          roughCtx.lineWidth = 2;
          roughCtx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
        }
      }

      diffuseTex = new THREE.CanvasTexture(canvas);
      diffuseTex.wrapS = THREE.RepeatWrapping;
      diffuseTex.wrapT = THREE.RepeatWrapping;
      diffuseTex.repeat.set(8, 8);

      bumpTex = new THREE.CanvasTexture(bumpCanvas);
      bumpTex.wrapS = THREE.RepeatWrapping;
      bumpTex.wrapT = THREE.RepeatWrapping;
      bumpTex.repeat.set(8, 8);

      roughTex = new THREE.CanvasTexture(roughCanvas);
      roughTex.wrapS = THREE.RepeatWrapping;
      roughTex.wrapT = THREE.RepeatWrapping;
      roughTex.repeat.set(8, 8);

      SurfaceManager.cachedTextures.set(diffuseKey, diffuseTex);
      SurfaceManager.cachedTextures.set(bumpKey, bumpTex);
      SurfaceManager.cachedTextures.set(roughKey, roughTex);
    }

    const material = new THREE.MeshPhysicalMaterial({
      map: diffuseTex,
      bumpMap: bumpTex,
      bumpScale: 0.025,
      roughness: 0.12,
      roughnessMap: roughTex,
      metalness: 0.06,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.4,
      shadowSide: THREE.DoubleSide,
    });

    return { material };
  }

  // 5. Wooden Floor / Parquet (Деревянный пол)
  private createWoodMaterial() {
    const diffuseKey = 'wood_diffuse';
    const bumpKey = 'wood_bump';

    let diffuseTex = SurfaceManager.cachedTextures.get(diffuseKey);
    let bumpTex = SurfaceManager.cachedTextures.get(bumpKey);

    if (!diffuseTex || !bumpTex) {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = size;
      bumpCanvas.height = size;
      const bumpCtx = bumpCanvas.getContext('2d')!;

      // 6 long wood parquet floorboards
      const plankCount = 6;
      const plankHeight = size / plankCount;

      ctx.fillStyle = '#1e140d'; // Dark seam between boards
      ctx.fillRect(0, 0, size, size);

      bumpCtx.fillStyle = '#101010';
      bumpCtx.fillRect(0, 0, size, size);

      const basePlankHues = [
        '#7f4f27', '#8e5b2f', '#744520', '#855328', '#6d3e1a', '#7c4c24'
      ];

      for (let p = 0; p < plankCount; p++) {
        const y = p * plankHeight;
        const h = plankHeight - 2; // 2px seam

        ctx.fillStyle = basePlankHues[p % basePlankHues.length];
        ctx.fillRect(0, y, size, h);

        bumpCtx.fillStyle = '#b0b0b0';
        bumpCtx.fillRect(0, y, size, h);

        // Wood grain rings
        const rings = 12;
        for (let r = 0; r < rings; r++) {
          const gy = y + (r / rings) * h;
          ctx.strokeStyle = Math.random() > 0.4 ? 'rgba(60, 32, 12, 0.3)' : 'rgba(160, 108, 60, 0.25)';
          ctx.lineWidth = 1 + Math.random() * 1.5;
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.bezierCurveTo(
            size * 0.33, gy + (Math.random() - 0.5) * 4,
            size * 0.66, gy + (Math.random() - 0.5) * 4,
            size, gy
          );
          ctx.stroke();

          bumpCtx.strokeStyle = Math.random() > 0.5 ? '#d0d0d0' : '#808080';
          bumpCtx.lineWidth = 1;
          bumpCtx.beginPath();
          bumpCtx.moveTo(0, gy);
          bumpCtx.lineTo(size, gy);
          bumpCtx.stroke();
        }
      }

      diffuseTex = new THREE.CanvasTexture(canvas);
      diffuseTex.wrapS = THREE.RepeatWrapping;
      diffuseTex.wrapT = THREE.RepeatWrapping;
      diffuseTex.repeat.set(6, 6);

      bumpTex = new THREE.CanvasTexture(bumpCanvas);
      bumpTex.wrapS = THREE.RepeatWrapping;
      bumpTex.wrapT = THREE.RepeatWrapping;
      bumpTex.repeat.set(6, 6);

      SurfaceManager.cachedTextures.set(diffuseKey, diffuseTex);
      SurfaceManager.cachedTextures.set(bumpKey, bumpTex);
    }

    const material = new THREE.MeshStandardMaterial({
      map: diffuseTex,
      bumpMap: bumpTex,
      bumpScale: 0.025,
      roughness: 0.28, // Satin finish wood parquet with clear reflections
      metalness: 0.05,
      shadowSide: THREE.DoubleSide,
    });

    return { material };
  }

  // 6. Cobblestone / Paving Stones (Брусчатка)
  private createCobblestoneMaterial() {
    const diffuseKey = 'cobblestone_diffuse';
    const bumpKey = 'cobblestone_bump';
    const roughKey = 'cobblestone_roughness';

    let diffuseTex = SurfaceManager.cachedTextures.get(diffuseKey);
    let bumpTex = SurfaceManager.cachedTextures.get(bumpKey);
    let roughTex = SurfaceManager.cachedTextures.get(roughKey);

    if (!diffuseTex || !bumpTex || !roughTex) {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = size;
      bumpCanvas.height = size;
      const bumpCtx = bumpCanvas.getContext('2d')!;

      const roughCanvas = document.createElement('canvas');
      roughCanvas.width = size;
      roughCanvas.height = size;
      const roughCtx = roughCanvas.getContext('2d')!;

      // Deep dark mortar base between paving stones
      ctx.fillStyle = '#1c1f24';
      ctx.fillRect(0, 0, size, size);

      bumpCtx.fillStyle = '#080808';
      bumpCtx.fillRect(0, 0, size, size);

      roughCtx.fillStyle = '#f0f0f0'; // Mortar is rough & matte
      roughCtx.fillRect(0, 0, size, size);

      const rows = 8;
      const cols = 8;
      const rowHeight = size / rows;
      const colWidth = size / cols;
      const grout = 3.5;

      const stoneColors = [
        '#686d79', '#7b808c', '#5e636f', '#747069', '#545963', '#837b74', '#606470'
      ];

      for (let r = 0; r < rows; r++) {
        const offset = (r % 2 === 1) ? colWidth * 0.5 : 0;
        const y = r * rowHeight + grout * 0.5;
        const h = rowHeight - grout;

        for (let c = -1; c <= cols; c++) {
          const x = c * colWidth + offset + grout * 0.5;
          const w = colWidth - grout;

          // Stone block with rounded corners
          const baseColor = stoneColors[Math.abs((r * 7 + c * 13)) % stoneColors.length];
          const grad = ctx.createRadialGradient(
            x + w * 0.45, y + h * 0.45, 1,
            x + w * 0.5, y + h * 0.5, Math.max(w, h) * 0.65
          );
          grad.addColorStop(0, '#9ca3af'); // Highlight on crown
          grad.addColorStop(0.3, baseColor);
          grad.addColorStop(1, '#2c3038'); // Shadow at edges
          ctx.fillStyle = grad;

          ctx.beginPath();
          ctx.roundRect(x, y, w, h, 4);
          ctx.fill();

          // Bump: dome shape for realistic light reflection on cobblestone crowns
          const bumpGrad = bumpCtx.createRadialGradient(
            x + w * 0.5, y + h * 0.5, 0,
            x + w * 0.5, y + h * 0.5, Math.max(w, h) * 0.6
          );
          bumpGrad.addColorStop(0, '#ffffff'); // Peak of dome
          bumpGrad.addColorStop(0.7, '#808080');
          bumpGrad.addColorStop(1, '#101010'); // Deep joint
          bumpCtx.fillStyle = bumpGrad;
          bumpCtx.beginPath();
          bumpCtx.roundRect(x, y, w, h, 4);
          bumpCtx.fill();

          // Wet polished stone crowns reflect light sharply (low roughness on crown)
          const roughGrad = roughCtx.createRadialGradient(
            x + w * 0.5, y + h * 0.5, 0,
            x + w * 0.5, y + h * 0.5, Math.max(w, h) * 0.6
          );
          roughGrad.addColorStop(0, '#303030'); // Shiny crown center
          roughGrad.addColorStop(0.7, '#707070');
          roughGrad.addColorStop(1, '#e0e0e0');
          roughCtx.fillStyle = roughGrad;
          roughCtx.beginPath();
          roughCtx.roundRect(x, y, w, h, 4);
          roughCtx.fill();
        }
      }

      diffuseTex = new THREE.CanvasTexture(canvas);
      diffuseTex.wrapS = THREE.RepeatWrapping;
      diffuseTex.wrapT = THREE.RepeatWrapping;
      diffuseTex.repeat.set(8, 8);

      bumpTex = new THREE.CanvasTexture(bumpCanvas);
      bumpTex.wrapS = THREE.RepeatWrapping;
      bumpTex.wrapT = THREE.RepeatWrapping;
      bumpTex.repeat.set(8, 8);

      roughTex = new THREE.CanvasTexture(roughCanvas);
      roughTex.wrapS = THREE.RepeatWrapping;
      roughTex.wrapT = THREE.RepeatWrapping;
      roughTex.repeat.set(8, 8);

      SurfaceManager.cachedTextures.set(diffuseKey, diffuseTex);
      SurfaceManager.cachedTextures.set(bumpKey, bumpTex);
      SurfaceManager.cachedTextures.set(roughKey, roughTex);
    }

    const material = new THREE.MeshPhysicalMaterial({
      map: diffuseTex,
      bumpMap: bumpTex,
      bumpScale: 0.045,
      roughness: 0.22,
      roughnessMap: roughTex,
      metalness: 0.12,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.3,
      shadowSide: THREE.DoubleSide,
    });

    return { material };
  }

  // 7. Countryside / Rural Terrain (Сельская местность)
  private createCountrysideMaterial() {
    const diffuseKey = 'countryside_diffuse';
    const bumpKey = 'countryside_bump';

    let diffuseTex = SurfaceManager.cachedTextures.get(diffuseKey);
    let bumpTex = SurfaceManager.cachedTextures.get(bumpKey);

    if (!diffuseTex || !bumpTex) {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = size;
      bumpCanvas.height = size;
      const bumpCtx = bumpCanvas.getContext('2d')!;

      // Rich rustic soil base
      ctx.fillStyle = '#4a3725';
      ctx.fillRect(0, 0, size, size);

      bumpCtx.fillStyle = '#808080';
      bumpCtx.fillRect(0, 0, size, size);

      // Dirt road ruts running through center
      const rutGrad = ctx.createLinearGradient(0, 0, size, 0);
      rutGrad.addColorStop(0, '#3a5423'); // Grass on sides
      rutGrad.addColorStop(0.18, '#4f3c2b'); // Dirt shoulder
      rutGrad.addColorStop(0.32, '#38271a'); // Dark compacted wheel rut
      rutGrad.addColorStop(0.50, '#53402e'); // Raised center mound
      rutGrad.addColorStop(0.68, '#38271a'); // Second wheel rut
      rutGrad.addColorStop(0.82, '#4f3c2b');
      rutGrad.addColorStop(1, '#3a5423');
      ctx.fillStyle = rutGrad;
      ctx.fillRect(0, 0, size, size);

      // Scattered pebbles and wild grass patches
      for (let i = 0; i < 400; i++) {
        const px = Math.random() * size;
        const py = Math.random() * size;
        const pr = 1 + Math.random() * 3;
        ctx.fillStyle = Math.random() > 0.4 ? '#8a8579' : '#635d54';
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();

        bumpCtx.fillStyle = '#ffffff';
        bumpCtx.beginPath();
        bumpCtx.arc(px, py, pr, 0, Math.PI * 2);
        bumpCtx.fill();
      }

      // Grass tufts along path borders
      const tuftColors = ['#466b2a', '#547f33', '#395720', '#63923b'];
      for (let i = 0; i < 1200; i++) {
        const gx = Math.random() < 0.5 ? Math.random() * size * 0.22 : size * 0.78 + Math.random() * size * 0.22;
        const gy = Math.random() * size;
        const gl = 3 + Math.random() * 6;
        ctx.strokeStyle = tuftColors[Math.floor(Math.random() * tuftColors.length)];
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + (Math.random() - 0.5) * 4, gy - gl);
        ctx.stroke();
      }

      diffuseTex = new THREE.CanvasTexture(canvas);
      diffuseTex.wrapS = THREE.RepeatWrapping;
      diffuseTex.wrapT = THREE.RepeatWrapping;
      diffuseTex.repeat.set(6, 6);

      bumpTex = new THREE.CanvasTexture(bumpCanvas);
      bumpTex.wrapS = THREE.RepeatWrapping;
      bumpTex.wrapT = THREE.RepeatWrapping;
      bumpTex.repeat.set(6, 6);

      SurfaceManager.cachedTextures.set(diffuseKey, diffuseTex);
      SurfaceManager.cachedTextures.set(bumpKey, bumpTex);
    }

    const material = new THREE.MeshStandardMaterial({
      map: diffuseTex,
      bumpMap: bumpTex,
      bumpScale: 0.05,
      roughness: 0.68,
      metalness: 0.05,
      shadowSide: THREE.DoubleSide,
    });

    return { material };
  }

  // 8. Factory / Industrial Floor (Завод)
  private createFactoryMaterial() {
    const diffuseKey = 'factory_diffuse';
    const bumpKey = 'factory_bump';

    let diffuseTex = SurfaceManager.cachedTextures.get(diffuseKey);
    let bumpTex = SurfaceManager.cachedTextures.get(bumpKey);

    if (!diffuseTex || !bumpTex) {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = size;
      bumpCanvas.height = size;
      const bumpCtx = bumpCanvas.getContext('2d')!;

      // Polished heavy-duty industrial concrete floor
      ctx.fillStyle = '#444952';
      ctx.fillRect(0, 0, size, size);

      bumpCtx.fillStyle = '#808080';
      bumpCtx.fillRect(0, 0, size, size);

      // Steel diamond plate panels in upper section
      const panelHeight = size * 0.42;
      const steelGrad = ctx.createLinearGradient(0, 0, size, panelHeight);
      steelGrad.addColorStop(0, '#59616e');
      steelGrad.addColorStop(0.5, '#717b8a');
      steelGrad.addColorStop(1, '#505763');
      ctx.fillStyle = steelGrad;
      ctx.fillRect(0, 0, size, panelHeight);

      // Raised diamond treads pattern on steel plate
      const treadStep = 18;
      for (let tx = 0; tx < size; tx += treadStep) {
        for (let ty = 0; ty < panelHeight; ty += treadStep) {
          const ox = (ty % (treadStep * 2) === 0) ? treadStep * 0.5 : 0;
          const x = tx + ox;
          const y = ty;

          // Diamond tread highlight
          ctx.strokeStyle = '#9ca6b5';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(x - 4, y);
          ctx.lineTo(x + 4, y);
          ctx.stroke();

          bumpCtx.strokeStyle = '#ffffff';
          bumpCtx.lineWidth = 2;
          bumpCtx.beginPath();
          bumpCtx.moveTo(x - 4, y);
          bumpCtx.lineTo(x + 4, y);
          bumpCtx.stroke();
        }
      }

      // Yellow & Black Industrial Hazard Warning Stripes
      const stripeY = panelHeight;
      const stripeHeight = size * 0.18;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, stripeY, size, stripeHeight);
      ctx.clip();

      ctx.fillStyle = '#eab308'; // Safety Yellow
      ctx.fillRect(0, stripeY, size, stripeHeight);

      ctx.fillStyle = '#181a20'; // Black Hazard Stripe
      const stripeW = 32;
      for (let sx = -size; sx < size * 2; sx += stripeW * 2) {
        ctx.beginPath();
        ctx.moveTo(sx, stripeY);
        ctx.lineTo(sx + stripeW, stripeY);
        ctx.lineTo(sx + stripeW + stripeHeight, stripeY + stripeHeight);
        ctx.lineTo(sx + stripeHeight, stripeY + stripeHeight);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Lower section: High-gloss epoxy concrete with expansion seams
      const epoxyY = stripeY + stripeHeight;
      const epoxyH = size - epoxyY;
      const epoxyGrad = ctx.createLinearGradient(0, epoxyY, size, size);
      epoxyGrad.addColorStop(0, '#383d45');
      epoxyGrad.addColorStop(0.5, '#4a515c');
      epoxyGrad.addColorStop(1, '#33373e');
      ctx.fillStyle = epoxyGrad;
      ctx.fillRect(0, epoxyY, size, epoxyH);

      // Expansion joints & metal corner bolts
      ctx.strokeStyle = '#1d2024';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(size * 0.5, epoxyY);
      ctx.lineTo(size * 0.5, size);
      ctx.moveTo(0, epoxyY);
      ctx.lineTo(size, epoxyY);
      ctx.stroke();

      bumpCtx.strokeStyle = '#101010';
      bumpCtx.lineWidth = 3;
      bumpCtx.beginPath();
      bumpCtx.moveTo(size * 0.5, epoxyY);
      bumpCtx.lineTo(size * 0.5, size);
      bumpCtx.moveTo(0, epoxyY);
      bumpCtx.lineTo(size, epoxyY);
      bumpCtx.stroke();

      // Corner rivets / bolts
      const boltPts = [
        [16, 16], [size - 16, 16], [size * 0.5, 16],
        [16, panelHeight - 12], [size - 16, panelHeight - 12]
      ];
      for (const [bx, by] of boltPts) {
        ctx.fillStyle = '#c0c8d4';
        ctx.beginPath();
        ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
        ctx.fill();

        bumpCtx.fillStyle = '#ffffff';
        bumpCtx.beginPath();
        bumpCtx.arc(bx, by, 3.5, 0, Math.PI * 2);
        bumpCtx.fill();
      }

      diffuseTex = new THREE.CanvasTexture(canvas);
      diffuseTex.wrapS = THREE.RepeatWrapping;
      diffuseTex.wrapT = THREE.RepeatWrapping;
      diffuseTex.repeat.set(5, 5);

      bumpTex = new THREE.CanvasTexture(bumpCanvas);
      bumpTex.wrapS = THREE.RepeatWrapping;
      bumpTex.wrapT = THREE.RepeatWrapping;
      bumpTex.repeat.set(5, 5);

      SurfaceManager.cachedTextures.set(diffuseKey, diffuseTex);
      SurfaceManager.cachedTextures.set(bumpKey, bumpTex);
    }

    const material = new THREE.MeshPhysicalMaterial({
      map: diffuseTex,
      bumpMap: bumpTex,
      bumpScale: 0.035,
      roughness: 0.18, // Polished factory epoxy and steel reflect light strongly
      metalness: 0.45, // High metallic response on steel tread plates
      clearcoat: 0.8,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.5,
      shadowSide: THREE.DoubleSide,
    });

    return { material };
  }

  // 9. Moon Surface / Lunar Regolith (Лунная поверхность)
  private createMoonMaterial() {
    const diffuseKey = 'moon_diffuse';
    const bumpKey = 'moon_bump';

    let diffuseTex = SurfaceManager.cachedTextures.get(diffuseKey);
    let bumpTex = SurfaceManager.cachedTextures.get(bumpKey);

    if (!diffuseTex || !bumpTex) {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = size;
      bumpCanvas.height = size;
      const bumpCtx = bumpCanvas.getContext('2d')!;

      // Dusty lunar regolith base
      ctx.fillStyle = '#5c5e63';
      ctx.fillRect(0, 0, size, size);

      bumpCtx.fillStyle = '#808080';
      bumpCtx.fillRect(0, 0, size, size);

      // Surface noise
      const imgData = ctx.getImageData(0, 0, size, size);
      const bumpData = bumpCtx.getImageData(0, 0, size, size);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 36;
        imgData.data[i] = Math.min(255, Math.max(0, imgData.data[i] + noise));
        imgData.data[i + 1] = Math.min(255, Math.max(0, imgData.data[i + 1] + noise));
        imgData.data[i + 2] = Math.min(255, Math.max(0, imgData.data[i + 2] + noise * 1.05));

        const b = bumpData.data[i] + noise * 1.2;
        bumpData.data[i] = b;
        bumpData.data[i + 1] = b;
        bumpData.data[i + 2] = b;
      }
      ctx.putImageData(imgData, 0, 0);
      bumpCtx.putImageData(bumpData, 0, 0);

      // Craters with raised rims and sunken shadows
      const craters = [
        { x: 120, y: 140, r: 52 },
        { x: 380, y: 340, r: 75 },
        { x: 360, y: 110, r: 35 },
        { x: 150, y: 390, r: 42 },
        { x: 250, y: 250, r: 24 },
        { x: 460, y: 230, r: 18 },
        { x: 60, y: 270, r: 16 },
        { x: 260, y: 70, r: 14 }
      ];

      for (const cr of craters) {
        // Shadowed sunken bowl
        const bowlGrad = ctx.createRadialGradient(
          cr.x - cr.r * 0.25, cr.y - cr.r * 0.25, cr.r * 0.1,
          cr.x, cr.y, cr.r
        );
        bowlGrad.addColorStop(0, '#2b2d31');
        bowlGrad.addColorStop(0.7, '#3c3e44');
        bowlGrad.addColorStop(0.9, '#7a7e87');
        bowlGrad.addColorStop(1, '#5c5e63');
        ctx.fillStyle = bowlGrad;
        ctx.beginPath();
        ctx.arc(cr.x, cr.y, cr.r, 0, Math.PI * 2);
        ctx.fill();

        // Bright illuminated rim highlight
        ctx.strokeStyle = '#9ca0a8';
        ctx.lineWidth = Math.max(2, cr.r * 0.12);
        ctx.beginPath();
        ctx.arc(cr.x, cr.y, cr.r * 0.95, -Math.PI * 0.75, Math.PI * 0.25);
        ctx.stroke();

        // Bump map: ring rim peak and sunken center
        const bGrad = bumpCtx.createRadialGradient(
          cr.x, cr.y, cr.r * 0.1,
          cr.x, cr.y, cr.r
        );
        bGrad.addColorStop(0, '#101010'); // Deep center
        bGrad.addColorStop(0.7, '#404040');
        bGrad.addColorStop(0.95, '#ffffff'); // Raised rim
        bGrad.addColorStop(1, '#808080'); // Surrounding terrain
        bumpCtx.fillStyle = bGrad;
        bumpCtx.beginPath();
        bumpCtx.arc(cr.x, cr.y, cr.r, 0, Math.PI * 2);
        bumpCtx.fill();
      }

      diffuseTex = new THREE.CanvasTexture(canvas);
      diffuseTex.wrapS = THREE.RepeatWrapping;
      diffuseTex.wrapT = THREE.RepeatWrapping;
      diffuseTex.repeat.set(4, 4);

      bumpTex = new THREE.CanvasTexture(bumpCanvas);
      bumpTex.wrapS = THREE.RepeatWrapping;
      bumpTex.wrapT = THREE.RepeatWrapping;
      bumpTex.repeat.set(4, 4);

      SurfaceManager.cachedTextures.set(diffuseKey, diffuseTex);
      SurfaceManager.cachedTextures.set(bumpKey, bumpTex);
    }

    const material = new THREE.MeshStandardMaterial({
      map: diffuseTex,
      bumpMap: bumpTex,
      bumpScale: 0.08,
      roughness: 0.58,
      metalness: 0.14,
      shadowSide: THREE.DoubleSide,
    });

    return { material };
  }

  private ensureSceneEnvironment() {
    if (this.scene.environment) return;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size / 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#4d5666');
    grad.addColorStop(0.35, '#353c47');
    grad.addColorStop(0.5, '#262a32');
    grad.addColorStop(0.55, '#1b1d24');
    grad.addColorStop(1, '#101216');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, canvas.height);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fillRect(size * 0.18, canvas.height * 0.1, size * 0.22, canvas.height * 0.25);
    ctx.fillStyle = 'rgba(230, 240, 255, 0.45)';
    ctx.fillRect(size * 0.65, canvas.height * 0.15, size * 0.18, canvas.height * 0.22);

    const envTex = new THREE.CanvasTexture(canvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = envTex;
  }

  public dispose() {
    if (this.surfaceMesh) {
      this.scene.remove(this.surfaceMesh);
      this.surfaceMesh.geometry.dispose();
      if (Array.isArray(this.surfaceMesh.material)) {
        this.surfaceMesh.material.forEach((m) => m.dispose());
      } else if (this.surfaceMesh.material) {
        this.surfaceMesh.material.dispose();
      }
      this.surfaceMesh = null;
    }
  }

  public static clearCache() {
    SurfaceManager.cachedTextures.forEach((tex) => tex.dispose());
    SurfaceManager.cachedTextures.clear();
  }
}
