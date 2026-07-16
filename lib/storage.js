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

        var key = post.name || post.id;
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
    if (storage.before !== null && typeof storage.before !== 'string') {
        throw new Error('storage.before must be a string or null');
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
