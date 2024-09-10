'use strict';

var fs = require('fs');
var util = require('util');

var snoowrap = require('snoowrap');
var nodemailer = require('nodemailer');

var makeRss = require('./lib/make-rss');

var packageJson = require('./package.json');
var config = require('./config.json');
var storage = require(config.storageFilePath);

var reddit = new snoowrap({
    'userAgent': packageJson.name + '/' + packageJson.version + ' by ' + config.username,
    'clientId': config.consumerKey,
    'clientSecret': config.consumerSecret,
    'username': config.username,
    'password': config.password,
});

var popularityGroups = Object.keys(config.minScore).map(function(v) {
    return parseInt(v, 10);
}).sort(function(a, b) {
    return a - b;
});


var maxTime = Math.round(new Date().getTime() / 1000) - (config.maxHoursAgo * 3600);
var before = storage.before || null;
var posts = [];
var requests = 0;


var blacklistRe = new RegExp('(?:' + config.blacklistStrings.map(function(string) {
    // escape for regexp
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}).join('|') + ')', 'i');


var logger = {
    '_getErrorText': function(type, message) {
        return util.format(
            '[%s] %s (before: %s) (posts: %s) (requests: %s) (max time: %s)',
            type,
            message,
            before,
            posts.length,
            requests,
            maxTime
        );
    },
    '_log': function(type, message) {
        util.log(this._getErrorText(type, message));
    },
    'logError': function(message) {
        var errorString = this._getErrorText('ERROR', message);
        util.log(errorString);
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
                    logger.logInfo('Error while sending email {' + error + '}');
                    return;
                }

                logger.logInfo('Message sent {' + info.response + '}');
            });
        }
    },
    'logInfo': function(message) {
        this._log('info', message);
    },
    'logDebug': function(message) {
        if (config.isLogDebug) {
            this._log('debug', message);
        }
    }
};


var finish = function() {
    var allPosts = (storage.posts || []).concat(posts);
    allPosts.sort(function(a, b) {
        return a.created_utc - b.created_utc;
    });
    if (allPosts.length > config.maxRssItems) {
        allPosts = allPosts.slice(-config.maxRssItems);
    }
    storage.posts = allPosts;

    var rssContent = makeRss(storage.posts);
    fs.writeFileSync(config.rssFilePath, rssContent);

    storage.before = before;
    fs.writeFileSync(config.storageFilePath, JSON.stringify(storage));
    logger.logInfo('Successfully updated');
};

let retries = 0;

var getUpdates = function(subreddits) {
    requests++;
    if (requests > config.maxRequests) {
        logger.logError('Too many requests');
        return;
    }

    var params = {
        'limit': 100
    };
    if (before) {
        params.before = before;
    }

    logger.logDebug('Get updates');

    reddit.getNew(params).then(function(items) {
        var itemsLength = items.length;
        if (itemsLength === 0) {
            logger.logInfo(`No items, trying to obtain before from storage (${retries} retries)`);
            if (storage.posts.length >= (retries + 2)) {
                retries++;
                before = storage.posts[retries].name;
                logger.logInfo('New before');
                getUpdates(subreddits);
            } else {
                logger.logError('Can not obtain before from storage');
                finish();
            }
            return;
        }

        for (var i = itemsLength - 1; i >= 0; i--) {
            var item = items[i].toJSON();

            var minScore = config.minScore[popularityGroups[0]];
            var minComments = config.minComments[popularityGroups[0]];
            if (subreddits[item.subreddit]) {
                minScore = config.minScore[subreddits[item.subreddit]];
                minComments = config.minComments[subreddits[item.subreddit]];
            }

            if (blacklistRe.test(item.title)) {
                logger.logDebug('Blacklisted ' + item.name + ': ' + item.title + ' — ' + item.subreddit);
            } else if (item.selftext !== '[deleted]' &&
                       item.score > 0 &&
                       (config.ignoreMinRulesForSubs.includes(item.subreddit.toLowerCase()) ||
                        item.score >= minScore ||
                        item.num_comments >= minComments)) {
                posts.push(item);
            } else if (item.created_utc > maxTime) {
                logger.logDebug(util.format('Finish on item {time: %s} {item name: %s}', item.created_utc, item.name));
                finish();
                return;
            }

            before = item.name;
        }

        getUpdates(subreddits);
    }).catch(function(error) {
        logger.logError(util.format('Can not get new: %s', error));
    });
};

var getPopularityGroup = function(count) {
    var selectedGroup = popularityGroups[0];

    popularityGroups.some(function(group) {
        if (count <= group) {
            selectedGroup = group;
            return true;
        }
    });

    return selectedGroup;
};

reddit.getSubscriptions({'limit': 100}).then(function(items) {
    logger.logDebug(util.format('Got subreddits {length: %s}', items.length));

    var subreddits = {};
    items.forEach(function(item) {
        subreddits[item.display_name] = getPopularityGroup(item.subscribers);
    });

    getUpdates(subreddits);
}).catch(function(error) {
    logger.logError(util.format('Can not get subreddits: %s', error));
});
