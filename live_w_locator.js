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
            // We no longer initialize Quagga here
            this.attachListeners();
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
            var streamLabel = Quagga.CameraAccess.getActiveStreamLabel();

            return Quagga.CameraAccess.enumerateVideoDevices().then(function (devices) {
                var deviceSelection = document.getElementById("deviceSelection");
                while (deviceSelection.firstChild) {
                    deviceSelection.removeChild(deviceSelection.firstChild);
                }
                devices.forEach(function (device) {
                    var option = document.createElement("option");
                    option.value = device.deviceId || device.id;
                    option.text = device.label || device.deviceId || device.id;
                    option.selected = streamLabel === device.label;
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
        detachListeners: function () {
            document.querySelector(".controls button.start").removeEventListener("click");
            document.querySelector(".controls button.stop").removeEventListener("click");
            document.querySelector(".controls .reader-config-group").removeEventListener("change");
        },
        applySetting: function (setting, value) {
            var track = Quagga.CameraAccess.getActiveTrack();
            if (track && typeof track.getCapabilities === "function") {
                var constraints = {};
                constraints[setting] = setting === "torch" ? !!value : parseFloat(value);
                track.applyConstraints({ advanced: [constraints] });
            }
        },
        setState: function (path, value) {
            var self = this;
            var parts = path.split('.');
            var target = self.state;
            while (parts.length > 1) {
                var part = parts.shift();
                if (typeof target[part] !== 'object') {
                    target[part] = {};
                }
                target = target[part];
            }
            var lastPart = parts.shift();
            target[lastPart] = value;

            // If Quagga is running, we need to restart it with the new configuration
            if (Quagga.initialized) {
                self.stopScanner();
                self.startScanner();
            }
        },
        inputMapper: {
            inputStream: {
                constraints: function (value) {
                    if (/^(\d+)x(\d+)$/.test(value)) {
                        var values = value.split("x");
                        return {
                            width: { min: parseInt(values[0]) },
                            height: { min: parseInt(values[1]) },
                        };
                    }
                    return {};
                },
                constraints_deviceId: function (value) {
                    return {
                        deviceId: value,
                    };
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
        lastResult: null,
        startScanner: function () {
            var self = this;
            if (Quagga.initialized) {
                // Quagga is already initialized and running
                return;
            }
            Quagga.init(self.state, function (err) {
                if (err) {
                    self.handleError(err);
                    return;
                }
                Quagga.start();
                self.initCameraSelection();
                self.checkCapabilities();
                Quagga.onProcessed(self.onProcessed);
                Quagga.onDetected(self.onDetected);
            });
        },
        stopScanner: function () {
            var self = this;
            if (Quagga.initialized) {
                Quagga.stop();
                Quagga.offProcessed(self.onProcessed);
                Quagga.offDetected(self.onDetected);
                Quagga.initialized = false;
                self._printCollectedResults();
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

            if (App.lastResult !== code) {
                App.lastResult = code;
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
    };

    App.init();
});
