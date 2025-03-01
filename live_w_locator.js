document.addEventListener('DOMContentLoaded', function () {
    // Initialize Result Collector
    var resultCollector = Quagga.ResultCollector.create({
        capture: true,
        capacity: 20,
        blacklist: [],
        filter: function (codeResult) {
            return true;
        }
    });

    // Register Result Collector with Quagga
    Quagga.registerResultCollector(resultCollector);

    var App = {
        init: function () {
            this.lastResult = null;
            this.scannerRunning = false;
            this.selectedDeviceId = null; // Property to keep track of the selected deviceId
            this.attachListeners();
            // Do not initialize camera selection on load to avoid permissions issues
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
        /**
         * Initialize Camera Selection with Optional Selected Device ID
         * @param {string|null} selectedDeviceId - The deviceId to be selected in the dropdown
         * @returns {Promise<string|null>} - The selectedDeviceId
         */
        initCameraSelection: async function (selectedDeviceId) {
            var self = this;
            try {
                const devices = await Quagga.CameraAccess.enumerateVideoDevices();
                var deviceSelection = document.getElementById("deviceSelection");
                // Clear existing options
                while (deviceSelection.firstChild) {
                    deviceSelection.removeChild(deviceSelection.firstChild);
                }
                if (devices.length === 0) {
                    var option = document.createElement("option");
                    option.value = "";
                    option.text = "No camera devices found";
                    deviceSelection.appendChild(option);
                    deviceSelection.disabled = true;
                    return null;
                }

                let hasValidDevice = false;
                devices.forEach(function (device, index) {
                    if (!device.deviceId || device.deviceId.trim() === "") {
                        console.warn(`Device at index ${index} has no valid deviceId and will be skipped.`);
                        return;
                    }
                    var option = document.createElement("option");
                    option.value = device.deviceId;
                    option.text = device.label || `Camera ${index + 1}`;
                    if (device.deviceId === selectedDeviceId) { // Set selected device
                        option.selected = true;
                        hasValidDevice = true;
                    }
                    deviceSelection.appendChild(option);
                });

                if (!hasValidDevice) {
                    // Set to first device
                    const firstDevice = devices.find(device => device.deviceId && device.deviceId.trim() !== "");
                    if (firstDevice) {
                        self.selectedDeviceId = firstDevice.deviceId;
                        deviceSelection.value = self.selectedDeviceId;
                        console.log(`Selected deviceId set to: ${self.selectedDeviceId}`);
                    }
                }

                deviceSelection.disabled = false;
                return self.selectedDeviceId;
            } catch (err) {
                console.error("Error enumerating video devices:", err);
                alert("Error accessing camera devices. Please ensure you have granted camera permissions.");
                return null;
            }
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
                        if (value) {
                            self.selectedDeviceId = value; // Update the selectedDeviceId
                            self.setState("inputStream.constraints.deviceId", { exact: value });
                        }
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
        /**
         * Set State Function
         * @param {string} path - The state path to update
         * @param {any} value - The value to set
         */
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
                    Quagga.offProcessed(self.onProcessed); // Removes the processed event listener
                    Quagga.offDetected(self.onDetected); // Removes the detected event listener
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

                    self._printCollectedResults(); // Display collected results

                } catch (error) {
                    console.error("Error releasing camera:", error);
                    throw error;
                }
            }
        },
        /**
         * Start Scanner Function
         */
        startScanner: async function () {
            var self = this;

            self.disableControls(true); // Disable controls while initializing

            try {
                // First, enumerate and initialize camera selection
                const selectedDeviceId = await self.initCameraSelection(self.selectedDeviceId);

                if (!selectedDeviceId) {
                    throw new Error("No camera device selected.");
                }

                // Update the state with the selected deviceId
                self.state.inputStream.constraints.deviceId = { exact: selectedDeviceId };

                // Initialize and start QuaggaJS
                Quagga.init(self.state, function (err) {
                    if (err) {
                        self.handleError(err);
                        self.disableControls(false);
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

                    // Ensure the code overlay is present
                    var codeOverlay = document.getElementById('codeOverlay');
                    if (!codeOverlay) {
                        codeOverlay = document.createElement('div');
                        codeOverlay.id = 'codeOverlay';
                        // Styling is handled in CSS
                        interactive.appendChild(codeOverlay);
                    }

                    self.disableControls(false); // Re-enable controls after initialization
                });

            } catch (error) {
                console.error("Error starting scanner:", error);
                self.handleError(error);
                self.disableControls(false);
            }
        },
        onProcessed: function (result) {
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
        },
        onDetected: function (result) {
            var code = result.codeResult.code;

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

            // Push the result to the resultCollector
            resultCollector.collect(result);
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
        inputMapper: {
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
        },
        state: {
            inputStream: {
                type: "LiveStream",
                constraints: {
                    width: { min: 640 },
                    height: { min: 480 },
                    facingMode: "environment",
                    aspectRatio: { min: 1, max: 2 },
                    deviceId: null, // Will be set dynamically
                },
                area: { // defines rectangle of the detection/localization area
                    top: "35%",    // top offset
                    right: "20%",  // right offset
                    left: "20%",   // left offset
                    bottom: "35%"  // bottom offset
                },
                target: document.querySelector("#interactive"),
            },
            locator: {
                patchSize: "medium",
                halfSample: true,
            },
            numOfWorkers: 4,
            decoder: {
                readers: [
                    { format: "code_128_reader", config: {} }, 
                    { format: "upc_reader", config: {} },
                    { format: "upc_e_reader", config: {} },
                ],
            },
            locate: true,
        },
    };

    App.init();
});
