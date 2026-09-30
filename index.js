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
var subredditRules = require('./lib/subreddit-rules');

var packageJson = require('./package.json');
var config = require('./config.json');

var processedThrough = null;
var lastNewPostPageLength = null;
var requests = 0;
var newPostRequests = 0;
var maxRequests;
var maxTime;
var overlapSeconds;
var popularityGroups;
var blacklistRe;
var rulesForSubs = {};

var reddit;

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
            '[%s] %s (processed through: %s) (%s) (requests: %s, new-post requests: %s/%s) (max time: %s)',
            type,
            message,
            processedThrough,
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

reddit = new RedditClient({
    'userAgent': packageJson.name + '/' + packageJson.version + ' by ' + config.username,
    'clientId': config.consumerKey,
    'clientSecret': config.consumerSecret,
    'username': config.username,
    'password': config.password,
    'logDebug': logger.logDebug.bind(logger)
});

var normalizeSubreddit = storageUtils.normalizeSubreddit;
var isSafeSubredditName = storageUtils.isSafeSubredditName;
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
        return false;
    }
    newPostRequests++;
    requests++;
    return true;
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

    var overlapHours = config.overlapHours === undefined ? 6 : Number(config.overlapHours);
    if (!isFinite(overlapHours) || overlapHours < 0) {
        throw new Error('overlapHours must be a non-negative number');
    }
    overlapSeconds = overlapHours * 3600;

    var blacklistStrings = Array.isArray(config.blacklistStrings) ? config.blacklistStrings : [];
    blacklistRe = blacklistStrings.length > 0 ? new RegExp('(?:' + blacklistStrings.map(function(string) {
        return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|') + ')', 'i') : null;

    rulesForSubs = subredditRules.normalize(config.rulesForSubs);
};

var getPopularityGroup = function(count) {
    for (var index = 0; index < popularityGroups.length; index++) {
        if (count <= popularityGroups[index]) {
            return popularityGroups[index];
        }
    }
    return popularityGroups[popularityGroups.length - 1];
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
                    'subscribers': Number(item.subscribers || 0),
                    'communityIcon': item.community_icon || null
                });
            });

            if (page.length < 100) {
                return subscriptions;
            }

            var lastItem = page[page.length - 1];
            var nextAfter = items.after === undefined ? lastItem.name : items.after;
            if (!nextAfter) {
                return subscriptions;
            }
            if (nextAfter === after || seenCursors[nextAfter]) {
                throw new Error('Can not continue subscription pagination');
            }

            seenCursors[nextAfter] = true;
            return getPage(nextAfter);
        });
    };

    return getPage(null);
};

var buildSubscriptions = function(rawSubscriptions) {
    var rawSubscriptionsByKey = {};
    rawSubscriptions.forEach(function(subscription) {
        if (!rawSubscriptionsByKey[subscription.key]) {
            rawSubscriptionsByKey[subscription.key] = subscription;
        }
    });

    var subscriptionsByKey = {};
    var subscriptions = Object.keys(rawSubscriptionsByKey).sort().map(function(key) {
        var rawSubscription = rawSubscriptionsByKey[key];
        var subscription = {
            'key': key,
            'displayName': rawSubscription.displayName,
            'communityIcon': rawSubscription.communityIcon,
            'popularityGroup': getPopularityGroup(rawSubscription.subscribers),
            'filename': getRssFilename(key)
        };
        subscriptionsByKey[key] = subscription;
        return subscription;
    });

    return {
        'list': subscriptions,
        'byKey': subscriptionsByKey
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

    var rules = subredditRules.getForSubreddit(rulesForSubs, subreddit, {
        'minScore': config.minScore[subscription.popularityGroup],
        'minComments': config.minComments[subscription.popularityGroup]
    });
    if (subredditRules.isExcludedLinkFlair(post, rules)) {
        stats.excludedLinkFlair++;
        return false;
    }
    if (post.score <= 0) {
        stats.nonPositiveScore++;
        return false;
    }
    if (post.score >= rules.minScore || post.num_comments >= rules.minComments) {
        stats.accepted++;
        return true;
    }

    stats.belowThreshold++;
    return false;
};

var storeNewPosts = function(storage, posts, subscriptionsByKey) {
    var storedPostKeys = {};
    Object.keys(storage.posts).forEach(function(subreddit) {
        var storedPosts = storage.posts[subreddit];
        if (!Array.isArray(storedPosts)) {
            return;
        }
        storedPosts.forEach(function(post) {
            var key = post && (post.name || post.id);
            if (key) {
                storedPostKeys['$' + key] = post;
            }
        });
    });

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

    posts.forEach(function(post) {
        if (!post) {
            return;
        }
        if (!isEligiblePost(post, subscriptionsByKey, stats)) {
            var rejectedSubreddit = normalizeSubreddit(post.subreddit);
            var rejectedPostKey = post.name || post.id;
            var previousPost = rejectedPostKey && storedPostKeys['$' + rejectedPostKey];
            var flairRules = rulesForSubs[rejectedSubreddit];
            if (previousPost && flairRules && Array.isArray(storage.posts[rejectedSubreddit]) &&
                (subredditRules.isExcludedLinkFlair(post, flairRules) ||
                    subredditRules.isExcludedLinkFlair(previousPost, flairRules))) {
                storage.posts[rejectedSubreddit].push(post);
                storedPostKeys['$' + rejectedPostKey] = post;
            }
            return;
        }

        var subreddit = normalizeSubreddit(post.subreddit);
        if (!storage.posts[subreddit]) {
            storage.posts[subreddit] = [];
        }

        var postKey = post.name || post.id;
        if (postKey && storedPostKeys['$' + postKey]) {
            stats.refreshed++;
        } else {
            stats.added++;
        }
        if (postKey) {
            storedPostKeys['$' + postKey] = post;
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

var makeSubscriptionsCache = function(subreddits) {
    return {
        'subreddits': subreddits.map(function(subreddit) {
            return subreddit.key;
        }),
        'updatedAt': new Date().toISOString()
    };
};

var sendEmail = function(subject, text, successMessage) {
    return new Promise(function(resolve, reject) {
        var transporter = nodemailer.createTransport(config.mailSmtpTransportUrl);
        transporter.sendMail({
            'from': config.mailFrom,
            'to': config.mailTo,
            'subject': subject,
            'text': text
        }, function(error, info) {
            if (error) {
                reject(error);
                return;
            }
            logger.logInfo(successMessage + ' {' + info.response + '}');
            resolve();
        });
    });
};

var formatSubscriptionChangeGroup = function(label, subreddits) {
    if (!subreddits.length) {
        return label + ': none';
    }

    return label + ':\n' + subreddits.map(function(subreddit) {
        return '- r/' + subreddit;
    }).join('\n');
};

var sendSubscriptionChangeEmail = function(changes) {
    if (!config.mailSmtpTransportUrl) {
        logger.logInfo('Subscriptions changed, but SMTP is not configured');
        return Promise.resolve();
    }

    var textParts = [
        'Your Reddit RSS subscription list changed.',
        '',
        formatSubscriptionChangeGroup('Added', changes.added),
        '',
        formatSubscriptionChangeGroup('Removed', changes.removed)
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
    return sendEmail('Reddit RSS: subscriptions changed', text, 'Subscription-change email sent');
};

var sendRequestLimitEmail = function(result, filterStats) {
    if (!config.mailSmtpTransportUrl) {
        logger.logInfo('New-post request limit reached, but SMTP is not configured');
        return Promise.resolve();
    }

    var text = [
        'The Reddit RSS new-post request limit was reached.',
        '',
        'Partial progress was saved successfully.',
        'Fetched mature posts: ' + result.posts.length,
        'Posts accepted by filters: ' + filterStats.accepted,
        'New stored posts: ' + filterStats.added,
        'Refreshed stored posts: ' + filterStats.refreshed,
        'Processed through remains: ' + result.processedThrough,
        'Target processed through: ' + result.targetProcessedThrough,
        'Resume after: ' + (result.pendingScan ? result.pendingScan.after : 'none'),
        'New-post requests: ' + newPostRequests + '/' + maxRequests,
        '',
        'The next manual or scheduled run will continue from the saved Reddit cursor.'
    ].join('\n');

    return sendEmail('Reddit RSS: new-post request limit reached', text, 'New-post request-limit email sent');
};

var publish = function(storage, subscriptions, changes) {
    var visiblePostsBySubreddit = Object.create(null);
    subscriptions.list.forEach(function(subscription) {
        var subreddit = subscription.key;
        visiblePostsBySubreddit[subreddit] = subredditRules.filterExcludedLinkFlairs(
            storage.posts[subreddit] || [], rulesForSubs[subreddit] || {}
        );
    });

    subscriptions.list.forEach(function(subscription) {
        var content = makeRss(
            subscription.displayName,
            visiblePostsBySubreddit[subscription.key],
            subscription.communityIcon,
            visiblePostsBySubreddit
        );
        writeFileAtomicSync(getRssFilePath(subscription.key), content);
    });

    if (changes.writeOpml) {
        writeFileAtomicSync(config.opmlFilePath, makeOpml(subscriptions.list, config.rssPublicBaseUrl));
    }

    changes.removed.forEach(function(subreddit) {
        var filePath = getRssFilePath(subreddit);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    });

    writeFileAtomicSync(config.storageFilePath, JSON.stringify(storage, null, 2) + '\n');
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
    var newPostCount = 0;
    var refreshedPostCount = 0;
    var acceptedPostCount = 0;

    try {
        initializeConfiguration();
        storage = storageUtils.requireCurrentStorage(readJsonFile(config.storageFilePath, false));
        processedThrough = storage.processedThrough;
        if (processedThrough === null) {
            processedThrough = maxTime;
            storage.processedThrough = processedThrough;
        }
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
        changes.hasChanges = changes.added.length > 0 || changes.removed.length > 0;
        changes.writeOpml = isFirstRun || changes.hasChanges;

        if (storage.pendingScan) {
            logger.logInfo(
                'Continuing an incomplete new-post scan',
                'after: ' + storage.pendingScan.after +
                '; scan from: ' + storage.pendingScan.scanFrom +
                '; target: ' + storage.pendingScan.targetProcessedThrough
            );
        }
        return fetchNewPosts(reddit, processedThrough, maxTime, overlapSeconds, reserveNewPostRequest, logger.logDebug.bind(logger), function(pageLength) {
            lastNewPostPageLength = pageLength;
        }, storage.pendingScan).then(function(result) {
            logger.logDebug(
                'Fetched mature posts {count: ' + result.posts.length +
                '; deferred: ' + result.deferredPosts +
                '; scan from: ' + result.scanFrom +
                '; target: ' + result.targetProcessedThrough +
                '; processed through: ' + result.processedThrough +
                '; pending after: ' + (result.pendingScan ? result.pendingScan.after : 'none') + '}'
            );
            var filterStats = storeNewPosts(storage, result.posts, subscriptions.byKey);
            newPostCount = filterStats.added;
            refreshedPostCount = filterStats.refreshed;
            acceptedPostCount = filterStats.accepted;
            if (result.requestLimitReached) {
                logger.logInfo(
                    'Reached maxRequests without finishing new-post pagination; saved a cursor for the next run',
                    'fetched mature posts: ' + result.posts.length +
                    '; new: ' + filterStats.added +
                    '; refreshed: ' + filterStats.refreshed +
                    '; accepted: ' + filterStats.accepted +
                    '; resume after: ' + (result.pendingScan ? result.pendingScan.after : 'none')
                );
            }
            logger.logDebug(util.format(
                'Post filter {accepted: %s; new: %s; refreshed: %s; below threshold: %s; non-positive score: %s; deleted: %s; blacklisted: %s; excluded flair: %s; not subscribed: %s}',
                filterStats.accepted,
                filterStats.added,
                filterStats.refreshed,
                filterStats.belowThreshold,
                filterStats.nonPositiveScore,
                filterStats.deleted,
                filterStats.blacklisted,
                filterStats.excludedLinkFlair,
                filterStats.notSubscribed
            ));
            storage.processedThrough = result.processedThrough;
            storage.pendingScan = result.pendingScan;
            return publish(storage, subscriptions, changes).then(function() {
                processedThrough = storage.processedThrough;
                logger.logDebug('Persisted storage {processed through: ' + processedThrough + '}');
                if (result.requestLimitReached) {
                    return sendRequestLimitEmail(result, filterStats).catch(function(error) {
                        logger.logError('Can not send new-post request-limit email: ' + error);
                    });
                }
            });
        });
    }).then(function() {
        logger.logInfo(
            'Successfully updated',
            'new posts: ' + newPostCount + '; refreshed: ' + refreshedPostCount + '; accepted: ' + acceptedPostCount
        );
    }).catch(function(error) {
        logger.logError(error.message || String(error));
        console.error(error);
        process.exitCode = 1;
    });
};

main();
