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

var getPostNameId = function(name) {
    if (typeof name !== 'string') {
        return null;
    }

    var match = /^t3_([0-9a-z]+)$/i.exec(name);
    if (!match) {
        return null;
    }

    return match[1].toLowerCase().replace(/^0+(?=.)/, '');
};

var compareBase36Ids = function(first, second) {
    if (first.length !== second.length) {
        return first.length < second.length ? -1 : 1;
    }
    if (first === second) {
        return 0;
    }
    return first < second ? -1 : 1;
};

var getFallbackBefores = function(postsBySubreddit, currentBefore) {
    var currentId = getPostNameId(currentBefore);
    if (!currentId || !postsBySubreddit || typeof postsBySubreddit !== 'object') {
        return [];
    }

    var seenNames = {};
    var candidates = [];
    Object.keys(postsBySubreddit).forEach(function(subreddit) {
        var posts = postsBySubreddit[subreddit];
        if (!Array.isArray(posts)) {
            return;
        }

        posts.forEach(function(post) {
            var name = post && post.name;
            var id = getPostNameId(name);
            var normalizedName = typeof name === 'string' ? name.toLowerCase() : null;
            if (!id || compareBase36Ids(id, currentId) >= 0 || seenNames[normalizedName]) {
                return;
            }

            seenNames[normalizedName] = true;
            candidates.push({'name': name, 'id': id});
        });
    });

    candidates.sort(function(first, second) {
        return compareBase36Ids(second.id, first.id);
    });
    return candidates.map(function(candidate) {
        return candidate.name;
    });
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
    'getFallbackBefores': getFallbackBefores,
    'sortAndLimitPosts': sortAndLimitPosts,
    'requireCurrentStorage': requireCurrentStorage
};
