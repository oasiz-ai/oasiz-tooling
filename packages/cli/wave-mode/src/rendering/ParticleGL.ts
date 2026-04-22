/**
 * ParticleGL - WebGL-accelerated particle renderer
 * Uses point sprites for efficient particle rendering
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  g: number;
  b: number;
  a: number;
  size: number;
  life: number;
  maxLife: number;
}

export class ParticleGL {
  private gl: WebGLRenderingContext | null = null;
  private canvas: HTMLCanvasElement;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private colorBuffer: WebGLBuffer | null = null;
  private sizeBuffer: WebGLBuffer | null = null;

  private particles: Particle[] = [];
  private maxParticles = 500;
  private activeCount = 0;

  // Pre-allocated typed arrays for buffer uploads
  private positionData: Float32Array;
  private colorData: Float32Array;
  private sizeData: Float32Array;

  // Uniform locations
  private resolutionLoc: WebGLUniformLocation | null = null;
  private offsetLoc: WebGLUniformLocation | null = null;

  // Camera offset (for world-space particles)
  private offsetX = 0;
  private offsetY = 0;

  private initialized = false;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;z-index:10;";
    container.appendChild(this.canvas);

    // Pre-allocate particles and buffers
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        r: 1,
        g: 1,
        b: 1,
        a: 1,
        size: 4,
        life: 0,
        maxLife: 1,
      });
    }

    this.positionData = new Float32Array(this.maxParticles * 2);
    this.colorData = new Float32Array(this.maxParticles * 4);
    this.sizeData = new Float32Array(this.maxParticles);

    this.initGL();
  }

  private initGL(): void {
    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });

    if (!gl) {
      console.warn("[ParticleGL] WebGL not available, falling back to Canvas2D");
      return;
    }

    this.gl = gl;

    // Vertex shader
    const vertexSrc = `
      attribute vec2 a_position;
      attribute vec4 a_color;
      attribute float a_size;
      uniform vec2 u_resolution;
      uniform vec2 u_offset;
      varying vec4 v_color;
      
      void main() {
        vec2 pos = a_position - u_offset;
        vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        gl_PointSize = a_size;
        v_color = a_color;
      }
    `;

    // Fragment shader - soft circular particles with glow
    const fragmentSrc = `
      precision mediump float;
      varying vec4 v_color;
      
      void main() {
        float dist = length(gl_PointCoord - 0.5);
        float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
        gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
      }
    `;

    // Compile shaders
    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);

    if (!vertexShader || !fragmentShader) return;

    // Link program
    const program = gl.createProgram();
    if (!program) return;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[ParticleGL] Program link failed:", gl.getProgramInfoLog(program));
      return;
    }

    this.program = program;
    gl.useProgram(program);

    // Get uniform locations
    this.resolutionLoc = gl.getUniformLocation(program, "u_resolution");
    this.offsetLoc = gl.getUniformLocation(program, "u_offset");

    // Create buffers
    this.positionBuffer = gl.createBuffer();
    this.colorBuffer = gl.createBuffer();
    this.sizeBuffer = gl.createBuffer();

    // Setup attributes
    const positionLoc = gl.getAttribLocation(program, "a_position");
    const colorLoc = gl.getAttribLocation(program, "a_color");
    const sizeLoc = gl.getAttribLocation(program, "a_size");

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
    gl.enableVertexAttribArray(sizeLoc);
    gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, 0, 0);

    // Enable blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glowy particles

    this.initialized = true;
    console.log("[ParticleGL] Initialized successfully");
  }

  private compileShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[ParticleGL] Shader compile failed:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * Resize the WebGL canvas to match container
   */
  resize(width: number, height: number, dpr: number = 1): void {
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * Set camera offset for world-space particles
   */
  setOffset(x: number, y: number): void {
    this.offsetX = x;
    this.offsetY = y;
  }

  /**
   * Emit a single particle
   */
  emit(
    x: number,
    y: number,
    vx: number,
    vy: number,
    r: number,
    g: number,
    b: number,
    a: number,
    size: number,
    life: number
  ): void {
    // Find an inactive particle or reuse oldest
    let p: Particle | null = null;

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.particles[i].life <= 0) {
        p = this.particles[i];
        break;
      }
    }

    if (!p) {
      // Reuse oldest (first in array with lowest life)
      let minLife = Infinity;
      for (let i = 0; i < this.maxParticles; i++) {
        if (this.particles[i].life < minLife) {
          minLife = this.particles[i].life;
          p = this.particles[i];
        }
      }
    }

    if (p) {
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.r = r;
      p.g = g;
      p.b = b;
      p.a = a;
      p.size = size;
      p.life = life;
      p.maxLife = life;
    }
  }

  /**
   * Emit a burst of particles (for explosions, death effects)
   */
  emitBurst(
    x: number,
    y: number,
    count: number,
    speed: number,
    r: number,
    g: number,
    b: number,
    size: number,
    life: number
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random() * 0.5);
      const vx = Math.cos(angle) * s;
      const vy = Math.sin(angle) * s;
      this.emit(x, y, vx, vy, r, g, b, 1, size * (0.5 + Math.random() * 0.5), life * (0.5 + Math.random() * 0.5));
    }
  }

  /**
   * Update all particles
   */
  update(dt: number): void {
    this.activeCount = 0;

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;

      // Update position
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Apply drag
      p.vx *= 0.98;
      p.vy *= 0.98;

      // Decay life
      p.life -= dt;

      // Fade alpha based on remaining life
      p.a = Math.max(0, p.life / p.maxLife);

      if (p.life > 0) {
        this.activeCount++;
      }
    }
  }

  /**
   * Render all active particles
   */
  render(): void {
    if (!this.initialized || !this.gl || this.activeCount === 0) return;

    const gl = this.gl;

    // Clear with transparent
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Set uniforms
    gl.uniform2f(this.resolutionLoc, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.offsetLoc, this.offsetX, this.offsetY);

    // Fill buffers with active particles
    let idx = 0;
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;

      this.positionData[idx * 2] = p.x;
      this.positionData[idx * 2 + 1] = p.y;
      this.colorData[idx * 4] = p.r;
      this.colorData[idx * 4 + 1] = p.g;
      this.colorData[idx * 4 + 2] = p.b;
      this.colorData[idx * 4 + 3] = p.a;
      this.sizeData[idx] = p.size;
      idx++;
    }

    // Upload data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.positionData.subarray(0, idx * 2), gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.colorData.subarray(0, idx * 4), gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.sizeData.subarray(0, idx), gl.DYNAMIC_DRAW);

    // Draw
    gl.drawArrays(gl.POINTS, 0, idx);
  }

  /**
   * Clear all particles
   */
  clear(): void {
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles[i].life = 0;
    }
    this.activeCount = 0;
  }

  /**
   * Get active particle count (for debugging)
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * Check if WebGL is available
   */
  isAvailable(): boolean {
    return this.initialized;
  }

  /**
   * Destroy the renderer and clean up resources
   */
  destroy(): void {
    if (this.gl) {
      if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
      if (this.colorBuffer) this.gl.deleteBuffer(this.colorBuffer);
      if (this.sizeBuffer) this.gl.deleteBuffer(this.sizeBuffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.canvas.remove();
    this.initialized = false;
  }
}
