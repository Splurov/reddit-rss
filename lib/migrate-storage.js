'use strict';

var storageUtils = require('./storage');

var migrateLegacyStorage = function(storage) {
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
        throw new Error('storage.json must contain an object');
    }

    if (storage.posts && !Array.isArray(storage.posts)) {
        return {
            'migrated': false,
            'storage': storage
        };
    }

    var postsBySubreddit = {};
    (storage.posts || []).forEach(function(post) {
        var subreddit = storageUtils.normalizeSubreddit(post && post.subreddit);
        if (!subreddit || !storageUtils.isSafeSubredditName(subreddit) || !post || typeof post !== 'object') {
            return;
        }

        if (!postsBySubreddit[subreddit]) {
            postsBySubreddit[subreddit] = [];
        }
        postsBySubreddit[subreddit].push(post);
    });

    Object.keys(postsBySubreddit).forEach(function(subreddit) {
        postsBySubreddit[subreddit] = storageUtils.sortAndLimitPosts(postsBySubreddit[subreddit]);
    });

    return {
        'migrated': true,
        'storage': Object.assign({}, storage, {
            'before': typeof storage.before === 'string' ? storage.before : null,
            'posts': postsBySubreddit
        })
    };
};

module.exports = migrateLegacyStorage;
