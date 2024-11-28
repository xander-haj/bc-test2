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
            if (typeof track.getCapabilities === "function") {
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
                while (deviceSelection.firstChild) {
                    deviceSelection.removeChild(deviceSelection.firstChild);
                }
                devices.forEach(function (device) {
                    var option = document.createElement("option");
                    option.value = device.deviceId || device.id;
                    option.text = device.label || device.deviceId || device.id;
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
                mappedValue = mapping[lastPart](value);
            }

            // Preserve existing properties
            if (typeof mappedValue === 'object' && !Array.isArray(mappedValue)) {
                target[lastPart] = Object.assign({}, target[lastPart], mappedValue);
            } else {
                target[lastPart] = mappedValue;
            }

            var needsRestart = false;

            // Determine if the change requires a restart
            if (path.startsWith('inputStream') || path.startsWith('decoder')) {
                needsRestart = true;
            }

            if (needsRestart) {
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
                // Apply settings without restarting
                if (path.startsWith('locator')) {
                    Quagga.setLocatorSettings(self.state.locator);
                }
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
            if (Quagga.initialized) {
                try {
                    Quagga.stop(); // Stops the scanner and video processing
                    await Quagga.CameraAccess.release(); // Waits for the camera to be released
                    Quagga.offProcessed(self.onProcessed); // Removes the processed event listener
                    Quagga.offDetected(self.onDetected); // Removes the detected event listener
                    Quagga.initialized = false; // Sets the initialized flag to false

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

                    // Do not remove other child nodes (like #boundingBox)

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
            return new Promise(function (resolve, reject) {
                Quagga.init(self.state, function (err) {
                    if (err) {
                        self.handleError(err);
                        reject(err);
                        return;
                    }
                    Quagga.start();
                    Quagga.initialized = true; // Set initialized to true
                    self.initCameraSelection();
                    self.checkCapabilities();
                    Quagga.onProcessed(self.onProcessed.bind(self));
                    Quagga.onDetected(self.onDetected.bind(self));

                    // Ensure the bounding box is present
                    var interactive = document.querySelector('#interactive');
                    var boundingBox = document.querySelector('#boundingBox');
                    if (!boundingBox) {
                        // If bounding box is missing, create and append it
                        boundingBox = document.createElement('div');
                        boundingBox.id = 'boundingBox';
                        interactive.appendChild(boundingBox);
                    }

                    resolve();
                });
            });
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
        inputMapper: {
            inputStream: {
                constraints: {
                    width: function (value) {
                        return { width: { min: parseInt(value) } };
                    },
                    height: function (value) {
                        return { height: { min: parseInt(value) } };
                    },
                    deviceId: function (value) {
                        // Return the value directly
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
                    return value;
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
                readers: [{ format: "code_128_reader", config: {} }],
            },
            locate: true,
        },
    };

    App.init();
});
