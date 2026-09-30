'use strict';

var storageUtils = require('./storage');

var hasOwn = function(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
};

var readMinimum = function(rules, subreddit, key) {
    if (!hasOwn(rules, key)) {
        throw new Error('rulesForSubs.' + subreddit + '.' + key + ' is required when overriding thresholds');
    }

    var value = Number(rules[key]);
    if (!isFinite(value) || value < 0) {
        throw new Error('rulesForSubs.' + subreddit + '.' + key + ' must be a non-negative number');
    }

    return value;
};

var normalize = function(rulesBySubreddit) {
    if (rulesBySubreddit === undefined) {
        return Object.create(null);
    }
    if (!rulesBySubreddit || typeof rulesBySubreddit !== 'object' || Array.isArray(rulesBySubreddit)) {
        throw new Error('rulesForSubs must be an object keyed by subreddit name');
    }

    var normalizedRules = Object.create(null);
    Object.keys(rulesBySubreddit).forEach(function(subreddit) {
        var normalizedSubreddit = storageUtils.normalizeSubreddit(subreddit);
        if (!normalizedSubreddit || !storageUtils.isSafeSubredditName(normalizedSubreddit)) {
            throw new Error('rulesForSubs has an invalid subreddit name: ' + subreddit);
        }
        if (hasOwn(normalizedRules, normalizedSubreddit)) {
            throw new Error('Duplicate subreddit rule: ' + subreddit);
        }

        var rules = rulesBySubreddit[subreddit];
        if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
            throw new Error('rulesForSubs.' + subreddit + ' must be an object');
        }
        Object.keys(rules).forEach(function(key) {
            if (key !== 'minScore' && key !== 'minComments' && key !== 'excludeLinkFlairs') {
                throw new Error('rulesForSubs.' + subreddit + ' has an unknown rule: ' + key);
            }
        });

        var hasThresholds = hasOwn(rules, 'minScore') || hasOwn(rules, 'minComments');
        var normalized = {};
        if (hasThresholds) {
            normalized.minScore = readMinimum(rules, subreddit, 'minScore');
            normalized.minComments = readMinimum(rules, subreddit, 'minComments');
        }

        if (hasOwn(rules, 'excludeLinkFlairs')) {
            if (!Array.isArray(rules.excludeLinkFlairs) || rules.excludeLinkFlairs.some(function(flair) {
                return typeof flair !== 'string' || flair.length === 0;
            })) {
                throw new Error('rulesForSubs.' + subreddit + '.excludeLinkFlairs must be an array of non-empty strings');
            }
            normalized.excludeLinkFlairs = rules.excludeLinkFlairs.slice();
        }

        normalizedRules[normalizedSubreddit] = normalized;
    });

    return normalizedRules;
};

var getForSubreddit = function(rulesBySubreddit, subreddit, defaultRules) {
    var rules = hasOwn(rulesBySubreddit, subreddit) ? rulesBySubreddit[subreddit] : {};
    return {
        'minScore': hasOwn(rules, 'minScore') ? rules.minScore : defaultRules.minScore,
        'minComments': hasOwn(rules, 'minComments') ? rules.minComments : defaultRules.minComments,
        'excludeLinkFlairs': rules.excludeLinkFlairs || []
    };
};

var isExcludedLinkFlair = function(post, rules) {
    var excluded = rules.excludeLinkFlairs || [];
    return typeof post.link_flair_text === 'string' &&
        excluded.indexOf(post.link_flair_text) !== -1;
};

var filterExcludedLinkFlairs = function(posts, rules) {
    return posts.filter(function(post) {
        return !isExcludedLinkFlair(post, rules);
    });
};

module.exports = {
    'normalize': normalize,
    'getForSubreddit': getForSubreddit,
    'isExcludedLinkFlair': isExcludedLinkFlair,
    'filterExcludedLinkFlairs': filterExcludedLinkFlairs
};
