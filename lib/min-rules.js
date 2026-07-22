'use strict';

var storageUtils = require('./storage');

var hasOwn = function(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
};

var readMinimum = function(rules, subreddit, key) {
    if (!hasOwn(rules, key)) {
        throw new Error('minRulesForSubs.' + subreddit + '.' + key + ' is required');
    }

    var value = Number(rules[key]);
    if (!isFinite(value) || value < 0) {
        throw new Error('minRulesForSubs.' + subreddit + '.' + key + ' must be a non-negative number');
    }

    return value;
};

var normalize = function(rulesBySubreddit) {
    if (rulesBySubreddit === undefined) {
        return {};
    }
    if (!rulesBySubreddit || typeof rulesBySubreddit !== 'object' || Array.isArray(rulesBySubreddit)) {
        throw new Error('minRulesForSubs must be an object keyed by subreddit name');
    }

    var normalizedRules = {};
    Object.keys(rulesBySubreddit).forEach(function(subreddit) {
        var normalizedSubreddit = storageUtils.normalizeSubreddit(subreddit);
        if (!normalizedSubreddit || !storageUtils.isSafeSubredditName(normalizedSubreddit)) {
            throw new Error('minRulesForSubs has an invalid subreddit name: ' + subreddit);
        }
        if (hasOwn(normalizedRules, normalizedSubreddit)) {
            throw new Error('minRulesForSubs has duplicate subreddit: ' + subreddit);
        }

        var rules = rulesBySubreddit[subreddit];
        if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
            throw new Error('minRulesForSubs.' + subreddit + ' must be an object');
        }

        normalizedRules[normalizedSubreddit] = {
            'minScore': readMinimum(rules, subreddit, 'minScore'),
            'minComments': readMinimum(rules, subreddit, 'minComments')
        };
    });

    return normalizedRules;
};

var getForSubreddit = function(rulesBySubreddit, subreddit, defaultRules) {
    return rulesBySubreddit[subreddit] || defaultRules;
};

module.exports = {
    'normalize': normalize,
    'getForSubreddit': getForSubreddit
};
