document.addEventListener('DOMContentLoaded', function () {
    var resultCollector = Quagga.ResultCollector.create({
        capture: true,
        capacity: 20,
        blacklist: [],
        filter: function (codeResult) {
            return true;
        }
    });

    var App = {
        init: function () {
            this.lastResult = null;
            this.scannerRunning = false;
            this.initializePerformanceMetrics();
            this.attachListeners();
            this.initCameraSelection();
        },
        handleError: function (err) {
            console.error(err);
            alert('Error initializing Quagga: ' + (err.message || err));
        },
        checkCapabilities: function () {
            var track = Quagga.CameraAccess.getActiveTrack();
            var capabilities = {};
            if (track && typeof track.getCapabilities === "function") {
                capabilities = track.getCapabilities();
            }
            this.applySettingsVisibility("zoom", capabilities.zoom);
            this.applySettingsVisibility("torch", capabilities.torch);
        },
        updateOptionsForMediaRange: function (node, range) {
            var NUM_STEPS = 6;
            var stepSize = (range.max - range.min) / NUM_STEPS;
            while (node.firstChild) {
                node.removeChild(node.firstChild);
            }
            for (var i = 0; i <= NUM_STEPS; i++) {
                var value = range.min + stepSize * i;
                var option = document.createElement("option");
                option.value = value;
                option.innerHTML = value.toFixed(2);
                node.appendChild(option);
            }
        },
        applySettingsVisibility: function (setting, capability) {
            if (typeof capability === "boolean") {
                var node = document.querySelector('input[name="settings_' + setting + '"]');
                if (node) {
                    node.parentNode.style.display = capability ? "block" : "none";
                }
                return;
            }
            if (window.MediaSettingsRange && capability instanceof window.MediaSettingsRange) {
                var node = document.querySelector('select[name="settings_' + setting + '"]');
                if (node) {
                    this.updateOptionsForMediaRange(node, capability);
                    node.parentNode.style.display = "block";
                }
                return;
            }
        },
        initCameraSelection: function () {
            var self = this;
            Quagga.CameraAccess.enumerateVideoDevices().then(function (devices) {
                var deviceSelection = document.getElementById("deviceSelection");
                var currentValue = deviceSelection.value; // Get the current selected value
                while (deviceSelection.firstChild) {
                    deviceSelection.removeChild(deviceSelection.firstChild);
                }
                devices.forEach(function (device) {
                    var option = document.createElement("option");
                    option.value = device.deviceId || device.id;
                    option.text = device.label || device.deviceId || device.id;
                    if (option.value === currentValue) {
                        option.selected = true; // Set the option as selected
                    }
                    deviceSelection.appendChild(option);
                });
            });
        },
        attachListeners: function () {
            var self = this;

            document.querySelector(".controls button.start").addEventListener("click", function (e) {
                e.preventDefault();
                self.startScanner();
            });

            document.querySelector(".controls button.stop").addEventListener("click", function (e) {
                e.preventDefault();
                self.stopScanner();
            });

            document.querySelector(".controls .reader-config-group").addEventListener(
                "change",
                function (e) {
                    e.preventDefault();
                    var target = e.target,
                        value =
                            target.type === "checkbox"
                                ? target.checked
                                : target.value,
                        name = target.name,
                        state = self._convertNameToState(name);

                    if (name === "inputStream_constraints_deviceId") {
                        // Handle camera device selection
                        self.setState("inputStream.constraints.deviceId", value);
                    } else if (name.startsWith("settings_")) {
                        // Handle settings like zoom and torch
                        var setting = name.substring(9); // Remove 'settings_' prefix
                        self.applySetting(setting, value);
                    } else if (name === "inputStream_constraints_width" || name === "inputStream_constraints_height") {
                        // Handle resolution changes
                        self.setState(name, value);
                    } else {
                        self.setState(state, value);
                    }
                }
            );
        },
        _convertNameToState: function (name) {
            return name.replace(/_/g, ".").replace(/-/g, "");
        },
        applySetting: function (setting, value) {
            var track = Quagga.CameraAccess.getActiveTrack();
            if (track && typeof track.getCapabilities === "function") {
                var constraints = {};
                constraints[setting] = setting === "torch" ? !!value : parseFloat(value);
                track.applyConstraints({ advanced: [constraints] });
            }
        },
        setState: async function (path, value) {
            var self = this;
            self.disableControls(true);

            var pathParts = path.split('.');
            var target = self.state;
            var mapping = self.inputMapper;

            for (var i = 0; i < pathParts.length - 1; i++) {
                var part = pathParts[i];
                if (!target[part]) {
                    target[part] = {};
                }
                target = target[part];
                if (mapping && mapping.hasOwnProperty(part)) {
                    mapping = mapping[part];
                } else {
                    mapping = null;
                }
            }

            var lastPart = pathParts[pathParts.length - 1];
            var mappedValue = value;

            if (mapping && mapping.hasOwnProperty(lastPart)) {
                if (typeof mapping[lastPart] === 'function') {
                    mappedValue = mapping[lastPart](value);
                } else {
                    mappedValue = mapping[lastPart];
                }
            } else {
                mappedValue = value;
            }

            // Preserve existing properties
            if (typeof mappedValue === 'object' && !Array.isArray(mappedValue)) {
                target[lastPart] = Object.assign({}, target[lastPart], mappedValue);
            } else {
                target[lastPart] = mappedValue;
            }

            var needsRestart = false;

            // Determine if the change requires a restart
            if (path.startsWith('inputStream') || path.startsWith('decoder') || path.startsWith('locator')) {
                needsRestart = true;
            }

            if (needsRestart) {
                if (self.scannerRunning) {
                    try {
                        await self.stopScanner();
                        await self.startScanner();
                    } catch (error) {
                        console.error("Error restarting scanner:", error);
                        self.handleError(error);
                    } finally {
                        self.disableControls(false);
                    }
                } else {
                    // Scanner is not running; just update the state
                    self.disableControls(false);
                }
            } else {
                // Re-enable controls
                self.disableControls(false);
            }
        },
        disableControls: function (disable) {
            var controls = document.querySelectorAll('.controls .reader-config-group input, .controls .reader-config-group select, .controls button');
            controls.forEach(function (control) {
                control.disabled = disable;
            });
            // Display a loading indicator
            var loadingIndicator = document.getElementById('loadingIndicator');
            if (loadingIndicator) {
                loadingIndicator.style.display = disable ? 'block' : 'none';
            }
        },
        stopScanner: async function () {
            var self = this;
            if (self.scannerRunning) {
                try {
                    Quagga.stop(); // Stops the scanner and video processing
                    await Quagga.CameraAccess.release(); // Waits for the camera to be released
                    Quagga.offProcessed(self.onProcessed.bind(self)); // Removes the processed event listener
                    Quagga.offDetected(self.onDetected.bind(self)); // Removes the detected event listener
                    self.scannerRunning = false;

                    // Remove Quagga's video and canvas elements from the DOM
                    var interactive = document.querySelector('#interactive');
                    var video = interactive.querySelector('video');
                    if (video) {
                        interactive.removeChild(video);
                    }
                    // Remove Quagga's canvas overlays
                    var canvases = interactive.querySelectorAll('canvas');
                    canvases.forEach(function (canvas) {
                        interactive.removeChild(canvas);
                    });

                    // Clear any overlays or results
                    var drawingCanvas = Quagga.canvas && Quagga.canvas.dom && Quagga.canvas.dom.overlay;
                    if (drawingCanvas) {
                        var drawingCtx = Quagga.canvas.ctx.overlay;
                        drawingCtx.clearRect(0, 0, drawingCanvas.getAttribute("width"), drawingCanvas.getAttribute("height"));
                    }

                    self._printCollectedResults(); // If you want to display collected results

                } catch (error) {
                    console.error("Error releasing camera:", error);
                    throw error;
                }
            }
        },
        startScanner: async function () {
            var self = this;
            Quagga.init(self.state, function (err) {
                if (err) {
                    self.handleError(err);
                    return;
                }
                Quagga.start();
                self.scannerRunning = true;
                self.checkCapabilities();
                Quagga.onProcessed(self.onProcessed.bind(self));
                Quagga.onDetected(self.onDetected.bind(self));

                // Ensure the bounding box is present
                var interactive = document.querySelector('#interactive');
                var boundingBox = document.getElementById('boundingBox');
                if (!boundingBox) {
                    // If bounding box is missing, create and append it
                    boundingBox = document.createElement('div');
                    boundingBox.id = 'boundingBox';
                    interactive.appendChild(boundingBox);
                }

                // Create the code overlay
                var codeOverlay = document.getElementById('codeOverlay');
                if (!codeOverlay) {
                    codeOverlay = document.createElement('div');
                    codeOverlay.id = 'codeOverlay';
                    codeOverlay.style.position = 'absolute';
                    codeOverlay.style.top = '25%'; // Adjusted to match updated ROI
                    codeOverlay.style.left = '15%'; // Adjusted to match updated ROI
                    codeOverlay.style.width = '70%'; // Adjusted width
                    codeOverlay.style.height = '50%'; // Adjusted height
                    codeOverlay.style.display = 'flex';
                    codeOverlay.style.alignItems = 'center';
                    codeOverlay.style.justifyContent = 'center';
                    codeOverlay.style.color = '#FFFFFF';
                    codeOverlay.style.fontSize = '24px';
                    codeOverlay.style.fontWeight = 'bold';
                    codeOverlay.style.textAlign = 'center';
                    codeOverlay.style.pointerEvents = 'none';
                    codeOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'; // Optional background for readability
                    interactive.appendChild(codeOverlay);
                }
            });
        },
        onProcessed: function (result) {
            // Implement frame skipping
            if (!this.performFrameSkipping()) {
                return;
            }

            var drawingCtx = Quagga.canvas.ctx.overlay,
                drawingCanvas = Quagga.canvas.dom.overlay;

            if (result) {
                if (result.boxes) {
                    drawingCtx.clearRect(
                        0,
                        0,
                        parseInt(drawingCanvas.getAttribute("width")),
                        parseInt(drawingCanvas.getAttribute("height"))
                    );
                    result.boxes
                        .filter(function (box) {
                            return box !== result.box;
                        })
                        .forEach(function (box) {
                            Quagga.ImageDebug.drawPath(box, { x: 0, y: 1 }, drawingCtx, {
                                color: "green",
                                lineWidth: 2,
                            });
                        });
                }

                if (result.box) {
                    Quagga.ImageDebug.drawPath(result.box, { x: 0, y: 1 }, drawingCtx, {
                        color: "#00F",
                        lineWidth: 2,
                    });
                }

                if (result.codeResult && result.codeResult.code) {
                    Quagga.ImageDebug.drawPath(result.line, { x: "x", y: "y" }, drawingCtx, {
                        color: "red",
                        lineWidth: 3,
                    });
                }
            }

            // Performance Metrics: Update FPS
            if (this.lastProcessedTime) {
                var now = performance.now();
                var delta = now - this.lastProcessedTime;
                var fps = 1000 / delta;
                this.updateFPS(fps);
            }
            this.lastProcessedTime = performance.now();

            // Periodically perform performance checks
            if (performance.now() - this.lastPerformanceCheckTime > 5000) { // Every 5 seconds
                this.performPerformanceChecks();
                this.lastPerformanceCheckTime = performance.now();
            }
        },
        onDetected: function (result) {
            // Implement frame skipping
            if (!this.performFrameSkipping()) {
                return;
            }

            var code = result.codeResult.code;
            var confidence = result.codeResult.confidence || 0;

            // Simple validation: UPC-A should be 12 digits
            if (code.length !== 12) {
                console.warn("Invalid UPC length:", code);
                return;
            }

            // Update detection confidence
            this.updateConfidence(confidence);

            // Check lighting conditions based on image brightness
            var imageData = Quagga.ImageDebug.getImageData();
            var avgBrightness = this.calculateAverageBrightness(imageData);
            if (avgBrightness < 100) { // Threshold for poor lighting
                this.showLightingWarning(true);
            } else {
                this.showLightingWarning(false);
            }

            if (this.lastResult !== code) {
                this.lastResult = code;

                // Update the code overlay
                var codeOverlay = document.getElementById('codeOverlay');
                if (codeOverlay) {
                    codeOverlay.textContent = code;
                }

                // Optionally, clear the overlay after a delay
                setTimeout(function () {
                    var overlay = document.getElementById('codeOverlay');
                    if (overlay) {
                        overlay.textContent = '';
                    }
                }, 3000); // Adjust the delay as needed

                // Existing code to display the result in the result strip
                var node = document.createElement("li");
                var canvas = Quagga.canvas.dom.image;

                node.innerHTML =
                    '<div class="thumbnail"><div class="imgWrapper"><img src="' +
                    canvas.toDataURL() +
                    '"/></div><div class="caption"><h4 class="code">' +
                    code +
                    "</h4></div></div>";
                document.querySelector("#result_strip ul.thumbnails").prepend(node);
            }
        },
        _printCollectedResults: function () {
            var results = resultCollector.getResults(),
                ul = document.querySelector("#result_strip ul.collector");
            if (!ul) {
                ul = document.createElement('ul');
                ul.className = 'collector';
                document.getElementById('result_strip').appendChild(ul);
            }
            results.forEach(function (result) {
                var li = document.createElement("li");
                li.innerHTML =
                    '<div class="thumbnail"><div class="imgWrapper"><img src="' +
                    result.frame +
                    '"/></div><div class="caption"><h4 class="code">' +
                    result.codeResult.code +
                    " (" +
                    result.codeResult.format +
                    ")</h4></div></div>";
                ul.prepend(li);
            });
        },
        // Initialize Performance Metrics
        initializePerformanceMetrics: function () {
            this.frameCount = 0;
            this.startTime = performance.now();
            this.fps = 0;
            this.confidenceSum = 0;
            this.confidenceCount = 0;
            this.avgFPS = 0;
            this.avgConfidence = 0;
            this.patchSizes = ["medium", "small", "x-small"]; // Ordered from larger to smaller
            this.currentPatchSizeIndex = 0; // Start with medium
            this.frameProcessingThreshold = 50; // in ms, adjust as needed
            this.lastPerformanceCheckTime = performance.now();
            this.lastProcessedTime = null;
            this.frameSkipCounter = 0;
        },
        // Update FPS Display
        updateFPS: function (currentFPS) {
            this.fps = currentFPS;
            // Update average FPS over the last second
            this.frameCount++;
            var elapsed = performance.now() - this.startTime;
            if (elapsed >= 1000) {
                this.avgFPS = this.frameCount / (elapsed / 1000);
                this.frameCount = 0;
                this.startTime = performance.now();
                document.getElementById('fps').textContent = this.avgFPS.toFixed(1);
            } else {
                document.getElementById('fps').textContent = this.fps.toFixed(1);
            }
        },
        // Update Confidence Display
        updateConfidence: function (confidence) {
            this.confidenceSum += confidence;
            this.confidenceCount++;
            this.avgConfidence = this.confidenceSum / this.confidenceCount;
            document.getElementById('confidence').textContent = this.avgConfidence.toFixed(2);
        },
        // Calculate Average Brightness of the Image
        calculateAverageBrightness: function (imageData) {
            var data = imageData.data;
            var total = 0;
            for (var i = 0; i < data.length; i += 4) {
                // Simple average of RGB
                total += (data[i] + data[i + 1] + data[i + 2]) / 3;
            }
            return total / (imageData.width * imageData.height);
        },
        // Show or Hide Lighting Warning
        showLightingWarning: function (show) {
            var warning = document.getElementById('lightingWarning');
            if (show) {
                warning.style.display = 'block';
            } else {
                warning.style.display = 'none';
            }
        },
        // Dynamic Patch Size Adjustment based on performance
        adjustPatchSize: function () {
            // Example logic: If FPS is below a threshold, reduce patch size
            if (this.avgFPS < 10 && this.currentPatchSizeIndex < this.patchSizes.length - 1) {
                this.currentPatchSizeIndex++;
                this.state.locator.patchSize = this.patchSizes[this.currentPatchSizeIndex];
                console.log("Reducing patchSize to:", this.state.locator.patchSize);
                this.setState("locator.patchSize", this.state.locator.patchSize);
            } else if (this.avgFPS > 20 && this.currentPatchSizeIndex > 0) {
                // If FPS is good, try increasing patchSize for better accuracy
                this.currentPatchSizeIndex--;
                this.state.locator.patchSize = this.patchSizes[this.currentPatchSizeIndex];
                console.log("Increasing patchSize to:", this.state.locator.patchSize);
                this.setState("locator.patchSize", this.state.locator.patchSize);
            }
        },
        // Periodic performance checks
        performPerformanceChecks: function () {
            // Call adjustPatchSize based on current performance metrics
            this.adjustPatchSize();
        },
        // Frame Skipping based on frequency
        performFrameSkipping: function () {
            // Implement frame skipping based on frequency
            this.frameSkipCounter = (this.frameSkipCounter || 0) + 1;
            if (this.frameSkipCounter >= this.state.frequency) {
                this.frameSkipCounter = 0;
                return true; // Process this frame
            }
            return false; // Skip this frame
        },
    };

    // Initialize the application
    App.init();

    // Define inputMapper and state outside the App object to prevent duplication
    App.inputMapper = {
        inputStream: {
            constraints: {
                width: function (value) {
                    return { min: parseInt(value) };
                },
                height: function (value) {
                    return { min: parseInt(value) };
                },
                deviceId: function (value) {
                    return value;
                },
            },
        },
        numOfWorkers: function (value) {
            return parseInt(value);
        },
        decoder: {
            readers: function (value) {
                if (value === "ean_extended") {
                    return [
                        {
                            format: "ean_reader",
                            config: {
                                supplements: ["ean_5_reader", "ean_2_reader"],
                            },
                        },
                    ];
                }
                return [
                    {
                        format: value + "_reader",
                        config: {},
                    },
                ];
            },
        },
        locator: {
            patchSize: function (value) {
                return value;
            },
            halfSample: function (value) {
                return (value === 'true' || value === true);
            },
        },
    };

    App.state = {
        inputStream: {
            type: "LiveStream",
            constraints: {
                width: { min: 1280 }, // Optimized resolution
                height: { min: 720 }, // Optimized resolution
                facingMode: "environment",
                aspectRatio: { min: 1, max: 2 },
                deviceId: null, // Ensure deviceId is included
            },
            area: { // defines rectangle of the detection/localization area
                top: "25%",    // Adjusted top offset
                right: "15%",  // Adjusted right offset
                left: "15%",   // Adjusted left offset
                bottom: "25%"  // Adjusted bottom offset
            },
            target: document.querySelector("#interactive"),
        },
        locator: {
            patchSize: "medium", // Optimized patch size
            halfSample: false, // Disabled half-sample for better accuracy
        },
        numOfWorkers: 4, // Optimized workers count
        decoder: {
            readers: [
                { format: "upc_reader", config: {} }, // Only UPC readers
                { format: "upc_e_reader", config: {} },
            ],
        },
        locate: true,
        frequency: 10, // Process every 10 frames
    };
});
