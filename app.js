/* ==========================================================================
   REVOLVER CORE JAVASCRIPT ENGINE
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------------------------
    // UI ELEMENTS & DOM SELECTORS
    // ----------------------------------------------------------------------
    const elements = {
        funcInput: document.getElementById('func-input'),
        boundA: document.getElementById('bound-a'),
        boundB: document.getElementById('bound-b'),
        axisX: document.getElementById('axis-x'),
        axisY: document.getElementById('axis-y'),
        
        canvas2d: document.getElementById('canvas-2d'),
        
        materialSelect: document.getElementById('material-select'),
        colorSelect: document.getElementById('color-select'),
        sweepSlider: document.getElementById('sweep-slider'),
        sweepValue: document.getElementById('sweep-value'),
        btnAnimateSweep: document.getElementById('btn-animate-sweep'),
        showAxes: document.getElementById('show-axes'),
        showSkeleton: document.getElementById('show-skeleton'),
        closeSolid: document.getElementById('close-solid'),
        

        
        volumeFormula: document.getElementById('volume-formula'),
        volumeResult: document.getElementById('volume-result'),
        riemannVolumeRow: document.getElementById('riemann-volume-row'),
        riemannVolumeResult: document.getElementById('riemann-volume-result'),
        surfaceFormula: document.getElementById('surface-formula'),
        surfaceResult: document.getElementById('surface-result'),
        
        sidebarToggle: document.getElementById('sidebar-toggle'),
        sidebar: document.getElementById('controlSidebar'),
        btnResetCamera: document.getElementById('btn-reset-camera'),
        viewportSubtitle: document.getElementById('viewport-subtitle'),
        
        errorToast: document.getElementById('error-toast'),
        errorMessage: document.getElementById('error-message')
    };

    // ----------------------------------------------------------------------
    // GLOBAL STATE
    // ----------------------------------------------------------------------
    let compiledFunction = null;
    let compiledDerivative = null;
    let sweepAnimationId = null;
    let isSweeping = false;
    
    // 3D Scene Variables
    let scene, camera, renderer, controls;
    let revolvedMesh = null;
    let skeletonLine = null;
    let sliceGroup = null;
    let gridHelper = null;
    let axesHelper = null;

    // ----------------------------------------------------------------------
    // COLOR PALETTES
    // ----------------------------------------------------------------------
    const palettes = {
        cyberpunk: {
            start: new THREE.Color(0x00f2fe), // Electric Cyan
            end: new THREE.Color(0xff007f),   // Hot Pink
            hexStart: '#00f2fe',
            hexEnd: '#ff007f'
        },
        sunset: {
            start: new THREE.Color(0xff5e36), // Vibrant Orange
            end: new THREE.Color(0x7000ff),   // Deep Violet
            hexStart: '#ff5e36',
            hexEnd: '#7000ff'
        },
        emerald: {
            start: new THREE.Color(0x0575e6), // Bright Blue
            end: new THREE.Color(0x00f260),   // Vivid Green
            hexStart: '#0575e6',
            hexEnd: '#00f260'
        },
        golden: {
            start: new THREE.Color(0xf21b3f), // Crimson
            end: new THREE.Color(0xffd700),   // Gold
            hexStart: '#f21b3f',
            hexEnd: '#ffd700'
        }
    };

    // ----------------------------------------------------------------------
    // MATH COMPILATION & EVALUATION
    // ----------------------------------------------------------------------
    function initMath() {
        const expr = elements.funcInput.value.trim();
        const a = parseFloat(elements.boundA.value);
        const b = parseFloat(elements.boundB.value);

        if (isNaN(a) || isNaN(b)) {
            showError("Bounds must be valid numerical values.");
            return false;
        }
        if (a >= b) {
            showError("Start bound 'a' must be strictly less than End bound 'b'.");
            return false;
        }

        try {
            // Compile main function
            compiledFunction = math.compile(expr);
            
            // Check that it works for a sample point
            const sampleY = evaluateF(a);
            if (sampleY === null || isNaN(sampleY)) {
                throw new Error("Function returned non-numerical value.");
            }

            // Compile derivative for surface area using math.js auto-differentiation
            try {
                const derivExpr = math.derivative(expr, 'x');
                compiledDerivative = derivExpr.compile();
            } catch (e) {
                console.warn("Derivative computation failed; falling back to numerical derivative.", e);
                compiledDerivative = null; // Fallback to numerical derivative
            }

            hideError();
            return true;
        } catch (error) {
            showError(`Math Error: ${error.message || "Invalid function formula."}`);
            compiledFunction = null;
            compiledDerivative = null;
            return false;
        }
    }

    function evaluateF(x) {
        if (!compiledFunction) return null;
        try {
            const val = compiledFunction.evaluate({ x: x });
            // Handle math.js complex results or undefined
            if (typeof val === 'object' && val.isComplex) {
                return val.re; // Fall back to real part
            }
            return Number(val);
        } catch (e) {
            return null;
        }
    }

    function evaluateFPrime(x) {
        if (compiledDerivative) {
            try {
                const val = compiledDerivative.evaluate({ x: x });
                if (typeof val === 'object' && val.isComplex) return val.re;
                return Number(val);
            } catch (e) {
                // Fallback to numerical differentiation
            }
        }
        
        // Numerical derivative fallback (Central Difference Method)
        const h = 1e-5;
        const yPlus = evaluateF(x + h);
        const yMinus = evaluateF(x - h);
        if (yPlus === null || yMinus === null) return 0;
        return (yPlus - yMinus) / (2 * h);
    }

    // ----------------------------------------------------------------------
    // INTEGRATION CALCULATION ENGINE
    // ----------------------------------------------------------------------
    function calculateCalculus() {
        if (!elements.volumeResult) return; // Safeguard if results box is scrapped
        const a = parseFloat(elements.boundA.value);
        const b = parseFloat(elements.boundB.value);
        const isAxisX = elements.axisX.checked;
        
        if (!compiledFunction) return;

        // Simpson's 1/3 Rule for high-precision integration
        function simpsonIntegrate(g, start, end, n = 1000) {
            if (n % 2 !== 0) n++; // Must be even
            const h = (end - start) / n;
            let sum = g(start) + g(end);

            for (let i = 1; i < n; i++) {
                const x = start + i * h;
                const coeff = (i % 2 === 0) ? 2 : 4;
                sum += coeff * g(x);
            }
            return sum * h / 3;
        }

        // 1. Calculate Exact Volume
        let exactVolume = 0;
        if (isAxisX) {
            // V = pi * integral_a_b (f(x))^2 dx
            exactVolume = Math.PI * simpsonIntegrate(x => Math.pow(evaluateF(x), 2), a, b);
            elements.volumeFormula.innerHTML = `\\( V = \\pi \\int_{${a}}^{${b}} [f(x)]^2 \\, dx \\)`;
        } else {
            // V = 2pi * integral_a_b x * f(x) dx
            exactVolume = 2 * Math.PI * simpsonIntegrate(x => x * evaluateF(x), a, b);
            elements.volumeFormula.innerHTML = `\\( V = 2\\pi \\int_{${a}}^{${b}} x \\cdot f(x) \\, dx \\)`;
        }
        elements.volumeResult.textContent = isNaN(exactVolume) ? "Undefined" : exactVolume.toFixed(4);

        // 2. Calculate Exact Surface Area
        let exactSurface = 0;
        if (isAxisX) {
            // A = 2pi * integral_a_b f(x) * sqrt(1 + (f'(x))^2) dx
            exactSurface = 2 * Math.PI * simpsonIntegrate(x => {
                const fx = evaluateF(x);
                const df = evaluateFPrime(x);
                return Math.abs(fx) * Math.sqrt(1 + df * df);
            }, a, b);
            elements.surfaceFormula.innerHTML = `\\( A = 2\\pi \\int_{${a}}^{${b}} f(x) \\sqrt{1 + [f'(x)]^2} \\, dx \\)`;
        } else {
            // A = 2pi * integral_a_b x * sqrt(1 + (f'(x))^2) dx
            exactSurface = 2 * Math.PI * simpsonIntegrate(x => {
                const df = evaluateFPrime(x);
                return Math.abs(x) * Math.sqrt(1 + df * df);
            }, a, b);
            elements.surfaceFormula.innerHTML = `\\( A = 2\\pi \\int_{${a}}^{${b}} x \\sqrt{1 + [f'(x)]^2} \\, dx \\)`;
        }
        elements.surfaceResult.textContent = isNaN(exactSurface) ? "Undefined" : exactSurface.toFixed(4);

        // 3. Riemann Slice Volume Sum
        const sliceMethod = getSelectedSliceMethod();
        if (sliceMethod !== 'none') {
            elements.riemannVolumeRow.style.style = 'flex'; // Reset display helper
            elements.riemannVolumeRow.style.display = 'flex';
            
            const nSlices = parseInt(elements.slicesSlider.value);
            const dx = (b - a) / nSlices;
            let riemannVol = 0;

            if (sliceMethod === 'disk') {
                // Disk Method Sum: pi * R^2 * dx (per disk) using Midpoint
                for (let i = 0; i < nSlices; i++) {
                    const xMid = a + (i + 0.5) * dx;
                    const r = evaluateF(xMid);
                    riemannVol += Math.PI * r * r * dx;
                }
                elements.methodExplanation.innerHTML = `Approx. using <strong>${nSlices} disks</strong> of width $dx = ${dx.toFixed(2)}$: $V_n = \\sum \\pi [f(x_i)]^2 dx$`;
            } else if (sliceMethod === 'shell') {
                // Shell Method Sum: 2pi * R * H * dx (per shell) using Midpoint
                for (let i = 0; i < nSlices; i++) {
                    const xMid = a + (i + 0.5) * dx;
                    const h = evaluateF(xMid);
                    // Radius is distance to Axis (x-midpoint for Y-axis rotation)
                    riemannVol += 2 * Math.PI * Math.abs(xMid) * h * dx;
                }
                elements.methodExplanation.innerHTML = `Approx. using <strong>${nSlices} shells</strong> of thickness $dx = ${dx.toFixed(2)}$: $V_n = \\sum 2\\pi x_i f(x_i) dx$`;
            }

            elements.riemannVolumeResult.textContent = isNaN(riemannVol) ? "Undefined" : riemannVol.toFixed(4);
        } else {
            elements.riemannVolumeRow.style.display = 'none';
        }

        // Re-trigger MathJax to typeset the dynamic integral formulas
        if (window.MathJax && window.MathJax.typesetPromise) {
            window.MathJax.typesetPromise();
        }
    }

    // ----------------------------------------------------------------------
    // 2D CANVAS PLOTTER
    // ----------------------------------------------------------------------
    function draw2DPreview() {
        const canvas = elements.canvas2d;
        if (!canvas) return; // Safeguard if 2D canvas is scrapped
        const ctx = canvas.getContext('2d');
        
        // Handle High-DPI screens
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        
        const width = rect.width;
        const height = rect.height;

        // Clear canvas
        ctx.fillStyle = '#06070a';
        ctx.fillRect(0, 0, width, height);

        const a = parseFloat(elements.boundA.value);
        const b = parseFloat(elements.boundB.value);
        const isAxisX = elements.axisX.checked;
        
        if (!compiledFunction) return;

        // 1. Gather curve points for range bounds AND a wider view margin
        const rangeWidth = b - a;
        const pad = rangeWidth * 0.25 || 1.0; // padding left/right
        const xMin = a - pad;
        const xMax = b + pad;
        
        const steps = 200;
        const curvePoints = [];
        let yMin = 0;
        let yMax = 1.0;

        for (let i = 0; i <= steps; i++) {
            const x = xMin + (i / steps) * (xMax - xMin);
            const y = evaluateF(x);
            if (y !== null && !isNaN(y)) {
                curvePoints.push({ x, y });
                if (y < yMin) yMin = y;
                if (y > yMax) yMax = y;
            }
        }

        if (curvePoints.length === 0) return;

        // Add 25% padding on Y bounds
        const yRange = yMax - yMin;
        yMin -= yRange * 0.15;
        yMax += yRange * 0.15;
        if (Math.abs(yMax - yMin) < 1e-4) {
            yMin -= 1;
            yMax += 1;
        }

        // Coordinate transforms
        function toCanvasX(x) {
            return ((x - xMin) / (xMax - xMin)) * width;
        }
        function toCanvasY(y) {
            return height - ((y - yMin) / (yMax - yMin)) * height;
        }

        // 2. Draw Gridlines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        
        // Vertical grids
        const xStep = Math.pow(10, Math.floor(Math.log10(rangeWidth))) / 2 || 1;
        const startGridX = Math.floor(xMin / xStep) * xStep;
        for (let x = startGridX; x <= xMax; x += xStep) {
            ctx.beginPath();
            ctx.moveTo(toCanvasX(x), 0);
            ctx.lineTo(toCanvasX(x), height);
            ctx.stroke();
        }
        // Horizontal grids
        const yStep = Math.pow(10, Math.floor(Math.log10(yRange || 1))) / 2 || 1;
        const startGridY = Math.floor(yMin / yStep) * yStep;
        for (let y = startGridY; y <= yMax; y += yStep) {
            ctx.beginPath();
            ctx.moveTo(0, toCanvasY(y));
            ctx.lineTo(width, toCanvasY(y));
            ctx.stroke();
        }

        // 3. Draw Main Axes (X & Y)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1.5;
        
        // X-axis (y = 0)
        if (yMin <= 0 && yMax >= 0) {
            ctx.beginPath();
            ctx.moveTo(0, toCanvasY(0));
            ctx.lineTo(width, toCanvasY(0));
            ctx.stroke();
        }
        // Y-axis (x = 0)
        if (xMin <= 0 && xMax >= 0) {
            ctx.beginPath();
            ctx.moveTo(toCanvasX(0), 0);
            ctx.lineTo(toCanvasX(0), height);
            ctx.stroke();
        }

        // 4. Draw Shaded Area to revolve
        const activeTheme = palettes[elements.colorSelect.value];
        ctx.fillStyle = activeTheme.hexStart + '1d'; // Hex + low alpha
        ctx.strokeStyle = activeTheme.hexStart + '88';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);

        const areaSteps = 100;
        ctx.beginPath();
        
        if (isAxisX) {
            // Shade down to X-axis (y = 0)
            ctx.moveTo(toCanvasX(a), toCanvasY(0));
            for (let i = 0; i <= areaSteps; i++) {
                const x = a + (i / areaSteps) * (b - a);
                const y = evaluateF(x);
                ctx.lineTo(toCanvasX(x), toCanvasY(y || 0));
            }
            ctx.lineTo(toCanvasX(b), toCanvasY(0));
        } else {
            // Shade region parallel to Y-axis (shells are built between x=a and x=b)
            // Riemann shell area is shaded down to X-axis
            ctx.moveTo(toCanvasX(a), toCanvasY(0));
            for (let i = 0; i <= areaSteps; i++) {
                const x = a + (i / areaSteps) * (b - a);
                const y = evaluateF(x);
                ctx.lineTo(toCanvasX(x), toCanvasY(y || 0));
            }
            ctx.lineTo(toCanvasX(b), toCanvasY(0));
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]); // Reset dashed lines

        // 5. Plot the full function curve
        ctx.strokeStyle = '#ff007f';
        ctx.shadowColor = 'rgba(255, 0, 127, 0.4)';
        ctx.shadowBlur = 6;
        ctx.lineWidth = 3;
        ctx.beginPath();
        
        let first = true;
        curvePoints.forEach(pt => {
            if (first) {
                ctx.moveTo(toCanvasX(pt.x), toCanvasY(pt.y));
                first = false;
            } else {
                ctx.lineTo(toCanvasX(pt.x), toCanvasY(pt.y));
            }
        });
        ctx.stroke();
        
        // Reset shadows
        ctx.shadowBlur = 0;

        // 6. Draw start/end boundaries [a, b]
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 1.5;
        
        // Line at x = a
        ctx.beginPath();
        ctx.moveTo(toCanvasX(a), 0);
        ctx.lineTo(toCanvasX(a), height);
        ctx.stroke();

        // Line at x = b
        ctx.beginPath();
        ctx.moveTo(toCanvasX(b), 0);
        ctx.lineTo(toCanvasX(b), height);
        ctx.stroke();

        // Text labels for a and b
        ctx.fillStyle = '#00f2fe';
        ctx.font = 'bold 10px Inter';
        ctx.fillText(`a = ${a}`, toCanvasX(a) + 4, height - 10);
        ctx.fillText(`b = ${b}`, toCanvasX(b) + 4, height - 10);
    }

    // ----------------------------------------------------------------------
    // THREE.JS 3D GRAPHICS ENGINE
    // ----------------------------------------------------------------------
    function init3DScene() {
        const container = document.getElementById('canvas-3d-container');
        
        // Create Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0b10);
        scene.fog = new THREE.FogExp2(0x0a0b10, 0.015);

        // Camera
        camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
        camera.position.set(8, 6, 10);

        // Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);

        // Interactive Orbit Controls
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.maxPolarAngle = Math.PI / 2 + 0.15; // Don't orbit too far below floor grid
        controls.minDistance = 2;
        controls.maxDistance = 50;

        // Custom Premium Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(ambientLight);

        // Soft Hemisphere sky-ground light variation
        const hemiLight = new THREE.HemisphereLight(0x7000ff, 0x00f2fe, 0.4);
        scene.add(hemiLight);

        // Key lighting with specular brightness
        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
        dirLight1.position.set(10, 15, 10);
        dirLight1.castShadow = true;
        scene.add(dirLight1);

        // Secondary soft fill light (warm orange tone)
        const dirLight2 = new THREE.DirectionalLight(0xffaa66, 0.45);
        dirLight2.position.set(-10, 5, -10);
        scene.add(dirLight2);

        // Subtle spotlight on the center stage
        const spotLight = new THREE.SpotLight(0x00f2fe, 0.5, 30, Math.PI / 6, 0.5, 1);
        spotLight.position.set(0, 12, 0);
        scene.add(spotLight);

        // 3D Grid & Helper Floor
        setupHelpers();

        // Slice mesh group
        sliceGroup = new THREE.Group();
        scene.add(sliceGroup);

        // Window resize listener
        window.addEventListener('resize', onWindowResize);

        // Start render frame loop
        animate();
    }

    function setupHelpers() {
        if (gridHelper) scene.remove(gridHelper);
        if (axesHelper) scene.remove(axesHelper);

        const a = parseFloat(elements.boundA.value);
        const b = parseFloat(elements.boundB.value);
        
        // Size the grid helper to always cover the bounds while remaining centered at the true origin (0, 0, 0)
        const maxBound = Math.max(Math.abs(a), Math.abs(b));
        const range = Math.max(maxBound * 2.5, 12);

        if (elements.showAxes.checked) {
            // Subtle coordinate grid centered at (0, 0, 0)
            gridHelper = new THREE.GridHelper(range, 24, 0x3b3e54, 0x1a1c28);
            gridHelper.position.set(0, -0.01, 0); // Always centered at true origin
            scene.add(gridHelper);

            // True coordinate axes: X (Red) = Horizontal axis of rotation, Y (Green) = Vertical axis, Z (Blue) = Depth axis
            axesHelper = new THREE.AxesHelper(range / 2);
            axesHelper.position.set(0, 0.01, 0); // Center at true origin
            scene.add(axesHelper);
        }
    }

    function onWindowResize() {
        const container = document.getElementById('canvas-3d-container');
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }

    function animate() {
        requestAnimationFrame(animate);
        controls.update(); // Essential for damping controls inertia
        renderer.render(scene, camera);
    }

    // ----------------------------------------------------------------------
    // 3D DYNAMIC GEOMETRY BUILDER (THE REVOLVER ENGINE)
    // ----------------------------------------------------------------------
    function update3DVisuals() {
        // Remove existing meshes
        if (revolvedMesh) {
            scene.remove(revolvedMesh);
            revolvedMesh.geometry.dispose();
            revolvedMesh = null;
        }
        if (skeletonLine) {
            scene.remove(skeletonLine);
            skeletonLine.geometry.dispose();
            skeletonLine = null;
        }
        
        // Clear old slice visualizers
        while(sliceGroup.children.length > 0) {
            const obj = sliceGroup.children[0];
            sliceGroup.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
        }

        const a = parseFloat(elements.boundA.value);
        const b = parseFloat(elements.boundB.value);
        const isAxisX = elements.axisX.checked;
        const sweepDeg = parseFloat(elements.sweepSlider.value);
        const sweepRad = (sweepDeg / 360) * Math.PI * 2;
        const theme = palettes[elements.colorSelect.value];
        const materialStyle = elements.materialSelect.value;

        if (!compiledFunction || isNaN(a) || isNaN(b)) return;

        // 1. Build original 2D curve skeleton (as 3D neon outline)
        if (elements.showSkeleton.checked) {
            const pointsCount = 100;
            const curvePoints = [];
            
            for (let i = 0; i <= pointsCount; i++) {
                const x = a + (i / pointsCount) * (b - a);
                const y = evaluateF(x);
                if (y !== null && !isNaN(y)) {
                    if (isAxisX) {
                        curvePoints.push(new THREE.Vector3(x, y, 0));
                    } else {
                        curvePoints.push(new THREE.Vector3(x, y, 0));
                    }
                }
            }

            if (curvePoints.length > 0) {
                const skeletonGeom = new THREE.BufferGeometry().setFromPoints(curvePoints);
                const skeletonMat = new THREE.LineBasicMaterial({
                    color: 0xff007f,
                    linewidth: 3, // WebGL standard linewidth is mostly 1, but we represent with glow
                    transparent: true,
                    opacity: 0.8
                });
                skeletonLine = new THREE.Line(skeletonGeom, skeletonMat);
                scene.add(skeletonLine);
            }
        }

        // Adjust 3D grid positioning depending on function range
        setupHelpers();

        // 3. Build Revolved Parametric Watertight Geometry!
        if (sweepRad > 0.01) {
            buildRevolvedSolid(a, b, isAxisX, sweepRad, theme, materialStyle);
        }

        // Update Floating Viewport Text Info
        elements.viewportSubtitle.innerHTML = `Sweep: ${sweepDeg.toFixed(0)}° | Axis: ${isAxisX ? 'X-Axis ($y=0$)' : 'Y-Axis ($x=0$)'}`;
    }

    function buildRevolvedSolid(a, b, isAxisX, maxSweepAngle, theme, materialStyle) {
        const nx = 80;    // resolution along function length
        const nphi = 80;  // resolution around revolution angle
        
        const vertices = [];
        const indices = [];
        const colors = [];

        // Precompute values along the curve
        const xVals = [];
        const rVals = [];
        for (let i = 0; i <= nx; i++) {
            const x = a + (i / nx) * (b - a);
            const r = evaluateF(x);
            xVals.push(x);
            rVals.push(r !== null && !isNaN(r) ? r : 0);
        }

        // We find the max/min radius to construct color gradients properly
        let maxRadius = Math.max(...rVals.map(Math.abs));
        if (maxRadius < 1e-4) maxRadius = 1.0;

        // Helper to map color based on radius
        function getRadiusColor(radius) {
            const ratio = Math.min(Math.max(Math.abs(radius) / maxRadius, 0), 1);
            return theme.start.clone().lerp(theme.end, ratio);
        }

        const isClosedSolid = elements.closeSolid.checked;
        const vGrid = (nx + 1) * (nphi + 1);
        const topIndex = (i, j) => i * (nphi + 1) + j;
        const bottomIndex = (i, j) => vGrid + i * (nphi + 1) + j;

        // 1. GENERATE VERTICES AND COLORS
        // Top Grid (the revolved function curve) - ALWAYS GENERATED
        for (let i = 0; i <= nx; i++) {
            const x = xVals[i];
            const r = rVals[i];

            for (let j = 0; j <= nphi; j++) {
                const phi = (j / nphi) * maxSweepAngle;
                
                let vx, vy, vz;
                if (isAxisX) {
                    vx = x;
                    vy = r * Math.cos(phi);
                    vz = r * Math.sin(phi);
                } else {
                    vx = x * Math.cos(phi);
                    vy = r;
                    vz = x * Math.sin(phi);
                }

                vertices.push(vx, vy, vz);
                const c = getRadiusColor(isAxisX ? r : x);
                colors.push(c.r, c.g, c.b);
            }
        }

        // Bottom Grid (axis/floor) - ONLY IF isClosedSolid
        if (isClosedSolid) {
            for (let i = 0; i <= nx; i++) {
                const x = xVals[i];

                for (let j = 0; j <= nphi; j++) {
                    const phi = (j / nphi) * maxSweepAngle;
                    
                    let vx, vy, vz;
                    if (isAxisX) {
                        vx = x;
                        vy = 0;
                        vz = 0;
                    } else {
                        vx = x * Math.cos(phi);
                        vy = 0;
                        vz = x * Math.sin(phi);
                    }

                    vertices.push(vx, vy, vz);
                    const c = getRadiusColor(0);
                    colors.push(c.r, c.g, c.b);
                }
            }
        }

        // 2. GENERATE FACES INDICES
        // A. Top Surface - ALWAYS GENERATED
        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < nphi; j++) {
                const aIdx = topIndex(i, j);
                const bIdx = topIndex(i + 1, j);
                const cIdx = topIndex(i + 1, j + 1);
                const dIdx = topIndex(i, j + 1);

                indices.push(aIdx, bIdx, dIdx);
                indices.push(bIdx, cIdx, dIdx);
            }
        }

        // Closed Solid faces - ONLY IF isClosedSolid
        if (isClosedSolid) {
            // B. Bottom Surface
            for (let i = 0; i < nx; i++) {
                for (let j = 0; j < nphi; j++) {
                    const aIdx = bottomIndex(i, j);
                    const bIdx = bottomIndex(i + 1, j);
                    const cIdx = bottomIndex(i + 1, j + 1);
                    const dIdx = bottomIndex(i, j + 1);

                    // Reverse winding order for outward facing normals
                    indices.push(aIdx, dIdx, bIdx);
                    indices.push(bIdx, dIdx, cIdx);
                }
            }

            // C. Start Cap (phi = 0, j = 0)
            const isClosedLoop = Math.abs(maxSweepAngle - Math.PI * 2) < 1e-4;
            if (!isClosedLoop) {
                for (let i = 0; i < nx; i++) {
                    const tA = topIndex(i, 0);
                    const tB = topIndex(i + 1, 0);
                    const bA = bottomIndex(i, 0);
                    const bB = bottomIndex(i + 1, 0);

                    indices.push(tA, bA, tB);
                    indices.push(tB, bA, bB);
                }

                // D. End Cap (phi = maxSweepAngle, j = nphi)
                for (let i = 0; i < nx; i++) {
                    const tA = topIndex(i, nphi);
                    const tB = topIndex(i + 1, nphi);
                    const bA = bottomIndex(i, nphi);
                    const bB = bottomIndex(i + 1, nphi);

                    indices.push(tA, tB, bA);
                    indices.push(tB, bB, bA);
                }
            }

            // E. Left End Boundary Wall (x = a, i = 0)
            for (let j = 0; j < nphi; j++) {
                const tA = topIndex(0, j);
                const tB = topIndex(0, j + 1);
                const bA = bottomIndex(0, j);
                const bB = bottomIndex(0, j + 1);

                indices.push(tA, tB, bA);
                indices.push(tB, bB, bA);
            }

            // F. Right End Boundary Wall (x = b, i = nx)
            for (let j = 0; j < nphi; j++) {
                const tA = topIndex(nx, j);
                const tB = topIndex(nx, j + 1);
                const bA = bottomIndex(nx, j);
                const bB = bottomIndex(nx, j + 1);

                indices.push(tA, bA, tB);
                indices.push(tB, bA, bB);
            }
        }

        // Build Three.js BufferGeometry
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();

        // Material Options
        let mat;
        if (materialStyle === 'solid') {
            mat = new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 0.15,
                metalness: 0.1,
                side: THREE.DoubleSide,
                shadowSide: THREE.DoubleSide
            });
        } else if (materialStyle === 'glass') {
            mat = new THREE.MeshPhysicalMaterial({
                vertexColors: true,
                transparent: true,
                transmission: 0.4,   // glasslike light bending
                opacity: 0.7,
                roughness: 0.1,
                metalness: 0.05,
                side: THREE.DoubleSide,
                depthWrite: false    // essential for correct transparency rendering overlays
            });
        } else {
            // Neon wireframe mode
            mat = new THREE.MeshBasicMaterial({
                vertexColors: true,
                wireframe: true,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.8
            });
        }

        revolvedMesh = new THREE.Mesh(geom, mat);
        revolvedMesh.castShadow = true;
        revolvedMesh.receiveShadow = true;
        scene.add(revolvedMesh);
    }


    // ----------------------------------------------------------------------
    // ANIMATION ENGINE (SWEEP ENGINE)
    // ----------------------------------------------------------------------
    function animateSweep() {
        if (isSweeping) {
            // STOP ANIMATION
            isSweeping = false;
            cancelAnimationFrame(sweepAnimationId);
            elements.btnAnimateSweep.innerHTML = '<i class="fa-solid fa-play"></i>';
            elements.btnAnimateSweep.classList.remove('playing');
        } else {
            // START ANIMATION
            isSweeping = true;
            elements.btnAnimateSweep.innerHTML = '<i class="fa-solid fa-pause"></i>';
            elements.btnAnimateSweep.classList.add('playing');
            
            let currentAngle = parseFloat(elements.sweepSlider.value);
            if (currentAngle >= 360) currentAngle = 0; // reset if full

            function step() {
                if (!isSweeping) return;
                currentAngle += 2.5; // step angle degrees
                if (currentAngle > 360) {
                    currentAngle = 360;
                    isSweeping = false;
                    elements.btnAnimateSweep.innerHTML = '<i class="fa-solid fa-play"></i>';
                    elements.btnAnimateSweep.classList.remove('playing');
                }

                elements.sweepSlider.value = currentAngle;
                elements.sweepValue.textContent = `${Math.round(currentAngle)}°`;
                
                update3DVisuals();

                if (isSweeping) {
                    sweepAnimationId = requestAnimationFrame(step);
                }
            }
            sweepAnimationId = requestAnimationFrame(step);
        }
    }

    // ----------------------------------------------------------------------
    // SIDEBAR & UTILITIES
    // ----------------------------------------------------------------------
    function toggleSidebar() {
        elements.sidebar.classList.toggle('collapsed');
        setTimeout(onWindowResize, 350); // Resize 3D stage after sidebar animation completes
    }

    function resetCamera() {
        controls.reset();
        camera.position.set(8, 6, 10);
        controls.target.set(0, 0, 0);
    }

    function showError(msg) {
        elements.errorMessage.textContent = msg;
        elements.errorToast.classList.add('visible');
    }

    function hideError() {
        elements.errorToast.classList.remove('visible');
    }

    function handleAxisChange() {
        triggerRecalculation();
    }

    // Trigger full calculation and rendering cascade
    function triggerRecalculation() {
        const mathOK = initMath();
        if (mathOK) {
            draw2DPreview();
            calculateCalculus();
            update3DVisuals();
        }
    }

    // ----------------------------------------------------------------------
    // INITIALIZATION & EVENT LISTENERS
    // ----------------------------------------------------------------------
    function init() {
        // Init WebGL 3D
        init3DScene();
        
        // Trigger initial calculations
        triggerRecalculation();

        // 1. Math Input Change Listeners
        elements.funcInput.addEventListener('input', triggerRecalculation);
        elements.boundA.addEventListener('change', triggerRecalculation);
        elements.boundB.addEventListener('change', triggerRecalculation);
        elements.axisX.addEventListener('change', handleAxisChange);
        elements.axisY.addEventListener('change', handleAxisChange);

        // 2. Visual Settings Listeners
        elements.materialSelect.addEventListener('change', update3DVisuals);
        elements.colorSelect.addEventListener('change', () => {
            triggerRecalculation(); // redraws 2D canvas with correct theme colors
        });
        
        elements.sweepSlider.addEventListener('input', (e) => {
            // Stop any active sweeping animation if user manually moves slider
            if (isSweeping) {
                isSweeping = false;
                cancelAnimationFrame(sweepAnimationId);
                elements.btnAnimateSweep.innerHTML = '<i class="fa-solid fa-play"></i>';
                elements.btnAnimateSweep.classList.remove('playing');
            }
            elements.sweepValue.textContent = `${e.target.value}°`;
            update3DVisuals();
        });
        
        elements.btnAnimateSweep.addEventListener('click', animateSweep);
        elements.showAxes.addEventListener('change', update3DVisuals);
        elements.showSkeleton.addEventListener('change', update3DVisuals);
        elements.closeSolid.addEventListener('change', update3DVisuals);

        // 4. Overlays & Responsive Listeners
        elements.sidebarToggle.addEventListener('click', toggleSidebar);
        elements.btnResetCamera.addEventListener('click', resetCamera);

        // 5. Collapsible Sidebar Accordion sections
        document.querySelectorAll('.card-header').forEach(header => {
            header.addEventListener('click', () => {
                const card = header.parentElement;
                card.classList.toggle('collapsed');
            });
        });
    }

    // Run the app!
    init();
});
