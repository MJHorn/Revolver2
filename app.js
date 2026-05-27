/* ==========================================================================
   REVOLVER CORE JAVASCRIPT ENGINE (Tabbed Bounded Region Mode)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------------------------
    // UI ELEMENTS & DOM SELECTORS
    // ----------------------------------------------------------------------
    const elements = {
        singleFuncInput: document.getElementById('single-func-input'),
        singleBoundA: document.getElementById('single-bound-a'),
        singleBoundB: document.getElementById('single-bound-b'),
        
        curve1Input: document.getElementById('curve-1-input'),
        curve2Input: document.getElementById('curve-2-input'),
        curve3Input: document.getElementById('curve-3-input'),
        curve4Input: document.getElementById('curve-4-input'),
        
        curve1Type: document.getElementById('curve-1-type'),
        curve2Type: document.getElementById('curve-2-type'),
        curve3Type: document.getElementById('curve-3-type'),
        curve4Type: document.getElementById('curve-4-type'),
        
        tabSingle: document.getElementById('tab-single'),
        tabBounded: document.getElementById('tab-bounded'),
        panelSingle: document.getElementById('panel-single'),
        panelBounded: document.getElementById('panel-bounded'),
        
        axisX: document.getElementById('axis-x'),
        axisY: document.getElementById('axis-y'),
        
        canvas2d: document.getElementById('canvas-2d'),
        
        sweepSlider: document.getElementById('sweep-slider'),
        sweepValue: document.getElementById('sweep-value'),
        btnAnimateSweep: document.getElementById('btn-animate-sweep'),
        
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
    let activeMode = 'single'; // 'single' or 'bounded'
    let compiledCurves = [null, null, null, null];
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
    // GRAPHITE PENCIL THEME COLOR CONFIGURATION
    // ----------------------------------------------------------------------
    const graphiteTheme = {
        start: new THREE.Color(0x8e8275), // Light Sepia / Graphite shading
        end: new THREE.Color(0x282625),   // Deep Charcoal lead
        hexStart: '#8e8275',
        hexEnd: '#282625'
    };

    // ----------------------------------------------------------------------
    // MATH COMPILATION & EVALUATION
    // ----------------------------------------------------------------------
    function initMath() {
        try {
            if (activeMode === 'single') {
                const expr = elements.singleFuncInput.value.trim();
                const aVal = elements.singleBoundA.value.trim();
                const bVal = elements.singleBoundB.value.trim();

                compiledCurves = [
                    expr ? math.compile(expr) : null,
                    math.compile("0"),
                    aVal ? math.compile(aVal) : null,
                    bVal ? math.compile(bVal) : null
                ];
            } else {
                const inputs = [
                    elements.curve1Input.value.trim(),
                    elements.curve2Input.value.trim(),
                    elements.curve3Input.value.trim(),
                    elements.curve4Input.value.trim()
                ];

                compiledCurves = inputs.map((expr, index) => {
                    if (!expr) return null;
                    return math.compile(expr);
                });
            }

            // Perform simple evaluation tests to ensure parsing succeeded
            compiledCurves.forEach((compiled, idx) => {
                if (compiled) {
                    const testVal = compiled.evaluate({ x: 1, y: 1 });
                    if (testVal === null || isNaN(testVal)) {
                        throw new Error(`Curve ${idx + 1} returned an invalid value.`);
                    }
                }
            });

            hideError();
            return true;
        } catch (error) {
            showError(`Math Error: ${error.message || "Invalid function formula."}`);
            compiledCurves = [null, null, null, null];
            return false;
        }
    }

    function evaluateCurve(curveNumber, varVal) {
        const compiled = compiledCurves[curveNumber - 1];
        if (!compiled) return null;

        let curveType = 'y';
        if (activeMode === 'single') {
            curveType = (curveNumber === 1 || curveNumber === 2) ? 'y' : 'x';
        } else {
            const typeEl = elements[`curve${curveNumber}Type`];
            curveType = typeEl ? typeEl.textContent.replace(' =', '').trim() : 'y';
        }

        try {
            // y-type curves depend on independent variable x
            // x-type curves depend on independent variable y
            const scope = (curveType === 'y') ? { x: varVal } : { y: varVal };
            const val = compiled.evaluate(scope);
            if (typeof val === 'object' && val.isComplex) return val.re;
            return Number(val);
        } catch (e) {
            return null;
        }
    }

    // ----------------------------------------------------------------------
    // BOUNDED REGION SOLVER ALGORITHM (COORDINATE GROUPING)
    // ----------------------------------------------------------------------
    function getBoundedRegion(nx = 80) {
        let types = [];
        if (activeMode === 'single') {
            types = ['y', 'y', 'x', 'x'];
        } else {
            types = [
                elements.curve1Type.textContent.replace(' =', '').trim(),
                elements.curve2Type.textContent.replace(' =', '').trim(),
                elements.curve3Type.textContent.replace(' =', '').trim(),
                elements.curve4Type.textContent.replace(' =', '').trim()
            ];
        }
        
        const yIndices = [];
        const xIndices = [];
        types.forEach((t, idx) => {
            if (t === 'y') yIndices.push(idx + 1);
            else xIndices.push(idx + 1);
        });

        // Auto-detect integration variable:
        // x if majority of curves are y-type (y = f(x)), y if majority are x-type (x = g(y))
        const indepVar = (yIndices.length >= xIndices.length) ? 'x' : 'y';

        let uMin = 0, uMax = 1;
        let boundaryCurves = [];

        if (indepVar === 'x') {
            // Integration along x. x defines domain boundaries, y defines region height boundaries.
            let xVals = [];
            xIndices.forEach(idx => {
                const val = evaluateCurve(idx, 0);
                if (val !== null && !isNaN(val)) xVals.push(val);
            });

            if (xVals.length >= 2) {
                uMin = Math.min(xVals[0], xVals[1]);
                uMax = Math.max(xVals[0], xVals[1]);
            } else if (xVals.length === 1) {
                uMin = Math.min(0, xVals[0]);
                uMax = Math.max(0, xVals[0]);
                if (uMin === uMax) uMax = uMin + 5;
            } else {
                uMin = 0;
                uMax = 5;
            }

            yIndices.forEach(idx => {
                boundaryCurves.push(idx);
            });
            while (boundaryCurves.length < 2) {
                boundaryCurves.push(null);
            }
        } else {
            // Integration along y. y defines domain boundaries, x defines region span boundaries.
            let yVals = [];
            yIndices.forEach(idx => {
                const val = evaluateCurve(idx, 0);
                if (val !== null && !isNaN(val)) yVals.push(val);
            });

            if (yVals.length >= 2) {
                uMin = Math.min(yVals[0], yVals[1]);
                uMax = Math.max(yVals[0], yVals[1]);
            } else if (yVals.length === 1) {
                uMin = Math.min(0, yVals[0]);
                uMax = Math.max(0, yVals[0]);
                if (uMin === uMax) uMax = uMin + 5;
            } else {
                uMin = 0;
                uMax = 5;
            }

            xIndices.forEach(idx => {
                boundaryCurves.push(idx);
            });
            while (boundaryCurves.length < 2) {
                boundaryCurves.push(null);
            }
        }

        if (uMin >= uMax) {
            uMax = uMin + 1;
        }

        const points = [];
        for (let i = 0; i <= nx; i++) {
            const u = uMin + (i / nx) * (uMax - uMin);
            let v1 = 0, v2 = 0;

            const idx1 = boundaryCurves[0];
            const idx2 = boundaryCurves[1];

            if (idx1 !== null) {
                const val = evaluateCurve(idx1, u);
                v1 = (val !== null && !isNaN(val)) ? val : 0;
            }
            if (idx2 !== null) {
                const val = evaluateCurve(idx2, u);
                v2 = (val !== null && !isNaN(val)) ? val : 0;
            }

            points.push({
                u: u,
                v1: v1,
                v2: v2,
                vMin: Math.min(v1, v2),
                vMax: Math.max(v1, v2)
            });
        }

        return {
            indepVar,
            uMin,
            uMax,
            points
        };
    }

    // ----------------------------------------------------------------------
    // STUB STAGERS
    // ----------------------------------------------------------------------
    function draw2DPreview() {
        // Simplified: wireframe previews are shown natively in the 3D Stage sketch line
    }

    function calculateCalculus() {
        // Skipped: calculations are not present in UI
    }

    // ----------------------------------------------------------------------
    // THREE.JS 3D GRAPHICS ENGINE
    // ----------------------------------------------------------------------
    function init3DScene() {
        const container = document.getElementById('canvas-3d-container');
        
        // Create Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf6f4eb); // Warm cream paper background
        scene.fog = new THREE.FogExp2(0xf6f4eb, 0.01); // Soft sepia fog

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

        // Custom Premium Lights for a realistic sketching board look
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.55); // soft ambient light for paper
        scene.add(ambientLight);

        // Soft Hemisphere sky-ground light variation with sepia/cream/graphite tones
        const hemiLight = new THREE.HemisphereLight(0xfaf6eb, 0xeedcb3, 0.35);
        scene.add(hemiLight);

        // Key lighting with specular brightness
        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.65);
        dirLight1.position.set(10, 15, 10);
        dirLight1.castShadow = true;
        scene.add(dirLight1);

        // Secondary soft fill light (warm drafting light tone)
        const dirLight2 = new THREE.DirectionalLight(0xeedcb3, 0.35);
        dirLight2.position.set(-10, 5, -10);
        scene.add(dirLight2);

        // Subtle spotlight on the center stage
        const spotLight = new THREE.SpotLight(0x2e2c2b, 0.25, 30, Math.PI / 6, 0.5, 1);
        spotLight.position.set(0, 12, 0);
        scene.add(spotLight);

        // 3D Grid & Helper Floor
        setupHelpers(null);

        // Slice mesh group
        sliceGroup = new THREE.Group();
        scene.add(sliceGroup);

        // Window resize listener
        window.addEventListener('resize', onWindowResize);

        // Start render frame loop
        animate();
    }

    function setupHelpers(region) {
        if (gridHelper) scene.remove(gridHelper);
        if (axesHelper) scene.remove(axesHelper);

        const uMin = region ? region.uMin : 0;
        const uMax = region ? region.uMax : 5;
        
        // Size the grid helper cover bounds
        const maxBound = Math.max(Math.abs(uMin), Math.abs(uMax));
        const range = Math.max(maxBound * 2.5, 12);

        // Sepia graphing paper style grid & coordinate axes (always visible)
        if (true) {
            // Sepia graphing paper style grid
            gridHelper = new THREE.GridHelper(range, 24, 0xd5c39a, 0xeedcb3);
            gridHelper.position.set(0, -0.01, 0);
            scene.add(gridHelper);

            // Graphite pencil axes
            const axesGroup = new THREE.Group();
            const lineMat = new THREE.LineBasicMaterial({ color: 0x5c5446, linewidth: 2 });
            
            // X axis line
            const xGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-range/2, 0, 0), new THREE.Vector3(range/2, 0, 0)]);
            const xAxis = new THREE.Line(xGeom, lineMat);
            axesGroup.add(xAxis);

            // Y axis line
            const yGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -range/2, 0), new THREE.Vector3(0, range/2, 0)]);
            const yAxis = new THREE.Line(yGeom, lineMat);
            axesGroup.add(yAxis);

            // Z axis line
            const zGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -range/2), new THREE.Vector3(0, 0, range/2)]);
            const zAxis = new THREE.Line(zGeom, lineMat);
            axesGroup.add(zAxis);

            axesHelper = axesGroup;
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
            if (skeletonLine.geometry) {
                skeletonLine.geometry.dispose();
            } else {
                skeletonLine.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                });
            }
            skeletonLine = null;
        }
        
        // Clear old slice visualizers
        while(sliceGroup.children.length > 0) {
            const obj = sliceGroup.children[0];
            sliceGroup.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
        }

        const isAxisX = elements.axisX.checked;
        const sweepDeg = parseFloat(elements.sweepSlider.value);
        const sweepRad = (sweepDeg / 360) * Math.PI * 2;
        const theme = graphiteTheme;
        const materialStyle = 'glass'; // Default to Translucent Ink Wash

        if (compiledCurves.every(c => c === null)) return;

        const region = getBoundedRegion(80);

        // 1. Build original 2D curve skeleton
        if (true) {
            skeletonLine = new THREE.Group();

            const topPoints = [];
            const bottomPoints = [];
            const nx = region.points.length - 1;
            
            for (let i = 0; i <= nx; i++) {
                const pt = region.points[i];
                let tx = (region.indepVar === 'x') ? pt.u : (activeMode === 'single' ? pt.v1 : pt.vMax);
                let ty = (region.indepVar === 'x') ? (activeMode === 'single' ? pt.v1 : pt.vMax) : pt.u;
                topPoints.push(new THREE.Vector3(tx, ty, 0));

                let bx = (region.indepVar === 'x') ? pt.u : pt.vMin;
                let by = (region.indepVar === 'x') ? pt.vMin : pt.u;
                bottomPoints.push(new THREE.Vector3(bx, by, 0));
            }

            const lineMatTop = new THREE.LineBasicMaterial({
                color: 0x2e2c2b, // Charcoal top outline
                linewidth: 3,
                transparent: true,
                opacity: 0.9
            });
            const lineMatBottom = new THREE.LineBasicMaterial({
                color: 0x8e8275, // Graphite bottom outline
                linewidth: 3,
                transparent: true,
                opacity: 0.8
            });

            // Draw top boundary curve
            const topGeom = new THREE.BufferGeometry().setFromPoints(topPoints);
            const lineTop = new THREE.Line(topGeom, lineMatTop);
            skeletonLine.add(lineTop);

            if (activeMode !== 'single') {
                // Draw bottom boundary curve
                const bottomGeom = new THREE.BufferGeometry().setFromPoints(bottomPoints);
                const lineBottom = new THREE.Line(bottomGeom, lineMatBottom);
                skeletonLine.add(lineBottom);

                // Draw left end cap boundary line
                const leftCapPoints = [bottomPoints[0], topPoints[0]];
                const leftGeom = new THREE.BufferGeometry().setFromPoints(leftCapPoints);
                const lineLeft = new THREE.Line(leftGeom, lineMatTop);
                skeletonLine.add(lineLeft);

                // Draw right end cap boundary line
                const rightCapPoints = [bottomPoints[nx], topPoints[nx]];
                const rightGeom = new THREE.BufferGeometry().setFromPoints(rightCapPoints);
                const lineRight = new THREE.Line(rightGeom, lineMatTop);
                skeletonLine.add(lineRight);
            }

            scene.add(skeletonLine);
        }

        // Adjust 3D grid positioning depending on function range
        setupHelpers(region);

        // 3. Build Revolved Parametric Watertight Geometry (Even if sweep angle is 0, we draw flat area!)
        buildRevolvedSolid(region, isAxisX, sweepRad, theme, materialStyle);

        // Update Floating Viewport Text Info
        elements.viewportSubtitle.innerHTML = `Sweep: ${sweepDeg.toFixed(0)}° | Axis: ${isAxisX ? 'X-Axis (y = 0)' : 'Y-Axis (x = 0)'}`;
    }

    function buildRevolvedSolid(region, isAxisX, maxSweepAngle, theme, materialStyle) {
        const nx = region.points.length - 1;
        const nphi = 80;  // resolution around revolution angle
        
        const vertices = [];
        const indices = [];
        const colors = [];
        const isClosedSolid = true; // Closed watertight boundary solid is always enabled

        // We find the max/min radius to construct color gradients properly
        let maxRadius = Math.max(...region.points.map(pt => Math.max(Math.abs(pt.vMin), Math.abs(pt.vMax))), 1.0);

        // Helper to map color based on radius
        function getRadiusColor(radius) {
            const ratio = Math.min(Math.max(Math.abs(radius) / maxRadius, 0), 1);
            return theme.start.clone().lerp(theme.end, ratio);
        }

        if (maxSweepAngle < 0.001) {
            // Sweep is 0°! Render a highly optimized double-sided flat 2D shaded area inside 3D stage at z = 0
            if (activeMode === 'single') {
                // In single mode with sweep = 0, we don't need any shaded area!
                // The curve itself is already drawn by the skeletonLine.
            } else {
                for (let i = 0; i <= nx; i++) {
                    const pt = region.points[i];
                    let tx = (region.indepVar === 'x') ? pt.u : pt.vMax;
                    let ty = (region.indepVar === 'x') ? pt.vMax : pt.u;
                    
                    let bx = (region.indepVar === 'x') ? pt.u : pt.vMin;
                    let by = (region.indepVar === 'x') ? pt.vMin : pt.u;

                    // Add top vertex
                    vertices.push(tx, ty, 0);
                    const cT = getRadiusColor(isAxisX ? ty : tx);
                    colors.push(cT.r, cT.g, cT.b);

                    // Add bottom vertex
                    vertices.push(bx, by, 0);
                    const cB = getRadiusColor(isAxisX ? by : bx);
                    colors.push(cB.r, cB.g, cB.b);
                }

                // Build triangles connecting successive points
                for (let i = 0; i < nx; i++) {
                    const tA = i * 2;
                    const bA = i * 2 + 1;
                    const tB = (i + 1) * 2;
                    const bB = (i + 1) * 2 + 1;

                    indices.push(tA, bA, tB);
                    indices.push(tB, bA, bB);
                }
            }
        } else {
            // Sweep is > 0°! Revolve the parametric 3D grid
            if (activeMode === 'single') {
                // 1. GENERATE VERTICES AND COLORS FOR SINGLE CURVE
                for (let i = 0; i <= nx; i++) {
                    const u = region.points[i].u;
                    const v = region.points[i].v1; // Use actual curve 1 value

                    for (let j = 0; j <= nphi; j++) {
                        const phi = (j / nphi) * maxSweepAngle;
                        
                        let vx, vy, vz;
                        let x = u;
                        let y = v;

                        if (isAxisX) {
                            vx = x;
                            vy = y * Math.cos(phi);
                            vz = y * Math.sin(phi);
                        } else {
                            vx = x * Math.cos(phi);
                            vy = y;
                            vz = x * Math.sin(phi);
                        }

                        vertices.push(vx, vy, vz);
                        const c = getRadiusColor(isAxisX ? y : x);
                        colors.push(c.r, c.g, c.b);
                    }
                }

                // 2. GENERATE FACES INDICES FOR SINGLE CURVE
                const vertexIndex = (i, j) => i * (nphi + 1) + j;
                for (let i = 0; i < nx; i++) {
                    for (let j = 0; j < nphi; j++) {
                        const aIdx = vertexIndex(i, j);
                        const bIdx = vertexIndex(i + 1, j);
                        const cIdx = vertexIndex(i + 1, j + 1);
                        const dIdx = vertexIndex(i, j + 1);

                        indices.push(aIdx, bIdx, dIdx);
                        indices.push(bIdx, cIdx, dIdx);
                    }
                }
            } else {
                // ORIGINAL BOUNDED SOLID REVOLUTION
                const vGrid = (nx + 1) * (nphi + 1);
                const topIndex = (i, j) => i * (nphi + 1) + j;
                const bottomIndex = (i, j) => vGrid + i * (nphi + 1) + j;

                // Precompute values along the curve
                const uVals = [];
                const vMinVals = [];
                const vMaxVals = [];
                for (let i = 0; i <= nx; i++) {
                    const pt = region.points[i];
                    uVals.push(pt.u);
                    vMinVals.push(pt.vMin);
                    vMaxVals.push(pt.vMax);
                }

                // 1. GENERATE VERTICES AND COLORS
                // Top Grid (vMax)
                for (let i = 0; i <= nx; i++) {
                    const u = uVals[i];
                    const v = vMaxVals[i];

                    for (let j = 0; j <= nphi; j++) {
                        const phi = (j / nphi) * maxSweepAngle;
                        
                        let vx, vy, vz;
                        let x = (region.indepVar === 'x') ? u : v;
                        let y = (region.indepVar === 'x') ? v : u;

                        if (isAxisX) {
                            vx = x;
                            vy = y * Math.cos(phi);
                            vz = y * Math.sin(phi);
                        } else {
                            vx = x * Math.cos(phi);
                            vy = y;
                            vz = x * Math.sin(phi);
                        }

                        vertices.push(vx, vy, vz);
                        const c = getRadiusColor(isAxisX ? y : x);
                        colors.push(c.r, c.g, c.b);
                    }
                }

                // Bottom Grid (vMin)
                for (let i = 0; i <= nx; i++) {
                    const u = uVals[i];
                    const v = vMinVals[i];

                    for (let j = 0; j <= nphi; j++) {
                        const phi = (j / nphi) * maxSweepAngle;
                        
                        let vx, vy, vz;
                        let x = (region.indepVar === 'x') ? u : v;
                        let y = (region.indepVar === 'x') ? v : u;

                        if (isAxisX) {
                            vx = x;
                            vy = y * Math.cos(phi);
                            vz = y * Math.sin(phi);
                        } else {
                            vx = x * Math.cos(phi);
                            vy = y;
                            vz = x * Math.sin(phi);
                        }

                        vertices.push(vx, vy, vz);
                        const c = getRadiusColor(isAxisX ? y : x);
                        colors.push(c.r, c.g, c.b);
                    }
                }

                // 2. GENERATE FACES INDICES
                // A. Top Surface
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

                // Closed Caps (Start Cap, End Cap, Side caps)
                const isClosedLoop = Math.abs(maxSweepAngle - Math.PI * 2) < 1e-4;
                if (!isClosedLoop) {
                    // C. Start Cap (phi = 0, j = 0)
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

                // E. Left End Boundary Wall (u = uMin, i = 0)
                for (let j = 0; j < nphi; j++) {
                    const tA = topIndex(0, j);
                    const tB = topIndex(0, j + 1);
                    const bA = bottomIndex(0, j);
                    const bB = bottomIndex(0, j + 1);

                    indices.push(tA, tB, bA);
                    indices.push(tB, bB, bA);
                }

                // F. Right End Boundary Wall (u = uMax, i = nx)
                for (let j = 0; j < nphi; j++) {
                    const tA = topIndex(nx, j);
                    const tB = topIndex(nx, j + 1);
                    const bA = bottomIndex(nx, j);
                    const bB = bottomIndex(nx, j + 1);

                    indices.push(tA, bA, tB);
                    indices.push(tB, bA, bB);
                }
            }
        }

        // Build Three.js BufferGeometry
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();

        // Material is Translucent Ink Wash (Physical Material)
        const mat = new THREE.MeshPhysicalMaterial({
            vertexColors: true,
            transparent: true,
            transmission: 0.15, // Light sepia paper ink wash bleed
            opacity: 0.85,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide,
            depthWrite: false    // essential for correct transparency rendering overlays
        });

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

        // 1. Sidebar Tab Switch Listeners
        elements.tabSingle.addEventListener('click', () => {
            if (activeMode === 'single') return;
            activeMode = 'single';
            elements.tabSingle.classList.add('active');
            elements.tabBounded.classList.remove('active');
            elements.panelSingle.style.display = 'block';
            elements.panelBounded.style.display = 'none';
            triggerRecalculation();
        });

        elements.tabBounded.addEventListener('click', () => {
            if (activeMode === 'bounded') return;
            activeMode = 'bounded';
            elements.tabBounded.classList.add('active');
            elements.tabSingle.classList.remove('active');
            elements.panelSingle.style.display = 'none';
            elements.panelBounded.style.display = 'block';
            triggerRecalculation();
        });

        // 2. Math Input Listeners
        // Single Curve Panel
        elements.singleFuncInput.addEventListener('input', triggerRecalculation);
        elements.singleBoundA.addEventListener('change', triggerRecalculation);
        elements.singleBoundB.addEventListener('change', triggerRecalculation);

        // Bounded Curve Panel
        const curveInputs = [elements.curve1Input, elements.curve2Input, elements.curve3Input, elements.curve4Input];
        curveInputs.forEach(input => {
            input.addEventListener('input', triggerRecalculation);
        });

        // Type Button click Toggles (Cycles y = and x =)
        const curveTypes = [elements.curve1Type, elements.curve2Type, elements.curve3Type, elements.curve4Type];
        curveTypes.forEach(btn => {
            btn.addEventListener('click', () => {
                const currentText = btn.textContent.trim();
                btn.textContent = (currentText === 'y =') ? 'x =' : 'y =';
                triggerRecalculation();
            });
        });

        elements.axisX.addEventListener('change', handleAxisChange);
        elements.axisY.addEventListener('change', handleAxisChange);
        
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

        // 4. Overlays & Responsive Listeners
        elements.sidebarToggle.addEventListener('click', toggleSidebar);
        elements.btnResetCamera.addEventListener('click', resetCamera);
    }

    // Run the app!
    init();
});
