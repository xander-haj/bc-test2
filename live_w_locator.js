$(function () {
    var resultCollector = Quagga.ResultCollector.create({
        capture: true,
        capacity: 20,
        blacklist: [
            { code: "WIWV8ETQZ1", format: "code_93" },
            { code: "EH3C-%GU23RK3", format: "code_93" },
            { code: "O308SIHQOXN5SA/PJ", format: "code_93" },
            { code: "DG7Q$TV8JQ/EN", format: "code_93" },
            { code: "VOFD1DB5A.1F6QU", format: "code_93" },
            { code: "4SO64P4X8 U4YUU1T-", format: "code_93" }
        ],
        filter: function (codeResult) {
            return true;
        }
    });

    var App = {
        init: function () {
            var self = this;

            // Check for camera access permissions
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                navigator.mediaDevices
                    .getUserMedia({ video: { facingMode: "environment" } })
                    .then(function (stream) {
                        // Initialize Quagga after permissions are granted
                        Quagga.init(self.state, function (err) {
                            if (err) {
                                return self.handleError(err);
                            }
                            App.attachListeners();
                            App.checkCapabilities();
                            Quagga.start();
                        });
                    })
                    .catch(function (err) {
                        // Handle permission denial or errors
                        console.error("Camera access denied or unavailable:", err);
                        alert(
                            "Camera access is required to use the barcode scanner. Please enable camera permissions."
                        );
                    });
            } else {
                alert(
                    "Your browser does not support the required Camera API. Please update to a modern browser."
                );
            }
        },
        handleError: function (err) {
            console.log(err);
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
            console.log("updateOptionsForMediaRange", node, range);
            var NUM_STEPS = 6;
            var stepSize = (range.max - range.min) / NUM_STEPS;
            var option;
            var value;
            while (node.firstChild) {
                node.removeChild(node.firstChild);
            }
            for (var i = 0; i <= NUM_STEPS; i++) {
                value = range.min + stepSize * i;
                option = document.createElement("option");
                option.value = value;
                option.innerHTML = value;
                node.appendChild(option);
            }
        },
        applySettingsVisibility: function (setting, capability) {
            if (typeof capability === "boolean") {
                var node = document.querySelector(
                    'input[name="settings_' + setting + '"]'
                );
                if (node) {
                    node.parentNode.style.display = capability
                        ? "block"
                        : "none";
                }
                return;
            }
            if (window.MediaSettingsRange && capability instanceof window.MediaSettingsRange) {
                var node = document.querySelector(
                    'select[name="settings_' + setting + '"]'
                );
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
                function pruneText(text) {
                    return text.length > 30 ? text.substr(0, 30) : text;
                }
                var $deviceSelection = document.getElementById("deviceSelection");
                while ($deviceSelection.firstChild) {
                    $deviceSelection.removeChild($deviceSelection.firstChild);
                }
                devices.forEach(function (device) {
                    var $option = document.createElement("option");
                    $option.value = device.deviceId || device.id;
                    $option.appendChild(
                        document.createTextNode(pruneText(device.label || device.deviceId || device.id))
                    );
                    $option.selected = streamLabel === device.label;
                    $deviceSelection.appendChild($option);
                });
            });
        },
        attachListeners: function () {
            var self = this;

            self.initCameraSelection();
            $(".controls").on("click", "button.stop", function (e) {
                e.preventDefault();
                Quagga.stop();
                self._printCollectedResults();
            });

            $(".controls .reader-config-group").on(
                "change",
                "input, select",
                function (e) {
                    e.preventDefault();
                    var $target = $(e.target),
                        value =
                            $target.attr("type") === "checkbox"
                                ? $target.prop("checked")
                                : $target.val(),
                        name = $target.attr("name"),
                        state = self._convertNameToState(name);

                    console.log("Value of " + state + " changed to " + value);
                    self.setState(state, value);
                }
            );
        },
        _printCollectedResults: function () {
            var results = resultCollector.getResults(),
                $ul = $("#result_strip ul.collector");

            results.forEach(function (result) {
                var $li = $(
                    '<li><div class="thumbnail"><div class="imgWrapper"><img /></div><div class="caption"><h4 class="code"></h4></div></div></li>'
                );

                $li.find("img").attr("src", result.frame);
                $li.find("h4.code").html(
                    result.codeResult.code + " (" + result.codeResult.format + ")"
                );
                $ul.prepend($li);
            });
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
            },
            locator: {
                patchSize: "medium",
                halfSample: true,
            },
            numOfWorkers: 2,
            frequency: 10,
            decoder: {
                readers: [{ format: "code_128_reader", config: {} }],
            },
            locate: true,
        },
        lastResult: null,
    };

    App.init();

    Quagga.onProcessed(function (result) {
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
    });

    Quagga.onDetected(function (result) {
        var code = result.codeResult.code;

        if (App.lastResult !== code) {
            App.lastResult = code;
            var $node = null,
                canvas = Quagga.canvas.dom.image;

            $node = $(
                '<li><div class="thumbnail"><div class="imgWrapper"><img /></div><div class="caption"><h4 class="code"></h4></div></div></li>'
            );
            $node.find("img").attr("src", canvas.toDataURL());
            $node.find("h4.code").html(code);
            $("#result_strip ul.thumbnails").prepend($node);
        }
    });
});
