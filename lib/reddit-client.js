'use strict';

var https = require('https');
var querystring = require('querystring');

var TOKEN_EXPIRY_MARGIN = 60000;
var REQUEST_TIMEOUT = 30000;

var makeError = function(message, statusCode, responseBody) {
    var error = new Error(message);
    error.statusCode = statusCode;
    error.responseBody = responseBody;
    return error;
};

var parseJson = function(response) {
    var body = response.body || '';
    var json;

    try {
        json = JSON.parse(body);
    } catch (error) {
        throw makeError('Reddit returned invalid JSON', response.statusCode, body);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw makeError('Reddit request failed with HTTP ' + response.statusCode, response.statusCode, body);
    }

    return json;
};

var performRequest = function(options) {
    return new Promise(function(resolve, reject) {
        var request = https.request(options, function(response) {
            var chunks = [];

            response.setEncoding('utf8');
            response.on('data', function(chunk) {
                chunks.push(chunk);
            });
            response.on('end', function() {
                resolve({
                    'statusCode': response.statusCode,
                    'body': chunks.join('')
                });
            });
        });

        request.setTimeout(REQUEST_TIMEOUT, function() {
            request.abort();
            reject(makeError('Reddit request timed out after ' + REQUEST_TIMEOUT + 'ms'));
        });
        request.on('error', reject);

        if (options.body) {
            request.write(options.body);
        }
        request.end();
    });
};

var makePath = function(pathname, params) {
    var query = querystring.stringify(params || {});
    return query ? pathname + '?' + query : pathname;
};

var RedditClient = function(options) {
    if (!options || !options.userAgent || !options.clientId || !options.clientSecret || !options.username || !options.password) {
        throw new Error('Reddit client requires userAgent, clientId, clientSecret, username and password');
    }

    this.userAgent = options.userAgent;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.username = options.username;
    this.password = options.password;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.logDebug = options.logDebug || function() {};
    this._request = performRequest;
};

RedditClient.prototype._performRequest = function(options) {
    this.logDebug('Request URL {url: https://' + options.hostname + options.path + '}');
    return this._request(options);
};

RedditClient.prototype._getAccessToken = function() {
    var client = this;
    if (client.accessToken && client.accessTokenExpiresAt > Date.now() + TOKEN_EXPIRY_MARGIN) {
        return Promise.resolve(client.accessToken);
    }

    var body = querystring.stringify({
        'grant_type': 'password',
        'username': client.username,
        'password': client.password
    });

    return client._performRequest({
        'hostname': 'www.reddit.com',
        'method': 'POST',
        'path': '/api/v1/access_token',
        'headers': {
            'Authorization': 'Basic ' + Buffer.from(client.clientId + ':' + client.clientSecret).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
            'User-Agent': client.userAgent
        },
        'body': body
    }).then(parseJson).then(function(response) {
        if (!response.access_token || !response.expires_in) {
            throw makeError('Reddit did not return an access token');
        }

        client.accessToken = response.access_token;
        client.accessTokenExpiresAt = Date.now() + (Number(response.expires_in) * 1000);
        return client.accessToken;
    });
};

RedditClient.prototype._authenticatedGet = function(pathname, params, retriedAfterUnauthorized) {
    var client = this;

    return client._getAccessToken().then(function(token) {
        return client._performRequest({
            'hostname': 'oauth.reddit.com',
            'method': 'GET',
            'path': makePath(pathname, params),
            'headers': {
                'Authorization': 'Bearer ' + token,
                'User-Agent': client.userAgent
            }
        }).then(parseJson).catch(function(error) {
            if (error.statusCode === 401 && !retriedAfterUnauthorized) {
                client.accessToken = null;
                client.accessTokenExpiresAt = 0;
                return client._authenticatedGet(pathname, params, true);
            }

            throw error;
        });
    });
};

RedditClient.prototype._getListing = function(pathname, params) {
    return this._authenticatedGet(pathname, params, false).then(function(response) {
        if (!response || !response.data || !Array.isArray(response.data.children)) {
            throw makeError('Reddit returned an invalid listing response');
        }

        return response.data.children.map(function(child) {
            return child.data;
        });
    });
};

RedditClient.prototype.getSubscriptions = function(params) {
    return this._getListing('/subreddits/mine/subscriber', params);
};

RedditClient.prototype.getNew = function(params) {
    return this._getListing('/new', params);
};

module.exports = RedditClient;
