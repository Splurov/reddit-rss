'use strict';

var POSTS_PER_SUBREDDIT = 250;

var normalizeSubreddit = function(name) {
    if (typeof name !== 'string') {
        return null;
    }

    var normalized = name.trim().replace(/^r\//i, '').toLowerCase();
    return normalized || null;
};

var isSafeSubredditName = function(name) {
    return /^[a-z0-9_]+$/.test(name);
};

var getPostTimestamp = function(post) {
    var timestamp = Number(post && post.created_utc);
    return isFinite(timestamp) ? timestamp : 0;
};

var sortAndLimitPosts = function(posts) {
    var postIndexes = {};
    var uniquePosts = [];
    posts.forEach(function(post) {
        if (!post || typeof post !== 'object') {
            return;
        }

        var key = post.name || (post.id && 't3_' + post.id);
        if (key) {
            key = '$' + key;
            if (Object.prototype.hasOwnProperty.call(postIndexes, key)) {
                uniquePosts[postIndexes[key]] = post;
                return;
            }
            postIndexes[key] = uniquePosts.length;
        }
        uniquePosts.push(post);
    });

    uniquePosts.sort(function(a, b) {
        return getPostTimestamp(a) - getPostTimestamp(b);
    });

    return uniquePosts.slice(-POSTS_PER_SUBREDDIT);
};

var requireCurrentStorage = function(storage) {
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
        throw new Error('storage.json must contain an object');
    }
    if (Array.isArray(storage.posts) || !storage.posts || typeof storage.posts !== 'object') {
        throw new Error('storage.posts must be an object keyed by subreddit name');
    }
    if (storage.processedThrough === undefined) {
        storage.processedThrough = null;
    }
    if (storage.processedThrough !== null &&
        (typeof storage.processedThrough !== 'number' || !isFinite(storage.processedThrough) || storage.processedThrough < 0)) {
        throw new Error('storage.processedThrough must be a non-negative number or null');
    }
    if (storage.pendingScan === undefined) {
        storage.pendingScan = null;
    }
    if (storage.pendingScan !== null) {
        var pendingScan = storage.pendingScan;
        if (!pendingScan || typeof pendingScan !== 'object' || Array.isArray(pendingScan)) {
            throw new Error('storage.pendingScan must be an object or null');
        }
        if (typeof pendingScan.after !== 'string' || !pendingScan.after) {
            throw new Error('storage.pendingScan.after must be a non-empty string');
        }
        if (typeof pendingScan.scanFrom !== 'number' || !isFinite(pendingScan.scanFrom) || pendingScan.scanFrom < 0) {
            throw new Error('storage.pendingScan.scanFrom must be a non-negative number');
        }
        if (typeof pendingScan.targetProcessedThrough !== 'number' ||
            !isFinite(pendingScan.targetProcessedThrough) || pendingScan.targetProcessedThrough < 0) {
            throw new Error('storage.pendingScan.targetProcessedThrough must be a non-negative number');
        }
        if (storage.processedThrough === null ||
            pendingScan.scanFrom > storage.processedThrough ||
            pendingScan.targetProcessedThrough < storage.processedThrough) {
            throw new Error('storage.pendingScan has inconsistent time boundaries');
        }
    }

    return storage;
};

module.exports = {
    'normalizeSubreddit': normalizeSubreddit,
    'isSafeSubredditName': isSafeSubredditName,
    'getPostTimestamp': getPostTimestamp,
    'sortAndLimitPosts': sortAndLimitPosts,
    'requireCurrentStorage': requireCurrentStorage
};
