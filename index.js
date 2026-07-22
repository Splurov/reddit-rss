'use strict';

var fs = require('fs');
var path = require('path');
var util = require('util');

var nodemailer = require('nodemailer');

var makeRss = require('./lib/make-rss');
var makeOpml = require('./lib/make-opml');
var fetchNewPosts = require('./lib/fetch-new-posts');
var RedditClient = require('./lib/reddit-client');
var storageUtils = require('./lib/storage');

var packageJson = require('./package.json');
var config = require('./config.json');

var before = null;
var lastNewPostPageLength = null;
var requests = 0;
var newPostRequests = 0;
var maxRequests;
var maxTime;
var popularityGroups;
var blacklistRe;
var ignoredMinRuleSubreddits = {};

var reddit = new RedditClient({
    'userAgent': packageJson.name + '/' + packageJson.version + ' by ' + config.username,
    'clientId': config.consumerKey,
    'clientSecret': config.consumerSecret,
    'username': config.username,
    'password': config.password,
});

var formatLogTime = function(date) {
    var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var pad = function(number) {
        return number < 10 ? '0' + number : String(number);
    };

    return date.getDate() + ' ' + monthNames[date.getMonth()] + ' ' +
        pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
};

var logger = {
    '_getErrorText': function(type, message, postDetails) {
        return util.format(
            '[%s] %s (before: %s) (%s) (requests: %s, new-post requests: %s/%s) (max time: %s)',
            type,
            message,
            before,
            postDetails || ('new-post page: ' + (lastNewPostPageLength === null ? '-' : lastNewPostPageLength)),
            requests,
            newPostRequests,
            maxRequests,
            maxTime
        );
    },
    '_log': function(type, message, postDetails) {
        console.log(formatLogTime(new Date()) + ' - ' + this._getErrorText(type, message, postDetails));
    },
    'logError': function(message) {
        var errorString = this._getErrorText('ERROR', message);
        console.log(formatLogTime(new Date()) + ' - ' + errorString);
        if (config.mailSmtpTransportUrl) {
            var safeErrorString = errorString.replace(/"password": "[^"]+"/, '"password": "<HIDDEN>"');
            var transporter = nodemailer.createTransport(config.mailSmtpTransportUrl);
            transporter.sendMail({
                'from': config.mailFrom,
                'to': config.mailTo,
                'subject': 'Reddit RSS Error',
                'text': safeErrorString
            }, function(error, info) {
                if (error) {
                    logger.logInfo('Error while sending error email {' + error + '}');
                    return;
                }

                logger.logInfo('Error email sent {' + info.response + '}');
            });
        }
    },
    'logInfo': function(message, postDetails) {
        this._log('info', message, postDetails);
    },
    'logDebug': function(message) {
        if (config.isLogDebug) {
            this._log('debug', message);
        }
    }
};

var normalizeSubreddit = storageUtils.normalizeSubreddit;
var isSafeSubredditName = storageUtils.isSafeSubredditName;
var getPostTimestamp = storageUtils.getPostTimestamp;
var sortAndLimitPosts = storageUtils.sortAndLimitPosts;

var getRssFilename = function(subreddit) {
    if (!isSafeSubredditName(subreddit)) {
        throw new Error('Unsupported subreddit name for RSS file: ' + subreddit);
    }

    return 'r-' + subreddit + '.xml';
};

var getRssPublicUrl = function(subreddit) {
    var baseUrl = config.rssPublicBaseUrl;
    if (baseUrl.charAt(baseUrl.length - 1) !== '/') {
        baseUrl += '/';
    }

    return baseUrl + getRssFilename(subreddit);
};

var getRssFilePath = function(subreddit) {
    var rssDirectory = path.resolve(config.rssDirectoryPath);
    var feedFilePath = path.resolve(rssDirectory, getRssFilename(subreddit));
    if (feedFilePath.indexOf(rssDirectory + path.sep) !== 0) {
        throw new Error('RSS file path is outside rssDirectoryPath');
    }

    return feedFilePath;
};

var ensureDirectory = function(directoryPath) {
    if (fs.existsSync(directoryPath)) {
        return;
    }

    var parentDirectory = path.dirname(directoryPath);
    if (parentDirectory !== directoryPath) {
        ensureDirectory(parentDirectory);
    }

    try {
        fs.mkdirSync(directoryPath);
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
};

var writeFileAtomicSync = function(filePath, content) {
    ensureDirectory(path.dirname(filePath));

    var temporaryPath = filePath + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    try {
        fs.writeFileSync(temporaryPath, content);
        fs.renameSync(temporaryPath, filePath);
    } catch (error) {
        if (fs.existsSync(temporaryPath)) {
            fs.unlinkSync(temporaryPath);
        }
        throw error;
    }
};

var readJsonFile = function(filePath, allowMissing) {
    if (!fs.existsSync(filePath)) {
        if (allowMissing) {
            return null;
        }
        return {};
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

var requireConfigValue = function(key) {
    if (!config[key]) {
        throw new Error('Missing required config value: ' + key);
    }
};

var reserveNewPostRequest = function() {
    if (newPostRequests >= maxRequests) {
        throw new Error('Too many new-post requests (maxRequests: ' + maxRequests + ')');
    }
    newPostRequests++;
    requests++;
};

var initializeConfiguration = function() {
    [
        'storageFilePath',
        'rssDirectoryPath',
        'rssPublicBaseUrl',
        'opmlFilePath',
        'opmlPublicUrl',
        'subscriptionsCacheFilePath',
        'maxRequests'
    ].forEach(requireConfigValue);

    if (!/^https?:\/\//i.test(config.rssPublicBaseUrl) || !/^https?:\/\//i.test(config.opmlPublicUrl)) {
        throw new Error('rssPublicBaseUrl and opmlPublicUrl must be public HTTP(S) URLs');
    }

    if (!config.minScore || !config.minComments) {
        throw new Error('minScore and minComments are required');
    }

    popularityGroups = Object.keys(config.minScore).map(function(value) {
        return parseInt(value, 10);
    }).filter(function(value) {
        return !isNaN(value);
    }).sort(function(a, b) {
        return a - b;
    });
    if (popularityGroups.length === 0) {
        throw new Error('minScore must contain at least one popularity group');
    }

    maxRequests = Number(config.maxRequests);
    if (!isFinite(maxRequests) || maxRequests < 1 || Math.floor(maxRequests) !== maxRequests) {
        throw new Error('maxRequests must be a positive integer');
    }

    var maxHoursAgo = Number(config.maxHoursAgo);
    if (!isFinite(maxHoursAgo) || maxHoursAgo < 0) {
        throw new Error('maxHoursAgo must be a non-negative number');
    }
    maxTime = Math.round(new Date().getTime() / 1000) - (maxHoursAgo * 3600);

    var blacklistStrings = Array.isArray(config.blacklistStrings) ? config.blacklistStrings : [];
    blacklistRe = blacklistStrings.length > 0 ? new RegExp('(?:' + blacklistStrings.map(function(string) {
        return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|') + ')', 'i') : null;

    (Array.isArray(config.ignoreMinRulesForSubs) ? config.ignoreMinRulesForSubs : []).forEach(function(subreddit) {
        var normalizedSubreddit = normalizeSubreddit(subreddit);
        if (normalizedSubreddit) {
            ignoredMinRuleSubreddits[normalizedSubreddit] = true;
        }
    });
};

var getPopularityGroup = function(count) {
    var selectedGroup = popularityGroups[popularityGroups.length - 1];
    popularityGroups.some(function(group) {
        if (count <= group) {
            selectedGroup = group;
            return true;
        }
        return false;
    });
    return selectedGroup;
};

var getAllSubscriptions = function() {
    var subscriptions = [];
    var seenCursors = {};

    var getPage = function(after) {
        requests++;
        var params = {'limit': 100};
        if (after) {
            params.after = after;
        }

        return reddit.getSubscriptions(params).then(function(items) {
            var page = Array.prototype.slice.call(items);
            logger.logDebug(util.format('Got subreddit page {length: %s}', page.length));

            page.forEach(function(item) {
                var displayName = item.display_name;
                var subreddit = normalizeSubreddit(displayName);
                if (!subreddit || !isSafeSubredditName(subreddit)) {
                    logger.logInfo('Skipped unsupported subreddit name: ' + displayName);
                    return;
                }

                subscriptions.push({
                    'key': subreddit,
                    'displayName': String(displayName),
                    'subscribers': Number(item.subscribers || 0)
                });
            });

            if (page.length < 100) {
                return subscriptions;
            }

            var lastItem = page[page.length - 1];
            var nextAfter = lastItem.name;
            if (!nextAfter || nextAfter === after || seenCursors[nextAfter]) {
                throw new Error('Can not continue subscription pagination');
            }

            seenCursors[nextAfter] = true;
            return getPage(nextAfter);
        });
    };

    return getPage(null);
};

var buildSubscriptions = function(rawSubscriptions) {
    var subscriptionsByKey = {};
    rawSubscriptions.forEach(function(subscription) {
        if (!subscriptionsByKey[subscription.key]) {
            subscriptionsByKey[subscription.key] = subscription;
        }
    });

    var subscriptions = Object.keys(subscriptionsByKey).sort().map(function(key) {
        var subscription = subscriptionsByKey[key];
        return {
            'key': key,
            'displayName': subscription.displayName,
            'popularityGroup': getPopularityGroup(subscription.subscribers),
            'filename': getRssFilename(key)
        };
    });

    return {
        'list': subscriptions,
        'byKey': subscriptions.reduce(function(result, subscription) {
            result[subscription.key] = subscription;
            return result;
        }, {})
    };
};

var getCachedSubreddits = function(cache) {
    if (!cache || !Array.isArray(cache.subreddits)) {
        return null;
    }

    var uniqueSubreddits = {};
    cache.subreddits.forEach(function(subreddit) {
        var normalizedSubreddit = normalizeSubreddit(subreddit);
        if (normalizedSubreddit && isSafeSubredditName(normalizedSubreddit)) {
            uniqueSubreddits[normalizedSubreddit] = true;
        }
    });
    return Object.keys(uniqueSubreddits).sort();
};

var compareSubscriptions = function(cachedSubreddits, currentSubreddits) {
    var cached = {};
    var current = {};
    var added = [];
    var removed = [];

    cachedSubreddits.forEach(function(subreddit) {
        cached[subreddit] = true;
    });
    currentSubreddits.forEach(function(subreddit) {
        current[subreddit] = true;
        if (!cached[subreddit]) {
            added.push(subreddit);
        }
    });
    cachedSubreddits.forEach(function(subreddit) {
        if (!current[subreddit]) {
            removed.push(subreddit);
        }
    });

    return {
        'added': added.sort(),
        'removed': removed.sort()
    };
};

var isEligiblePost = function(post, subscriptionsByKey, stats) {
    stats.total++;
    var subreddit = normalizeSubreddit(post.subreddit);
    var subscription = subreddit && subscriptionsByKey[subreddit];
    if (!subscription) {
        stats.notSubscribed++;
        return false;
    }

    if (blacklistRe && blacklistRe.test(post.title || '')) {
        stats.blacklisted++;
        return false;
    }
    if (post.selftext === '[deleted]') {
        stats.deleted++;
        return false;
    }

    var minScore = config.minScore[subscription.popularityGroup];
    var minComments = config.minComments[subscription.popularityGroup];
    if (post.score <= 0) {
        stats.nonPositiveScore++;
        return false;
    }
    if (ignoredMinRuleSubreddits[subreddit] ||
        post.score >= minScore ||
        post.num_comments >= minComments) {
        stats.accepted++;
        return true;
    }

    stats.belowThreshold++;
    return false;
};

var storeNewPosts = function(storage, posts, subscriptionsByKey) {
    var stats = {
        'total': 0,
        'accepted': 0,
        'notSubscribed': 0,
        'blacklisted': 0,
        'deleted': 0,
        'nonPositiveScore': 0,
        'belowThreshold': 0
    };

    posts.forEach(function(post) {
        if (!post || !isEligiblePost(post, subscriptionsByKey, stats)) {
            return;
        }

        var subreddit = normalizeSubreddit(post.subreddit);
        if (!storage.posts[subreddit]) {
            storage.posts[subreddit] = [];
        }
        storage.posts[subreddit].push(post);
    });

    Object.keys(storage.posts).forEach(function(subreddit) {
        storage.posts[subreddit] = sortAndLimitPosts(storage.posts[subreddit]);
        if (!subscriptionsByKey[subreddit]) {
            delete storage.posts[subreddit];
        }
    });

    return stats;
};

var removeFileIfExists = function(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
};

var makeSubscriptionsCache = function(subreddits) {
    return {
        'subreddits': subreddits.map(function(subreddit) {
            return subreddit.key;
        }),
        'updatedAt': new Date().toISOString()
    };
};

var sendSubscriptionChangeEmail = function(changes) {
    if (!config.mailSmtpTransportUrl) {
        logger.logInfo('Subscriptions changed, but SMTP is not configured');
        return Promise.resolve();
    }

    var textParts = [
        'Your Reddit RSS subscription list changed.',
        '',
        'Added: ' + (changes.added.length ? changes.added.map(function(subreddit) { return 'r/' + subreddit; }).join(', ') : 'none'),
        'Removed: ' + (changes.removed.length ? changes.removed.map(function(subreddit) { return 'r/' + subreddit; }).join(', ') : 'none')
    ];

    if (changes.added.length) {
        textParts.push('', 'New RSS feeds:');
        changes.added.forEach(function(subreddit) {
            textParts.push('r/' + subreddit + ': ' + getRssPublicUrl(subreddit));
        });
    }

    textParts.push(
        '',
        'Update the OPML subscription in your RSS client:',
        config.opmlPublicUrl
    );

    var text = textParts.join('\n');

    return new Promise(function(resolve, reject) {
        var transporter = nodemailer.createTransport(config.mailSmtpTransportUrl);
        transporter.sendMail({
            'from': config.mailFrom,
            'to': config.mailTo,
            'subject': 'Reddit RSS: subscriptions changed',
            'text': text
        }, function(error, info) {
            if (error) {
                reject(error);
                return;
            }
            logger.logInfo('Subscription-change email sent {' + info.response + '}');
            resolve();
        });
    });
};

var publish = function(storage, subscriptions, changes) {
    subscriptions.list.forEach(function(subscription) {
        var content = makeRss(subscription.displayName, storage.posts[subscription.key] || []);
        writeFileAtomicSync(getRssFilePath(subscription.key), content);
    });

    if (changes.writeOpml) {
        writeFileAtomicSync(config.opmlFilePath, makeOpml(subscriptions.list, config.rssPublicBaseUrl));
    }

    if (changes.hasChanges) {
        changes.removed.forEach(function(subreddit) {
            removeFileIfExists(getRssFilePath(subreddit));
        });
    }

    writeFileAtomicSync(config.storageFilePath, JSON.stringify(storage));
    if (changes.writeOpml) {
        writeFileAtomicSync(config.subscriptionsCacheFilePath, JSON.stringify(makeSubscriptionsCache(subscriptions.list), null, 2) + '\n');
    }

    if (!changes.hasChanges) {
        return Promise.resolve();
    }

    return sendSubscriptionChangeEmail(changes).catch(function(error) {
        logger.logError('Can not send subscription-change email: ' + error);
    });
};

var main = function() {
    var storage;
    var cachedSubreddits;
    var savedPostCount = 0;

    try {
        initializeConfiguration();
        storage = storageUtils.requireCurrentStorage(readJsonFile(config.storageFilePath, false));
        before = storage.before;
        cachedSubreddits = getCachedSubreddits(readJsonFile(config.subscriptionsCacheFilePath, true));
    } catch (error) {
        logger.logError(error.message);
        process.exitCode = 1;
        return;
    }

    return getAllSubscriptions().then(function(rawSubscriptions) {
        var subscriptions = buildSubscriptions(rawSubscriptions);
        var currentSubreddits = subscriptions.list.map(function(subscription) {
            return subscription.key;
        });
        var isFirstRun = cachedSubreddits === null;
        var changes = isFirstRun ? {'added': [], 'removed': []} : compareSubscriptions(cachedSubreddits, currentSubreddits);
        changes.isFirstRun = isFirstRun;
        changes.hasChanges = changes.added.length > 0 || changes.removed.length > 0;
        changes.writeOpml = isFirstRun || changes.hasChanges;

        return fetchNewPosts(reddit, before, maxTime, reserveNewPostRequest, logger.logDebug.bind(logger), function(pageLength) {
            lastNewPostPageLength = pageLength;
        }).then(function(result) {
            logger.logDebug('Fetched mature posts {count: ' + result.posts.length + '; deferred: ' + result.deferredPosts + '; before: ' + result.before + '}');
            var filterStats = storeNewPosts(storage, result.posts, subscriptions.byKey);
            savedPostCount = filterStats.accepted;
            logger.logDebug(util.format(
                'Post filter {accepted: %s; below threshold: %s; non-positive score: %s; deleted: %s; blacklisted: %s; not subscribed: %s}',
                filterStats.accepted,
                filterStats.belowThreshold,
                filterStats.nonPositiveScore,
                filterStats.deleted,
                filterStats.blacklisted,
                filterStats.notSubscribed
            ));
            storage.before = result.before;
            return publish(storage, subscriptions, changes).then(function() {
                before = storage.before;
                logger.logDebug('Persisted storage {before: ' + before + '}');
            });
        });
    }).then(function() {
        logger.logInfo('Successfully updated', 'saved posts: ' + savedPostCount);
    }).catch(function(error) {
        logger.logError(error.message || String(error));
        console.error(error);
        process.exitCode = 1;
    });
};

main();
