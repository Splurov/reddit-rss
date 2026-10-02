'use strict';

var storageUtils = require('./storage');
var subredditRules = require('./subreddit-rules');
var normalizeSubreddit = storageUtils.normalizeSubreddit;

var getPostKey = function(post) {
    return post && (post.name || (post.id && 't3_' + post.id));
};

var getRejectionReason = function(post, subscriptionsByKey, options) {
    var subreddit = normalizeSubreddit(post.subreddit);
    var subscription = subreddit && subscriptionsByKey[subreddit];
    if (!subscription) {
        return 'notSubscribed';
    }
    if (options.blacklistRe && options.blacklistRe.test(post.title || '')) {
        return 'blacklisted';
    }
    if (post.selftext === '[deleted]') {
        return 'deleted';
    }

    var rules = subredditRules.getForSubreddit(options.rulesForSubs, subreddit, {
        'minScore': options.minScore[subscription.popularityGroup],
        'minComments': options.minComments[subscription.popularityGroup]
    });
    if (subredditRules.isExcludedLinkFlair(post, rules)) {
        return 'excludedLinkFlair';
    }
    if (post.score <= 0) {
        return 'nonPositiveScore';
    }
    if (post.score >= rules.minScore || post.num_comments >= rules.minComments) {
        return null;
    }
    return 'belowThreshold';
};

var storeNewPosts = function(storage, posts, subscriptionsByKey, options) {
    var storedPostsByKey = Object.create(null);
    var candidatesByKey = Object.create(null);
    var incomingPostKeys = Object.create(null);
    var crossposts = [];
    var stats = {
        'accepted': 0,
        'added': 0,
        'refreshed': 0,
        'notSubscribed': 0,
        'blacklisted': 0,
        'deleted': 0,
        'excludedLinkFlair': 0,
        'nonPositiveScore': 0,
        'belowThreshold': 0
    };

    var rememberCandidate = function(post) {
        var key = getPostKey(post);
        if (key) {
            candidatesByKey[key] = post;
        }
        if (post && post.crosspost_parent_list && post.crosspost_parent_list.length > 0) {
            crossposts.push(post);
        }
    };

    Object.keys(storage.posts).forEach(function(subreddit) {
        if (!Array.isArray(storage.posts[subreddit])) {
            return;
        }
        storage.posts[subreddit].forEach(function(post) {
            var key = getPostKey(post);
            if (key) {
                storedPostsByKey[key] = post;
            }
            rememberCandidate(post);
        });
    });
    posts.forEach(function(post) {
        rememberCandidate(post);
        var key = getPostKey(post);
        if (key) {
            incomingPostKeys[key] = true;
        }
    });

    var storePost = function(post) {
        var subreddit = normalizeSubreddit(post.subreddit);
        var key = getPostKey(post);
        if (key && storedPostsByKey[key] === post) {
            return;
        }
        if (!storage.posts[subreddit]) {
            storage.posts[subreddit] = [];
        }
        if (key && storedPostsByKey[key]) {
            stats.refreshed++;
        } else {
            stats.added++;
        }
        if (key) {
            storedPostsByKey[key] = post;
        }
        storage.posts[subreddit].push(post);
    };

    posts.forEach(function(post) {
        if (!post) {
            return;
        }
        var rejection = getRejectionReason(post, subscriptionsByKey, options);
        if (!rejection) {
            stats.accepted++;
            storePost(post);
            return;
        }
        stats[rejection]++;

        var subreddit = normalizeSubreddit(post.subreddit);
        var key = getPostKey(post);
        var previousPost = key && storedPostsByKey[key];
        var flairRules = options.rulesForSubs[subreddit];
        if (previousPost && flairRules && Array.isArray(storage.posts[subreddit]) &&
            (subredditRules.isExcludedLinkFlair(post, flairRules) ||
                subredditRules.isExcludedLinkFlair(previousPost, flairRules))) {
            storage.posts[subreddit].push(post);
            storedPostsByKey[key] = post;
        }
    });

    var checkedCrosspostKeys = Object.create(null);
    crossposts.forEach(function(candidate) {
        var crosspostKey = getPostKey(candidate);
        if (crosspostKey && checkedCrosspostKeys[crosspostKey]) {
            return;
        }
        checkedCrosspostKeys[crosspostKey] = true;
        var crosspost = candidatesByKey[crosspostKey] || candidate;
        var embeddedParent = crosspost.crosspost_parent_list && crosspost.crosspost_parent_list[0];
        if (!embeddedParent) {
            return;
        }
        var parentKey = getPostKey(embeddedParent);
        var parent = incomingPostKeys[parentKey] ? candidatesByKey[parentKey] :
            (incomingPostKeys[crosspostKey] ? embeddedParent : candidatesByKey[parentKey]) || embeddedParent;
        var parentRejection = getRejectionReason(parent, subscriptionsByKey, options);
        if (parentRejection === 'notSubscribed' || parentRejection === 'blacklisted' || parentRejection === 'deleted') {
            return;
        }
        if (parentRejection && getRejectionReason(crosspost, subscriptionsByKey, options)) {
            return;
        }
        // Use the original's data, even when only its crosspost passes score/comments/flair.
        storePost(parent);
        candidatesByKey[getPostKey(parent)] = parent;
    });

    Object.keys(storage.posts).forEach(function(subreddit) {
        storage.posts[subreddit] = storageUtils.sortAndLimitPosts(storage.posts[subreddit]);
        if (!subscriptionsByKey[subreddit]) {
            delete storage.posts[subreddit];
        }
    });
    return stats;
};

var getVisiblePostsBySubreddit = function(storage, subscriptionsByKey, rulesForSubs) {
    var visiblePosts = Object.create(null);
    var storedPostsByKey = Object.create(null);
    var visiblePostKeys = Object.create(null);
    Object.keys(subscriptionsByKey).forEach(function(subreddit) {
        var posts = storage.posts[subreddit] || [];
        posts.forEach(function(post) {
            storedPostsByKey[getPostKey(post)] = post;
        });
        visiblePosts[subreddit] = subredditRules.filterExcludedLinkFlairs(posts, rulesForSubs[subreddit] || {});
        visiblePosts[subreddit].forEach(function(post) {
            visiblePostKeys[getPostKey(post)] = true;
        });
    });

    Object.keys(visiblePosts).forEach(function(subreddit) {
        visiblePosts[subreddit].slice().forEach(function(post) {
            var embeddedParent = post.crosspost_parent_list && post.crosspost_parent_list[0];
            var parentKey = getPostKey(embeddedParent);
            var parent = parentKey && storedPostsByKey[parentKey];
            var parentSubreddit = parent && normalizeSubreddit(parent.subreddit);
            if (parent && visiblePosts[parentSubreddit] && !visiblePostKeys[parentKey]) {
                visiblePosts[parentSubreddit].push(parent);
                visiblePostKeys[parentKey] = true;
            }
        });
    });
    Object.keys(visiblePosts).forEach(function(subreddit) {
        visiblePosts[subreddit] = storageUtils.sortAndLimitPosts(visiblePosts[subreddit]);
    });
    return visiblePosts;
};

module.exports = {
    'storeNewPosts': storeNewPosts,
    'getVisiblePostsBySubreddit': getVisiblePostsBySubreddit
};
