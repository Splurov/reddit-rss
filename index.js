'use strict';

var fs = require('fs');
var util = require('util');

var Snoocore = require('snoocore');

var makeRss = require('./lib/make-rss');

var packageJson = require('./package.json');
var config = require('./config.json');
var storage = require(config.storageFilePath);

var reddit = new Snoocore({
    'userAgent': packageJson.name + '/' + packageJson.version + ' by ' + config.username
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

var BLACKLIST_STRINGS = [
    '[sponsor]'
];

var blacklistRe = new RegExp('(?:' + BLACKLIST_STRINGS.map(function(string) {
    // escape for regexp
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}).join('|') + ')', 'i');


var logger = {
    '_log': function(type, message) {
        util.log(util.format('[%s] %s (before: %s) (posts: %s) (requests: %s) (max time: %s)',
                             type,
                             message,
                             before,
                             posts.length,
                             requests,
                             maxTime));
    },
    'logError': function(message) {
        this._log('ERROR', message);
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

    reddit('new').get(params).then(function(items) {
        var itemsLength;
        try {
            itemsLength = items.data.children.length;
        } catch(e) {
            logger.logError('No data');
            return;
        }

        if (itemsLength === 0) {
            logger.logInfo('No items, trying to obtain before from storage');
            if (storage.posts.length >= 2) {
                before = storage.posts[1].name;
                logger.logInfo('New before');
                getUpdates(subreddits);
            } else {
                logger.logError('Can not obtain before from storage');
                finish();
            }
            return;
        }

        for (var i = itemsLength - 1; i >= 0; i--) {
            var item = items.data.children[i].data;
            if (item.created_utc > maxTime) {
                logger.logDebug(util.format('Finish on item {time: %s} {item name: %s}', item.created_utc, item.name));
                finish();
                return;
            }

            before = item.name;

            var minScore = config.minScore[popularityGroups[0]];
            var minComments = config.minComments[popularityGroups[0]];
            if (subreddits[item.subreddit]) {
                minScore = config.minScore[subreddits[item.subreddit]];
                minComments = config.minComments[subreddits[item.subreddit]];
            }

            if (blacklistRe.test(item.title)) {
                logger.logInfo('blacklisted: ' + item.title + ' — ' + item.subreddit);
            } else if (item.score >= minScore || item.num_comments >= minComments) {
                posts.push(item);
            }
        }

        getUpdates(subreddits);
    }, function(error) {
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

reddit.auth(Snoocore.oauth.getAuthData('script', {
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    username: config.username,
    password: config.password,
    scope: ['read', 'mysubreddits']
})).then(function() {
    reddit.subreddits.mine.$where.get({$where: 'subscriber', 'limit': 100}).then(function(responseJson) {
        var items;
        try {
            items = responseJson.data.children;
        } catch(e) {
            logger.logError('No subreddits');
            return;
        }

        logger.logDebug(util.format('Got subreddits {length: %s}', items.length));

        var subreddits = {};
        items.forEach(function(item) {
            subreddits[item.data.display_name] = getPopularityGroup(item.data.subscribers);
        });

        getUpdates(subreddits);
    }, function(error) {
        logger.logError(util.format('Can not get subreddits: %s', error));
    });
});
