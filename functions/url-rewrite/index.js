var DEBUG = false;

function log(value) {
    if (DEBUG) {
        console.log(value);
    }
}
function stripTrailingSlash(path) {
    return path.endsWith("/") ? path.slice(0, -1) : path;
}

function parseOptions(querystring, headers) {
    //?ops=f_auto,w_200,h_200,q_80 would make the querystring object in
    // cloudfront request like {querystring: {ops: {value: "f_auto,w_200,h_200,q_80"}}} and header:{accept:{value:"image/webp"}}
    var opsValue = "";
    var headerAcceptValue = "";
    var SUPPORTED_FORMATS = ["auto", "jpeg", "jpg", "webp", "avif", "png", "svg"];

    //   log("parsing options: " + JSON.stringify(querystring));
    if (querystring && querystring.ops && querystring.ops.value) {
        opsValue = querystring.ops.value;
    }
    //   log("opsValue: " + opsValue);
    if (!opsValue) {
        // log("no ops value");
        return {};
    }
    var opsArray = opsValue.split(","); //["f_auto", "w_200", "h_200", "q_80"]
    var options = {
        format: null,
        quality: null,
        width: null,
        height: null,
    };
    for (var i = 0; i < opsArray.length; i++) {
        var kv = opsArray[i].split("_"); //["f", "auto"]
        if (kv.length !== 2) continue;
        var key = (kv[0] || "").trim().toLowerCase();
        var val = (kv[1] || "").trim().toLowerCase();

        if (!key || !val) {
            continue;
        }

        if (key === "f") {
            var f_value = val;
            if (SUPPORTED_FORMATS.indexOf(f_value) !== -1) {
                if (f_value === "auto") {
                    options.format = "jpeg";
                    headerAcceptValue =
                        headers && headers.accept && headers.accept.value
                            ? headers.accept.value
                            : "";
                    //   log("header: " + JSON.stringify(headers));
                    if (headerAcceptValue) {
                        // log("header-accept-value" + JSON.stringify(headerAcceptValue));
                        if (headerAcceptValue.includes("avif")) {
                            options.format = "avif";
                        } else if (headerAcceptValue.includes("webp")) {
                            options.format = "webp";
                        }
                    }
                }
                else {
                    options.format = f_value;
                }
            }
        }
        if (key === "w") {
            var w_value = parseInt(val);
            if (!isNaN(w_value) && w_value > 0 && w_value <= 3840) {
                options.width = w_value;
            }
        }
        if (key === "h") {
            var h_value = parseInt(val);
            if (!isNaN(h_value) && h_value > 0 && h_value <= 2160) {
                options.height = h_value;
            }
        }
        if (key === "q") {
            var q_value = parseInt(val);
            if (!isNaN(q_value) && q_value >= 30 && q_value <= 100) {
                options.quality = q_value;
            }
        }
    }
    //   log("parsed options: " + JSON.stringify(options));
    //{"format": "webp"/null, "quality": "80"/null, "width": "200"/null, "height": "200"/null}
    return options;
}


function buildNormalizedPath(path, options) {
    var normalizedArray = [];
    if (options.format) {
        normalizedArray.push("format" + "=" + options.format);
    }
    if (options.quality) {
        normalizedArray.push("quality" + "=" + options.quality);
    }
    if (options.width) {
        normalizedArray.push("width" + "=" + options.width);
    }
    if (options.height) {
        normalizedArray.push("height" + "=" + options.height);
    }
    var lastJoinedPath = normalizedArray.length
        ? `/${normalizedArray.join(",")}`
        : "/original";
    // log("lastJoinedPath: " + lastJoinedPath);
    return path + lastJoinedPath;
}

function normalizePath(request) {
    // console.time("normalizePath");
    var path = request.uri.trim(); //trim the path to remove any leading or trailing spaces
    path = stripTrailingSlash(path);
    //   log("request: " + JSON.stringify(request));
    var normalizedOptions = parseOptions(request.querystring, request.headers);
    var normalizedPath = buildNormalizedPath(path, normalizedOptions);

    // console.timeEnd("normalizePath");
    return normalizedPath;
}

function handler(event) {
    var request = event.request;
    var normalized = normalizePath(request);
    request.uri = normalized;

    request["querystring"] = {};
    return request;
}