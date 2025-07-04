function handler(event) {
    var request = event.request;
    var originalImagePath = request.uri;
    //  validate, process and normalize the requested operations in query parameters

    //the coming url would be like /image.jpeg?f=auto&w=200&h=200&q=80

    var normalizedOperations = {};
    if (request.querystring) {
        Object.keys(request.querystring).forEach(operation => {
            switch (operation.toLowerCase()) {
                case 'f': 
                    var SUPPORTED_FORMATS = ['auto', 'jpeg', 'webp', 'avif', 'png', 'svg', 'gif'];
                    if (request.querystring[operation]['value'] && SUPPORTED_FORMATS.includes(request.querystring[operation]['value'].toLowerCase())) {
                        var format = request.querystring[operation]['value'].toLowerCase(); // normalize to lowercase
                        if (format === 'auto') {
                            format = 'jpeg';
                            if (request.headers['accept']) {
                                if (request.headers['accept'].value.includes("avif")) {
                                    format = 'avif';
                                } else if (request.headers['accept'].value.includes("webp")) {
                                    format = 'webp';
                                } 
                            }
                        }
                        normalizedOperations['format'] = format;
                    }
                    break;
                case 'w':
                    if (request.querystring[operation]['value']) {
                        var width = parseInt(request.querystring[operation]['value']);
                        if (!isNaN(width) && (width > 0)) {
                            // you can protect the Lambda function by setting a max value, e.g. if (width > 3840) width = 3840;
                            width = Math.min(width, 3840);
                            normalizedOperations['width'] = width.toString();
                        }
                    }
                    break;
                case 'h':
                    if (request.querystring[operation]['value']) {
                        var height = parseInt(request.querystring[operation]['value']);
                        if (!isNaN(height) && (height > 0)) {
                            // you can protect the Lambda function by setting a max value, e.g. if (height > 2160) height = 2160;
                            height= Math.min(height, 2160);
                            normalizedOperations['height'] = height.toString();
                        }
                    }
                    break;
                case 'q':
                    if (request.querystring[operation]['value']) {
                        var quality = parseInt(request.querystring[operation]['value']);
                        if (!isNaN(quality) && (quality > 0)) {
                            if (quality > 100) quality = 100;
                            normalizedOperations['quality'] = quality.toString();
                        }
                    }
                    break;
                default: break;
            }
        });

        // console.log('normalizedOperations', normalizedOperations);
        //rewrite the path to normalized version if valid operations are found
        if (Object.keys(normalizedOperations).length > 0) {
            // put them in order
            var normalizedOperationsArray = [];
            if (normalizedOperations.format) normalizedOperationsArray.push('format='+normalizedOperations.format);
            if (normalizedOperations.quality) normalizedOperationsArray.push('quality='+normalizedOperations.quality);
            if (normalizedOperations.width) normalizedOperationsArray.push('width='+normalizedOperations.width);
            if (normalizedOperations.height) normalizedOperationsArray.push('height='+normalizedOperations.height);
            request.uri = originalImagePath + '/' + normalizedOperationsArray.join(',');     
        } else {
            // If no valid operation is found, flag the request with /original path suffix
            request.uri = originalImagePath + '/original';     
        }

    } else {
        // If no query strings are found, flag the request with /original path suffix
        request.uri = originalImagePath + '/original'; 
    }
    // remove query strings
    request['querystring'] = {};
    return request;
}
